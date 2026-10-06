create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'operator' check (role in ('admin','operator','commercial')),
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  id smallint primary key default 1 check (id = 1),
  on_duty_name text not null default 'Samuel',
  timezone text not null default 'America/Sao_Paulo',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

insert into public.app_settings (id, on_duty_name, timezone)
values (1, 'Samuel', 'America/Sao_Paulo')
on conflict (id) do nothing;

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) >= 2),
  cpf text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) default auth.uid(),
  constraint patients_cpf_format check (cpf is null or cpf ~ '^[0-9]{11}$')
);
create unique index if not exists patients_cpf_unique on public.patients(cpf) where cpf is not null;

create table if not exists public.admissions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete restrict,
  bed integer not null check (bed between 1 and 19),
  mode text not null check (mode in ('private','hotel')),
  entry_at timestamptz not null,
  discharge_at timestamptz,
  status text not null default 'active' check (status in ('active','discharge_pending','finalized','cancelled')),
  closer_name text not null,
  created_by_name text not null,
  created_by uuid references public.profiles(id) default auth.uid(),
  half_initial boolean not null default false,
  commission_amount numeric(12,2) not null default 0 check (commission_amount >= 0),
  notes text,
  created_at timestamptz not null default now(),
  constraint admissions_discharge_after_entry check (discharge_at is null or discharge_at >= entry_at)
);
create unique index if not exists admissions_open_bed_unique
  on public.admissions(bed)
  where status in ('active','discharge_pending');
create unique index if not exists admissions_open_patient_unique
  on public.admissions(patient_id)
  where status in ('active','discharge_pending');

create table if not exists public.rate_periods (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null references public.admissions(id) on delete cascade,
  effective_at timestamptz not null,
  standard_rate numeric(12,2) not null check (standard_rate >= 0),
  negotiated_rate numeric(12,2) not null check (negotiated_rate >= 0),
  ventilation boolean,
  label text not null,
  changed_by_name text not null,
  changed_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists rate_periods_admission_effective_idx
  on public.rate_periods(admission_id, effective_at);

create table if not exists public.charges (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null references public.admissions(id) on delete cascade,
  occurred_at timestamptz not null,
  kind text not null check (kind in ('daily','extra','adjustment')),
  category text not null,
  description text not null,
  amount numeric(12,2) not null check (amount >= 0),
  cycle_key text,
  created_by_name text not null,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index if not exists charges_cycle_unique
  on public.charges(admission_id, cycle_key)
  where cycle_key is not null;
create index if not exists charges_admission_occurred_idx
  on public.charges(admission_id, occurred_at);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null references public.admissions(id) on delete cascade,
  occurred_at timestamptz not null,
  amount numeric(12,2) not null check (amount > 0),
  method text not null check (method in ('PIX','Cartão','Transferência','Dinheiro','Outro')),
  notes text,
  created_by_name text not null,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists payments_admission_occurred_idx
  on public.payments(admission_id, occurred_at);

create table if not exists public.audits (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid references public.admissions(id) on delete set null,
  occurred_at timestamptz not null default now(),
  user_name text not null,
  user_id uuid references public.profiles(id) default auth.uid(),
  action text not null,
  detail text not null
);
create index if not exists audits_admission_occurred_idx
  on public.audits(admission_id, occurred_at);

create or replace function private.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.active from public.profiles p where p.id = auth.uid()),
    false
  )
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.active and p.role = 'admin' from public.profiles p where p.id = auth.uid()),
    false
  )
$$;

revoke all on function private.is_active_member() from public, anon;
revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_active_member() to authenticated;
grant execute on function private.is_admin() to authenticated;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, display_name, role, active)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name',''), split_part(coalesce(new.email,'Usuário'),'@',1)),
    'operator',
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.patients enable row level security;
alter table public.admissions enable row level security;
alter table public.rate_periods enable row level security;
alter table public.charges enable row level security;
alter table public.payments enable row level security;
alter table public.audits enable row level security;

drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles
for select to authenticated
using (id = auth.uid() or private.is_active_member());

drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
for update to authenticated
using (private.is_admin())
with check (private.is_admin());

drop policy if exists settings_active_select on public.app_settings;
create policy settings_active_select on public.app_settings
for select to authenticated
using (private.is_active_member());

drop policy if exists settings_active_update on public.app_settings;
create policy settings_active_update on public.app_settings
for update to authenticated
using (private.is_active_member())
with check (private.is_active_member());

drop policy if exists patients_active_all on public.patients;
create policy patients_active_all on public.patients
for all to authenticated
using (private.is_active_member())
with check (private.is_active_member());

drop policy if exists admissions_active_all on public.admissions;
create policy admissions_active_all on public.admissions
for all to authenticated
using (private.is_active_member())
with check (private.is_active_member());

drop policy if exists rate_periods_active_all on public.rate_periods;
create policy rate_periods_active_all on public.rate_periods
for all to authenticated
using (private.is_active_member())
with check (private.is_active_member());

drop policy if exists charges_active_all on public.charges;
create policy charges_active_all on public.charges
for all to authenticated
using (private.is_active_member())
with check (private.is_active_member());

drop policy if exists payments_active_all on public.payments;
create policy payments_active_all on public.payments
for all to authenticated
using (private.is_active_member())
with check (private.is_active_member());

drop policy if exists audits_active_select on public.audits;
create policy audits_active_select on public.audits
for select to authenticated
using (private.is_active_member());

drop policy if exists audits_active_insert on public.audits;
create policy audits_active_insert on public.audits
for insert to authenticated
with check (private.is_active_member());

revoke all on public.profiles, public.app_settings, public.patients, public.admissions, public.rate_periods, public.charges, public.payments, public.audits from anon;
grant select on public.profiles, public.app_settings, public.patients, public.admissions, public.rate_periods, public.charges, public.payments, public.audits to authenticated;
grant insert, update on public.patients, public.admissions, public.rate_periods, public.charges, public.payments to authenticated;
grant insert on public.audits to authenticated;
grant update on public.app_settings to authenticated;
grant update on public.profiles to authenticated;
