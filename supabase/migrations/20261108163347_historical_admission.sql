-- A discharged account can remain financially pending without occupying a bed.
drop index public.admissions_open_bed_unique;
drop index public.admissions_open_patient_unique;
create unique index admissions_open_bed_unique on public.admissions(bed) where discharge_at is null and status in ('active','discharge_pending');
create unique index admissions_open_patient_unique on public.admissions(patient_id) where discharge_at is null and status in ('active','discharge_pending');

create function private.create_uti_admission_with_discharge_impl(
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
    where a.status <> 'cancelled' and (a.bed=p_bed or a.patient_id=v_patient)
      and a.entry_at < coalesce(p_discharge_at,'infinity'::timestamptz)
      and coalesce(a.discharge_at,'infinity'::timestamptz) > p_entry_at
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

create or replace function private.create_uti_admission_impl(p_name text,p_cpf text,p_bed integer,p_mode text,p_entry_at timestamptz,p_closer text,p_half_initial boolean,p_ventilation boolean,p_negotiated_rate numeric,p_notes text default null)
returns uuid language sql security definer set search_path=public,private,pg_temp as $$
 select private.create_uti_admission_with_discharge_impl(p_name,p_cpf,p_bed,p_mode,p_entry_at,p_closer,p_half_initial,p_ventilation,p_negotiated_rate,p_notes,null);
$$;

create function public.create_uti_historical_admission(p_name text,p_cpf text,p_bed integer,p_mode text,p_entry_at timestamptz,p_closer text,p_half_initial boolean,p_ventilation boolean,p_negotiated_rate numeric,p_notes text,p_discharge_at timestamptz)
returns uuid language plpgsql security invoker set search_path=public,private,pg_temp as $$
begin
 if p_discharge_at is null then raise exception 'Informe a data da alta.'; end if;
 return private.create_uti_admission_with_discharge_impl(p_name,p_cpf,p_bed,p_mode,p_entry_at,p_closer,p_half_initial,p_ventilation,p_negotiated_rate,p_notes,p_discharge_at);
end;
$$;

revoke all on function private.create_uti_admission_with_discharge_impl(text,text,integer,text,timestamptz,text,boolean,boolean,numeric,text,timestamptz),public.create_uti_historical_admission(text,text,integer,text,timestamptz,text,boolean,boolean,numeric,text,timestamptz) from public,anon,authenticated;
grant execute on function private.create_uti_admission_with_discharge_impl(text,text,integer,text,timestamptz,text,boolean,boolean,numeric,text,timestamptz),public.create_uti_historical_admission(text,text,integer,text,timestamptz,text,boolean,boolean,numeric,text,timestamptz) to authenticated;
