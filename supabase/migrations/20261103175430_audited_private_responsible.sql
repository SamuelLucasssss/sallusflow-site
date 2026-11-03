-- Reassign commercial responsibility without changing the patient's ledger.
create or replace function public.create_uti_admission(
 p_name text,p_cpf text,p_bed integer,p_mode text,p_entry_at timestamptz,p_closer text,
 p_half_initial boolean,p_ventilation boolean,p_negotiated_rate numeric,p_notes text default null
) returns uuid language plpgsql security invoker set search_path=public,private,pg_temp as $$
begin
 if p_mode='private' and lower(trim(coalesce(p_closer,''))) not in ('samuel','roberto') then
   raise exception 'Escolha Samuel ou Roberto como responsável pelo particular.';
 end if;
 return private.create_uti_admission_impl(p_name,p_cpf,p_bed,p_mode,p_entry_at,p_closer,p_half_initial,p_ventilation,p_negotiated_rate,p_notes);
end;
$$;

create table public.private_responsible_edits (
 id uuid primary key default gen_random_uuid(),
 admission_id uuid not null references public.admissions(id) on delete restrict,
 client_ref text not null check(length(client_ref) between 16 and 120),
 expected_version bigint not null,
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 reason text not null check(length(reason) between 8 and 220),
 responsible_code text not null check(responsible_code in ('samuel','roberto')),
 before_data jsonb not null, after_data jsonb not null,
 unique(admission_id,client_ref)
);
create index private_responsible_edits_created_by_idx on public.private_responsible_edits(created_by);
alter table public.private_responsible_edits enable row level security;
create policy private_responsible_edits_admin_read on public.private_responsible_edits
 for select to authenticated using (private.is_admin());
revoke all on public.private_responsible_edits from public,anon,authenticated;
grant select on public.private_responsible_edits to authenticated;

create function private.set_uti_private_responsible_impl(
 p_admission_id uuid,p_expected_version bigint,p_responsible text,p_reason text,p_client_ref text
) returns text language plpgsql security definer set search_path=public,private,pg_temp as $$
declare
 a public.admissions; c public.commercial_closers; e public.private_responsible_edits;
 v_code text:=lower(trim(coalesce(p_responsible,'')));
 v_reason text:=trim(coalesce(p_reason,'')); v_ref text:=trim(coalesce(p_client_ref,''));
 v_before jsonb; v_after jsonb;
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Somente administradores podem alterar o responsável.'; end if;
 if v_code not in ('samuel','roberto') then raise exception 'Escolha Samuel ou Roberto.'; end if;
 if length(v_reason) not between 8 and 220 then raise exception 'Informe o motivo da alteração (8 a 220 caracteres).'; end if;
 if length(v_ref) not between 16 and 120 then raise exception 'Identificador da alteração inválido.'; end if;
 select * into a from public.admissions where id=p_admission_id for update;
 if not found then raise exception 'Internação não encontrada.'; end if;
 select * into e from public.private_responsible_edits where admission_id=a.id and client_ref=v_ref;
 if found then
   if e.created_by<>auth.uid() or e.responsible_code<>v_code or e.reason<>v_reason
     or e.expected_version is distinct from p_expected_version then raise exception 'Identificador já utilizado em outra alteração.'; end if;
   return e.after_data->>'closerName';
 end if;
 if a.mode<>'private' or a.status='cancelled' then raise exception 'Escolha uma internação particular não cancelada.'; end if;
 if p_expected_version is null or a.account_version<>p_expected_version then raise exception 'A conta foi alterada. Atualize e confira antes de salvar.'; end if;
 select * into c from public.commercial_closers where code=v_code and active;
 if not found then raise exception 'Responsável indisponível. Atualize a página.'; end if;
 if a.closer_id=c.id and a.closer_name=c.display_name then raise exception 'Este já é o responsável atual.'; end if;
 v_before:=jsonb_build_object('closerId',a.closer_id,'closerName',a.closer_name,'commissionAmount',a.commission_amount,'accountVersion',a.account_version);
 update public.admissions set closer_id=c.id,closer_name=c.display_name,
   commission_amount=c.commission_amount,account_version=account_version+1 where id=a.id;
 v_after:=jsonb_build_object('closerId',c.id,'closerName',c.display_name,'commissionAmount',c.commission_amount,'accountVersion',a.account_version+1);
 insert into public.private_responsible_edits(admission_id,client_ref,expected_version,created_by,reason,responsible_code,before_data,after_data)
 values(a.id,v_ref,p_expected_version,auth.uid(),v_reason,v_code,v_before,v_after);
 insert into public.audits(admission_id,user_name,user_id,action,detail)
 values(a.id,private.current_display_name(),auth.uid(),'Responsável particular alterado',
   coalesce(a.closer_name,'Não informado')||' → '||c.display_name||' • Comissão por internação: R$ '||c.commission_amount||' • Motivo: '||v_reason);
 return c.display_name;
