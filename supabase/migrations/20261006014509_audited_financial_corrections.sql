alter table public.payments add column if not exists cancelled_at timestamptz;
alter table public.payments add column if not exists cancelled_by uuid references public.profiles(id);
alter table public.payments add column if not exists cancel_reason text;
alter table public.charges add column if not exists cancelled_at timestamptz;
alter table public.charges add column if not exists cancelled_by uuid references public.profiles(id);
alter table public.charges add column if not exists cancel_reason text;
create index if not exists payments_cancelled_by_idx on public.payments(cancelled_by);
create index if not exists charges_cancelled_by_idx on public.charges(cancelled_by);

CREATE OR REPLACE FUNCTION private.reconcile_admission_status(p_admission_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  a public.admissions;
  v_billed numeric;
  v_received numeric;
  v_balance numeric;
  v_status text;
begin
  select * into a from public.admissions where id=p_admission_id for update;
  if not found then raise exception 'Internação não encontrada.'; end if;
  if a.status='cancelled' then return 'cancelled'; end if;

  select coalesce(sum(amount),0) into v_billed
  from public.charges
  where admission_id=p_admission_id and cancelled_at is null;

  select coalesce(sum(amount),0) into v_received
  from public.payments
  where admission_id=p_admission_id and cancelled_at is null;

  v_balance:=v_billed-v_received;

  if a.discharge_at is null then
    v_status:='active';
  else
    v_status:=case when abs(v_balance)<=0.009 then 'finalized' else 'discharge_pending' end;
  end if;

  update public.admissions set status=v_status where id=p_admission_id;
  return v_status;
end;
$function$;

CREATE OR REPLACE FUNCTION private.add_uti_payment_impl(p_admission_id uuid, p_occurred_at timestamp with time zone, p_amount numeric, p_method text, p_notes text, p_client_ref text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_user text;
  v_status text;
  v_entry_at timestamptz;
  v_balance numeric;
  v_id uuid;
begin
  if not private.is_active_member() then raise exception 'Acesso não autorizado.'; end if;
  v_user := private.current_display_name();

  if p_occurred_at is null then raise exception 'Informe a data e hora do pagamento.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Valor do pagamento inválido.'; end if;
  if p_method not in ('PIX','Cartão','Transferência','Dinheiro','Outro') then raise exception 'Forma de pagamento inválida.'; end if;

  select status,entry_at into v_status,v_entry_at
  from public.admissions where id=p_admission_id for update;

  if not found then raise exception 'Internação não encontrada.'; end if;
  if v_status='cancelled' then raise exception 'Não é possível registrar pagamento em internação cancelada.'; end if;
  if v_status='finalized' then raise exception 'A conta já está finalizada.'; end if;
  if p_occurred_at < v_entry_at then raise exception 'O pagamento não pode ter data anterior à entrada.'; end if;
  if p_occurred_at > now() + interval '10 minutes' then raise exception 'O pagamento não pode ser registrado no futuro.'; end if;

  if v_status='active' then
    perform private.sync_daily_charges(p_admission_id,null,v_user);
  end if;

  select
    coalesce((select sum(c.amount) from public.charges c where c.admission_id=p_admission_id and c.cancelled_at is null),0)
    - coalesce((select sum(pm.amount) from public.payments pm where pm.admission_id=p_admission_id and pm.cancelled_at is null),0)
  into v_balance;

  if v_balance <= 0.009 then raise exception 'Não há saldo pendente para receber.'; end if;
  if p_amount > v_balance + 0.009 then
    raise exception 'O pagamento informado é maior que o saldo pendente de R$ %.', to_char(v_balance,'FM999G999G990D00');
  end if;

  insert into public.payments(admission_id,occurred_at,amount,method,notes,created_by_name,created_by,client_ref)
  values(
    p_admission_id,p_occurred_at,p_amount,p_method,nullif(trim(coalesce(p_notes,'')),''),v_user,auth.uid(),
    nullif(trim(coalesce(p_client_ref,'')),'')
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is null then return v_status; end if;

  insert into public.audits(admission_id,user_name,user_id,action,detail)
  values(p_admission_id,v_user,auth.uid(),'Pagamento registrado','R$ '||to_char(p_amount,'FM999G999G990D00')||' • '||p_method);

  if v_status='discharge_pending' then
    v_status:=private.reconcile_admission_status(p_admission_id);
    if v_status='finalized' then
      insert into public.audits(admission_id,user_name,user_id,action,detail)
      values(p_admission_id,v_user,auth.uid(),'Conta finalizada','Saldo quitado após a alta.');
    end if;
  end if;

  return v_status;
end;
$function$;

CREATE OR REPLACE FUNCTION private.discharge_uti_impl(p_admission_id uuid, p_discharge_at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_user text;
  a public.admissions;
  v_billed numeric;
  v_received numeric;
  v_balance numeric;
  v_status text;
  v_trimmed integer := 0;
  v_rebuild jsonb;
  v_rebuild_diff numeric := 0;
begin
  if not private.is_active_member() then raise exception 'Acesso não autorizado.'; end if;
  v_user := private.current_display_name();

  select * into a from public.admissions where id=p_admission_id for update;
  if not found then raise exception 'Internação não encontrada.'; end if;
  if a.status='cancelled' then raise exception 'Internação cancelada não pode receber alta.'; end if;
  if a.status='finalized' then raise exception 'Esta internação já está finalizada.'; end if;
  if a.status='discharge_pending' then return 'discharge_pending'; end if;
  if p_discharge_at is null then raise exception 'Informe a data e hora de saída.'; end if;
  if p_discharge_at<a.entry_at then raise exception 'A saída não pode ser anterior à entrada.'; end if;
  if p_discharge_at>now()+interval '10 minutes' then raise exception 'A saída não pode ser registrada no futuro.'; end if;

  v_trimmed:=private.trim_future_daily_charges(p_admission_id,p_discharge_at);
  v_rebuild:=private.rebuild_daily_charges(p_admission_id,p_discharge_at,v_user);
  v_rebuild_diff:=coalesce((v_rebuild->>'difference')::numeric,0);

  select coalesce(sum(amount),0) into v_billed
  from public.charges where admission_id=p_admission_id and cancelled_at is null;

  select coalesce(sum(amount),0) into v_received
  from public.payments where admission_id=p_admission_id and cancelled_at is null;

  v_balance:=v_billed-v_received;
  v_status:=case when abs(v_balance)<=0.009 then 'finalized' else 'discharge_pending' end;

  update public.admissions set discharge_at=p_discharge_at,status=v_status where id=p_admission_id;

  if v_trimmed>0 then
    insert into public.audits(admission_id,user_name,user_id,action,detail)
    values(p_admission_id,v_user,auth.uid(),'Diária automática ajustada',
      v_trimmed::text||case when v_trimmed=1 then ' diária removida' else ' diárias removidas' end||
      ' por ocorrer no dia da saída ou após ele.');
  end if;

  if abs(v_rebuild_diff)>0.009 then
    insert into public.audits(admission_id,user_name,user_id,action,detail)
    values(p_admission_id,v_user,auth.uid(),'Diárias automáticas reconciliadas',
      'Valores recalculados pelo histórico de condições antes do acerto • diferença R$ '||
      to_char(v_rebuild_diff,'FM999G999G990D00'));
  end if;

  insert into public.audits(admission_id,user_name,user_id,action,detail)
  values(p_admission_id,v_user,auth.uid(),
    case when v_status='finalized' then 'Alta e acerto finalizados' else 'Alta registrada' end,
    'Saída '||to_char(p_discharge_at at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')||
    ' • Total R$ '||to_char(v_billed,'FM999G999G990D00')||
    ' • Recebido R$ '||to_char(v_received,'FM999G999G990D00')||
    ' • Saldo R$ '||to_char(v_balance,'FM999G999G990D00'));

  return v_status;
end;
$function$;

CREATE OR REPLACE FUNCTION public.preview_uti_settlement(p_admission_id uuid, p_discharge_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  a public.admissions;
  r public.rate_periods;
  v_entry_local timestamp;
  v_discharge_date date;
  v_next_date date;
  v_cycle timestamptz;
  v_daily_total numeric := 0;
  v_extras_total numeric := 0;
  v_received numeric := 0;
  v_full_count integer := 0;
  v_half_count integer := 0;
  v_units numeric := 0;
  v_items jsonb := '[]'::jsonb;
  v_extra_items jsonb := '[]'::jsonb;
  v_payments jsonb := '[]'::jsonb;
  v_amount numeric;
  v_stay_minutes bigint;
begin
  if not private.is_active_member() then raise exception 'Acesso não autorizado.'; end if;

  select * into a from public.admissions where id=p_admission_id;
  if not found then raise exception 'Internação não encontrada.'; end if;
  if p_discharge_at is null then raise exception 'Informe a data e hora de saída.'; end if;
  if p_discharge_at<a.entry_at then raise exception 'A saída não pode ser anterior à entrada.'; end if;

  v_discharge_date:=(p_discharge_at at time zone 'America/Sao_Paulo')::date;

  select * into r from public.rate_periods
  where admission_id=a.id and effective_at<=a.entry_at
  order by effective_at desc,created_at desc limit 1;
  if not found then raise exception 'Condição de diária não encontrada.'; end if;

  v_amount:=case when a.half_initial then r.negotiated_rate/2 else r.negotiated_rate end;
  v_daily_total:=v_daily_total+v_amount;
  if a.half_initial then v_half_count:=1;v_units:=0.5; else v_full_count:=1;v_units:=1; end if;

  v_items:=v_items||jsonb_build_array(jsonb_build_object(
    'occurredAt',a.entry_at,'description',
    case when a.half_initial then '½ diária inicial — '||r.label else 'Diária inicial — '||r.label end,
    'amount',v_amount,'units',case when a.half_initial then 0.5 else 1 end,'kind','daily'));

  v_entry_local:=a.entry_at at time zone 'America/Sao_Paulo';
  v_next_date:=v_entry_local::date+1;
  v_cycle:=(v_next_date+time '07:00') at time zone 'America/Sao_Paulo';

  while (v_cycle at time zone 'America/Sao_Paulo')::date<v_discharge_date loop
    select * into r from public.rate_periods
    where admission_id=a.id and effective_at<=v_cycle
    order by effective_at desc,created_at desc limit 1;
    if found then
      v_daily_total:=v_daily_total+r.negotiated_rate;
      v_full_count:=v_full_count+1;v_units:=v_units+1;
      v_items:=v_items||jsonb_build_array(jsonb_build_object(
        'occurredAt',v_cycle,'description','Diária — '||r.label,
        'amount',r.negotiated_rate,'units',1,'kind','daily'));
    end if;
    v_next_date:=v_next_date+1;
    v_cycle:=(v_next_date+time '07:00') at time zone 'America/Sao_Paulo';
  end loop;

  select coalesce(sum(amount),0) into v_extras_total
  from public.charges where admission_id=a.id and kind<>'daily' and cancelled_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'occurredAt',c.occurred_at,'description',c.description,'category',c.category,
    'amount',c.amount,'kind',c.kind) order by c.occurred_at),'[]'::jsonb)
  into v_extra_items
  from public.charges c
  where c.admission_id=a.id and c.kind<>'daily' and c.cancelled_at is null;

  v_items:=v_items||v_extra_items;

  select coalesce(sum(amount),0) into v_received
  from public.payments where admission_id=a.id and cancelled_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'occurredAt',p.occurred_at,'amount',p.amount,'method',p.method,
    'notes',p.notes,'createdBy',p.created_by_name) order by p.occurred_at),'[]'::jsonb)
  into v_payments
  from public.payments p
  where p.admission_id=a.id and p.cancelled_at is null;

  v_stay_minutes:=greatest(0,floor(extract(epoch from (p_discharge_at-a.entry_at))/60));

  return jsonb_build_object(
    'admissionId',a.id,'entryAt',a.entry_at,'dischargeAt',p_discharge_at,
    'stayMinutes',v_stay_minutes,'dailyUnits',v_units,'fullDailyCount',v_full_count,
    'halfDailyCount',v_half_count,'dailyTotal',v_daily_total,'extrasTotal',v_extras_total,
    'total',v_daily_total+v_extras_total,'received',v_received,
    'balance',(v_daily_total+v_extras_total)-v_received,'items',v_items,'payments',v_payments);
