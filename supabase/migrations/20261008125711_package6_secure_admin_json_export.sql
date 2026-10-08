create or replace function private.log_uti_data_export_impl()
returns uuid
language plpgsql
security definer
set search_path='public','private','pg_temp'
as $$
declare
  v_id uuid;
begin
  if not private.is_admin() then
    raise exception 'Apenas administrador com sessão ativa e MFA pode exportar dados.';
  end if;

  insert into public.audits(admission_id,user_name,user_id,action,detail)
  values (
    null,
    private.current_display_name(),
    auth.uid(),
    'Exportação administrativa de dados',
    'Exportação JSON solicitada pelo usuário. O arquivo pode conter dados pessoais e financeiros.'
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.log_uti_data_export()
returns uuid
language sql
set search_path='public','private','pg_temp'
as $$
  select private.log_uti_data_export_impl()
$$;

revoke all on function private.log_uti_data_export_impl() from public, anon;
grant execute on function private.log_uti_data_export_impl() to authenticated;

revoke all on function public.log_uti_data_export() from public, anon;
grant execute on function public.log_uti_data_export() to authenticated;
