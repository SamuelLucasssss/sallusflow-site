create or replace function private.sync_daily_charges(
  p_admission_id uuid default null,
  p_limit_at timestamptz default null,
  p_user_name text default 'Sistema'
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
begin
  for a in
    select *
    from public.admissions
    where status in ('active','discharge_pending')
      and (p_admission_id is null or id = p_admission_id)
  loop
    v_end := coalesce(p_limit_at, a.discharge_at, now());
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
    if v_entry_local::time < time '07:00' then
      v_next_date := v_entry_local::date;
    else
      v_next_date := v_entry_local::date + 1;
    end if;

    v_cycle := (v_next_date + time '07:00') at time zone 'America/Sao_Paulo';

    while v_cycle < v_end loop
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
$$;

create or replace function public.sync_uti_charges(
  p_admission_id uuid default null,
  p_limit_at timestamptz default null
)
returns integer
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_name text;
begin
  if not private.is_active_member() then
    raise exception 'Acesso não autorizado.';
  end if;

  select display_name into v_name from public.profiles where id = auth.uid();
  return private.sync_daily_charges(p_admission_id, p_limit_at, coalesce(v_name,'Sistema'));
end;
$$;

revoke all on function public.sync_uti_charges(uuid,timestamptz) from public;
grant execute on function public.sync_uti_charges(uuid,timestamptz) to authenticated;

create extension if not exists pg_cron with schema extensions;
select cron.schedule(
  'imec-uti-sync-daily-charges',
  '5 * * * *',
  $$select private.sync_daily_charges(null, null, 'Sistema');$$
)
where not exists (
  select 1 from cron.job where jobname = 'imec-uti-sync-daily-charges'
);
