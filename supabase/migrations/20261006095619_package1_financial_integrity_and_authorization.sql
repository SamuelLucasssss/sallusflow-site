-- Package 1 hardening: immutable ledger, credits/refunds, atomic settlement,
-- commercial closers, and server-side authorization.

create table if not exists public.commercial_closers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  display_name text not null unique,
  commission_amount numeric not null default 0 check (commission_amount >= 0 and commission_amount = round(commission_amount,2)),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.commercial_closers(code,display_name,commission_amount,active)
values
  ('samuel','Samuel',80,true),
  ('roberto','Roberto',80,true),
  ('aline','Aline',0,true)
on conflict (code) do update set
  display_name=excluded.display_name,
  commission_amount=excluded.commission_amount,
  active=excluded.active;

alter table public.commercial_closers enable row level security;

drop policy if exists commercial_closers_read_active on public.commercial_closers;
create policy commercial_closers_read_active
on public.commercial_closers for select to authenticated
using (private.is_active_member());

revoke all on table public.commercial_closers from anon;
revoke insert, update, delete on table public.commercial_closers from authenticated;
grant select on table public.commercial_closers to authenticated;

alter table public.admissions
  add column if not exists closer_id uuid references public.commercial_closers(id),
  add column if not exists account_version bigint not null default 1;

create index if not exists admissions_closer_id_idx on public.admissions(closer_id);

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null references public.admissions(id) on delete restrict,
  occurred_at timestamptz not null,
  amount numeric not null check (amount > 0 and amount = round(amount,2)),
  method text not null check (method in ('PIX','Cartão','Transferência','Dinheiro','Outro')),
  notes text,
  created_by_name text not null,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  client_ref text,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id),
  cancel_reason text
);

create index if not exists refunds_admission_occurred_idx on public.refunds(admission_id,occurred_at);
create index if not exists refunds_created_by_idx on public.refunds(created_by);
create index if not exists refunds_cancelled_by_idx on public.refunds(cancelled_by);
create unique index if not exists refunds_admission_client_ref_unique
  on public.refunds(admission_id,client_ref) where client_ref is not null;

alter table public.refunds enable row level security;
drop policy if exists refunds_read_active on public.refunds;
create policy refunds_read_active
on public.refunds for select to authenticated
using (private.is_active_member());

revoke all on table public.refunds from anon;
revoke insert, update, delete on table public.refunds from authenticated;
grant select on table public.refunds to authenticated;

-- Preserve daily-charge history: only one ACTIVE charge may own a cycle key.
drop index if exists public.charges_cycle_unique;
create unique index if not exists charges_cycle_active_unique
  on public.charges(admission_id,cycle_key)
  where cycle_key is not null and cancelled_at is null;

create or replace function private.current_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.role
  from public.profiles p
  where p.id=auth.uid() and p.active=true
$$;

create or replace function private.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select case private.current_role()
    when 'admin' then true
    when 'commercial' then p_permission in (
      'create_admission','add_extra','add_payment','adjust_rate','discharge','update_on_duty'
    )
    when 'operator' then p_permission in (
      'create_admission','add_extra','discharge'
    )
    else false
  end
$$;

create or replace function private.bump_account_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.admissions
  set account_version=account_version+1
  where id=case when tg_op='DELETE' then old.admission_id else new.admission_id end;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists charges_bump_account_version on public.charges;
create trigger charges_bump_account_version
after insert or update on public.charges
for each row execute function private.bump_account_version();

drop trigger if exists payments_bump_account_version on public.payments;
create trigger payments_bump_account_version
after insert or update on public.payments
for each row execute function private.bump_account_version();

drop trigger if exists refunds_bump_account_version on public.refunds;
create trigger refunds_bump_account_version
after insert or update on public.refunds
for each row execute function private.bump_account_version();

drop trigger if exists rates_bump_account_version on public.rate_periods;
create trigger rates_bump_account_version
after insert or update on public.rate_periods
for each row execute function private.bump_account_version();

create or replace function private.compute_daily_charge_rows(
  p_admission_id uuid,
  p_limit_at timestamptz default null
)
returns table(
  cycle_key text,
  occurred_at timestamptz,
  category text,
  description text,
  amount numeric
)
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  a public.admissions;
  r public.rate_periods;
  v_entry_local timestamp;
  v_now_local timestamp;
  v_active_cycle_limit_date date;
  v_next_date date;
  v_cycle timestamptz;
  v_end timestamptz;
  v_discharge_date date;
  v_has_discharge_cutoff boolean;