end;
$$;
create function public.set_uti_private_responsible(
 p_admission_id uuid,p_expected_version bigint,p_responsible text,p_reason text,p_client_ref text
) returns text language sql security invoker set search_path=public,private,pg_temp as $$
 select private.set_uti_private_responsible_impl(p_admission_id,p_expected_version,p_responsible,p_reason,p_client_ref);
$$;
revoke all on function private.set_uti_private_responsible_impl(uuid,bigint,text,text,text),public.set_uti_private_responsible(uuid,bigint,text,text,text) from public,anon,authenticated;
grant execute on function private.set_uti_private_responsible_impl(uuid,bigint,text,text,text),public.set_uti_private_responsible(uuid,bigint,text,text,text) to authenticated;

-- Repasse belongs once to the receipt that completes the settled account.
create or replace function private.get_uti_monthly_receipts_report_impl(p_month date,p_mode text,p_selected_keys text[] default null)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_report jsonb;
begin
 if auth.uid() is null or not private.is_active_member() then raise exception 'Sessão inválida ou usuário sem acesso ativo.'; end if;
 if p_month is null or not isfinite(p_month) or extract(day from p_month)<>1 then raise exception 'Informe o primeiro dia da competência.'; end if;
 if p_mode is null or p_mode not in ('hotel','private') then raise exception 'Escolha humanizado ou particular.'; end if;
 if p_selected_keys is not null and (cardinality(p_selected_keys)>10000 or array_ndims(p_selected_keys)>1
   or array_position(p_selected_keys,null) is not null or cardinality(p_selected_keys)<>(select count(distinct k) from unnest(p_selected_keys) k)) then
   raise exception 'Seleção de recebimentos inválida.';
 end if;
 with period as (
   select p_month::timestamp at time zone 'America/Sao_Paulo' start_at,
     (p_month+interval '1 month')::timestamp at time zone 'America/Sao_Paulo' end_at
 ), movements as (
   select 'payment:'||pm.id::text key,pm.admission_id,pm.occurred_at,round(pm.amount*100) cents,'receipt'::text kind,pm.method,pm.card_type
   from public.payments pm join public.admissions a on a.id=pm.admission_id cross join period t
   where a.mode=p_mode and pm.cancelled_at is null and pm.occurred_at>=t.start_at and pm.occurred_at<t.end_at
   union all
   select 'refund:'||rf.id::text,rf.admission_id,rf.occurred_at,round(rf.amount*100),'refund',rf.method,null::text
   from public.refunds rf join public.admissions a on a.id=rf.admission_id cross join period t
   where a.mode=p_mode and rf.cancelled_at is null and rf.occurred_at>=t.start_at and rf.occurred_at<t.end_at
 ), settled_private as (
   select a.id,round(a.commission_amount*100) fee_cents,
     (coalesce((select sum(c.amount) from public.charges c where c.admission_id=a.id and c.cancelled_at is null),0)
      +coalesce((select sum(r.amount) from public.refunds r where r.admission_id=a.id and r.cancelled_at is null),0))*100 target_cents
   from public.admissions a
   where p_mode='private' and a.mode='private' and a.status='finalized' and a.discharge_at is not null
     and lower(a.closer_name) in ('samuel','roberto') and a.commission_amount>0
     and coalesce((select sum(c.amount) from public.charges c where c.admission_id=a.id and c.cancelled_at is null),0)>0
 ), paid_private as (
   select p.id,p.admission_id,p.occurred_at,s.fee_cents,s.target_cents,
     sum(round(p.amount*100)) over(partition by p.admission_id order by p.occurred_at,p.id rows unbounded preceding) gross_cents
   from public.payments p join settled_private s on s.id=p.admission_id where p.cancelled_at is null
 ), private_fees as (
   select distinct on(admission_id) id,admission_id,fee_cents from paid_private
   where target_cents>0 and gross_cents>=target_cents order by admission_id,occurred_at,id
 ), candidates as (
   select m.*,p.name,a.entry_at,a.discharge_at,a.closer_name,coalesce(f.fee_cents,0) fee_cents,
     case when a.mode='private' then 'UTI '||lpad(a.bed::text,2,'0') when a.bed>=17 then 'Suíte' else 'Simples' end bed_type,
     p_selected_keys is null or m.key=any(p_selected_keys) included,
     jsonb_build_object('key',m.key,'admissionId',a.id,'patientName',p.name,'entryAt',a.entry_at,'dischargeAt',a.discharge_at,
       'bedType',case when a.mode='private' then 'UTI '||lpad(a.bed::text,2,'0') when a.bed>=17 then 'Suíte' else 'Simples' end,
       'responsible',a.closer_name,'privateCommissionCents',coalesce(f.fee_cents,0),'occurredAt',m.occurred_at,'amountCents',m.cents,'kind',m.kind,'method',m.method,'cardType',m.card_type) item
   from movements m join public.admissions a on a.id=m.admission_id join public.patients p on p.id=a.patient_id
   left join private_fees f on m.key='payment:'||f.id::text
 ), grouped as (
   select admission_id,name,entry_at,discharge_at,closer_name,bed_type,
     sum(fee_cents) private_fee,
     sum(case when kind='receipt' then cents else -cents end) net,
     count(*) filter(where kind='receipt') receipts,count(*) filter(where kind='refund') refunds,
     coalesce(jsonb_agg(occurred_at order by occurred_at,key) filter(where kind='receipt'),'[]'::jsonb) receipt_dates,
     coalesce(jsonb_agg(occurred_at order by occurred_at,key) filter(where kind='refund'),'[]'::jsonb) refund_dates
   from candidates where included group by admission_id,name,entry_at,discharge_at,closer_name,bed_type
 ), summary as (
   select coalesce(sum(cents) filter(where included and kind='receipt'),0) received,
     coalesce(sum(cents) filter(where included and kind='refund'),0) refunded,
     count(*) filter(where included and kind='receipt') receipts,count(*) filter(where included and kind='refund') refunds,
     count(*) candidate_count,count(*) filter(where included) selected_count from candidates
 )
 select jsonb_build_object('month',to_char(p_month,'YYYY-MM'),'mode',p_mode,'generatedAt',now(),
   'receivedCents',s.received,'refundedCents',s.refunded,'netCents',s.received-s.refunded,
   'receiptCount',s.receipts,'refundCount',s.refunds,'admissionCount',(select count(*) from grouped),
   'commissionPercent',case when p_mode='hotel' then 3 else 0 end,
   'commissionCents',case when p_mode='hotel' then round((s.received-s.refunded)*3/100) else 0 end,
   'privateCommissionCents',coalesce((select sum(private_fee) from grouped),0),
   'candidateCount',s.candidate_count,'selectedCount',s.selected_count,'manualSelection',s.candidate_count<>s.selected_count,
   'sourceSnapshot',md5(jsonb_build_object('month',p_month,'mode',p_mode,
     'candidates',coalesce((select jsonb_agg(item order by key) from candidates),'[]'::jsonb))::text),
   'invalidSelectionCount',(select count(*) from unnest(p_selected_keys) k where not exists(select 1 from candidates c where c.key=k)),
   'movements',coalesce((select jsonb_agg(item||jsonb_build_object('included',included) order by occurred_at,key) from candidates),'[]'::jsonb),
   'rows',coalesce((select jsonb_agg(jsonb_build_object('admissionId',admission_id,'patientName',name,'entryAt',entry_at,
     'dischargeAt',discharge_at,'bedType',bed_type,'responsible',closer_name,'netCents',net,'receiptCount',receipts,'refundCount',refunds,
     'privateCommissionCents',private_fee,'receiptDates',receipt_dates,'refundDates',refund_dates) order by lower(name),entry_at,admission_id) from grouped),'[]'::jsonb))
 into v_report from summary s;
 if (v_report->>'invalidSelectionCount')::integer<>0 then raise exception 'A seleção contém lançamentos fora da modalidade ou competência. Atualize e confira.'; end if;
 return v_report-'invalidSelectionCount';
