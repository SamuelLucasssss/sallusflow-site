create table public.admission_bed_transfers (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null references public.admissions(id) on delete restrict,
  from_bed integer not null check (from_bed between 1 and 19),
  to_bed integer not null check (to_bed between 1 and 19 and to_bed <> from_bed),
  effective_at timestamptz not null check (isfinite(effective_at)),
  reason text not null check (length(reason) between 8 and 220),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  created_by_name text not null,
  unique (admission_id,effective_at)
);
create index admission_bed_transfers_created_by_idx on public.admission_bed_transfers(created_by);
alter table public.admission_bed_transfers enable row level security;
create policy admission_bed_transfers_read on public.admission_bed_transfers
for select to authenticated using (private.is_active_member());
revoke all on public.admission_bed_transfers from public,anon,authenticated;
grant select on public.admission_bed_transfers to authenticated;

-- Intervals are half-open. The destination is occupied starting at the transfer time.
create view private.admission_bed_periods as
select a.id as admission_id,a.status,segment.bed,segment.starts_at,
       lead(segment.starts_at,1,a.discharge_at) over (
         partition by a.id order by segment.starts_at
       ) as ends_at
from public.admissions a
cross join lateral (
  select coalesce((
    select t.from_bed from public.admission_bed_transfers t
    where t.admission_id=a.id order by t.effective_at limit 1
  ),a.bed) as bed,a.entry_at as starts_at
  union all
  select t.to_bed,t.effective_at from public.admission_bed_transfers t
  where t.admission_id=a.id
) segment;
revoke all on private.admission_bed_periods from public,anon,authenticated;

create function private.check_uti_bed_period_update()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  first_transfer timestamptz;
  last_transfer public.admission_bed_transfers;
begin
  if new.status='cancelled' or (
    new.bed=old.bed and new.entry_at=old.entry_at
    and new.discharge_at is not distinct from old.discharge_at and old.status<>'cancelled'
  ) then return new; end if;

  select min(t.effective_at) into first_transfer from public.admission_bed_transfers t
  where t.admission_id=new.id;
  if first_transfer is not null then
    select * into last_transfer from public.admission_bed_transfers t
    where t.admission_id=new.id order by t.effective_at desc limit 1;
    if new.entry_at>=first_transfer or new.discharge_at<=last_transfer.effective_at then
      raise exception 'Entrada e alta devem respeitar o histórico de transferências.';
    end if;
    if new.bed<>last_transfer.to_bed then
      raise exception 'Registre uma transferência para trocar este leito.';
    end if;
  end if;

  if exists (
    select 1 from private.admission_bed_periods own
    join private.admission_bed_periods other on other.admission_id<>own.admission_id
      and other.status<>'cancelled'
      and other.bed=case when own.ends_at is not distinct from old.discharge_at then new.bed else own.bed end
    where own.admission_id=new.id
      and other.starts_at<coalesce(case when own.ends_at is not distinct from old.discharge_at
                                       then new.discharge_at else own.ends_at end,'infinity'::timestamptz)
      and coalesce(other.ends_at,'infinity'::timestamptz)>
          case when own.starts_at=old.entry_at then new.entry_at else own.starts_at end
  ) then raise exception 'O período coincide com outra ocupação do leito.'; end if;
  return new;
end;
$$;
revoke all on function private.check_uti_bed_period_update() from public,anon,authenticated;
create trigger admissions_check_bed_period_update
before update of bed,entry_at,discharge_at,status on public.admissions
for each row execute function private.check_uti_bed_period_update();

create function private.record_uti_bed_transfer(
  p_admission_id uuid,p_expected_version bigint,p_to_bed integer,p_effective_at timestamptz,
  p_reason text,p_actor_id uuid,p_actor_name text
) returns uuid language plpgsql security invoker set search_path='' as $$
declare
  a public.admissions;
  v_previous_at timestamptz;
  v_reason text:=trim(coalesce(p_reason,''));
  v_id uuid;
