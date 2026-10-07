create or replace function private.current_display_name()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select display_name from public.profiles where id = auth.uid()), 'Usuário')
$$;

create or replace function public.create_uti_admission(
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
begin
  if not private.is_active_member() then raise exception 'Acesso não autorizado.'; end if;
  v_user := private.current_display_name();
  v_cpf := nullif(regexp_replace(coalesce(p_cpf,''), '\D', '', 'g'), '');

  if length(trim(coalesce(p_name,''))) < 2 then raise exception 'Informe o nome do paciente.'; end if;
  if v_cpf is not null and v_cpf !~ '^[0-9]{11}$' then raise exception 'CPF deve ter 11 dígitos.'; end if;
  if p_bed is null or p_bed < 1 or p_bed > 19 then raise exception 'Leito inválido.'; end if;
  if p_mode not in ('private','hotel') then raise exception 'Modalidade inválida.'; end if;
  if p_mode = 'hotel' and p_bed < 10 then raise exception 'Hotelaria está disponível nos leitos 10 a 19.'; end if;
  if p_entry_at is null then raise exception 'Informe a data de entrada.'; end if;
  if p_negotiated_rate is null or p_negotiated_rate <= 0 then raise exception 'Valor da diária inválido.'; end if;

  if v_cpf is not null then
    select id into v_patient from public.patients where cpf = v_cpf;
  end if;

  if v_patient is null then
    insert into public.patients(name,cpf,created_by)
    values(trim(p_name),v_cpf,auth.uid())
    returning id into v_patient;
  end if;

  v_standard := case
    when p_mode='private' and coalesce(p_ventilation,false) then 10000
    when p_mode='private' then 7000
    when p_bed>=17 then 500
    else 400
  end;

  v_label := case
    when p_mode='private' and coalesce(p_ventilation,false) then 'Particular com ventilação'
    when p_mode='private' then 'Particular sem ventilação'
    when p_bed>=17 then 'Hotelaria com suíte'
    else 'Hotelaria individual'
  end;

  insert into public.admissions(
    patient_id,bed,mode,entry_at,status,closer_name,created_by_name,created_by,
    half_initial,commission_amount,notes
  )
  values(
    v_patient,p_bed,p_mode,p_entry_at,'active',
    coalesce(nullif(trim(p_closer),''),v_user),v_user,auth.uid(),
    coalesce(p_half_initial,false),case when p_mode='private' then 80 else 0 end,
    nullif(trim(coalesce(p_notes,'')),'')
  )
  returning id into v_admission;

  insert into public.rate_periods(
    admission_id,effective_at,standard_rate,negotiated_rate,ventilation,label,changed_by_name,changed_by
  )
  values(
    v_admission,p_entry_at,v_standard,p_negotiated_rate,
    case when p_mode='private' then coalesce(p_ventilation,false) else null end,
    v_label,v_user,auth.uid()
  );

  perform private.sync_daily_charges(v_admission,null,v_user);

  insert into public.audits(admission_id,user_name,user_id,action,detail)
  values(
    v_admission,v_user,auth.uid(),'Internação criada',
    'Leito '||lpad(p_bed::text,2,'0')||' • '||v_label||' • R$ '||to_char(p_negotiated_rate,'FM999G999G990D00')
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

create or replace function public.add_uti_payment(
  p_admission_id uuid,
  p_occurred_at timestamptz,
  p_amount numeric,
  p_method text,
  p_notes text default null
)
returns text
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_user text;
  v_status text;
  v_balance numeric;
begin
  if not private.is_active_member() then raise exception 'Acesso não autorizado.'; end if;
  v_user := private.current_display_name();
  if p_amount is null or p_amount <= 0 then raise exception 'Valor do pagamento inválido.'; end if;
  if p_method not in ('PIX','Cartão','Transferência','Dinheiro','Outro') then raise exception 'Forma de pagamento inválida.'; end if;

  select status into v_status from public.admissions where id=p_admission_id for update;
  if not found then raise exception 'Internação não encontrada.'; end if;

  insert into public.payments(admission_id,occurred_at,amount,method,notes,created_by_name,created_by)
  values(p_admission_id,p_occurred_at,p_amount,p_method,nullif(trim(coalesce(p_notes,'')),''),v_user,auth.uid());

  insert into public.audits(admission_id,user_name,user_id,action,detail)
  values(p_admission_id,v_user,auth.uid(),'Pagamento registrado','R$ '||to_char(p_amount,'FM999G999G990D00')||' • '||p_method);

  if v_status='discharge_pending' then
    select coalesce(sum(c.amount),0)-coalesce((select sum(p.amount) from public.payments p where p.admission_id=p_admission_id),0)
    into v_balance
    from public.charges c
    where c.admission_id=p_admission_id;

    if v_balance <= 0 then
      update public.admissions set status='finalized' where id=p_admission_id;
      insert into public.audits(admission_id,user_name,user_id,action,detail)
      values(p_admission_id,v_user,auth.uid(),'Conta finalizada','Saldo quitado após a alta.');
      return 'finalized';
    end if;
  end if;
  return v_status;
end;
$$;

create or replace function public.add_uti_extra(
  p_admission_id uuid,
  p_occurred_at timestamptz,
  p_category text,
  p_description text,
  p_amount numeric
)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_user text;
  v_id uuid;
  v_cat text;
  v_desc text;
begin
  if not private.is_active_member() then raise exception 'Acesso não autorizado.'; end if;
  v_user := private.current_display_name();
  if p_amount is null or p_amount <= 0 then raise exception 'Valor do extra inválido.'; end if;
  if not exists(select 1 from public.admissions where id=p_admission_id) then raise exception 'Internação não encontrada.'; end if;

  v_cat:=coalesce(nullif(trim(p_category),''),'Outro serviço');
  v_desc:=coalesce(nullif(trim(p_description),''),v_cat);

  insert into public.charges(admission_id,occurred_at,kind,category,description,amount,created_by_name,created_by)
  values(p_admission_id,p_occurred_at,'extra',v_cat,v_desc,p_amount,v_user,auth.uid())
  returning id into v_id;

  insert into public.audits(admission_id,user_name,user_id,action,detail)
  values(p_admission_id,v_user,auth.uid(),'Extra adicionado',v_cat||' • R$ '||to_char(p_amount,'FM999G999G990D00'));

  return v_id;
end;
$$;

create or replace function public.adjust_uti_rate(
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
begin
  if not private.is_active_member() then raise exception 'Acesso não autorizado.'; end if;
  v_user := private.current_display_name();
  if p_negotiated_rate is null or p_negotiated_rate <= 0 then raise exception 'Valor da diária inválido.'; end if;

  select * into a from public.admissions where id=p_admission_id;
  if not found then raise exception 'Internação não encontrada.'; end if;
  if p_effective_at < a.entry_at then raise exception 'A nova condição não pode começar antes da entrada.'; end if;

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
  values(p_admission_id,p_effective_at,v_standard,p_negotiated_rate,
    case when a.mode='private' then coalesce(p_ventilation,false) else null end,
    v_label,v_user,auth.uid())
  returning id into v_id;

  insert into public.audits(admission_id,user_name,user_id,action,detail)
  values(p_admission_id,v_user,auth.uid(),'Diária ajustada',
    'A partir de '||to_char(p_effective_at at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')||
    ' • '||v_label||' • R$ '||to_char(p_negotiated_rate,'FM999G999G990D00'));

  return v_id;
end;
$$;

create or replace function public.discharge_uti(
  p_admission_id uuid,
  p_discharge_at timestamptz
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
  v_status text;
begin
  if not private.is_active_member() then raise exception 'Acesso não autorizado.'; end if;
  v_user:=private.current_display_name();

  select * into a from public.admissions where id=p_admission_id for update;
  if not found then raise exception 'Internação não encontrada.'; end if;
  if p_discharge_at < a.entry_at then raise exception 'A alta não pode ser anterior à entrada.'; end if;

  perform private.sync_daily_charges(p_admission_id,p_discharge_at,v_user);

  select
    coalesce((select sum(amount) from public.charges where admission_id=p_admission_id),0)
    - coalesce((select sum(amount) from public.payments where admission_id=p_admission_id),0)
  into v_balance;

  v_status:=case when v_balance<=0 then 'finalized' else 'discharge_pending' end;

  update public.admissions set discharge_at=p_discharge_at,status=v_status where id=p_admission_id;

  insert into public.audits(admission_id,user_name,user_id,action,detail)
  values(p_admission_id,v_user,auth.uid(),
    case when v_status='finalized' then 'Conta finalizada' else 'Alta registrada' end,
    case when v_status='finalized' then 'Saldo quitado.' else 'Saldo pendente R$ '||to_char(v_balance,'FM999G999G990D00') end);

  return v_status;
end;
$$;

create or replace function public.update_uti_on_duty(p_name text)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare v_user text;
begin
  if not private.is_active_member() then raise exception 'Acesso não autorizado.'; end if;
  if p_name not in ('Samuel','Roberto') then raise exception 'Responsável de plantão inválido.'; end if;
  v_user:=private.current_display_name();

  update public.app_settings set on_duty_name=p_name,updated_at=now(),updated_by=auth.uid() where id=1;
  insert into public.audits(user_name,user_id,action,detail)
  values(v_user,auth.uid(),'Plantão comercial atualizado',p_name);
end;
$$;

create or replace function public.admin_update_uti_member(
  p_user_id uuid,
  p_active boolean,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare v_admin text;
begin
  if not private.is_admin() then raise exception 'Somente administradores podem alterar acessos.'; end if;
  if p_role not in ('admin','operator','commercial') then raise exception 'Perfil inválido.'; end if;
  if p_user_id=auth.uid() and p_active=false then raise exception 'Você não pode desativar seu próprio acesso.'; end if;

  v_admin:=private.current_display_name();
  update public.profiles set active=p_active,role=p_role where id=p_user_id;
  if not found then raise exception 'Usuário não encontrado.'; end if;

  insert into public.audits(user_name,user_id,action,detail)
  values(v_admin,auth.uid(),'Acesso atualizado',p_user_id::text||' • '||p_role||' • '||case when p_active then 'ativo' else 'inativo' end);
end;
$$;

revoke all on function public.create_uti_admission(text,text,integer,text,timestamptz,text,boolean,boolean,numeric,text) from public;
revoke all on function public.add_uti_payment(uuid,timestamptz,numeric,text,text) from public;
revoke all on function public.add_uti_extra(uuid,timestamptz,text,text,numeric) from public;
revoke all on function public.adjust_uti_rate(uuid,timestamptz,numeric,boolean) from public;
revoke all on function public.discharge_uti(uuid,timestamptz) from public;
revoke all on function public.update_uti_on_duty(text) from public;
revoke all on function public.admin_update_uti_member(uuid,boolean,text) from public;

grant execute on function public.create_uti_admission(text,text,integer,text,timestamptz,text,boolean,boolean,numeric,text) to authenticated;
grant execute on function public.add_uti_payment(uuid,timestamptz,numeric,text,text) to authenticated;
grant execute on function public.add_uti_extra(uuid,timestamptz,text,text,numeric) to authenticated;
grant execute on function public.adjust_uti_rate(uuid,timestamptz,numeric,boolean) to authenticated;
grant execute on function public.discharge_uti(uuid,timestamptz) to authenticated;
grant execute on function public.update_uti_on_duty(text) to authenticated;
grant execute on function public.admin_update_uti_member(uuid,boolean,text) to authenticated;
