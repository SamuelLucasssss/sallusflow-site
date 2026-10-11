-- Restore EXECUTE required by RLS policies that call these SECURITY DEFINER predicates.
-- These functions validate the current Supabase session, active profile and (when configured) MFA.
-- The private schema is not exposed through PostgREST, and anon remains denied.
grant execute on function private.is_active_member() to authenticated;
grant execute on function private.is_admin() to authenticated;

revoke execute on function private.is_active_member() from anon;
revoke execute on function private.is_admin() from anon;
