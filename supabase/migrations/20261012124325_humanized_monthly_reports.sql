-- Monthly humanized receipts use receipt dates in Sao Paulo, not admission/discharge dates.
create index payments_monthly_report_idx on public.payments(occurred_at,admission_id) where cancelled_at is null;
create index refunds_monthly_report_idx on public.refunds(occurred_at,admission_id) where cancelled_at is null;
create function private.get_uti_humanized_monthly_report_impl(p_month date)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_report jsonb;
begin
 if auth.uid() is null or not private.is_active_member() then raise exception 'Sessão inválida ou usuário sem acesso ativo.'; end if;
 if p_month is null or not isfinite(p_month) or extract(day from p_month)<>1 then raise exception 'Informe o primeiro dia da competência.'; end if;
 -- One statement snapshot keeps rows, totals and commission consistent.
 with period as (
   select p_month::timestamp at time zone 'America/Sao_Paulo' start_at,
     (p_month+interval '1 month')::timestamp at time zone 'America/Sao_Paulo' end_at
 ), movements as (
   select pm.admission_id,round(pm.amount*100) cents,true receipt
   from public.payments pm join public.admissions a on a.id=pm.admission_id cross join period t
   where a.mode='hotel' and pm.cancelled_at is null and pm.occurred_at>=t.start_at and pm.occurred_at<t.end_at
   union all
   select r.admission_id,-round(r.amount*100) cents,false receipt
   from public.refunds r join public.admissions a on a.id=r.admission_id cross join period t
   where a.mode='hotel' and r.cancelled_at is null and r.occurred_at>=t.start_at and r.occurred_at<t.end_at
 ), grouped as (
   select admission_id,sum(cents) cents,count(*) filter(where receipt) receipt_count,count(*) filter(where not receipt) refund_count
   from movements group by admission_id
 ), summary as (
   select coalesce(sum(cents) filter(where receipt),0) received,
     -coalesce(sum(cents) filter(where not receipt),0) refunded,
     coalesce(sum(cents),0) net,count(*) filter(where receipt) receipt_count,count(*) filter(where not receipt) refund_count
   from movements
 ), rows as (
   select a.id,p.name,a.entry_at,a.discharge_at,case when a.bed>=17 then 'Suíte' else 'Simples' end bed_type,g.*
   from grouped g join public.admissions a on a.id=g.admission_id join public.patients p on p.id=a.patient_id
 )
 select jsonb_build_object('month',to_char(p_month,'YYYY-MM'),'generatedAt',now(),
   'receivedCents',s.received,'refundedCents',s.refunded,'netCents',s.net,
   'receiptCount',s.receipt_count,'refundCount',s.refund_count,'admissionCount',(select count(*) from rows),
   'commissionPercent',3,'commissionCents',round(s.net*3/100),
   'rows',coalesce((select jsonb_agg(jsonb_build_object('admissionId',r.id,'patientName',r.name,
     'entryAt',r.entry_at,'dischargeAt',r.discharge_at,'bedType',r.bed_type,'netCents',r.cents,
     'receiptCount',r.receipt_count,'refundCount',r.refund_count) order by lower(r.name),r.entry_at,r.id) from rows r),'[]'::jsonb))
 into v_report from summary s;
 return v_report;
end;
$$;
create function public.get_uti_humanized_monthly_report(p_month date)
returns jsonb language sql security invoker set search_path=public,private,pg_temp as $$
 select private.get_uti_humanized_monthly_report_impl(p_month);
$$;
create function private.log_uti_report_event_impl(p_month date,p_event text,p_include_commission boolean)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_id uuid;
begin
 if auth.uid() is null or not private.is_active_member() then raise exception 'Sessão inválida ou usuário sem acesso ativo.'; end if;
 if p_month is null or not isfinite(p_month) or extract(day from p_month)<>1 then raise exception 'Competência inválida.'; end if;
 if p_event is null or p_event not in ('pdf_downloaded','print_requested','csv_downloaded') or p_include_commission is null then raise exception 'Evento documental inválido.'; end if;
 insert into public.audits(admission_id,user_name,user_id,action,detail)
 values(null,private.current_display_name(),auth.uid(),
   case p_event when 'pdf_downloaded' then 'Relatório mensal — PDF' when 'print_requested' then 'Relatório mensal — impressão' else 'Relatório mensal — CSV' end,
   'Leito humanizado ref. competência '||to_char(p_month,'MM/YYYY')||' • Comissão de 3% da Aline Glória '||case when p_include_commission then 'incluída.' else 'não incluída.' end)
 returning id into v_id;
 return v_id;
end;
$$;
create function public.log_uti_report_event(p_month date,p_event text,p_include_commission boolean)
returns uuid language sql security invoker set search_path=public,private,pg_temp as $$
 select private.log_uti_report_event_impl(p_month,p_event,p_include_commission);
$$;
revoke all on function private.get_uti_humanized_monthly_report_impl(date),public.get_uti_humanized_monthly_report(date),private.log_uti_report_event_impl(date,text,boolean),public.log_uti_report_event(date,text,boolean) from public,anon;
grant execute on function private.get_uti_humanized_monthly_report_impl(date),public.get_uti_humanized_monthly_report(date),private.log_uti_report_event_impl(date,text,boolean),public.log_uti_report_event(date,text,boolean) to authenticated;
