drop index if exists public.charges_cycle_unique;
create unique index charges_cycle_unique
  on public.charges(admission_id, cycle_key);
