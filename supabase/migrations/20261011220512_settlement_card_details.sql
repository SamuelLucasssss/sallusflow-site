-- Keep legacy card receipts explicit; never infer credit/debit or due dates.
alter table public.payments
  add column card_type text check (card_type in ('credit','debit')),
  add column installment_dates date[] not null default '{}'::date[],
  add constraint payments_card_details_check check (
    (card_type is null and cardinality(installment_dates)=0)
    or (card_type is not null and method='Cartão' and (
      (card_type='debit' and cardinality(installment_dates)=0)
      or (card_type='credit' and cardinality(installment_dates) between 1 and 24
        and array_ndims(installment_dates)=1 and array_position(installment_dates,null) is null)
    ))
  );

create or replace function private.add_uti_card_payment_impl(
  p_admission_id uuid,p_occurred_at timestamptz,p_amount numeric,
  p_card_type text,p_installment_dates date[],p_notes text,p_client_ref text
)
returns text language plpgsql security definer
set search_path = public, private, pg_temp
as $$
declare
  v_status text;
  v_date date;
  v_previous date;
  v_existing public.payments;
begin
  if auth.uid() is null or not private.has_permission('add_payment') then
    raise exception 'Seu perfil não pode registrar pagamentos.';
  end if;
  if p_card_type is null or p_card_type not in ('credit','debit') then
    raise exception 'Informe crédito ou débito.';
  end if;
  if p_occurred_at is null then raise exception 'Informe a data e hora do pagamento.'; end if;
  if nullif(trim(coalesce(p_client_ref,'')),'') is null then raise exception 'Identificador da operação ausente.'; end if;
  if p_installment_dates is null then raise exception 'Informe os vencimentos.'; end if;
  if p_card_type='debit' and cardinality(p_installment_dates)<>0 then raise exception 'Débito não admite parcelas.'; end if;
  if p_card_type='credit' then
    if cardinality(p_installment_dates) not between 1 and 24 or array_ndims(p_installment_dates)<>1 then
      raise exception 'Informe de 1 a 24 vencimentos.';
    end if;
    foreach v_date in array p_installment_dates loop
      if v_date is null or v_date<(p_occurred_at at time zone 'America/Sao_Paulo')::date then
        raise exception 'Vencimento ausente ou anterior ao recebimento.';
      end if;
      if v_previous is not null and v_date<=v_previous then raise exception 'Os vencimentos devem estar em ordem crescente.'; end if;
      v_previous:=v_date;
    end loop;
  end if;

  -- Same admission lock as the existing receipt operation; details commit atomically.
  perform 1 from public.admissions where id=p_admission_id for update;
  if not found then raise exception 'Internação não encontrada.'; end if;
  select * into v_existing from public.payments
  where admission_id=p_admission_id and client_ref=trim(p_client_ref);
  if found then
    if v_existing.cancelled_at is not null then raise exception 'Este recebimento foi cancelado. Inicie uma nova operação.'; end if;
    if v_existing.card_type is distinct from p_card_type
      or v_existing.installment_dates is distinct from p_installment_dates
      or v_existing.amount is distinct from round(p_amount,2)
      or v_existing.occurred_at is distinct from p_occurred_at then
      raise exception 'Identificador já utilizado em outro recebimento.';
    end if;
    return private.reconcile_admission_status(p_admission_id);
  end if;
  v_status:=private.add_uti_payment_impl(p_admission_id,p_occurred_at,p_amount,'Cartão',p_notes,p_client_ref);
  update public.payments set card_type=p_card_type,installment_dates=p_installment_dates
  where admission_id=p_admission_id and client_ref=trim(p_client_ref);
  insert into public.audits(admission_id,user_name,user_id,action,detail)
  values(p_admission_id,private.current_display_name(),auth.uid(),'Detalhes do cartão registrados',
    case when p_card_type='credit' then 'Crédito • '||cardinality(p_installment_dates)||'x • Vencimentos: '||array_to_string(p_installment_dates,', ')
    else 'Débito' end);
  return v_status;
end;
$$;

create or replace function public.add_uti_card_payment(
  p_admission_id uuid,p_occurred_at timestamptz,p_amount numeric,
  p_card_type text,p_installment_dates date[],p_notes text,p_client_ref text
)
returns text language sql security invoker
set search_path = public, private, pg_temp
as $$
  select private.add_uti_card_payment_impl(p_admission_id,p_occurred_at,p_amount,p_card_type,p_installment_dates,p_notes,p_client_ref);
$$;
revoke all on function private.add_uti_card_payment_impl(uuid,timestamptz,numeric,text,date[],text,text) from public,anon;
grant execute on function private.add_uti_card_payment_impl(uuid,timestamptz,numeric,text,date[],text,text) to authenticated;
revoke all on function public.add_uti_card_payment(uuid,timestamptz,numeric,text,date[],text,text) from public,anon;
grant execute on function public.add_uti_card_payment(uuid,timestamptz,numeric,text,date[],text,text) to authenticated;

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
    'occurredAt',p.occurred_at,'amount',p.amount,'method',p.method,
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
