-- SECURITY NOTE:
-- The original one-time bootstrap activation hash is intentionally redacted.
-- New environments must provision the first administrator through a secure
-- environment-specific process; activation secrets must never live in Git.


create extension if not exists pgcrypto with schema extensions;

create table if not exists private.uti_bootstrap (
  id smallint primary key default 1 check (id=1),
  code_hash text not null,
  consumed_at timestamptz,
  consumed_by uuid
);

insert into private.uti_bootstrap(id,code_hash,consumed_at,consumed_by)
values(1,encode(extensions.digest('DISABLED_BOOTSTRAP_PLACEHOLDER','sha256'),'hex'),null,null)
on conflict(id) do update
set code_hash=excluded.code_hash
where private.uti_bootstrap.consumed_at is null;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, display_name, email, role, active)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name',''), split_part(coalesce(new.email,'Usuário'),'@',1)),
    new.email,
    'operator',
    false
  )
  on conflict (id) do update set
    display_name=excluded.display_name,
    email=excluded.email;
  return new;
end;
$$;

create or replace function private.claim_initial_admin(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_cfg private.uti_bootstrap;
begin
  if auth.uid() is null then raise exception 'Você precisa estar autenticado.'; end if;
  if exists(select 1 from public.profiles where active=true and role='admin') then
    raise exception 'O administrador inicial já foi definido.';
  end if;

  select * into v_cfg from private.uti_bootstrap where id=1 for update;
  if not found or v_cfg.consumed_at is not null then
    raise exception 'A chave inicial não está mais disponível.';
  end if;

  if encode(extensions.digest(coalesce(p_code,''),'sha256'),'hex') <> v_cfg.code_hash then
    raise exception 'Chave de ativação inválida.';
  end if;

  update public.profiles
  set active=true, role='admin'
  where id=auth.uid();

  if not found then raise exception 'Perfil de usuário não encontrado.'; end if;

  update private.uti_bootstrap
  set consumed_at=now(), consumed_by=auth.uid()
  where id=1;

  insert into public.audits(user_name,user_id,action,detail)
  select display_name,id,'Administrador inicial ativado','Ativação única concluída.'
  from public.profiles where id=auth.uid();

  return true;
end;
$$;

revoke all on function private.claim_initial_admin(text) from public,anon;
grant execute on function private.claim_initial_admin(text) to authenticated;

create or replace function public.claim_uti_admin(p_code text)
returns boolean
language sql
security invoker
set search_path = public, private, pg_temp
as $$
  select private.claim_initial_admin(p_code)
$$;

revoke all on function public.claim_uti_admin(text) from public,anon;
grant execute on function public.claim_uti_admin(text) to authenticated;