begin
  select * into a from public.admissions where id=p_admission_id;
  if not found then return; end if;

  v_now_local := now() at time zone 'America/Sao_Paulo';
  v_end := coalesce(p_limit_at,a.discharge_at,now());
  v_has_discharge_cutoff := (p_limit_at is not null or a.discharge_at is not null);

  if v_has_discharge_cutoff then
    v_discharge_date := (v_end at time zone 'America/Sao_Paulo')::date;
  else
    v_active_cycle_limit_date :=
      v_now_local::date - case when v_now_local::time < time '07:00' then 1 else 0 end;
  end if;

  if a.entry_at > v_end then return; end if;

  select * into r
  from public.rate_periods
  where admission_id=a.id and effective_at<=a.entry_at
  order by effective_at desc,created_at desc
  limit 1;

  if found then
    cycle_key := 'initial:'||a.id::text||':'||extract(epoch from a.entry_at)::text;
    occurred_at := a.entry_at;
    category := case when a.mode='private' then 'Diária UTI' else 'Hotelaria' end;
    description := case when a.half_initial then '½ diária inicial — '||r.label else 'Diária inicial — '||r.label end;
    amount := round(case when a.half_initial then r.negotiated_rate/2 else r.negotiated_rate end,2);
    return next;
  end if;

  v_entry_local:=a.entry_at at time zone 'America/Sao_Paulo';
  v_next_date:=v_entry_local::date+1;
  v_cycle:=(v_next_date+time '07:00') at time zone 'America/Sao_Paulo';

  while
    v_cycle < v_end
    and (
      (v_has_discharge_cutoff and (v_cycle at time zone 'America/Sao_Paulo')::date < v_discharge_date)
      or
      (not v_has_discharge_cutoff and (v_cycle at time zone 'America/Sao_Paulo')::date < v_active_cycle_limit_date)
    )
  loop
    select * into r
    from public.rate_periods
    where admission_id=a.id and effective_at<=v_cycle
    order by effective_at desc,created_at desc
    limit 1;

    if found then
      cycle_key := 'cycle:'||a.id::text||':'||extract(epoch from v_cycle)::text;
      occurred_at := v_cycle;
      category := case when a.mode='private' then 'Diária UTI' else 'Hotelaria' end;
      description := 'Diária — '||r.label;
      amount := round(r.negotiated_rate,2);
      return next;
    end if;

    v_next_date:=v_next_date+1;
    v_cycle:=(v_next_date+time '07:00') at time zone 'America/Sao_Paulo';
  end loop;
end;
$$;

create or replace function private.sync_daily_charges(
  p_admission_id uuid default null,
  p_limit_at timestamptz default null,
  p_user_name text default 'Sistema'
)
returns integer
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  a record;
  d record;
  v_count integer:=0;
  v_inserted integer:=0;
begin
  for a in
    select id from public.admissions
    where status in ('active','discharge_pending')
      and (p_admission_id is null or id=p_admission_id)
  loop
    for d in select * from private.compute_daily_charge_rows(a.id,p_limit_at)
    loop
      insert into public.charges(
        admission_id,occurred_at,kind,category,description,amount,cycle_key,created_by_name,created_by
      )
      select a.id,d.occurred_at,'daily',d.category,d.description,d.amount,d.cycle_key,p_user_name,auth.uid()
      where not exists (
        select 1 from public.charges c
        where c.admission_id=a.id and c.cycle_key=d.cycle_key and c.cancelled_at is null
      )
      on conflict do nothing;
      get diagnostics v_inserted=row_count;
      v_count:=v_count+v_inserted;
    end loop;
  end loop;
  return v_count;
end;
$$;

