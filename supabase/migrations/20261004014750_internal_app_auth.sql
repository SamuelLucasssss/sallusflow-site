create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  display_name text not null,
  role text not null check (role in ('admin','operator','commercial')),
  active boolean not null default true,
  password_salt text not null,
  password_hash text not null,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_users_username_lower check (username = lower(username)),
  constraint app_users_username_format check (username ~ '^[a-z0-9._-]{3,40}$')
);

create table if not exists public.app_sessions (
  token_hash text primary key,
  user_id uuid not null references public.app_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  user_agent text
);

create index if not exists app_sessions_user_idx on public.app_sessions(user_id);
create index if not exists app_sessions_expiry_idx on public.app_sessions(expires_at);

alter table public.app_users enable row level security;
alter table public.app_sessions enable row level security;

revoke all on public.app_users, public.app_sessions from anon, authenticated;

-- SECURITY NOTE:
-- The original historical migration seeded temporary prototype accounts with
-- password salts/hashes. Those credential-derived values are intentionally
-- NOT committed to Git. This custom auth model was removed by the subsequent
-- remove_unused_custom_auth migration.
