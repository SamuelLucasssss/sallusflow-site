create or replace function private.role_has_permission(p_role text,p_permission text)
returns boolean
language sql
immutable
security definer
set search_path = public, private, pg_temp
as $$
  select case p_role
    when 'admin' then true
    when 'commercial' then p_permission in (
      'create_admission','add_extra','add_payment','adjust_rate','discharge','update_on_duty'
    )
    when 'operator' then p_permission in (
      'create_admission','add_extra','discharge'
    )
    else false
  end
$$;

create or replace function private.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select private.role_has_permission(private.current_role(),p_permission)
$$;

revoke all on function private.role_has_permission(text,text) from public,anon,authenticated;
revoke all on function private.has_permission(text) from public,anon,authenticated;
