alter table public.profiles add column if not exists email text;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_first boolean;
begin
  select not exists(select 1 from public.profiles) into v_first;

  insert into public.profiles (id, display_name, email, role, active)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name',''), split_part(coalesce(new.email,'Usuário'),'@',1)),
    new.email,
    case when v_first then 'admin' else 'operator' end,
    v_first
  )
  on conflict (id) do update set
    display_name = excluded.display_name,
    email = excluded.email;

  return new;
end;
$$;
