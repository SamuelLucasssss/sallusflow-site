-- Corrections retain the admission identity and the cancelled daily-charge history.
create table public.admission_initial_edits (
 id uuid primary key default gen_random_uuid(),
 admission_id uuid not null references public.admissions(id) on delete restrict,
 client_ref text not null check (length(client_ref) between 16 and 120),
 created_at timestamptz not null default now(),
 created_by uuid not null references public.profiles(id),
 reason text not null check (length(reason) between 8 and 220),
 before_data jsonb not null,
 after_data jsonb not null,
 unique(admission_id,client_ref)
);
create index admission_initial_edits_created_by_idx on public.admission_initial_edits(created_by);
alter table public.admission_initial_edits enable row level security;
create policy admission_initial_edits_admin_read on public.admission_initial_edits for select to authenticated using (private.is_admin());
revoke all on public.admission_initial_edits from public,anon,authenticated;
grant select on public.admission_initial_edits to authenticated;

create function private.edit_uti_admission_initial_impl(
 p_admission_id uuid,p_expected_version bigint,p_entry_at timestamptz,p_half_initial boolean,p_reason text,p_client_ref text
) returns text language plpgsql security definer set search_path=public,private,pg_temp as $$
declare
 a public.admissions; r public.rate_periods; e public.admission_initial_edits;
 v_reason text:=trim(coalesce(p_reason,'')); v_ref text:=trim(coalesce(p_client_ref,''));
 v_before jsonb; v_after jsonb; v_rebuild jsonb; v_billed numeric; v_received numeric; v_refunded numeric; v_reserved numeric; v_status text;
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Somente administradores podem editar a entrada e a primeira diária.'; end if;
 if length(v_reason) not between 8 and 220 then raise exception 'Informe o motivo da correção (8 a 220 caracteres).'; end if;
 if length(v_ref) not between 16 and 120 then raise exception 'Identificador da correção inválido.'; end if;
 if p_entry_at is null or not isfinite(p_entry_at) or p_entry_at>now() then raise exception 'Informe uma entrada válida, sem data futura.'; end if;
 if p_half_initial is null then raise exception 'Escolha diária integral ou meia diária.'; end if;
 select * into a from public.admissions where id=p_admission_id for update;
 if not found or a.status='cancelled' then raise exception 'Internação não encontrada ou cancelada.'; end if;
 select * into e from public.admission_initial_edits where admission_id=a.id and client_ref=v_ref;
 if found then
   if e.created_by<>auth.uid() or e.reason<>v_reason or (e.after_data->>'entryAt')::timestamptz<>p_entry_at
     or (e.after_data->>'halfInitial')::boolean<>p_half_initial or a.entry_at<>p_entry_at or a.half_initial<>p_half_initial then
     raise exception 'Identificador já utilizado em outra correção.';
   end if;
   return a.status;
 end if;
 if p_expected_version is null or p_expected_version<>a.account_version then raise exception 'A conta foi alterada. Atualize a página antes de editar.'; end if;
 if a.entry_at=p_entry_at and a.half_initial=p_half_initial then raise exception 'Nenhuma alteração informada.'; end if;
 if a.discharge_at is not null and p_entry_at>a.discharge_at then raise exception 'A entrada não pode ser posterior à alta.'; end if;
 select * into r from public.rate_periods where admission_id=a.id order by effective_at,created_at,id limit 1 for update;
 if not found or r.effective_at<>a.entry_at then raise exception 'A condição inicial precisa ser revisada antes de alterar a entrada.'; end if;
 if p_entry_at<>a.entry_at then
   if exists(select 1 from public.rate_periods where admission_id=a.id and id<>r.id and effective_at<=p_entry_at) then
     raise exception 'A nova entrada alcança uma alteração de diária. Revise as condições comerciais antes de corrigir a entrada.';
   end if;
   if exists(select 1 from public.payments where admission_id=a.id and cancelled_at is null and occurred_at<p_entry_at)
     or exists(select 1 from public.refunds where admission_id=a.id and cancelled_at is null and occurred_at<p_entry_at)
     or exists(select 1 from public.charges where admission_id=a.id and kind<>'daily' and cancelled_at is null and occurred_at<p_entry_at)
     or exists(select 1 from public.scheduled_receipts where admission_id=a.id and status='pending' and expected_at<p_entry_at) then
     raise exception 'Existem lançamentos anteriores à nova entrada. Corrija esses lançamentos primeiro.';
   end if;
   if p_entry_at<a.entry_at and exists(select 1 from public.admissions other where other.id<>a.id and other.bed=a.bed and other.status<>'cancelled'
     and other.entry_at<a.entry_at and coalesce(other.discharge_at,'infinity'::timestamptz)>p_entry_at) then
     raise exception 'O leito estava ocupado por outra internação no período acrescentado.';
   end if;
 end if;
 select coalesce(sum(amount),0) into v_billed from public.charges where admission_id=a.id and cancelled_at is null;
 v_before:=jsonb_build_object('entryAt',a.entry_at,'halfInitial',a.half_initial,'status',a.status,'billed',v_billed,'initialRate',to_jsonb(r));
 -- Reconciliation also works on settled admissions; the real discharge cutoff is retained.
 update public.admissions set entry_at=p_entry_at,half_initial=p_half_initial,
   status=case when a.status='finalized' then 'discharge_pending' else a.status end,account_version=account_version+1 where id=a.id;
 if r.effective_at<>p_entry_at then update public.rate_periods set effective_at=p_entry_at where id=r.id; end if;
 v_rebuild:=private.reconcile_daily_charges(a.id,a.discharge_at,private.current_display_name(),'Entrada/primeira diária corrigida: '||v_reason);
 select coalesce(sum(amount),0) into v_billed from public.charges where admission_id=a.id and cancelled_at is null;
 select coalesce(sum(amount),0) into v_received from public.payments where admission_id=a.id and cancelled_at is null;
 select coalesce(sum(amount),0) into v_refunded from public.refunds where admission_id=a.id and cancelled_at is null;
 select coalesce(sum(amount),0) into v_reserved from public.scheduled_receipts where admission_id=a.id and status='pending';
 if v_billed<0 then raise exception 'A correção deixaria a cobrança negativa. Revise os descontos primeiro.'; end if;
 if v_reserved>greatest(0,v_billed-v_received+v_refunded)+0.009 then raise exception 'A correção deixaria os recebimentos previstos acima do saldo. Revise as previsões primeiro.'; end if;
 v_status:=private.reconcile_admission_status(a.id);
 select * into r from public.rate_periods where id=r.id;
 v_after:=jsonb_build_object('entryAt',p_entry_at,'halfInitial',p_half_initial,'status',v_status,'billed',v_billed,'initialRate',to_jsonb(r),'reconciliation',v_rebuild);
 insert into public.admission_initial_edits(admission_id,client_ref,created_by,reason,before_data,after_data)
 values(a.id,v_ref,auth.uid(),v_reason,v_before,v_after);
 insert into public.audits(admission_id,user_name,user_id,action,detail)
 values(a.id,private.current_display_name(),auth.uid(),'Entrada e primeira diária corrigidas',
   'Entrada: '||to_char(a.entry_at at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')||' → '||to_char(p_entry_at at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')||
   ' • Primeira diária: '||case when a.half_initial then 'meia' else 'integral' end||' → '||case when p_half_initial then 'meia' else 'integral' end||
   ' • Cobrado: R$ '||(v_before->>'billed')||' → R$ '||v_billed||' • Motivo: '||v_reason);
 return v_status;
end;
$$;
create function public.edit_uti_admission_initial(
 p_admission_id uuid,p_expected_version bigint,p_entry_at timestamptz,p_half_initial boolean,p_reason text,p_client_ref text
) returns text language sql security invoker set search_path=public,private,pg_temp as $$
 select private.edit_uti_admission_initial_impl(p_admission_id,p_expected_version,p_entry_at,p_half_initial,p_reason,p_client_ref);
$$;
revoke all on function public.edit_uti_admission_initial(uuid,bigint,timestamptz,boolean,text,text) from public,anon;
revoke all on function private.edit_uti_admission_initial_impl(uuid,bigint,timestamptz,boolean,text,text) from public,anon;
grant execute on function public.edit_uti_admission_initial(uuid,bigint,timestamptz,boolean,text,text) to authenticated;
grant execute on function private.edit_uti_admission_initial_impl(uuid,bigint,timestamptz,boolean,text,text) to authenticated;
