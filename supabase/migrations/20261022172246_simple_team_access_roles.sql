-- Referral users register admissions and consult data; only admins discharge.
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin','operator','commercial','referral'));

create or replace function private.role_has_permission(p_role text,p_permission text)
returns boolean language sql immutable security definer set search_path=public,private,pg_temp as $$
 select case p_role
   when 'admin' then true
   when 'commercial' then p_permission in ('create_admission','add_extra','add_payment','adjust_rate','update_on_duty')
   when 'operator' then p_permission in ('create_admission','add_extra')
   when 'referral' then p_permission='create_admission'
   else false
 end
$$;
revoke all on function private.role_has_permission(text,text) from public,anon,authenticated;

create or replace function private.admin_update_uti_member_impl(p_user_id uuid,p_active boolean,p_role text)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_admin text;v_target_role text;v_target_active boolean;v_admin_count integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('imec-uti:admin-membership',0));
 if not private.is_admin() then raise exception 'Somente administradores podem alterar acessos.'; end if;
 if p_role is null or p_role not in ('admin','operator','commercial','referral') or p_active is null then raise exception 'Perfil ou situação inválidos.'; end if;
 select role,active into v_target_role,v_target_active from public.profiles where id=p_user_id;
 if not found then raise exception 'Usuário não encontrado.'; end if;
 select count(*) into v_admin_count from public.profiles where active=true and role='admin';
 if v_target_active and v_target_role='admin' and (not p_active or p_role<>'admin') and v_admin_count<=1 then
   raise exception 'É necessário manter pelo menos um administrador ativo.';
 end if;
 update public.profiles set active=p_active,role=p_role where id=p_user_id;
 v_admin:=private.current_display_name();
 insert into public.audits(user_name,user_id,action,detail)
 values(v_admin,auth.uid(),'Acesso atualizado',p_user_id::text||' • '||p_role||' • '||case when p_active then 'ativo' else 'inativo' end);
end;
$$;
