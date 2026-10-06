revoke all on function private.current_display_name() from public, anon;
grant execute on function private.current_display_name() to authenticated;

revoke all on function private.is_active_member() from public, anon;
grant execute on function private.is_active_member() to authenticated;

revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;

revoke all on function private.sync_daily_charges(uuid,timestamptz,text) from public, anon, authenticated;
revoke all on function private.handle_new_user() from public, anon, authenticated;
