alter table public.profiles
  add column if not exists security_onboarding_completed_at timestamptz;

alter table public.app_settings
  add column if not exists mfa_required boolean not null default false;

create or replace function private.security_session_ok()
returns boolean
language sql
stable
security definer
set search_path='auth','pg_temp'
as $$
  select coalesce(
    exists(
      select 1
      from auth.sessions s
      where s.id = nullif((select auth.jwt()->>'session_id'),'')::uuid
        and s.user_id = (select auth.uid())
    ),
    false
  )
$$;

create or replace function private.security_mfa_ok()
returns boolean
language sql
stable
security definer
set search_path='public','pg_temp'
as $$
  select case
    when coalesce((select s.mfa_required from public.app_settings s where s.id=1),false)
      then coalesce((select auth.jwt()->>'aal'),'aal1')='aal2'
    else true
  end
$$;

create or replace function private.is_active_member()
returns boolean
language sql
stable
security definer
set search_path='public','private','pg_temp'
as $$
  select private.security_session_ok()
     and private.security_mfa_ok()
     and coalesce(
       (select p.active from public.profiles p where p.id=(select auth.uid())),
       false
     )
$$;

create or replace function private.current_role()
returns text
language sql
stable
security definer
set search_path='public','private','pg_temp'
as $$
  select p.role
  from public.profiles p
  where p.id=(select auth.uid())
    and p.active=true
    and private.security_session_ok()
    and private.security_mfa_ok()
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path='public','private','pg_temp'
as $$
  select private.security_session_ok()
     and private.security_mfa_ok()
     and coalesce(
       (select p.active and p.role='admin' from public.profiles p where p.id=(select auth.uid())),
       false
     )
$$;

create or replace function private.mark_uti_security_onboarding_complete_impl()
returns void
language plpgsql
security definer
set search_path='public','private','pg_temp'
as $$
declare
  v_name text;
begin
  if not private.security_session_ok() then
    raise exception 'Sessão inválida ou encerrada.';
  end if;
  if coalesce((select auth.jwt()->>'aal'),'aal1') <> 'aal2' then
    raise exception 'Confirme o segundo fator antes de concluir a segurança da conta.';
  end if;

  update public.profiles
  set security_onboarding_completed_at=coalesce(security_onboarding_completed_at,now())
  where id=(select auth.uid());

  if not found then raise exception 'Perfil não encontrado.'; end if;

  v_name:=private.current_display_name();
  insert into public.audits(user_name,user_id,action,detail)
  values(v_name,(select auth.uid()),'Segurança da conta atualizada','MFA verificado e política de senha confirmada.');
end;
$$;

create or replace function public.mark_uti_security_onboarding_complete()
returns void
language sql
set search_path='public','private','pg_temp'
as $$
  select private.mark_uti_security_onboarding_complete_impl()
$$;

revoke all on function public.mark_uti_security_onboarding_complete() from public, anon;
grant execute on function public.mark_uti_security_onboarding_complete() to authenticated;

revoke all on function private.security_session_ok() from public, anon, authenticated;
revoke all on function private.security_mfa_ok() from public, anon, authenticated;
revoke all on function private.mark_uti_security_onboarding_complete_impl() from public, anon, authenticated;