end;
$function$;

CREATE OR REPLACE FUNCTION private.cancel_uti_payment_impl(p_payment_id uuid, p_reason text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_user text;
  p public.payments;
  v_status text;
begin
  if not private.is_active_member() then raise exception 'Acesso não autorizado.'; end if;
  if length(trim(coalesce(p_reason,'')))<3 then raise exception 'Informe o motivo do estorno.'; end if;
  v_user:=private.current_display_name();

  select * into p from public.payments where id=p_payment_id for update;
  if not found then raise exception 'Pagamento não encontrado.'; end if;
  if p.cancelled_at is not null then
    select status into v_status from public.admissions where id=p.admission_id;
    return v_status;
  end if;

  perform 1 from public.admissions where id=p.admission_id for update;

  update public.payments
  set cancelled_at=now(),cancelled_by=auth.uid(),cancel_reason=trim(p_reason)
  where id=p_payment_id;

  v_status:=private.reconcile_admission_status(p.admission_id);

  insert into public.audits(admission_id,user_name,user_id,action,detail)
  values(p.admission_id,v_user,auth.uid(),'Pagamento estornado',
    'R$ '||to_char(p.amount,'FM999G999G990D00')||' • '||p.method||' • Motivo: '||trim(p_reason));

  return v_status;
end;
$function$;

CREATE OR REPLACE FUNCTION private.cancel_uti_extra_impl(p_charge_id uuid, p_reason text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_user text;
  c public.charges;
  v_status text;
begin
  if not private.is_active_member() then raise exception 'Acesso não autorizado.'; end if;
  if length(trim(coalesce(p_reason,'')))<3 then raise exception 'Informe o motivo do cancelamento.'; end if;
  v_user:=private.current_display_name();

  select * into c from public.charges where id=p_charge_id for update;
  if not found then raise exception 'Cobrança não encontrada.'; end if;
  if c.kind='daily' then raise exception 'Diárias automáticas não podem ser canceladas manualmente.'; end if;
  if c.cancelled_at is not null then
    select status into v_status from public.admissions where id=c.admission_id;
    return v_status;
  end if;

  perform 1 from public.admissions where id=c.admission_id for update;

  update public.charges
  set cancelled_at=now(),cancelled_by=auth.uid(),cancel_reason=trim(p_reason)
  where id=p_charge_id;

  v_status:=private.reconcile_admission_status(c.admission_id);

  insert into public.audits(admission_id,user_name,user_id,action,detail)
  values(c.admission_id,v_user,auth.uid(),'Cobrança extra cancelada',
    c.category||' • R$ '||to_char(c.amount,'FM999G999G990D00')||' • Motivo: '||trim(p_reason));

  return v_status;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_uti_payment(p_payment_id uuid, p_reason text)
 RETURNS text
 LANGUAGE sql
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$ select private.cancel_uti_payment_impl(p_payment_id,p_reason) $function$;

CREATE OR REPLACE FUNCTION public.cancel_uti_extra(p_charge_id uuid, p_reason text)
 RETURNS text
 LANGUAGE sql
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$ select private.cancel_uti_extra_impl(p_charge_id,p_reason) $function$;

revoke all on function private.reconcile_admission_status(uuid) from public,anon,authenticated;
revoke all on function private.cancel_uti_payment_impl(uuid,text) from public,anon;
grant execute on function private.cancel_uti_payment_impl(uuid,text) to authenticated;
revoke all on function private.cancel_uti_extra_impl(uuid,text) from public,anon;
grant execute on function private.cancel_uti_extra_impl(uuid,text) to authenticated;
revoke all on function public.cancel_uti_payment(uuid,text) from public,anon;
grant execute on function public.cancel_uti_payment(uuid,text) to authenticated;
revoke all on function public.cancel_uti_extra(uuid,text) from public,anon;
grant execute on function public.cancel_uti_extra(uuid,text) to authenticated;
