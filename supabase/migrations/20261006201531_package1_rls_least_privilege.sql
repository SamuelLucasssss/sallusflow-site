drop policy if exists admissions_active_all on public.admissions;
drop policy if exists charges_active_all on public.charges;
drop policy if exists patients_active_all on public.patients;
drop policy if exists payments_active_all on public.payments;
drop policy if exists rate_periods_active_all on public.rate_periods;
drop policy if exists settings_active_update on public.app_settings;
drop policy if exists audits_active_insert on public.audits;
drop policy if exists profiles_admin_update on public.profiles;

create policy admissions_active_select
on public.admissions for select to authenticated
using (private.is_active_member());

create policy charges_active_select
on public.charges for select to authenticated
using (private.is_active_member());

create policy patients_active_select
on public.patients for select to authenticated
using (private.is_active_member());

create policy payments_active_select
on public.payments for select to authenticated
using (private.is_active_member());

create policy rate_periods_active_select
on public.rate_periods for select to authenticated
using (private.is_active_member());

revoke insert,update,delete on public.admissions from authenticated;
revoke insert,update,delete on public.charges from authenticated;
revoke insert,update,delete on public.patients from authenticated;
revoke insert,update,delete on public.payments from authenticated;
revoke insert,update,delete on public.refunds from authenticated;
revoke insert,update,delete on public.rate_periods from authenticated;
revoke insert,update,delete on public.audits from authenticated;
revoke update on public.app_settings from authenticated;
revoke update on public.profiles from authenticated;