end;
$$;

create or replace function private.export_uti_monthly_receipts_report_impl(
 p_month date,p_mode text,p_event text,p_include_commission boolean,p_selected_keys text[],p_expected_snapshot text
) returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare r jsonb;
begin
 if auth.uid() is null or not private.is_active_member() then raise exception 'Sessão inválida ou usuário sem acesso ativo.'; end if;
 if p_event is null or p_event not in ('pdf_downloaded','print_requested','csv_downloaded') or p_include_commission is null then raise exception 'Evento documental inválido.'; end if;
 r:=private.get_uti_monthly_receipts_report_impl(p_month,p_mode,p_selected_keys);
 if p_expected_snapshot is null or p_expected_snapshot<>r->>'sourceSnapshot' then
   raise exception 'Os recebimentos mudaram. Atualize o relatório e confira a seleção antes de exportar.';
 end if;
 insert into public.audits(admission_id,user_name,user_id,action,detail)
 values(null,private.current_display_name(),auth.uid(),
   case p_event when 'pdf_downloaded' then 'Relatório mensal — PDF' when 'print_requested' then 'Relatório mensal — impressão' else 'Relatório mensal — CSV' end,
   case when p_mode='hotel' then 'Leito humanizado' else 'Particular' end||' ref. competência '||to_char(p_month,'MM/YYYY')||
   ' • Data do recebimento • Seleção: '||(r->>'selectedCount')||'/'||(r->>'candidateCount')||' lançamentos • Líquido R$ '||((r->>'netCents')::numeric/100)||
   ' • Comissão: '||case when p_include_commission and p_mode='private' then 'repasse particular por quitação incluído' when p_include_commission then 'Aline incluída' else 'não incluída' end||' • Conferência: '||(r->>'sourceSnapshot'));
 return r;
end;
$$;
