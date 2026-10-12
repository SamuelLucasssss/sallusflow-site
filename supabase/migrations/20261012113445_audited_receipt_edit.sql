-- Administrative corrections preserve the receipt identity and immutable history.
create table public.payment_edits (
 id uuid primary key default gen_random_uuid(),
 payment_id uuid not null references public.payments(id) on delete restrict,
 client_ref text not null check (length(client_ref) between 16 and 120),
 created_at timestamptz not null default now(),
 created_by uuid not null references public.profiles(id),
 reason text not null check (length(reason) between 8 and 220),
 before_data jsonb not null,
 after_data jsonb not null,
 unique(payment_id,client_ref)
);
create index payment_edits_created_by_idx on public.payment_edits(created_by);
alter table public.payment_edits enable row level security;
create policy payment_edits_admin_read on public.payment_edits for select to authenticated using (private.is_admin());
revoke all on public.payment_edits from public,anon,authenticated;
grant select on public.payment_edits to authenticated;

create function private.edit_uti_payment_impl(
 p_payment_id uuid,p_expected_version bigint,p_amount numeric,p_occurred_at timestamptz,
 p_method text,p_card_type text,p_installment_dates date[],p_notes text,p_reason text,p_client_ref text
) returns text language plpgsql security definer set search_path=public,private,pg_temp as $$
declare
 a public.admissions; p public.payments; v_after public.payments; e public.payment_edits;
 v_admission uuid; v_reason text:=trim(coalesce(p_reason,'')); v_ref text:=trim(coalesce(p_client_ref,''));
 v_notes text:=nullif(trim(coalesce(p_notes,'')),''); v_date date; v_previous date;
 v_billed numeric; v_received numeric; v_refunded numeric; v_reserved numeric; v_status text;
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Somente administradores podem editar recebimentos.'; end if;
 if length(v_reason) not between 8 and 220 then raise exception 'Informe o motivo da correção (8 a 220 caracteres).'; end if;
 if length(v_ref) not between 16 and 120 then raise exception 'Identificador da correção inválido.'; end if;
 if p_amount is null or p_amount in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
   or p_amount<=0 or p_amount>1000000 or p_amount<>round(p_amount,2) then raise exception 'Informe um valor positivo com até duas casas decimais.'; end if;
 if p_occurred_at is null or not isfinite(p_occurred_at) or p_occurred_at>now() then raise exception 'Informe a data real do recebimento, sem data futura.'; end if;
 if p_method is null or p_method not in ('PIX','Cartão','Transferência','Dinheiro','Outro') or length(coalesce(v_notes,''))>2000 then raise exception 'Forma de pagamento ou observação inválida.'; end if;
 if p_installment_dates is null then raise exception 'Informe os vencimentos do cartão.'; end if;
 if p_card_type is not null then
   if p_method<>'Cartão' or p_card_type not in ('credit','debit') then raise exception 'Informe crédito ou débito.'; end if;
   if p_card_type='credit' then
     if cardinality(p_installment_dates) not between 1 and 24 or array_ndims(p_installment_dates)<>1 then raise exception 'Informe de 1 a 24 vencimentos.'; end if;
     foreach v_date in array p_installment_dates loop
       if v_date is null or not isfinite(v_date) or v_date<(p_occurred_at at time zone 'America/Sao_Paulo')::date then raise exception 'Vencimento ausente, inválido ou anterior ao recebimento.'; end if;
       if v_previous is not null and v_date<=v_previous then raise exception 'Os vencimentos devem estar em ordem crescente.'; end if;
       v_previous:=v_date;
     end loop;
   elsif cardinality(p_installment_dates)<>0 then raise exception 'Débito não admite parcelas.'; end if;
 elsif p_method='Cartão' or cardinality(p_installment_dates)<>0 then raise exception 'Informe crédito ou débito; outras formas não admitem parcelas.';
 end if;
 select admission_id into v_admission from public.payments where id=p_payment_id;
 if not found then raise exception 'Recebimento não encontrado.'; end if;
 -- Same admission-first lock order as all new receipt operations.
 select * into a from public.admissions where id=v_admission for update;
 select * into p from public.payments where id=p_payment_id and admission_id=a.id for update;
 if not found or p.cancelled_at is not null or a.status='cancelled' then raise exception 'Recebimento ou internação cancelados não podem ser editados.'; end if;
 if p_occurred_at<a.entry_at then raise exception 'O recebimento não pode ter data anterior à entrada.'; end if;
 select * into e from public.payment_edits where payment_id=p.id and client_ref=v_ref;
 if found then
   if e.created_by<>auth.uid() or e.reason<>v_reason or e.after_data<>to_jsonb(p)
     or p.amount<>p_amount or p.occurred_at<>p_occurred_at or p.method<>p_method
     or p.card_type is distinct from p_card_type or p.installment_dates is distinct from p_installment_dates
     or p.notes is distinct from v_notes then raise exception 'Identificador já utilizado em outra correção.'; end if;
   return a.status;
 end if;
 if p_expected_version is null or a.account_version<>p_expected_version then raise exception 'A conta foi alterada. Atualize a página e confira o recebimento antes de editar.'; end if;
 if p.amount=p_amount and p.occurred_at=p_occurred_at and p.method=p_method and p.card_type is not distinct from p_card_type
   and p.installment_dates is not distinct from p_installment_dates and p.notes is not distinct from v_notes then raise exception 'Nenhuma alteração informada.'; end if;
 select coalesce(sum(amount),0) into v_billed from public.charges where admission_id=a.id and cancelled_at is null;
 select coalesce(sum(amount),0) into v_received from public.payments where admission_id=a.id and cancelled_at is null;
 select coalesce(sum(amount),0) into v_refunded from public.refunds where admission_id=a.id and cancelled_at is null;
 if p_amount<p.amount and v_received-p.amount+p_amount<v_refunded then raise exception 'O valor corrigido ficaria abaixo dos reembolsos já realizados.'; end if;
 if p_amount>p.amount then
   select coalesce(sum(amount),0) into v_reserved from public.scheduled_receipts where admission_id=a.id and status='pending';
   if v_billed-v_received+v_refunded+p.amount-p_amount<v_reserved-0.009 then raise exception 'O valor corrigido ultrapassa o saldo disponível, considerando os recebimentos previstos.'; end if;
 end if;
 update public.payments set amount=p_amount,occurred_at=p_occurred_at,method=p_method,card_type=p_card_type,
   installment_dates=p_installment_dates,notes=v_notes where id=p.id returning * into v_after;
 insert into public.payment_edits(payment_id,client_ref,created_by,reason,before_data,after_data)
 values(p.id,v_ref,auth.uid(),v_reason,to_jsonb(p),to_jsonb(v_after));
 v_status:=private.reconcile_admission_status(a.id);
 insert into public.audits(admission_id,user_name,user_id,action,detail)
 values(a.id,private.current_display_name(),auth.uid(),'Recebimento editado',
   'Recebimento '||p.id||' • Antes: R$ '||p.amount||' • '||to_char(p.occurred_at at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')||' • '||p.method||coalesce(' / '||p.card_type,'')||' • Vencimentos: '||coalesce(nullif(array_to_string(p.installment_dates,', '),''),'nenhum')||
   ' • Depois: R$ '||v_after.amount||' • '||to_char(v_after.occurred_at at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')||' • '||v_after.method||coalesce(' / '||v_after.card_type,'')||' • Vencimentos: '||coalesce(nullif(array_to_string(v_after.installment_dates,', '),''),'nenhum')||' • Motivo: '||v_reason);
 return v_status;
end;
$$;
create function public.edit_uti_payment(
 p_payment_id uuid,p_expected_version bigint,p_amount numeric,p_occurred_at timestamptz,
 p_method text,p_card_type text,p_installment_dates date[],p_notes text,p_reason text,p_client_ref text
) returns text language sql security invoker set search_path=public,private,pg_temp as $$
 select private.edit_uti_payment_impl(p_payment_id,p_expected_version,p_amount,p_occurred_at,p_method,p_card_type,p_installment_dates,p_notes,p_reason,p_client_ref);
$$;
revoke all on function private.edit_uti_payment_impl(uuid,bigint,numeric,timestamptz,text,text,date[],text,text,text) from public,anon;
revoke all on function public.edit_uti_payment(uuid,bigint,numeric,timestamptz,text,text,date[],text,text,text) from public,anon;
grant execute on function private.edit_uti_payment_impl(uuid,bigint,numeric,timestamptz,text,text,date[],text,text,text) to authenticated;
grant execute on function public.edit_uti_payment(uuid,bigint,numeric,timestamptz,text,text,date[],text,text,text) to authenticated;

-- Receipt identities allow precise edits from the settlement preview. Calculations are unchanged.
create or replace function private.preview_uti_settlement_impl(
  p_admission_id uuid,
  p_discharge_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  a public.admissions;
  d record;
  v_daily_total numeric:=0;
  v_extras_total numeric:=0;
  v_received numeric:=0;
  v_refunded numeric:=0;
  v_full_count integer:=0;
  v_half_count integer:=0;
  v_units numeric:=0;
  v_items jsonb:='[]'::jsonb;
  v_extra_items jsonb:='[]'::jsonb;
  v_payments jsonb:='[]'::jsonb;
  v_refunds jsonb:='[]'::jsonb;
  v_stay_minutes bigint;
begin
  if not private.is_active_member() then raise exception 'Acesso não autorizado.'; end if;

  select * into a from public.admissions where id=p_admission_id;
  if not found then raise exception 'Internação não encontrada.'; end if;
  if p_discharge_at is null then raise exception 'Informe a data e hora de saída.'; end if;
  if p_discharge_at<a.entry_at then raise exception 'A saída não pode ser anterior à entrada.'; end if;
  if p_discharge_at>now()+interval '10 minutes' then raise exception 'A saída não pode ser registrada no futuro.'; end if;

  if exists(
    select 1 from public.charges c
    where c.admission_id=a.id
      and c.cancelled_at is null
      and c.kind<>'daily'
      and c.occurred_at>p_discharge_at
  ) then
    raise exception 'Existem cobranças extras posteriores ao horário de saída. Corrija os lançamentos antes de registrar a alta.';
  end if;

  for d in select * from private.compute_daily_charge_rows(a.id,p_discharge_at)
  loop
    v_daily_total:=v_daily_total+d.amount;
    if d.description like '½ diária inicial%' then
      v_half_count:=v_half_count+1;
      v_units:=v_units+0.5;
    else
      v_full_count:=v_full_count+1;
      v_units:=v_units+1;
    end if;
    v_items:=v_items||jsonb_build_array(jsonb_build_object(
      'occurredAt',d.occurred_at,'description',d.description,'amount',d.amount,
      'units',case when d.description like '½ diária inicial%' then 0.5 else 1 end,'kind','daily'
    ));
  end loop;

  select coalesce(sum(amount),0) into v_extras_total
  from public.charges
  where admission_id=a.id and kind<>'daily' and cancelled_at is null;

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
    'id',p.id,'admissionId',p.admission_id,'occurredAt',p.occurred_at,'amount',p.amount,'method',p.method,
    'notes',p.notes,'createdBy',p.created_by_name,'cardType',p.card_type,'installmentDates',p.installment_dates) order by p.occurred_at),'[]'::jsonb)
  into v_payments
  from public.payments p
  where p.admission_id=a.id and p.cancelled_at is null;

  select coalesce(sum(amount),0) into v_refunded
  from public.refunds where admission_id=a.id and cancelled_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'occurredAt',r.occurred_at,'amount',r.amount,'method',r.method,
    'notes',r.notes,'createdBy',r.created_by_name) order by r.occurred_at),'[]'::jsonb)
  into v_refunds
  from public.refunds r
  where r.admission_id=a.id and r.cancelled_at is null;

  v_stay_minutes:=greatest(0,floor(extract(epoch from (p_discharge_at-a.entry_at))/60));

  return jsonb_build_object(
    'admissionId',a.id,
    'accountVersion',a.account_version,
    'entryAt',a.entry_at,
    'dischargeAt',p_discharge_at,
    'stayMinutes',v_stay_minutes,
    'dailyUnits',v_units,
    'fullDailyCount',v_full_count,
    'halfDailyCount',v_half_count,
    'dailyTotal',v_daily_total,
    'extrasTotal',v_extras_total,
    'total',v_daily_total+v_extras_total,
    'received',v_received,
    'refunded',v_refunded,
    'netReceived',v_received-v_refunded,
    'balance',(v_daily_total+v_extras_total)-v_received+v_refunded,
    'items',v_items,
    'payments',v_payments,
    'refunds',v_refunds
  );
end;
$$;
