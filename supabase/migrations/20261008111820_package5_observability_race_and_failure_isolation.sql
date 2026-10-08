create or replace function private.enrich_uti_health_with_observability()
returns trigger
language plpgsql
security definer
set search_path='public','private','cron','pg_temp'
as $$
declare
  v_watchdog_active boolean:=false;
  v_watchdog_failures integer:=0;
  v_active_admissions integer:=coalesce((new.metrics->>'active_admissions')::integer,0);
begin
  select coalesce(bool_or(active),false)
  into v_watchdog_active
  from cron.job
  where jobname='imec-uti-observability-watchdog';

  select count(*)
  into v_watchdog_failures
  from cron.job j
  join cron.job_run_details d on d.jobid=j.jobid
  where j.jobname='imec-uti-observability-watchdog'
    and d.start_time >= now()-interval '6 hours'
    and d.status not in ('succeeded','running');

  new.metrics:=coalesce(new.metrics,'{}'::jsonb)||jsonb_build_object(
    'observability_watchdog_active',v_watchdog_active,
    'observability_watchdog_recent_failures',v_watchdog_failures
  );

  if not v_watchdog_active then
    new.issues:=coalesce(new.issues,'[]'::jsonb)||jsonb_build_array(jsonb_build_object(
      'code','OBSERVABILITY_WATCHDOG_INACTIVE',
      'severity',case when v_active_admissions>0 then 'critical' else 'warn' end,
      'message','O watchdog de observabilidade está ausente ou inativo.'
    ));
  end if;

  if v_watchdog_failures>0 then
    new.issues:=coalesce(new.issues,'[]'::jsonb)||jsonb_build_array(jsonb_build_object(
      'code','OBSERVABILITY_WATCHDOG_FAILURES',
      'severity','warn',
      'message','O watchdog de observabilidade apresentou falha recente.',
      'count',v_watchdog_failures
    ));
  end if;

  if exists(select 1 from jsonb_array_elements(coalesce(new.issues,'[]'::jsonb)) e where e->>'severity'='critical') then
    new.status:='critical';
  elsif jsonb_array_length(coalesce(new.issues,'[]'::jsonb))>0 and new.status='ok' then
    new.status:='warn';
  end if;

  return new;
end;
$$;

revoke all on function private.enrich_uti_health_with_observability() from public, anon, authenticated;

drop trigger if exists system_health_observability_enrichment on public.system_health_checks;
create trigger system_health_observability_enrichment
before insert on public.system_health_checks
for each row execute function private.enrich_uti_health_with_observability();

create or replace function private.upsert_uti_system_alert(
  p_alert_key text,
  p_code text,
  p_severity text,
  p_message text,
  p_details jsonb default '{}'::jsonb,
  p_detected_at timestamptz default now(),
  p_health_check_id bigint default null
)
returns bigint
language plpgsql
security definer
set search_path='public','private','pg_temp'
as $$
declare
  v_id bigint;
  v_old_severity text;
  v_escalated boolean := false;
begin
  if nullif(trim(coalesce(p_alert_key,'')),'') is null then raise exception 'Chave do alerta ausente.'; end if;
  if nullif(trim(coalesce(p_code,'')),'') is null then raise exception 'Código do alerta ausente.'; end if;
  if p_severity not in ('warn','critical') then raise exception 'Severidade de alerta inválida.'; end if;
  if nullif(trim(coalesce(p_message,'')),'') is null then raise exception 'Mensagem do alerta ausente.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(trim(p_alert_key),0));

  select id,severity
    into v_id,v_old_severity
  from public.system_alerts
  where alert_key=trim(p_alert_key)
    and status in ('open','acknowledged')
  for update;

  if found then
    v_escalated:=v_old_severity='warn' and p_severity='critical';

    update public.system_alerts
    set severity=p_severity,
        message=trim(p_message),
        details=coalesce(p_details,'{}'::jsonb),
        last_detected_at=coalesce(p_detected_at,now()),
        occurrence_count=occurrence_count+1,
        health_check_id=p_health_check_id,
        status=case when v_escalated then 'open' else status end,
        acknowledged_at=case when v_escalated then null else acknowledged_at end,
        acknowledged_by=case when v_escalated then null else acknowledged_by end,
        acknowledged_by_name=case when v_escalated then null else acknowledged_by_name end,
        resolved_at=null
    where id=v_id;

    if v_escalated then
      insert into public.audits(user_name,user_id,action,detail)
      values('Sistema',null,'Alerta operacional escalado',p_code||' • CRÍTICO • '||trim(p_message));
    end if;
    return v_id;
  end if;

  insert into public.system_alerts(
    alert_key,code,severity,message,details,status,
    first_detected_at,last_detected_at,occurrence_count,health_check_id
  )
  values(
    trim(p_alert_key),trim(p_code),p_severity,trim(p_message),
    coalesce(p_details,'{}'::jsonb),'open',
    coalesce(p_detected_at,now()),coalesce(p_detected_at,now()),1,p_health_check_id
  )
  returning id into v_id;

  insert into public.audits(user_name,user_id,action,detail)
  values('Sistema',null,'Alerta operacional aberto',p_code||' • '||upper(p_severity)||' • '||trim(p_message));

  return v_id;
end;
$$;

revoke all on function private.upsert_uti_system_alert(text,text,text,text,jsonb,timestamptz,bigint) from public, anon, authenticated;

create or replace function private.system_health_alert_trigger()
returns trigger
language plpgsql
security definer
set search_path='public','private','pg_temp'
as $$
begin
  begin
    perform private.reconcile_uti_health_snapshot(new.id);
  exception when others then
    insert into public.audits(user_name,user_id,action,detail)
    values('Sistema',null,'Falha no processamento de alertas','Health check #'||new.id||' preservado; reconciliação de alertas falhou.');
    raise warning 'IMEC UTI alert reconciliation failed for health check % [%]: %',new.id,sqlstate,sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function private.system_health_alert_trigger() from public, anon, authenticated;

select private.run_uti_health_check('migration');
