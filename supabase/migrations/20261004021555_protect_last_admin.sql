create or replace function public.admin_update_uti_member(
  p_user_id uuid,
  p_active boolean,
  p_role text
)
returns void
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  v_admin text;
  v_target_role text;
  v_target_active boolean;
  v_admin_count integer;
begin
  if not private.is_admin() then raise exception 'Somente administradores podem alterar acessos.'; end if;
  if p_role not in ('admin','operator','commercial') then raise exception 'Perfil inválido.'; end if;

  select role,active into v_target_role,v_target_active from public.profiles where id=p_user_id;
  if not found then raise exception 'Usuário não encontrado.'; end if;

  select count(*) into v_admin_count from public.profiles where active=true and role='admin';

  if v_target_active=true and v_target_role='admin' and (p_active=false or p_role<>'admin') and v_admin_count<=1 then
    raise exception 'É necessário manter pelo menos um administrador ativo.';
  end if;

  update public.profiles set active=p_active,role=p_role where id=p_user_id;

  v_admin:=private.current_display_name();
  insert into public.audits(user_name,user_id,action,detail)
  values(v_admin,auth.uid(),'Acesso atualizado',p_user_id::text||' • '||p_role||' • '||case when p_active then 'ativo' else 'inativo' end);
end;
$$;

revoke execute on function public.admin_update_uti_member(uuid,boolean,text) from anon;
grant execute on function public.admin_update_uti_member(uuid,boolean,text) to authenticated;
