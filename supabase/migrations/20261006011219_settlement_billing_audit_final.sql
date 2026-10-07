CREATE OR REPLACE FUNCTION private.sync_daily_charges(p_admission_id uuid DEFAULT NULL::uuid, p_limit_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_user_name text DEFAULT 'Sistema'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  a record;
  r record;
  v_entry_local timestamp;
  v_next_date date;
  v_cycle timestamptz;
  v_end timestamptz;
  v_key text;
  v_inserted integer;
  v_count integer := 0;
  v_discharge_date date;
  v_has_discharge_cutoff boolean;
begin
  for a in
    select *
    from public.admissions
    where status in ('active','discharge_pending')
      and (p_admission_id is null or id = p_admission_id)
  loop
    v_end := coalesce(p_limit_at, a.discharge_at, now());
    v_has_discharge_cutoff := (p_limit_at is not null or a.discharge_at is not null);

    if v_has_discharge_cutoff then
      v_discharge_date := (v_end at time zone 'America/Sao_Paulo')::date;
    else
      v_discharge_date := null;
    end if;

    if a.entry_at > v_end then
      continue;
    end if;

    select *
    into r
    from public.rate_periods
    where admission_id = a.id
      and effective_at <= a.entry_at
    order by effective_at desc
    limit 1;

    if found then
      v_key := 'initial:' || a.id::text || ':' || extract(epoch from a.entry_at)::text;
      insert into public.charges (
        admission_id, occurred_at, kind, category, description, amount, cycle_key, created_by_name
      )
      values (
        a.id,
        a.entry_at,
        'daily',
        case when a.mode = 'private' then 'Diária UTI' else 'Hotelaria' end,
        case when a.half_initial then '½ diária inicial — ' || r.label else 'Diária inicial — ' || r.label end,
        case when a.half_initial then r.negotiated_rate / 2 else r.negotiated_rate end,
        v_key,
        p_user_name
      )
      on conflict (admission_id, cycle_key) do nothing;
      get diagnostics v_inserted = row_count;
      v_count := v_count + v_inserted;
    end if;

    v_entry_local := a.entry_at at time zone 'America/Sao_Paulo';
    v_next_date := v_entry_local::date + 1;
    v_cycle := (v_next_date + time '07:00') at time zone 'America/Sao_Paulo';

    while
      v_cycle < v_end
      and (
        not v_has_discharge_cutoff
        or (v_cycle at time zone 'America/Sao_Paulo')::date < v_discharge_date
      )
    loop
      select *
      into r
      from public.rate_periods
      where admission_id = a.id
        and effective_at <= v_cycle
      order by effective_at desc
      limit 1;

      if found then
        v_key := 'cycle:' || a.id::text || ':' || extract(epoch from v_cycle)::text;
        insert into public.charges (
          admission_id, occurred_at, kind, category, description, amount, cycle_key, created_by_name
        )
        values (
          a.id,
          v_cycle,
          'daily',
          case when a.mode = 'private' then 'Diária UTI' else 'Hotelaria' end,
          'Diária — ' || r.label,
          r.negotiated_rate,
          v_key,
          p_user_name
        )
        on conflict (admission_id, cycle_key) do nothing;
        get diagnostics v_inserted = row_count;
        v_count := v_count + v_inserted;
      end if;

      v_next_date := v_next_date + 1;
      v_cycle := (v_next_date + time '07:00') at time zone 'America/Sao_Paulo';
    end loop;
  end loop;

  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION private.trim_future_daily_charges(p_admission_id uuid, p_discharge_at timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_count integer := 0;
  v_discharge_date date;
begin
  if not private.is_active_member() then
    raise exception 'Acesso não autorizado.';
  end if;

  v_discharge_date := (p_discharge_at at time zone 'America/Sao_Paulo')::date;

  delete from public.charges
  where admission_id = p_admission_id
    and kind = 'daily'
    and cycle_key like 'cycle:%'
    and (occurred_at at time zone 'America/Sao_Paulo')::date >= v_discharge_date;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION private.rebuild_daily_charges(p_admission_id uuid, p_limit_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_user_name text DEFAULT 'Sistema'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_before numeric := 0;
  v_after numeric := 0;
  v_deleted integer := 0;
  v_inserted integer := 0;
begin
  if not private.is_active_member() then
    raise exception 'Acesso não autorizado.';
  end if;

  select coalesce(sum(amount),0)
  into v_before
  from public.charges
  where admission_id=p_admission_id
    and kind='daily'
    and cycle_key is not null;

  delete from public.charges
  where admission_id=p_admission_id
    and kind='daily'
    and cycle_key is not null;

  get diagnostics v_deleted = row_count;

  v_inserted := private.sync_daily_charges(p_admission_id,p_limit_at,p_user_name);

  select coalesce(sum(amount),0)
  into v_after
  from public.charges
  where admission_id=p_admission_id
    and kind='daily'
    and cycle_key is not null;

  return jsonb_build_object(
    'deleted',v_deleted,
    'inserted',v_inserted,
    'before',v_before,
    'after',v_after,
    'difference',v_after-v_before
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_uti_admission(p_name text, p_cpf text, p_bed integer, p_mode text, p_entry_at timestamp with time zone, p_closer text, p_half_initial boolean, p_ventilation boolean, p_negotiated_rate numeric, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.add_uti_payment(p_admission_id uuid, p_occurred_at timestamp with time zone, p_amount numeric, p_method text, p_notes text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_user text;
  v_status text;
  v_balance numeric;
begin
  if not private.is_active_member() then raise exception 'Acesso não autorizado.'; end if;
  v_user := private.current_display_name();
  if p_amount is null or p_amount <= 0 then raise exception 'Valor do pagamento inválido.'; end if;
  if p_method not in ('PIX','Cartão','Transferência','Dinheiro','Outro') then raise exception 'Forma de pagamento inválida.'; end if;

  select status into v_status
  from public.admissions
  where id=p_admission_id
  for update;

  if not found then raise exception 'Internação não encontrada.'; end if;
  if v_status='cancelled' then raise exception 'Não é possível registrar pagamento em internação cancelada.'; end if;
  if v_status='finalized' then raise exception 'A conta já está finalizada.'; end if;

  if v_status='discharge_pending' then
    select
      coalesce((select sum(c.amount) from public.charges c where c.admission_id=p_admission_id),0)
      - coalesce((select sum(pm.amount) from public.payments pm where pm.admission_id=p_admission_id),0)
    into v_balance;

    if v_balance <= 0 then
      update public.admissions set status='finalized' where id=p_admission_id;
      raise exception 'A conta já está quitada.';
    end if;

    if p_amount > v_balance + 0.009 then
      raise exception 'O pagamento informado é maior que o saldo pendente de R$ %.', to_char(v_balance,'FM999G999G990D00');
    end if;
  end if;

  insert into public.payments(admission_id,occurred_at,amount,method,notes,created_by_name,created_by)
  values(p_admission_id,p_occurred_at,p_amount,p_method,nullif(trim(coalesce(p_notes,'')),''),v_user,auth.uid());

  insert into public.audits(admission_id,user_name,user_id,action,detail)
  values(p_admission_id,v_user,auth.uid(),'Pagamento registrado','R$ '||to_char(p_amount,'FM999G999G990D00')||' • '||p_method);

  if v_status='discharge_pending' then
    select
      coalesce((select sum(c.amount) from public.charges c where c.admission_id=p_admission_id),0)
      - coalesce((select sum(pm.amount) from public.payments pm where pm.admission_id=p_admission_id),0)
    into v_balance;

    if v_balance <= 0.009 then
      update public.admissions set status='finalized' where id=p_admission_id;
      insert into public.audits(admission_id,user_name,user_id,action,detail)
      values(p_admission_id,v_user,auth.uid(),'Conta finalizada','Saldo quitado após a alta.');
      return 'finalized';
    end if;
  end if;

  return v_status;
end;
$function$;

CREATE OR REPLACE FUNCTION public.add_uti_extra(p_admission_id uuid, p_occurred_at timestamp with time zone, p_category text, p_description text, p_amount numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_user text;
  v_id uuid;
  v_cat text;
  v_desc text;
  v_status text;
begin
  if not private.is_active_member() then raise exception 'Acesso não autorizado.'; end if;
  v_user := private.current_display_name();
  if p_amount is null or p_amount <= 0 then raise exception 'Valor do extra inválido.'; end if;

  select status into v_status
  from public.admissions
  where id=p_admission_id
  for update;

  if not found then raise exception 'Internação não encontrada.'; end if;
  if v_status='cancelled' then raise exception 'Não é possível adicionar cobrança em internação cancelada.'; end if;
  if v_status='finalized' then raise exception 'A conta já está finalizada.'; end if;

  v_cat:=coalesce(nullif(trim(p_category),''),'Outro serviço');
  v_desc:=coalesce(nullif(trim(p_description),''),v_cat);

  insert into public.charges(admission_id,occurred_at,kind,category,description,amount,created_by_name,created_by)
  values(p_admission_id,p_occurred_at,'extra',v_cat,v_desc,p_amount,v_user,auth.uid())
  returning id into v_id;

  insert into public.audits(admission_id,user_name,user_id,action,detail)
  values(p_admission_id,v_user,auth.uid(),'Extra adicionado',v_cat||' • R$ '||to_char(p_amount,'FM999G999G990D00'));

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.adjust_uti_rate(p_admission_id uuid, p_effective_at timestamp with time zone, p_negotiated_rate numeric, p_ventilation boolean DEFAULT NULL::boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_user text;
  a public.admissions;
  v_standard numeric;
  v_label text;
  v_id uuid;
  v_rebuild jsonb;
  v_diff numeric;
begin
  if not private.is_active_member() then raise exception 'Acesso não autorizado.'; end if;
  v_user := private.current_display_name();
  if p_negotiated_rate is null or p_negotiated_rate <= 0 then raise exception 'Valor da diária inválido.'; end if;

  select * into a from public.admissions where id=p_admission_id for update;
  if not found then raise exception 'Internação não encontrada.'; end if;
  if a.status <> 'active' then raise exception 'A diária só pode ser ajustada enquanto a internação estiver ativa.'; end if;
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

  insert into public.rate_periods(
    admission_id,effective_at,standard_rate,negotiated_rate,ventilation,label,changed_by_name,changed_by
  )
  values(
    p_admission_id,p_effective_at,v_standard,p_negotiated_rate,
    case when a.mode='private' then coalesce(p_ventilation,false) else null end,
    v_label,v_user,auth.uid()
  )
  returning id into v_id;

  v_rebuild := private.rebuild_daily_charges(p_admission_id,null,v_user);
  v_diff := coalesce((v_rebuild->>'difference')::numeric,0);

  insert into public.audits(admission_id,user_name,user_id,action,detail)
  values(
    p_admission_id,v_user,auth.uid(),'Diária ajustada',
    'A partir de '||to_char(p_effective_at at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')||
    ' • '||v_label||' • R$ '||to_char(p_negotiated_rate,'FM999G999G990D00')
  );

  if abs(v_diff) > 0.009 then
    insert into public.audits(admission_id,user_name,user_id,action,detail)
    values(
      p_admission_id,v_user,auth.uid(),'Diárias automáticas reconciliadas',
      'Histórico recalculado após mudança de condição • diferença R$ '||
      to_char(v_diff,'FM999G999G990D00')
    );
  end if;

  return v_id;
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

  select * into a from public.admissions where id = p_admission_id;
  if not found then raise exception 'Internação não encontrada.'; end if;
  if p_discharge_at is null then raise exception 'Informe a data e hora de saída.'; end if;
  if p_discharge_at < a.entry_at then raise exception 'A saída não pode ser anterior à entrada.'; end if;

  v_discharge_date := (p_discharge_at at time zone 'America/Sao_Paulo')::date;

  select * into r
  from public.rate_periods
  where admission_id = a.id and effective_at <= a.entry_at
  order by effective_at desc, created_at desc
  limit 1;
  if not found then raise exception 'Condição de diária não encontrada.'; end if;

  v_amount := case when a.half_initial then r.negotiated_rate / 2 else r.negotiated_rate end;
  v_daily_total := v_daily_total + v_amount;
  if a.half_initial then
    v_half_count := 1; v_units := 0.5;
  else
    v_full_count := 1; v_units := 1;
  end if;

  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'occurredAt', a.entry_at,
    'description', case when a.half_initial then '½ diária inicial — ' || r.label else 'Diária inicial — ' || r.label end,
    'amount', v_amount,
    'units', case when a.half_initial then 0.5 else 1 end,
    'kind', 'daily'
  ));

  v_entry_local := a.entry_at at time zone 'America/Sao_Paulo';
  v_next_date := v_entry_local::date + 1;
  v_cycle := (v_next_date + time '07:00') at time zone 'America/Sao_Paulo';

  while (v_cycle at time zone 'America/Sao_Paulo')::date < v_discharge_date loop
    select * into r
    from public.rate_periods
    where admission_id = a.id and effective_at <= v_cycle
    order by effective_at desc, created_at desc
    limit 1;

    if found then
      v_daily_total := v_daily_total + r.negotiated_rate;
      v_full_count := v_full_count + 1;
      v_units := v_units + 1;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'occurredAt', v_cycle,
        'description', 'Diária — ' || r.label,
        'amount', r.negotiated_rate,
        'units', 1,
        'kind', 'daily'
      ));
    end if;

    v_next_date := v_next_date + 1;
    v_cycle := (v_next_date + time '07:00') at time zone 'America/Sao_Paulo';
  end loop;

  select coalesce(sum(amount),0)
  into v_extras_total
  from public.charges
  where admission_id = a.id and kind <> 'daily';

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'occurredAt', c.occurred_at,
        'description', c.description,
        'category', c.category,
        'amount', c.amount,
        'kind', c.kind
      ) order by c.occurred_at
    ),
    '[]'::jsonb
  )
  into v_extra_items
  from public.charges c
  where c.admission_id = a.id and c.kind <> 'daily';

  v_items := v_items || v_extra_items;

  select coalesce(sum(amount),0)
  into v_received
  from public.payments
  where admission_id = a.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'occurredAt', p.occurred_at,
        'amount', p.amount,
        'method', p.method,
        'notes', p.notes,
        'createdBy', p.created_by_name
      ) order by p.occurred_at
    ),
    '[]'::jsonb
  )
  into v_payments
  from public.payments p
  where p.admission_id = a.id;

  v_stay_minutes := greatest(0, floor(extract(epoch from (p_discharge_at - a.entry_at)) / 60));

  return jsonb_build_object(
    'admissionId', a.id,
    'entryAt', a.entry_at,
    'dischargeAt', p_discharge_at,
    'stayMinutes', v_stay_minutes,
    'dailyUnits', v_units,
    'fullDailyCount', v_full_count,
    'halfDailyCount', v_half_count,
    'dailyTotal', v_daily_total,
    'extrasTotal', v_extras_total,
    'total', v_daily_total + v_extras_total,
    'received', v_received,
    'balance', (v_daily_total + v_extras_total) - v_received,
    'items', v_items,
    'payments', v_payments
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.discharge_uti(p_admission_id uuid, p_discharge_at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
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

  select * into a
  from public.admissions
  where id = p_admission_id
  for update;

  if not found then raise exception 'Internação não encontrada.'; end if;
  if a.status = 'cancelled' then raise exception 'Internação cancelada não pode receber alta.'; end if;
  if a.status = 'finalized' then raise exception 'Esta internação já está finalizada.'; end if;
  if p_discharge_at is null then raise exception 'Informe a data e hora de saída.'; end if;
  if p_discharge_at < a.entry_at then raise exception 'A saída não pode ser anterior à entrada.'; end if;

  v_trimmed := private.trim_future_daily_charges(p_admission_id, p_discharge_at);
  v_rebuild := private.rebuild_daily_charges(p_admission_id,p_discharge_at,v_user);
  v_rebuild_diff := coalesce((v_rebuild->>'difference')::numeric,0);

  select coalesce(sum(amount),0)
  into v_billed
  from public.charges
  where admission_id = p_admission_id;

  select coalesce(sum(amount),0)
  into v_received
  from public.payments
  where admission_id = p_admission_id;

  v_balance := v_billed - v_received;
  v_status := case when v_balance <= 0 then 'finalized' else 'discharge_pending' end;

  update public.admissions
  set discharge_at = p_discharge_at,
      status = v_status
  where id = p_admission_id;

  if v_trimmed > 0 then
    insert into public.audits(admission_id,user_name,user_id,action,detail)
    values(
      p_admission_id,v_user,auth.uid(),'Diária automática ajustada',
      v_trimmed::text || case when v_trimmed=1 then ' diária removida' else ' diárias removidas' end ||
      ' por ocorrer no dia da saída ou após ele.'
    );
  end if;

  if abs(v_rebuild_diff) > 0.009 then
    insert into public.audits(admission_id,user_name,user_id,action,detail)
    values(
      p_admission_id,v_user,auth.uid(),'Diárias automáticas reconciliadas',
      'Valores recalculados pelo histórico de condições antes do acerto • diferença R$ '||
      to_char(v_rebuild_diff,'FM999G999G990D00')
    );
  end if;

  insert into public.audits(admission_id,user_name,user_id,action,detail)
  values(
    p_admission_id,v_user,auth.uid(),
    case when v_status='finalized' then 'Alta e acerto finalizados' else 'Alta registrada' end,
    'Saída ' || to_char(p_discharge_at at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI') ||
    ' • Total R$ ' || to_char(v_billed,'FM999G999G990D00') ||
    ' • Recebido R$ ' || to_char(v_received,'FM999G999G990D00') ||
    ' • Saldo R$ ' || to_char(v_balance,'FM999G999G990D00')
  );

  return v_status;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_uti_charges(p_admission_id uuid DEFAULT NULL::uuid, p_limit_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_name text;
begin
  if not private.is_active_member() then
    raise exception 'Acesso não autorizado.';
  end if;

  select display_name into v_name from public.profiles where id = auth.uid();
  return private.sync_daily_charges(p_admission_id, p_limit_at, coalesce(v_name,'Sistema'));
end;
$function$;


revoke all on function private.sync_daily_charges(uuid,timestamptz,text) from public, anon;
grant execute on function private.sync_daily_charges(uuid,timestamptz,text) to authenticated;
revoke all on function private.trim_future_daily_charges(uuid,timestamptz) from public, anon;
grant execute on function private.trim_future_daily_charges(uuid,timestamptz) to authenticated;
revoke all on function private.rebuild_daily_charges(uuid,timestamptz,text) from public, anon;
grant execute on function private.rebuild_daily_charges(uuid,timestamptz,text) to authenticated;

revoke all on function public.create_uti_admission(text,text,integer,text,timestamptz,text,boolean,boolean,numeric,text) from public, anon;
grant execute on function public.create_uti_admission(text,text,integer,text,timestamptz,text,boolean,boolean,numeric,text) to authenticated;
revoke all on function public.add_uti_payment(uuid,timestamptz,numeric,text,text) from public, anon;
grant execute on function public.add_uti_payment(uuid,timestamptz,numeric,text,text) to authenticated;
revoke all on function public.add_uti_extra(uuid,timestamptz,text,text,numeric) from public, anon;
grant execute on function public.add_uti_extra(uuid,timestamptz,text,text,numeric) to authenticated;
revoke all on function public.adjust_uti_rate(uuid,timestamptz,numeric,boolean) from public, anon;
grant execute on function public.adjust_uti_rate(uuid,timestamptz,numeric,boolean) to authenticated;
revoke all on function public.preview_uti_settlement(uuid,timestamptz) from public, anon;
grant execute on function public.preview_uti_settlement(uuid,timestamptz) to authenticated;
revoke all on function public.discharge_uti(uuid,timestamptz) from public, anon;
grant execute on function public.discharge_uti(uuid,timestamptz) to authenticated;
revoke all on function public.sync_uti_charges(uuid,timestamptz) from public, anon;
grant execute on function public.sync_uti_charges(uuid,timestamptz) to authenticated;
