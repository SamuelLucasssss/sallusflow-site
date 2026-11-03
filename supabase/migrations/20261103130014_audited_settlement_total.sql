-- An agreed total changes the charge, never the actual receipts or refunds.
create table public.settlement_total_edits (
 id uuid primary key default gen_random_uuid(),
 admission_id uuid not null references public.admissions(id) on delete restrict,
 charge_id uuid not null references public.charges(id) on delete restrict,
 client_ref text not null check(length(client_ref) between 16 and 120),
 created_at timestamptz not null default now(),
 created_by uuid not null references public.profiles(id),
 reason text not null check(length(reason) between 8 and 220),
 expected_version bigint not null,
 previous_total numeric(14,2) not null,
 agreed_total numeric(14,2) not null check(agreed_total between 0 and 1000000),
 before_data jsonb not null,
 after_data jsonb not null,
 unique(admission_id,client_ref)
);
create index settlement_total_edits_charge_idx on public.settlement_total_edits(charge_id);
create index settlement_total_edits_created_by_idx on public.settlement_total_edits(created_by);
alter table public.settlement_total_edits enable row level security;
create policy settlement_total_edits_admin_read on public.settlement_total_edits for select to authenticated using (private.is_admin());
revoke all on public.settlement_total_edits from public,anon,authenticated;
grant select on public.settlement_total_edits to authenticated;

create function private.set_uti_settlement_total_impl(
 p_admission_id uuid,p_expected_version bigint,p_total numeric,p_reason text,p_client_ref text
) returns text language plpgsql security definer set search_path=public,private,pg_temp as $$
declare
 a public.admissions; e public.settlement_total_edits;
 v_reason text:=trim(coalesce(p_reason,'')); v_ref text:=trim(coalesce(p_client_ref,''));
 v_billed numeric; v_received numeric; v_refunded numeric; v_reserved numeric; v_delta numeric;
 v_status text; v_charge uuid; v_before jsonb; v_after jsonb;
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Somente administradores podem ajustar o total do acerto.'; end if;
 if p_total is null or p_total in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
   or p_total<0 or p_total>1000000 or p_total<>round(p_total,2) then
   raise exception 'Informe um total válido, entre R$ 0,00 e R$ 1.000.000,00, com até duas casas decimais.';
 end if;
 if length(v_reason) not between 8 and 220 then raise exception 'Informe o motivo do ajuste (8 a 220 caracteres).'; end if;
 if length(v_ref) not between 16 and 120 then raise exception 'Identificador do ajuste inválido.'; end if;
 select * into a from public.admissions where id=p_admission_id for update;
 if not found then raise exception 'Internação não encontrada.'; end if;
 select * into e from public.settlement_total_edits where admission_id=a.id and client_ref=v_ref;
 if found then
   if e.created_by<>auth.uid() or e.agreed_total<>p_total or e.reason<>v_reason
     or p_expected_version is distinct from e.expected_version then
     raise exception 'Identificador já utilizado em outro ajuste.';
   end if;
   return a.status;
 end if;
 if a.status not in ('discharge_pending','finalized') or a.discharge_at is null then
   raise exception 'Confirme a alta antes de ajustar o valor total do acerto.';
 end if;
 if p_expected_version is null or p_expected_version<>a.account_version then
   raise exception 'A conta foi alterada. Atualize a página e confira os valores antes de ajustar.';
 end if;
 select coalesce(sum(amount),0) into v_billed from public.charges where admission_id=a.id and cancelled_at is null;
 select coalesce(sum(amount),0) into v_received from public.payments where admission_id=a.id and cancelled_at is null;
 select coalesce(sum(amount),0) into v_refunded from public.refunds where admission_id=a.id and cancelled_at is null;
 select coalesce(sum(amount),0) into v_reserved from public.scheduled_receipts where admission_id=a.id and status='pending';
 v_delta:=p_total-v_billed;
 if v_delta=0 then raise exception 'O total informado já é o valor atual.'; end if;
 if v_reserved>greatest(0,p_total-v_received+v_refunded) then
   raise exception 'O novo total deixaria previsões acima do saldo. Revise os recebimentos previstos primeiro.';
 end if;
 v_before:=jsonb_build_object('billed',v_billed,'received',v_received,'refunded',v_refunded,
   'balance',v_billed-v_received+v_refunded,'status',a.status,'accountVersion',a.account_version);
 insert into public.charges(admission_id,occurred_at,kind,category,description,amount,created_by_name,created_by,client_ref)
 values(a.id,a.discharge_at,'adjustment',case when v_delta<0 then 'Desconto no acerto' else 'Ajuste no acerto' end,
   'Total acordado no acerto: R$ '||p_total||' — '||v_reason,v_delta,private.current_display_name(),auth.uid(),v_ref)
 returning id into v_charge;
 v_status:=private.reconcile_admission_status(a.id);
 v_after:=jsonb_build_object('billed',p_total,'received',v_received,'refunded',v_refunded,
   'balance',p_total-v_received+v_refunded,'status',v_status,'adjustment',v_delta,'chargeId',v_charge,
   'accountVersion',(select account_version from public.admissions where id=a.id));
 insert into public.settlement_total_edits(admission_id,charge_id,client_ref,created_by,reason,expected_version,previous_total,agreed_total,before_data,after_data)
 values(a.id,v_charge,v_ref,auth.uid(),v_reason,p_expected_version,v_billed,p_total,v_before,v_after);
 insert into public.audits(admission_id,user_name,user_id,action,detail)
 values(a.id,private.current_display_name(),auth.uid(),'Total do acerto ajustado',
   'Cobrado: R$ '||v_billed||' → R$ '||p_total||' • Ajuste: R$ '||v_delta||
   ' • Recebido líquido preservado: R$ '||(v_received-v_refunded)||' • Saldo: R$ '||(p_total-v_received+v_refunded)||
   ' • Motivo: '||v_reason||' • Situação: '||v_status);
 return v_status;
end;
$$;
create function public.set_uti_settlement_total(
 p_admission_id uuid,p_expected_version bigint,p_total numeric,p_reason text,p_client_ref text
) returns text language sql security invoker set search_path=public,private,pg_temp as $$
 select private.set_uti_settlement_total_impl(p_admission_id,p_expected_version,p_total,p_reason,p_client_ref);
$$;
revoke all on function private.set_uti_settlement_total_impl(uuid,bigint,numeric,text,text),public.set_uti_settlement_total(uuid,bigint,numeric,text,text) from public,anon,authenticated;
grant execute on function private.set_uti_settlement_total_impl(uuid,bigint,numeric,text,text),public.set_uti_settlement_total(uuid,bigint,numeric,text,text) to authenticated;
