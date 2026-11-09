alter table public.admission_bed_transfers
  add column next_daily_rate numeric(12,2),
  add column rate_effective_at timestamptz,
  add constraint admission_bed_transfer_rate_schedule check (
    (next_daily_rate is null and rate_effective_at is null)
    or (next_daily_rate is not null and next_daily_rate between 0.01 and 1000000
        and rate_effective_at is not null and isfinite(rate_effective_at) and rate_effective_at>effective_at)
  );

create function private.transfer_uti_bed_with_rate_impl(
  p_admission_id uuid,p_expected_version bigint,p_to_bed integer,p_effective_at timestamptz,
  p_reason text,p_next_daily_rate numeric
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  a public.admissions;
  v_transfer_id uuid;
  v_actor_name text;
  v_last_charge timestamptz;
  v_reference_local timestamp;
  v_cycle_local timestamp;
  v_rate_at timestamptz;
  v_standard numeric;
  v_label text;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Somente administradores podem transferir leitos.';
  end if;
  if p_next_daily_rate is null or p_next_daily_rate not between 0.01 and 1000000
    or p_next_daily_rate<>round(p_next_daily_rate,2) then
    raise exception 'Informe um valor positivo com até duas casas decimais.';
  end if;

  v_actor_name:=private.current_display_name();
  v_transfer_id:=private.record_uti_bed_transfer(p_admission_id,p_expected_version,p_to_bed,p_effective_at,
    p_reason,auth.uid(),v_actor_name);
  select * into a from public.admissions where id=p_admission_id;
  if a.mode<>'hotel' or a.status<>'active' or a.discharge_at is not null then
    raise exception 'A próxima diária pode ser definida apenas para hotelaria em andamento.';
  end if;

  -- Never change an already posted cycle. A transfer logged late still starts prospectively.
  select max(occurred_at) into v_last_charge from public.charges
  where admission_id=a.id and kind='daily' and cancelled_at is null;
  v_reference_local:=greatest(now(),p_effective_at,v_last_charge) at time zone 'America/Sao_Paulo';
  v_cycle_local:=greatest(
    v_reference_local::date + case when v_reference_local::time>=time '07:00' then 1 else 0 end + time '07:00',
    (a.entry_at at time zone 'America/Sao_Paulo')::date + 1 + time '07:00'
  );
  v_rate_at:=v_cycle_local at time zone 'America/Sao_Paulo';
  v_standard:=case when a.bed>=17 then 500 else 400 end;
  v_label:=case when a.bed>=17 then 'Hotelaria com suíte' else 'Hotelaria individual' end;

  -- If another transfer occurs before the same cycle, the latest chosen rate applies.
  insert into public.rate_periods(admission_id,effective_at,standard_rate,negotiated_rate,ventilation,label,changed_by_name,changed_by)
  values(a.id,v_rate_at,v_standard,p_next_daily_rate,null,v_label,v_actor_name,auth.uid())
  on conflict (admission_id,effective_at) do update
    set standard_rate=excluded.standard_rate,negotiated_rate=excluded.negotiated_rate,
        ventilation=excluded.ventilation,label=excluded.label,changed_by_name=excluded.changed_by_name,
        changed_by=excluded.changed_by;

  update public.admission_bed_transfers
  set next_daily_rate=p_next_daily_rate,rate_effective_at=v_rate_at where id=v_transfer_id;
  insert into public.audits(admission_id,user_name,user_id,action,detail)
  values(a.id,v_actor_name,auth.uid(),'Diária programada na transferência',
    format('Leito %s • R$ %s a partir de %s',a.bed,p_next_daily_rate,to_char(v_cycle_local,'DD/MM/YYYY HH24:MI')));
  return v_transfer_id;
end;
$$;

create function public.transfer_uti_bed_with_rate(
  p_admission_id uuid,p_expected_version bigint,p_to_bed integer,p_effective_at timestamptz,
  p_reason text,p_next_daily_rate numeric
) returns uuid language sql security invoker set search_path='' as $$
  select private.transfer_uti_bed_with_rate_impl(p_admission_id,p_expected_version,p_to_bed,
    p_effective_at,p_reason,p_next_daily_rate);
$$;

revoke all on function private.transfer_uti_bed_with_rate_impl(uuid,bigint,integer,timestamptz,text,numeric),
  public.transfer_uti_bed_with_rate(uuid,bigint,integer,timestamptz,text,numeric) from public,anon,authenticated;
grant execute on function private.transfer_uti_bed_with_rate_impl(uuid,bigint,integer,timestamptz,text,numeric),
  public.transfer_uti_bed_with_rate(uuid,bigint,integer,timestamptz,text,numeric) to authenticated;
