-- Cash competence: actual confirmed receipts/refunds, independently of entry/exit.
-- Old humanized RPCs stay available for clients open during the release.
create function private.get_uti_monthly_receipts_report_impl(p_month date,p_mode text,p_selected_keys text[] default null)
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
 ), candidates as (
   select m.*,p.name,a.entry_at,a.discharge_at,a.closer_name,
     case when a.mode='private' then 'UTI '||lpad(a.bed::text,2,'0') when a.bed>=17 then 'Suíte' else 'Simples' end bed_type,
     p_selected_keys is null or m.key=any(p_selected_keys) included,
     jsonb_build_object('key',m.key,'admissionId',a.id,'patientName',p.name,'entryAt',a.entry_at,'dischargeAt',a.discharge_at,
       'bedType',case when a.mode='private' then 'UTI '||lpad(a.bed::text,2,'0') when a.bed>=17 then 'Suíte' else 'Simples' end,
       'responsible',a.closer_name,'occurredAt',m.occurred_at,'amountCents',m.cents,'kind',m.kind,'method',m.method,'cardType',m.card_type) item
   from movements m join public.admissions a on a.id=m.admission_id join public.patients p on p.id=a.patient_id
 ), grouped as (
   select admission_id,name,entry_at,discharge_at,closer_name,bed_type,
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
   'candidateCount',s.candidate_count,'selectedCount',s.selected_count,'manualSelection',s.candidate_count<>s.selected_count,
   'sourceSnapshot',md5(jsonb_build_object('month',p_month,'mode',p_mode,
     'candidates',coalesce((select jsonb_agg(item order by key) from candidates),'[]'::jsonb))::text),
   'invalidSelectionCount',(select count(*) from unnest(p_selected_keys) k where not exists(select 1 from candidates c where c.key=k)),
   'movements',coalesce((select jsonb_agg(item||jsonb_build_object('included',included) order by occurred_at,key) from candidates),'[]'::jsonb),
   'rows',coalesce((select jsonb_agg(jsonb_build_object('admissionId',admission_id,'patientName',name,'entryAt',entry_at,
     'dischargeAt',discharge_at,'bedType',bed_type,'responsible',closer_name,'netCents',net,'receiptCount',receipts,'refundCount',refunds,
     'receiptDates',receipt_dates,'refundDates',refund_dates) order by lower(name),entry_at,admission_id) from grouped),'[]'::jsonb))
 into v_report from summary s;
 if (v_report->>'invalidSelectionCount')::integer<>0 then raise exception 'A seleção contém lançamentos fora da modalidade ou competência. Atualize e confira.'; end if;
 return v_report-'invalidSelectionCount';
end;
$$;
create function public.get_uti_monthly_receipts_report(p_month date,p_mode text)
returns jsonb language sql security invoker set search_path=public,private,pg_temp as $$
 select private.get_uti_monthly_receipts_report_impl(p_month,p_mode,null);
$$;
create function private.export_uti_monthly_receipts_report_impl(
 p_month date,p_mode text,p_event text,p_include_commission boolean,p_selected_keys text[],p_expected_snapshot text
) returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare r jsonb;
begin
 if auth.uid() is null or not private.is_active_member() then raise exception 'Sessão inválida ou usuário sem acesso ativo.'; end if;
 if p_event is null or p_event not in ('pdf_downloaded','print_requested','csv_downloaded') or p_include_commission is null then raise exception 'Evento documental inválido.'; end if;
 if p_mode='private' and p_include_commission then raise exception 'A comissão da Aline é exclusiva do leito humanizado.'; end if;
 r:=private.get_uti_monthly_receipts_report_impl(p_month,p_mode,p_selected_keys);
 if p_expected_snapshot is null or p_expected_snapshot<>r->>'sourceSnapshot' then
   raise exception 'Os recebimentos mudaram. Atualize o relatório e confira a seleção antes de exportar.';
 end if;
 insert into public.audits(admission_id,user_name,user_id,action,detail)
 values(null,private.current_display_name(),auth.uid(),
   case p_event when 'pdf_downloaded' then 'Relatório mensal — PDF' when 'print_requested' then 'Relatório mensal — impressão' else 'Relatório mensal — CSV' end,
   case when p_mode='hotel' then 'Leito humanizado' else 'Particular' end||' ref. competência '||to_char(p_month,'MM/YYYY')||
   ' • Data do recebimento • Seleção: '||(r->>'selectedCount')||'/'||(r->>'candidateCount')||' lançamentos • Líquido R$ '||((r->>'netCents')::numeric/100)||
   ' • Comissão: '||case when p_include_commission then 'incluída' else 'não incluída' end||' • Conferência: '||(r->>'sourceSnapshot'));
 return r;
end;
$$;
create function public.export_uti_monthly_receipts_report(
 p_month date,p_mode text,p_event text,p_include_commission boolean,p_selected_keys text[],p_expected_snapshot text
) returns jsonb language sql security invoker set search_path=public,private,pg_temp as $$
 select private.export_uti_monthly_receipts_report_impl(p_month,p_mode,p_event,p_include_commission,p_selected_keys,p_expected_snapshot);
$$;
revoke all on function private.get_uti_monthly_receipts_report_impl(date,text,text[]),public.get_uti_monthly_receipts_report(date,text),
 private.export_uti_monthly_receipts_report_impl(date,text,text,boolean,text[],text),public.export_uti_monthly_receipts_report(date,text,text,boolean,text[],text) from public,anon;
grant execute on function private.get_uti_monthly_receipts_report_impl(date,text,text[]),public.get_uti_monthly_receipts_report(date,text),
 private.export_uti_monthly_receipts_report_impl(date,text,text,boolean,text[],text),public.export_uti_monthly_receipts_report(date,text,text,boolean,text[],text) to authenticated;
