create or replace function public.is_uti_admin_secure_session()
returns boolean
language sql
stable
set search_path='public','private','pg_temp'
as $$
  select private.is_admin()
$$;

revoke all on function public.is_uti_admin_secure_session() from public, anon;
grant execute on function public.is_uti_admin_secure_session() to authenticated;
