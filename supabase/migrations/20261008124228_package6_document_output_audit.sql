create or replace function private.log_uti_document_event_impl(
  p_admission_id uuid,
  p_event text,
  p_document_kind text
)
returns uuid
language plpgsql
security definer
set search_path='public','private','pg_temp'
as $$
declare
  v_user text;
  v_action text;
  v_detail text;
  v_id uuid;
begin
  if not private.is_active_member() then
    raise exception 'Sessão inválida ou usuário sem acesso ativo.';
  end if;

  if p_event not in ('print_requested','print_view_opened','pdf_downloaded') then
    raise exception 'Evento documental inválido.';
  end if;

  if p_document_kind not in ('admission_statement','settlement_sheet','settlement_pdf') then
    raise exception 'Tipo de documento inválido.';
  end if;

  perform 1 from public.admissions where id=p_admission_id;
  if not found then
    raise exception 'Internação não encontrada.';
  end if;

  v_user:=private.current_display_name();

  v_action:=case
    when p_document_kind='admission_statement' then 'Ficha de internação — impressão'
    when p_document_kind='settlement_sheet' then 'Folha de acerto — impressão'
    else 'Folha de acerto — PDF'
  end;

  v_detail:=case
    when p_event='print_requested' then 'Impressão solicitada pelo usuário.'
    when p_event='print_view_opened' then 'Visualização de impressão aberta pelo usuário.'
    else 'PDF gerado para download pelo usuário.'
  end;

  insert into public.audits(admission_id,user_name,user_id,action,detail)
  values(p_admission_id,v_user,auth.uid(),v_action,v_detail)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.log_uti_document_event(
  p_admission_id uuid,
  p_event text,
  p_document_kind text
)
returns uuid
language sql
set search_path='public','private','pg_temp'
as $$
  select private.log_uti_document_event_impl(p_admission_id,p_event,p_document_kind)
$$;

revoke all on function private.log_uti_document_event_impl(uuid,text,text) from public, anon;
grant execute on function private.log_uti_document_event_impl(uuid,text,text) to authenticated;

revoke all on function public.log_uti_document_event(uuid,text,text) from public, anon;
grant execute on function public.log_uti_document_event(uuid,text,text) to authenticated;