begin
  if length(v_reason) not between 8 and 220 then raise exception 'Informe o motivo da transferência (8 a 220 caracteres).'; end if;
  if p_to_bed is null or p_to_bed not between 1 and 19 then raise exception 'Selecione um leito válido.'; end if;
  if p_effective_at is null or not isfinite(p_effective_at) or p_effective_at>now() then
    raise exception 'Informe a data e hora da transferência, sem data futura.';
  end if;

  lock table public.admissions in share row exclusive mode;
  select * into a from public.admissions where id=p_admission_id for update;
  if not found or a.status='cancelled' then raise exception 'Internação indisponível.'; end if;
  if a.account_version is distinct from p_expected_version then raise exception 'A conta foi alterada. Atualize e confira.'; end if;
  if a.bed=p_to_bed then raise exception 'Escolha um leito diferente do atual.'; end if;
  if a.mode='hotel' and p_to_bed<10 then raise exception 'Hotelaria está disponível nos leitos 10 a 19.'; end if;
  select max(t.effective_at) into v_previous_at from public.admission_bed_transfers t where t.admission_id=a.id;
  if p_effective_at<=coalesce(v_previous_at,a.entry_at) or p_effective_at>=a.discharge_at then
    raise exception 'A transferência deve ocorrer após a entrada ou última transferência e antes da alta.';
  end if;

  insert into public.admission_bed_transfers(admission_id,from_bed,to_bed,effective_at,reason,created_by,created_by_name)
  values(a.id,a.bed,p_to_bed,p_effective_at,v_reason,p_actor_id,p_actor_name) returning id into v_id;
  -- The occupancy trigger validates the resulting timeline before committing the move.
  update public.admissions set bed=p_to_bed,account_version=account_version+1 where id=a.id;
  insert into public.audits(admission_id,user_name,user_id,action,detail)
  values(a.id,p_actor_name,p_actor_id,'Transferência de leito',
    format('Leito %s → %s em %s • %s',a.bed,p_to_bed,to_char(p_effective_at at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI'),v_reason));
  return v_id;
end;
$$;
revoke all on function private.record_uti_bed_transfer(uuid,bigint,integer,timestamptz,text,uuid,text) from public,anon,authenticated;

create function private.transfer_uti_bed_impl(
  p_admission_id uuid,p_expected_version bigint,p_to_bed integer,p_effective_at timestamptz,p_reason text
) returns uuid language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Somente administradores podem transferir leitos.';
  end if;
  return private.record_uti_bed_transfer(p_admission_id,p_expected_version,p_to_bed,p_effective_at,
    p_reason,auth.uid(),private.current_display_name());
end;
$$;

create function public.transfer_uti_bed(
  p_admission_id uuid,p_expected_version bigint,p_to_bed integer,p_effective_at timestamptz,p_reason text
) returns uuid language sql security invoker set search_path='' as $$
  select private.transfer_uti_bed_impl(p_admission_id,p_expected_version,p_to_bed,p_effective_at,p_reason);
$$;
revoke all on function private.transfer_uti_bed_impl(uuid,bigint,integer,timestamptz,text),
  public.transfer_uti_bed(uuid,bigint,integer,timestamptz,text) from public,anon,authenticated;
grant execute on function private.transfer_uti_bed_impl(uuid,bigint,integer,timestamptz,text),
  public.transfer_uti_bed(uuid,bigint,integer,timestamptz,text) to authenticated;

-- New admissions validate actual bed periods, including past transfers.
create or replace function private.create_uti_admission_with_discharge_impl(
  p_name text,
  p_cpf text,
  p_bed integer,
  p_mode text,
  p_entry_at timestamptz,
  p_closer text,
  p_half_initial boolean,
  p_ventilation boolean,
  p_negotiated_rate numeric,
  p_notes text,
  p_discharge_at timestamptz
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
  if p_discharge_at is not null and not private.has_permission('discharge') then
    raise exception 'Seu perfil não pode registrar uma alta.';
  end if;
  if p_discharge_at is not null and (
    not isfinite(p_discharge_at) or p_entry_at is null or not isfinite(p_entry_at)
    or p_discharge_at <= p_entry_at or p_discharge_at > now()
  ) then raise exception 'A alta deve ser posterior à entrada e não pode estar no futuro.'; end if;
  if p_mode='private' and lower(trim(coalesce(p_closer,''))) not in ('samuel','roberto') then
    raise exception 'Escolha Samuel ou Roberto como responsável pelo particular.';
  end if;
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

  -- Serialize occupancy checks with other admissions and occupancy updates.
  lock table public.admissions in share row exclusive mode;
  if v_cpf is not null then
    select id into v_patient from public.patients where cpf=v_cpf;
  end if;

  if exists (
    select 1 from public.admissions a
    where a.status <> 'cancelled' and a.patient_id=v_patient
      and a.entry_at < coalesce(p_discharge_at,'infinity'::timestamptz)
      and coalesce(a.discharge_at,'infinity'::timestamptz) > p_entry_at
  ) or exists (
    select 1 from private.admission_bed_periods b
    where b.status<>'cancelled' and b.bed=p_bed
      and b.starts_at<coalesce(p_discharge_at,'infinity'::timestamptz)
      and coalesce(b.ends_at,'infinity'::timestamptz)>p_entry_at
  ) then
    if p_discharge_at is null and exists (
      select 1 from public.admissions a where a.bed=p_bed and a.discharge_at is null and a.status='active'
    ) then raise exception 'Este leito já possui uma internação em aberto.'; end if;
    raise exception 'O período coincide com outra internação deste leito ou paciente.';
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
    patient_id,bed,mode,entry_at,discharge_at,status,closer_id,closer_name,created_by_name,created_by,
    half_initial,commission_amount,notes
  )
  values(
    v_patient,p_bed,p_mode,p_entry_at,p_discharge_at,
    case when p_discharge_at is null then 'active' else 'discharge_pending' end,
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

  perform private.sync_daily_charges(v_admission,p_discharge_at,v_user);

  insert into public.audits(admission_id,user_name,user_id,action,detail)
  values(
    v_admission,v_user,auth.uid(),case when p_discharge_at is null then 'Internação criada' else 'Internação retroativa com alta' end,
    'Leito '||lpad(p_bed::text,2,'0')||' • '||v_label||' • R$ '||to_char(v_rate,'FM999G999G990D00')||
    ' • Fechamento: '||v_closer.display_name||case when p_discharge_at is null then '' else ' • Alta: '||to_char(p_discharge_at at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI') end
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
