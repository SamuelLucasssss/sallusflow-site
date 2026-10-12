-- Additive hardening only; no ledger data is rewritten or deleted.
-- Reviewed in isolated PostgreSQL. Apply only through the reviewed release.
-- The obsolete private discharge implementation must not bypass version checks.
do $$ begin
  if to_regprocedure('private.discharge_uti_impl(uuid,timestamptz)') is not null then
    execute 'revoke all on function private.discharge_uti_impl(uuid,timestamptz) from public,anon,authenticated';
  end if;
end $$;
alter table public.charges add constraint charges_finite_values check (amount not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));
alter table public.payments add constraint payments_finite_values check (amount not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));
alter table public.refunds add constraint refunds_finite_values check (amount not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));
alter table public.rate_periods add constraint rate_periods_finite_values check (standard_rate not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) and negotiated_rate not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));
alter table public.admissions add constraint admissions_finite_values check (commission_amount not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));
alter table public.commercial_closers add constraint commercial_closers_finite_values check (commission_amount not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

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
  v_existing public.payments;
begin
  if not private.has_permission('add_payment') then raise exception 'Seu perfil não pode registrar pagamentos.'; end if;
  v_user:=private.current_display_name();

  if nullif(trim(coalesce(p_client_ref,'')),'') is null then raise exception 'Identificador da operação ausente.'; end if;
  if p_occurred_at is null then raise exception 'Informe a data e hora do pagamento.'; end if;
  if v_amount is null or v_amount='NaN'::numeric or v_amount<=0 then raise exception 'Valor do pagamento inválido.'; end if;
  if p_method not in ('PIX','Cartão','Transferência','Dinheiro','Outro') then raise exception 'Forma de pagamento inválida.'; end if;

  select status,entry_at into v_status,v_entry_at
  from public.admissions where id=p_admission_id for update;

  if not found then raise exception 'Internação não encontrada.'; end if;
  if v_status='cancelled' then raise exception 'Não é possível registrar pagamento em internação cancelada.'; end if;
  -- Retry must be checked under the admission lock, before balance/finalized guards.
  select * into v_existing from public.payments
  where admission_id=p_admission_id and client_ref=trim(p_client_ref);
  if found then
    if v_existing.cancelled_at is not null then
      raise exception 'Este recebimento foi cancelado. Inicie uma nova operação.';
    end if;
    if v_existing.amount is distinct from v_amount
      or v_existing.method is distinct from p_method
      or v_existing.occurred_at is distinct from p_occurred_at
      or v_existing.notes is distinct from nullif(trim(coalesce(p_notes,'')),'') then
      raise exception 'Identificador já utilizado em outro recebimento.';
    end if;
    return private.reconcile_admission_status(p_admission_id);
  end if;
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
  if v_rate is null or v_rate='NaN'::numeric or v_rate in ('Infinity'::numeric,'-Infinity'::numeric) or v_rate<=0 then raise exception 'Valor da diária inválido.'; end if;

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
  if v_rate is null or v_rate='NaN'::numeric or v_rate in ('Infinity'::numeric,'-Infinity'::numeric) or v_rate<=0 then raise exception 'Valor da diária inválido.'; end if;

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
    order by id
    for update
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

-- Serialize role/active changes before checking the last administrator.
CREATE OR REPLACE FUNCTION private.admin_update_uti_member_impl(p_user_id uuid, p_active boolean, p_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_admin text;
  v_target_role text;
  v_target_active boolean;
  v_admin_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('imec-uti:admin-membership',0));
  if not private.is_admin() then raise exception 'Somente administradores podem alterar acessos.'; end if;
  if p_role not in ('admin','operator','commercial') then raise exception 'Perfil inválido.'; end if;

  select role,active into v_target_role,v_target_active from public.profiles where id=p_user_id;
  if not found then raise exception 'Usuário não encontrado.'; end if;

  select count(*) into v_admin_count from public.profiles where active=true and role='admin';

  if v_target_active=true and v_target_role='admin' and (p_active=false or p_role<>'admin') and v_admin_count<=1 then
    raise exception 'É necessário manter pelo menos um administrador ativo.';
  end if;

  update public.profiles set active=p_active,role=p_role where id=p_user_id;

  v_admin:=private.current_display_name();
  insert into public.audits(user_name,user_id,action,detail)
  values(v_admin,auth.uid(),'Acesso atualizado',p_user_id::text||' • '||p_role||' • '||case when p_active then 'ativo' else 'inativo' end);
end;
$function$;
