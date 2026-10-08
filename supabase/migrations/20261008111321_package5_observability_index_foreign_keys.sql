create index if not exists system_alerts_health_check_id_idx
  on public.system_alerts(health_check_id)
  where health_check_id is not null;

create index if not exists system_alerts_acknowledged_by_idx
  on public.system_alerts(acknowledged_by)
  where acknowledged_by is not null;