create or replace function private.reconcile_daily_charges(
  p_admission_id uuid,
  p_limit_at timestamptz default null,
  p_user_name text default 'Sistema',
  p_reason text default 'Reconciliação automática de diária'
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_before numeric:=0;
  v_after numeric:=0;
  v_cancelled integer:=0;
  v_inserted integer:=0;
begin
  select coalesce(sum(amount),0) into v_before
  from public.charges
  where admission_id=p_admission_id and kind='daily' and cancelled_at is null;

  update public.charges c
  set cancelled_at=now(),
      cancelled_by=auth.uid(),
      cancel_reason=coalesce(nullif(trim(p_reason),''),'Reconciliação automática de diária')
  where c.admission_id=p_admission_id
    and c.kind='daily'
    and c.cancelled_at is null
    and not exists (
      select 1
      from private.compute_daily_charge_rows(p_admission_id,p_limit_at) d
      where d.cycle_key=c.cycle_key
        and d.occurred_at=c.occurred_at
        and d.category=c.category
        and d.description=c.description
        and d.amount=c.amount
    );
  get diagnostics v_cancelled=row_count;

  v_inserted:=private.sync_daily_charges(p_admission_id,p_limit_at,p_user_name);

  select coalesce(sum(amount),0) into v_after
  from public.charges
  where admission_id=p_admission_id and kind='daily' and cancelled_at is null;

  return jsonb_build_object(
    'cancelled',v_cancelled,
    'inserted',v_inserted,
    'before',v_before,
    'after',v_after,
    'difference',v_after-v_before
  );
end;
$$;

create or replace function private.rebuild_daily_charges(
  p_admission_id uuid,
  p_limit_at timestamptz default null,
  p_user_name text default 'Sistema'
)
returns jsonb
language sql
security definer
set search_path = public, private, pg_temp
as $$
  select private.reconcile_daily_charges(
    p_admission_id,p_limit_at,p_user_name,'Condição comercial/alta reconciliada'
  )
$$;

create or replace function private.trim_future_daily_charges(
  p_admission_id uuid,
  p_discharge_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_count integer:=0;
begin
  update public.charges c
  set cancelled_at=now(),
      cancelled_by=auth.uid(),
      cancel_reason='Diária invalidada por alta registrada'
  where c.admission_id=p_admission_id
    and c.kind='daily'
    and c.cancelled_at is null
    and not exists (
      select 1 from private.compute_daily_charge_rows(p_admission_id,p_discharge_at) d
      where d.cycle_key=c.cycle_key
        and d.occurred_at=c.occurred_at
        and d.amount=c.amount
        and d.description=c.description
    );
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

create or replace function private.reconcile_admission_status(p_admission_id uuid)
returns text
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  a public.admissions;
  v_billed numeric;
  v_received numeric;
  v_refunded numeric;
  v_balance numeric;
  v_status text;
begin
  select * into a from public.admissions where id=p_admission_id for update;
  if not found then raise exception 'Internação não encontrada.'; end if;
  if a.status='cancelled' then return 'cancelled'; end if;

  select coalesce(sum(amount),0) into v_billed
  from public.charges where admission_id=p_admission_id and cancelled_at is null;

  select coalesce(sum(amount),0) into v_received
  from public.payments where admission_id=p_admission_id and cancelled_at is null;

  select coalesce(sum(amount),0) into v_refunded
  from public.refunds where admission_id=p_admission_id and cancelled_at is null;

  v_balance:=v_billed-v_received+v_refunded;

  if a.discharge_at is null then
    v_status:='active';
  else
    v_status:=case when abs(v_balance)<=0.009 then 'finalized' else 'discharge_pending' end;
  end if;

  update public.admissions set status=v_status where id=p_admission_id;
  return v_status;
end;
$$;

create or replace function private.create_uti_admission_impl(
  p_name text,
  p_cpf text,
  p_bed integer,
  p_mode text,
  p_entry_at timestamptz,
  p_closer text,
  p_half_initial boolean,
  p_ventilation boolean,
  p_negotiated_rate numeric,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_user text;
  v_patient uuid;
  v_admission uuid;
  v_cpf text;
  v_standard numeric;
  v_label text;
  v_rate numeric;
  v_closer public.commercial_closers;
begin
  if not private.has_permission('create_admission') then raise exception 'Seu perfil não pode criar internações.'; end if;
  v_user:=private.current_display_name();
  v_cpf:=nullif(regexp_replace(coalesce(p_cpf,''),'\D','','g'),'');
  v_rate:=round(p_negotiated_rate,2);

  select * into v_closer
  from public.commercial_closers
  where active=true
    and (lower(code)=lower(trim(coalesce(p_closer,''))) or lower(display_name)=lower(trim(coalesce(p_closer,''))))
  limit 1;

  if not found then raise exception 'Responsável pelo fechamento inválido.'; end if;
  if length(trim(coalesce(p_name,'')))<2 then raise exception 'Informe o nome do paciente.'; end if;
  if v_cpf is not null and v_cpf !~ '^[0-9]{11}$' then raise exception 'CPF deve ter 11 dígitos.'; end if;
  if p_bed is null or p_bed<1 or p_bed>19 then raise exception 'Leito inválido.'; end if;
  if p_mode not in ('private','hotel') then raise exception 'Modalidade inválida.'; end if;
  if p_mode='hotel' and p_bed<10 then raise exception 'Hotelaria está disponível nos leitos 10 a 19.'; end if;
  if p_entry_at is null then raise exception 'Informe a data de entrada.'; end if;
  if p_entry_at>now()+interval '10 minutes' then raise exception 'A entrada não pode ser registrada no futuro.'; end if;
  if v_rate is null or v_rate<=0 then raise exception 'Valor da diária inválido.'; end if;

  if v_cpf is not null then
    select id into v_patient from public.patients where cpf=v_cpf;
  end if;

  if v_patient is null then
    insert into public.patients(name,cpf,created_by)
    values(trim(p_name),v_cpf,auth.uid())
    returning id into v_patient;
  end if;

  v_standard:=case
    when p_mode='private' and coalesce(p_ventilation,false) then 10000
    when p_mode='private' then 7000
    when p_bed>=17 then 500
    else 400
  end;

  v_label:=case
    when p_mode='private' and coalesce(p_ventilation,false) then 'Particular com ventilação'
    when p_mode='private' then 'Particular sem ventilação'
    when p_bed>=17 then 'Hotelaria com suíte'
    else 'Hotelaria individual'
  end;

  insert into public.admissions(
    patient_id,bed,mode,entry_at,status,closer_id,closer_name,created_by_name,created_by,
    half_initial,commission_amount,notes
  )
  values(
    v_patient,p_bed,p_mode,p_entry_at,'active',
    v_closer.id,v_closer.display_name,v_user,auth.uid(),
    coalesce(p_half_initial,false),
    case when p_mode='private' then v_closer.commission_amount else 0 end,
    nullif(trim(coalesce(p_notes,'')),'')
  )
  returning id into v_admission;

  insert into public.rate_periods(
    admission_id,effective_at,standard_rate,negotiated_rate,ventilation,label,changed_by_name,changed_by
  )
  values(
    v_admission,p_entry_at,v_standard,v_rate,
    case when p_mode='private' then coalesce(p_ventilation,false) else null end,
    v_label,v_user,auth.uid()
  );

  perform private.sync_daily_charges(v_admission,null,v_user);

  insert into public.audits(admission_id,user_name,user_id,action,detail)
  values(
    v_admission,v_user,auth.uid(),'Internação criada',
    'Leito '||lpad(p_bed::text,2,'0')||' • '||v_label||' • R$ '||to_char(v_rate,'FM999G999G990D00')||
    ' • Fechamento: '||v_closer.display_name
  );

  return v_admission;
exception
  when unique_violation then
    if sqlerrm like '%admissions_open_bed_unique%' then
      raise exception 'Este leito já possui uma internação em aberto.';
    elsif sqlerrm like '%admissions_open_patient_unique%' then
      raise exception 'Este paciente já possui uma internação em aberto.';
    elsif sqlerrm like '%patients_cpf_unique%' then
      raise exception 'Já existe um paciente cadastrado com este CPF.';
    end if;
    raise;
end;
$$;

create or replace function private.add_uti_payment_impl(
  p_admission_id uuid,
  p_occurred_at timestamptz,
  p_amount numeric,
  p_method text,
  p_notes text,
  p_client_ref text
)
returns text
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_user text;
  v_status text;
  v_entry_at timestamptz;
  v_balance numeric;
  v_id uuid;
  v_amount numeric:=round(p_amount,2);
  v_refunded numeric;
begin
  if not private.has_permission('add_payment') then raise exception 'Seu perfil não pode registrar pagamentos.'; end if;
  v_user:=private.current_display_name();

  if nullif(trim(coalesce(p_client_ref,'')),'') is null then raise exception 'Identificador da operação ausente.'; end if;
  if p_occurred_at is null then raise exception 'Informe a data e hora do pagamento.'; end if;
  if v_amount is null or v_amount<=0 then raise exception 'Valor do pagamento inválido.'; end if;
  if p_method not in ('PIX','Cartão','Transferência','Dinheiro','Outro') then raise exception 'Forma de pagamento inválida.'; end if;

  select status,entry_at into v_status,v_entry_at
  from public.admissions where id=p_admission_id for update;

  if not found then raise exception 'Internação não encontrada.'; end if;
  if v_status='cancelled' then raise exception 'Não é possível registrar pagamento em internação cancelada.'; end if;
  if v_status='finalized' then raise exception 'A conta já está finalizada.'; end if;
  if p_occurred_at<v_entry_at then raise exception 'O pagamento não pode ter data anterior à entrada.'; end if;
  if p_occurred_at>now()+interval '10 minutes' then raise exception 'O pagamento não pode ser registrado no futuro.'; end if;

  if v_status='active' then perform private.sync_daily_charges(p_admission_id,null,v_user); end if;

  select
    coalesce((select sum(c.amount) from public.charges c where c.admission_id=p_admission_id and c.cancelled_at is null),0)
    - coalesce((select sum(pm.amount) from public.payments pm where pm.admission_id=p_admission_id and pm.cancelled_at is null),0)
    + coalesce((select sum(r.amount) from public.refunds r where r.admission_id=p_admission_id and r.cancelled_at is null),0)
  into v_balance;

  if v_balance<=0.009 then raise exception 'Não há saldo pendente para receber.'; end if;
  if v_amount>v_balance+0.009 then
    raise exception 'O pagamento informado é maior que o saldo pendente de R$ %.',to_char(v_balance,'FM999G999G990D00');
  end if;

  insert into public.payments(admission_id,occurred_at,amount,method,notes,created_by_name,created_by,client_ref)
  values(p_admission_id,p_occurred_at,v_amount,p_method,nullif(trim(coalesce(p_notes,'')),''),v_user,auth.uid(),trim(p_client_ref))
  on conflict do nothing
  returning id into v_id;

  if v_id is null then return private.reconcile_admission_status(p_admission_id); end if;

  insert into public.audits(admission_id,user_name,user_id,action,detail)
  values(p_admission_id,v_user,auth.uid(),'Pagamento registrado','R$ '||to_char(v_amount,'FM999G999G990D00')||' • '||p_method);

  v_status:=private.reconcile_admission_status(p_admission_id);
  if v_status='finalized' then
    insert into public.audits(admission_id,user_name,user_id,action,detail)
    values(p_admission_id,v_user,auth.uid(),'Conta finalizada','Saldo quitado após a alta.');
  end if;
  return v_status;
end;
$$;

create or replace function private.add_uti_extra_impl(
  p_admission_id uuid,
  p_occurred_at timestamptz,
  p_category text,
  p_description text,
  p_amount numeric,
  p_client_ref text
)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_user text;
  v_id uuid;
  v_existing uuid;
  v_cat text;
  v_desc text;
  v_status text;
  v_entry_at timestamptz;
  v_discharge_at timestamptz;
  v_amount numeric:=round(p_amount,2);
begin
  if not private.has_permission('add_extra') then raise exception 'Seu perfil não pode adicionar cobranças.'; end if;
  v_user:=private.current_display_name();

  if nullif(trim(coalesce(p_client_ref,'')),'') is null then raise exception 'Identificador da operação ausente.'; end if;
  if p_occurred_at is null then raise exception 'Informe a data e hora do extra.'; end if;
  if v_amount is null or v_amount<=0 then raise exception 'Valor do extra inválido.'; end if;

  select status,entry_at,discharge_at into v_status,v_entry_at,v_discharge_at
  from public.admissions where id=p_admission_id for update;

  if not found then raise exception 'Internação não encontrada.'; end if;
  if v_status='cancelled' then raise exception 'Não é possível adicionar cobrança em internação cancelada.'; end if;
  if v_status='finalized' then raise exception 'A conta já está finalizada.'; end if;
  if p_occurred_at<v_entry_at then raise exception 'O extra não pode ter data anterior à entrada.'; end if;
  if p_occurred_at>now()+interval '10 minutes' then raise exception 'O extra não pode ser registrado no futuro.'; end if;
  if v_discharge_at is not null and p_occurred_at>v_discharge_at then
    raise exception 'A data do extra não pode ser posterior à saída do paciente.';
  end if;

  v_cat:=coalesce(nullif(trim(p_category),''),'Outro serviço');
  v_desc:=coalesce(nullif(trim(p_description),''),v_cat);

  insert into public.charges(admission_id,occurred_at,kind,category,description,amount,created_by_name,created_by,client_ref)
  values(p_admission_id,p_occurred_at,'extra',v_cat,v_desc,v_amount,v_user,auth.uid(),trim(p_client_ref))
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_existing from public.charges
    where admission_id=p_admission_id and client_ref=trim(p_client_ref)
    limit 1;
    return v_existing;
  end if;

  insert into public.audits(admission_id,user_name,user_id,action,detail)
  values(p_admission_id,v_user,auth.uid(),'Extra adicionado',v_cat||' • R$ '||to_char(v_amount,'FM999G999G990D00'));

  return v_id;
end;
$$;

create or replace function private.adjust_uti_rate_impl(
  p_admission_id uuid,
  p_effective_at timestamptz,
  p_negotiated_rate numeric,
  p_ventilation boolean default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_user text;
  a public.admissions;
  v_standard numeric;
  v_label text;
  v_id uuid;
  v_rebuild jsonb;
  v_diff numeric;
  v_rate numeric:=round(p_negotiated_rate,2);
begin
  if not private.has_permission('adjust_rate') then raise exception 'Seu perfil não pode alterar a diária.'; end if;
  v_user:=private.current_display_name();
  if v_rate is null or v_rate<=0 then raise exception 'Valor da diária inválido.'; end if;

  select * into a from public.admissions where id=p_admission_id for update;
  if not found then raise exception 'Internação não encontrada.'; end if;
  if a.status<>'active' then raise exception 'A diária só pode ser ajustada enquanto a internação estiver ativa.'; end if;
  if p_effective_at<a.entry_at then raise exception 'A nova condição não pode começar antes da entrada.'; end if;

  v_standard:=case
    when a.mode='private' and coalesce(p_ventilation,false) then 10000
    when a.mode='private' then 7000
    when a.bed>=17 then 500
    else 400
  end;

  v_label:=case
    when a.mode='private' and coalesce(p_ventilation,false) then 'Particular com ventilação'
    when a.mode='private' then 'Particular sem ventilação'
    when a.bed>=17 then 'Hotelaria com suíte'
    else 'Hotelaria individual'
  end;

  insert into public.rate_periods(admission_id,effective_at,standard_rate,negotiated_rate,ventilation,label,changed_by_name,changed_by)
  values(
    p_admission_id,p_effective_at,v_standard,v_rate,
    case when a.mode='private' then coalesce(p_ventilation,false) else null end,
    v_label,v_user,auth.uid()
  )
  on conflict (admission_id,effective_at)
  do update set
    standard_rate=excluded.standard_rate,
    negotiated_rate=excluded.negotiated_rate,
    ventilation=excluded.ventilation,
    label=excluded.label,
    changed_by_name=excluded.changed_by_name,
    changed_by=excluded.changed_by
  returning id into v_id;

  v_rebuild:=private.reconcile_daily_charges(
    p_admission_id,null,v_user,'Diária substituída por alteração de condição comercial'
  );
  v_diff:=coalesce((v_rebuild->>'difference')::numeric,0);

  insert into public.audits(admission_id,user_name,user_id,action,detail)
  values(
    p_admission_id,v_user,auth.uid(),'Diária ajustada',
    'A partir de '||to_char(p_effective_at at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')||
    ' • '||v_label||' • R$ '||to_char(v_rate,'FM999G999G990D00')
  );

  if abs(v_diff)>0.009 then
    insert into public.audits(admission_id,user_name,user_id,action,detail)
    values(
      p_admission_id,v_user,auth.uid(),'Diárias automáticas reconciliadas',
      'Lançamentos anteriores preservados como cancelados • diferença R$ '||to_char(v_diff,'FM999G999G990D00')
    );
  end if;

  return v_id;
end;
$$;

create or replace function private.cancel_uti_extra_impl(p_charge_id uuid,p_reason text)
returns text
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_user text;
  c public.charges;
  v_status text;
begin
  if not private.is_admin() then raise exception 'Somente administradores podem cancelar cobranças.'; end if;
  if length(trim(coalesce(p_reason,'')))<3 then raise exception 'Informe o motivo do cancelamento.'; end if;
  v_user:=private.current_display_name();

  select * into c from public.charges where id=p_charge_id for update;
  if not found then raise exception 'Cobrança não encontrada.'; end if;
  if c.kind='daily' then raise exception 'Diárias automáticas são corrigidas pela reconciliação da conta.'; end if;
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
$$;

create or replace function private.cancel_uti_payment_impl(p_payment_id uuid,p_reason text)
returns text
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_user text;
  p public.payments;
  v_status text;
begin
  if not private.is_admin() then raise exception 'Somente administradores podem estornar pagamentos.'; end if;
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
$$;

create or replace function private.add_uti_refund_impl(
  p_admission_id uuid,
  p_occurred_at timestamptz,
  p_amount numeric,
  p_method text,
  p_notes text,
  p_client_ref text
)
returns text
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_user text;
  a public.admissions;
  v_balance numeric;
  v_credit numeric;
  v_amount numeric:=round(p_amount,2);
  v_id uuid;
  v_status text;
begin
  if not private.is_admin() then raise exception 'Somente administradores podem registrar reembolsos.'; end if;
  v_user:=private.current_display_name();

  if nullif(trim(coalesce(p_client_ref,'')),'') is null then raise exception 'Identificador da operação ausente.'; end if;
  if p_occurred_at is null then raise exception 'Informe a data e hora do reembolso.'; end if;
  if v_amount is null or v_amount<=0 then raise exception 'Valor do reembolso inválido.'; end if;
  if p_method not in ('PIX','Cartão','Transferência','Dinheiro','Outro') then raise exception 'Forma de reembolso inválida.'; end if;

  select * into a from public.admissions where id=p_admission_id for update;
  if not found then raise exception 'Internação não encontrada.'; end if;
  if a.status='cancelled' then raise exception 'Internação cancelada não pode receber reembolso.'; end if;
  if p_occurred_at<a.entry_at then raise exception 'O reembolso não pode ter data anterior à entrada.'; end if;
  if p_occurred_at>now()+interval '10 minutes' then raise exception 'O reembolso não pode ser registrado no futuro.'; end if;

  select
    coalesce((select sum(c.amount) from public.charges c where c.admission_id=p_admission_id and c.cancelled_at is null),0)
    - coalesce((select sum(pm.amount) from public.payments pm where pm.admission_id=p_admission_id and pm.cancelled_at is null),0)
    + coalesce((select sum(r.amount) from public.refunds r where r.admission_id=p_admission_id and r.cancelled_at is null),0)
  into v_balance;

  v_credit:=-v_balance;
  if v_credit<=0.009 then raise exception 'Não há crédito a devolver nesta conta.'; end if;
  if v_amount>v_credit+0.009 then
    raise exception 'O reembolso é maior que o crédito disponível de R$ %.',to_char(v_credit,'FM999G999G990D00');
  end if;

  insert into public.refunds(admission_id,occurred_at,amount,method,notes,created_by_name,created_by,client_ref)
  values(p_admission_id,p_occurred_at,v_amount,p_method,nullif(trim(coalesce(p_notes,'')),''),v_user,auth.uid(),trim(p_client_ref))
  on conflict do nothing
  returning id into v_id;

  if v_id is null then return private.reconcile_admission_status(p_admission_id); end if;

  insert into public.audits(admission_id,user_name,user_id,action,detail)
  values(p_admission_id,v_user,auth.uid(),'Reembolso registrado',
    'R$ '||to_char(v_amount,'FM999G999G990D00')||' • '||p_method);

  v_status:=private.reconcile_admission_status(p_admission_id);
  if v_status='finalized' then
    insert into public.audits(admission_id,user_name,user_id,action,detail)
    values(p_admission_id,v_user,auth.uid(),'Conta finalizada','Crédito ao paciente integralmente devolvido.');
  end if;
  return v_status;
end;
$$;

create or replace function private.cancel_uti_refund_impl(p_refund_id uuid,p_reason text)
returns text
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_user text;
  r public.refunds;
  v_status text;
begin
  if not private.is_admin() then raise exception 'Somente administradores podem estornar reembolsos.'; end if;
  if length(trim(coalesce(p_reason,'')))<3 then raise exception 'Informe o motivo do estorno.'; end if;
  v_user:=private.current_display_name();

  select * into r from public.refunds where id=p_refund_id for update;
  if not found then raise exception 'Reembolso não encontrado.'; end if;
  if r.cancelled_at is not null then
    select status into v_status from public.admissions where id=r.admission_id;
    return v_status;
  end if;

  perform 1 from public.admissions where id=r.admission_id for update;

  update public.refunds
  set cancelled_at=now(),cancelled_by=auth.uid(),cancel_reason=trim(p_reason)
  where id=p_refund_id;

  v_status:=private.reconcile_admission_status(r.admission_id);

  insert into public.audits(admission_id,user_name,user_id,action,detail)
  values(r.admission_id,v_user,auth.uid(),'Reembolso estornado',
    'R$ '||to_char(r.amount,'FM999G999G990D00')||' • Motivo: '||trim(p_reason));

  return v_status;
end;
$$;

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
    'notes',p.notes,'createdBy',p.created_by_name) order by p.occurred_at),'[]'::jsonb)
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

create or replace function public.preview_uti_settlement(p_admission_id uuid,p_discharge_at timestamptz)
returns jsonb
language sql
set search_path = public, private, pg_temp
as $$
  select private.preview_uti_settlement_impl(p_admission_id,p_discharge_at)
$$;

create or replace function private.discharge_uti_impl(
  p_admission_id uuid,
  p_discharge_at timestamptz,
  p_expected_version bigint
)
returns text
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_user text;
  a public.admissions;
  v_billed numeric;
  v_received numeric;
  v_refunded numeric;
  v_balance numeric;
  v_status text;
  v_rebuild jsonb;
  v_rebuild_diff numeric:=0;
begin
  if not private.has_permission('discharge') then raise exception 'Seu perfil não pode registrar alta.'; end if;
  v_user:=private.current_display_name();

  select * into a from public.admissions where id=p_admission_id for update;
  if not found then raise exception 'Internação não encontrada.'; end if;
  if a.status='cancelled' then raise exception 'Internação cancelada não pode receber alta.'; end if;
  if p_expected_version is null then raise exception 'Recalcule o acerto antes de registrar a alta.'; end if;
  if a.account_version<>p_expected_version then
    raise exception 'A conta foi alterada desde a conferência. Recalcule o acerto antes de registrar a alta.';
  end if;
  if a.status='finalized' then raise exception 'Esta internação já está finalizada.'; end if;
  if a.status='discharge_pending' then return private.reconcile_admission_status(p_admission_id); end if;
  if p_discharge_at is null then raise exception 'Informe a data e hora de saída.'; end if;
  if p_discharge_at<a.entry_at then raise exception 'A saída não pode ser anterior à entrada.'; end if;
  if p_discharge_at>now()+interval '10 minutes' then raise exception 'A saída não pode ser registrada no futuro.'; end if;

  if exists(
    select 1 from public.charges c
    where c.admission_id=p_admission_id
      and c.cancelled_at is null
      and c.kind<>'daily'
      and c.occurred_at>p_discharge_at
  ) then
    raise exception 'Existem cobranças extras posteriores ao horário de saída. Corrija os lançamentos antes de registrar a alta.';
  end if;

  v_rebuild:=private.reconcile_daily_charges(
    p_admission_id,p_discharge_at,v_user,'Diária invalidada/substituída no fechamento da alta'
  );
  v_rebuild_diff:=coalesce((v_rebuild->>'difference')::numeric,0);

  select coalesce(sum(amount),0) into v_billed
  from public.charges where admission_id=p_admission_id and cancelled_at is null;

  select coalesce(sum(amount),0) into v_received
  from public.payments where admission_id=p_admission_id and cancelled_at is null;

  select coalesce(sum(amount),0) into v_refunded
  from public.refunds where admission_id=p_admission_id and cancelled_at is null;

  v_balance:=v_billed-v_received+v_refunded;
  v_status:=case when abs(v_balance)<=0.009 then 'finalized' else 'discharge_pending' end;

  update public.admissions
  set discharge_at=p_discharge_at,
      status=v_status,
      account_version=account_version+1
  where id=p_admission_id;

  if abs(v_rebuild_diff)>0.009 then
    insert into public.audits(admission_id,user_name,user_id,action,detail)
    values(
      p_admission_id,v_user,auth.uid(),'Diárias automáticas reconciliadas',
      'Histórico preservado por cancelamento/substituição • diferença R$ '||to_char(v_rebuild_diff,'FM999G999G990D00')
    );
  end if;

  insert into public.audits(admission_id,user_name,user_id,action,detail)
  values(
    p_admission_id,v_user,auth.uid(),
    case when v_status='finalized' then 'Alta e acerto finalizados' else 'Alta registrada' end,
    'Saída '||to_char(p_discharge_at at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')||
    ' • Total R$ '||to_char(v_billed,'FM999G999G990D00')||
    ' • Recebido R$ '||to_char(v_received,'FM999G999G990D00')||
    ' • Reembolsado R$ '||to_char(v_refunded,'FM999G999G990D00')||
    ' • Saldo R$ '||to_char(v_balance,'FM999G999G990D00')
  );

  return v_status;
end;
$$;

create or replace function public.discharge_uti(
  p_admission_id uuid,
  p_discharge_at timestamptz,
  p_expected_version bigint
)
returns text
language sql
set search_path = public, private, pg_temp
as $$
  select private.discharge_uti_impl(p_admission_id,p_discharge_at,p_expected_version)
$$;

create or replace function public.discharge_uti(
  p_admission_id uuid,
  p_discharge_at timestamptz
)
returns text
language plpgsql
set search_path = public, private, pg_temp
as $$
begin
  raise exception 'Esta versão do sistema está desatualizada. Recarregue a página antes de registrar a alta.';
end;
$$;

create or replace function public.add_uti_refund(
  p_admission_id uuid,
  p_occurred_at timestamptz,
  p_amount numeric,
  p_method text,
  p_notes text,
  p_client_ref text
)
returns text
language sql
set search_path = public, private, pg_temp
as $$
  select private.add_uti_refund_impl(p_admission_id,p_occurred_at,p_amount,p_method,p_notes,p_client_ref)
$$;

create or replace function public.cancel_uti_refund(p_refund_id uuid,p_reason text)
returns text
language sql
set search_path = public, private, pg_temp
as $$
  select private.cancel_uti_refund_impl(p_refund_id,p_reason)
$$;

create or replace function private.update_uti_on_duty_impl(p_name text)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_user text;
begin
  if not private.has_permission('update_on_duty') then raise exception 'Seu perfil não pode alterar o plantão comercial.'; end if;
  if p_name not in ('Samuel','Roberto') then raise exception 'Responsável de plantão inválido.'; end if;
  v_user:=private.current_display_name();

  update public.app_settings
  set on_duty_name=p_name,updated_at=now(),updated_by=auth.uid()
  where id=1;

  insert into public.audits(user_name,user_id,action,detail)
  values(v_user,auth.uid(),'Plantão comercial atualizado',p_name);
end;
$$;

-- Harden execution privileges.
revoke all on function private.current_role() from public,anon,authenticated;
revoke all on function private.has_permission(text) from public,anon,authenticated;
revoke all on function private.bump_account_version() from public,anon,authenticated;
revoke all on function private.compute_daily_charge_rows(uuid,timestamptz) from public,anon,authenticated;
revoke all on function private.sync_daily_charges(uuid,timestamptz,text) from public,anon,authenticated;
revoke all on function private.reconcile_daily_charges(uuid,timestamptz,text,text) from public,anon,authenticated;
revoke all on function private.rebuild_daily_charges(uuid,timestamptz,text) from public,anon,authenticated;
revoke all on function private.trim_future_daily_charges(uuid,timestamptz) from public,anon,authenticated;
revoke all on function private.reconcile_admission_status(uuid) from public,anon,authenticated;

revoke all on function private.create_uti_admission_impl(text,text,integer,text,timestamptz,text,boolean,boolean,numeric,text) from public,anon;
grant execute on function private.create_uti_admission_impl(text,text,integer,text,timestamptz,text,boolean,boolean,numeric,text) to authenticated;

revoke all on function private.add_uti_payment_impl(uuid,timestamptz,numeric,text,text,text) from public,anon;
grant execute on function private.add_uti_payment_impl(uuid,timestamptz,numeric,text,text,text) to authenticated;

revoke all on function private.add_uti_extra_impl(uuid,timestamptz,text,text,numeric,text) from public,anon;
grant execute on function private.add_uti_extra_impl(uuid,timestamptz,text,text,numeric,text) to authenticated;

revoke all on function private.adjust_uti_rate_impl(uuid,timestamptz,numeric,boolean) from public,anon;
grant execute on function private.adjust_uti_rate_impl(uuid,timestamptz,numeric,boolean) to authenticated;

revoke all on function private.cancel_uti_payment_impl(uuid,text) from public,anon;
grant execute on function private.cancel_uti_payment_impl(uuid,text) to authenticated;

revoke all on function private.cancel_uti_extra_impl(uuid,text) from public,anon;
grant execute on function private.cancel_uti_extra_impl(uuid,text) to authenticated;

revoke all on function private.add_uti_refund_impl(uuid,timestamptz,numeric,text,text,text) from public,anon;
grant execute on function private.add_uti_refund_impl(uuid,timestamptz,numeric,text,text,text) to authenticated;

revoke all on function private.cancel_uti_refund_impl(uuid,text) from public,anon;
grant execute on function private.cancel_uti_refund_impl(uuid,text) to authenticated;

revoke all on function private.preview_uti_settlement_impl(uuid,timestamptz) from public,anon;
grant execute on function private.preview_uti_settlement_impl(uuid,timestamptz) to authenticated;

revoke all on function private.discharge_uti_impl(uuid,timestamptz,bigint) from public,anon;
grant execute on function private.discharge_uti_impl(uuid,timestamptz,bigint) to authenticated;

revoke all on function public.add_uti_refund(uuid,timestamptz,numeric,text,text,text) from public,anon;
grant execute on function public.add_uti_refund(uuid,timestamptz,numeric,text,text,text) to authenticated;

revoke all on function public.cancel_uti_refund(uuid,text) from public,anon;
grant execute on function public.cancel_uti_refund(uuid,text) to authenticated;

revoke all on function public.discharge_uti(uuid,timestamptz,bigint) from public,anon;
grant execute on function public.discharge_uti(uuid,timestamptz,bigint) to authenticated;

revoke all on function public.discharge_uti(uuid,timestamptz) from public,anon;
grant execute on function public.discharge_uti(uuid,timestamptz) to authenticated;

revoke all on function public.preview_uti_settlement(uuid,timestamptz) from public,anon;
grant execute on function public.preview_uti_settlement(uuid,timestamptz) to authenticated;
