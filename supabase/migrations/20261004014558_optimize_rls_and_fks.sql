drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles
for select to authenticated
using (id = (select auth.uid()) or private.is_active_member());

create index if not exists admissions_created_by_idx on public.admissions(created_by);
create index if not exists app_settings_updated_by_idx on public.app_settings(updated_by);
create index if not exists audits_user_id_idx on public.audits(user_id);
create index if not exists charges_created_by_idx on public.charges(created_by);
create index if not exists patients_created_by_idx on public.patients(created_by);
create index if not exists payments_created_by_idx on public.payments(created_by);
create index if not exists rate_periods_changed_by_idx on public.rate_periods(changed_by);
