-- A promise is not a payment. Existing ledger calculations remain unchanged.
create table public.scheduled_receipts (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null references public.admissions(id),
  expected_at timestamptz not null,
  amount numeric(12,2) not null check (amount>0 and amount<>'NaN'::numeric),
  method text not null check (method in ('PIX','credit','debit','Cartão','Transferência','Dinheiro','Outro')),
  installment_dates date[] not null default '{}',
  notes text check (char_length(notes)<=2000),
  status text not null default 'pending' check (status in ('pending','confirmed','cancelled')),
  client_ref text not null check (char_length(client_ref) between 16 and 120),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id),
  created_by_name text not null,
  payment_id uuid unique references public.payments(id),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  cancel_reason text,
  unique (admission_id,client_ref),
  check ((status='pending' and payment_id is null and resolved_at is null)
    or (status='confirmed' and payment_id is not null and resolved_at is not null)
    or (status='cancelled' and payment_id is null and resolved_at is not null)),
  check ((method='credit' and cardinality(installment_dates) between 1 and 24
      and array_ndims(installment_dates)=1 and array_position(installment_dates,null) is null)
    or (method<>'credit' and cardinality(installment_dates)=0))
);
create index scheduled_receipts_admission_expected_idx on public.scheduled_receipts(admission_id,expected_at);
create index scheduled_receipts_pending_expected_idx on public.scheduled_receipts(expected_at,id) where status='pending';
create index scheduled_receipts_created_by_idx on public.scheduled_receipts(created_by);
create index scheduled_receipts_resolved_by_idx on public.scheduled_receipts(resolved_by);
alter table public.scheduled_receipts enable row level security;
revoke all on public.scheduled_receipts from public,anon,authenticated;
grant select on public.scheduled_receipts to authenticated;
create policy scheduled_receipts_active_read on public.scheduled_receipts for select to authenticated
using ((select private.is_active_member()));

create function private.schedule_uti_receipt_impl(
 p_admission_id uuid,p_expected_at timestamptz,p_amount numeric,p_method text,
 p_installment_dates date[],p_notes text,p_client_ref text
) returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare
 a public.admissions;
 s public.scheduled_receipts;
 v_balance numeric;
 v_reserved numeric;
 v_date date;
 v_previous date;
 v_id uuid;
 v_ref text:=trim(coalesce(p_client_ref,''));
 v_notes text:=nullif(trim(coalesce(p_notes,'')),'');
 v_user text;
begin
 if auth.uid() is null or not private.has_permission('add_payment') then raise exception 'Seu perfil não pode prever recebimentos.'; end if;
 if p_expected_at is null or p_amount is null or p_amount='NaN'::numeric or p_amount in ('Infinity'::numeric,'-Infinity'::numeric)
 or p_amount<=0 or p_amount>1000000 or p_amount<>round(p_amount,2) then raise exception 'Informe data e valor válidos para a previsão.'; end if;
 if p_method is null or p_method not in ('PIX','credit','debit','Cartão','Transferência','Dinheiro','Outro') then raise exception 'Forma de pagamento inválida.'; end if;
 if char_length(v_ref) not between 16 and 120 or char_length(coalesce(v_notes,''))>2000 then raise exception 'Identificador ou observação inválidos.'; end if;
 if p_installment_dates is null then raise exception 'Informe os vencimentos do cartão.'; end if;
 if p_method='credit' then
   if cardinality(p_installment_dates) not between 1 and 24 or array_ndims(p_installment_dates)<>1 then raise exception 'Informe de 1 a 24 vencimentos.'; end if;
   foreach v_date in array p_installment_dates loop
     if v_date is null or v_date<(p_expected_at at time zone 'America/Sao_Paulo')::date or (v_previous is not null and v_date<=v_previous) then
       raise exception 'Vencimentos inválidos ou fora de ordem.'; end if;
     v_previous:=v_date;
   end loop;
 elsif cardinality(p_installment_dates)<>0 then raise exception 'Esta forma não admite vencimentos de cartão.';
 end if;
 select * into a from public.admissions where id=p_admission_id for update;
 if not found then raise exception 'Internação não encontrada.'; end if;
 select * into s from public.scheduled_receipts where admission_id=a.id and client_ref=v_ref;
 if found then
   if s.status='cancelled' or s.expected_at is distinct from p_expected_at or s.amount is distinct from p_amount
   or s.method is distinct from p_method or s.installment_dates is distinct from p_installment_dates or s.notes is distinct from v_notes then
     raise exception 'Referência já utilizada em outra previsão.'; end if;
   return s.id;
 end if;
 if a.status not in ('active','discharge_pending') or p_expected_at<a.entry_at then raise exception 'A conta ou a data não permite esta previsão.'; end if;
 v_user:=private.current_display_name();
 if a.status='active' then perform private.sync_daily_charges(a.id,null,v_user); end if;
 select coalesce((select sum(amount) from public.charges where admission_id=a.id and cancelled_at is null),0)
 -coalesce((select sum(amount) from public.payments where admission_id=a.id and cancelled_at is null),0)
 +coalesce((select sum(amount) from public.refunds where admission_id=a.id and cancelled_at is null),0) into v_balance;
 select coalesce(sum(amount),0) into v_reserved from public.scheduled_receipts where admission_id=a.id and status='pending';
 if p_amount>v_balance-v_reserved+0.009 then raise exception 'A previsão supera o saldo disponível, descontadas as outras previsões.'; end if;
 insert into public.scheduled_receipts(admission_id,expected_at,amount,method,installment_dates,notes,client_ref,created_by,created_by_name)
 values(a.id,p_expected_at,p_amount,p_method,p_installment_dates,v_notes,v_ref,auth.uid(),v_user) returning id into v_id;
 insert into public.audits(admission_id,user_name,user_id,action,detail)
 values(a.id,v_user,auth.uid(),'Recebimento previsto',
   'R$ '||to_char(p_amount,'FM999G999G990D00')||' • Previsto para '||to_char(p_expected_at at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')||' • Não altera o saldo nem os recebimentos.');
 return v_id;
end;
$$;

create function private.confirm_uti_receipt_impl(
 p_schedule_id uuid,p_occurred_at timestamptz,p_method text,p_installment_dates date[],p_notes text
) returns text language plpgsql security definer set search_path=public,private,pg_temp as $$
declare
 s public.scheduled_receipts;
 p public.payments;
 v_admission uuid;
 v_status text;
 v_ref text;
 v_notes text:=nullif(trim(coalesce(p_notes,'')),'');
 v_method text:=case when p_method in ('credit','debit') then 'Cartão' else p_method end;
begin
 if auth.uid() is null or not private.has_permission('add_payment') then raise exception 'Seu perfil não pode confirmar recebimentos.'; end if;
 if p_method is null or p_method not in ('PIX','credit','debit','Cartão','Transferência','Dinheiro','Outro') then raise exception 'Forma de pagamento inválida.'; end if;
 select admission_id into v_admission from public.scheduled_receipts where id=p_schedule_id;
 if not found then raise exception 'Previsão não encontrada.'; end if;
 -- Every financial operation locks the admission before its dependent rows.
 perform 1 from public.admissions where id=v_admission for update;
 select * into s from public.scheduled_receipts where id=p_schedule_id for update;
 if s.status='cancelled' then raise exception 'Esta previsão foi cancelada.'; end if;
 if s.status='confirmed' then
   select * into p from public.payments where id=s.payment_id;
   if p.cancelled_at is not null then raise exception 'O recebimento foi estornado. Crie uma nova previsão.'; end if;
   if p.occurred_at is distinct from p_occurred_at or p.method is distinct from v_method
   or p.card_type is distinct from (case when p_method in ('credit','debit') then p_method else null end)
   or p.installment_dates is distinct from p_installment_dates or p.notes is distinct from v_notes then
     raise exception 'Esta previsão já foi confirmada com outros dados.'; end if;
   return private.reconcile_admission_status(v_admission);
 end if;
 if p_occurred_at is null or p_occurred_at>now() then raise exception 'Informe a data real do recebimento, sem data futura.'; end if;
 if p_installment_dates is null or (p_method not in ('credit','debit') and cardinality(p_installment_dates)<>0) then raise exception 'Vencimentos inválidos.'; end if;
 if char_length(coalesce(v_notes,''))>2000 then raise exception 'Observação muito longa.'; end if;
 v_ref:='scheduled-receipt:'||s.id::text;
 if p_method in ('credit','debit') then
   v_status:=private.add_uti_card_payment_impl(v_admission,p_occurred_at,s.amount,p_method,p_installment_dates,v_notes,v_ref);
 else
   v_status:=private.add_uti_payment_impl(v_admission,p_occurred_at,s.amount,p_method,v_notes,v_ref);
 end if;
 select * into p from public.payments where admission_id=v_admission and client_ref=v_ref;
 if not found then raise exception 'O recebimento não foi registrado.'; end if;
 update public.scheduled_receipts set status='confirmed',payment_id=p.id,resolved_at=now(),resolved_by=auth.uid() where id=s.id;
 insert into public.audits(admission_id,user_name,user_id,action,detail)
 values(v_admission,private.current_display_name(),auth.uid(),'Recebimento previsto confirmado',
   'R$ '||to_char(s.amount,'FM999G999G990D00')||' • Recebido em '||to_char(p_occurred_at at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')||' • Previsão '||s.id::text);
 return v_status;
end;
$$;

create function private.cancel_uti_receipt_impl(p_schedule_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare s public.scheduled_receipts;v_admission uuid;v_reason text:=trim(coalesce(p_reason,''));
begin
 if auth.uid() is null or not private.has_permission('add_payment') then raise exception 'Seu perfil não pode cancelar previsões.'; end if;
 if char_length(v_reason) not between 8 and 220 then raise exception 'Informe o motivo do cancelamento (8 a 220 caracteres).'; end if;
 select admission_id into v_admission from public.scheduled_receipts where id=p_schedule_id;
 if not found then raise exception 'Previsão não encontrada.'; end if;
 perform 1 from public.admissions where id=v_admission for update;
 select * into s from public.scheduled_receipts where id=p_schedule_id for update;
 if s.status='cancelled' then return; end if;
 if s.status='confirmed' then raise exception 'Recebimento já confirmado. Use o estorno administrativo.'; end if;
 update public.scheduled_receipts set status='cancelled',resolved_at=now(),resolved_by=auth.uid(),cancel_reason=v_reason where id=s.id;
 insert into public.audits(admission_id,user_name,user_id,action,detail)
 values(v_admission,private.current_display_name(),auth.uid(),'Previsão de recebimento cancelada',v_reason||' • Previsão '||s.id::text);
end;
$$;

create function public.schedule_uti_receipt(p_admission_id uuid,p_expected_at timestamptz,p_amount numeric,p_method text,p_installment_dates date[],p_notes text,p_client_ref text)
returns uuid language sql security invoker set search_path=public,private,pg_temp as $$
 select private.schedule_uti_receipt_impl(p_admission_id,p_expected_at,p_amount,p_method,p_installment_dates,p_notes,p_client_ref);
$$;
create function public.confirm_uti_receipt(p_schedule_id uuid,p_occurred_at timestamptz,p_method text,p_installment_dates date[],p_notes text)
returns text language sql security invoker set search_path=public,private,pg_temp as $$
 select private.confirm_uti_receipt_impl(p_schedule_id,p_occurred_at,p_method,p_installment_dates,p_notes);
$$;
create function public.cancel_uti_receipt(p_schedule_id uuid,p_reason text)
returns void language sql security invoker set search_path=public,private,pg_temp as $$
 select private.cancel_uti_receipt_impl(p_schedule_id,p_reason);
$$;

revoke all on function private.schedule_uti_receipt_impl(uuid,timestamptz,numeric,text,date[],text,text) from public,anon,authenticated;
revoke all on function private.confirm_uti_receipt_impl(uuid,timestamptz,text,date[],text) from public,anon,authenticated;
revoke all on function private.cancel_uti_receipt_impl(uuid,text) from public,anon,authenticated;
revoke all on function public.schedule_uti_receipt(uuid,timestamptz,numeric,text,date[],text,text) from public,anon,authenticated;
revoke all on function public.confirm_uti_receipt(uuid,timestamptz,text,date[],text) from public,anon,authenticated;
revoke all on function public.cancel_uti_receipt(uuid,text) from public,anon,authenticated;
grant execute on function private.schedule_uti_receipt_impl(uuid,timestamptz,numeric,text,date[],text,text),
 private.confirm_uti_receipt_impl(uuid,timestamptz,text,date[],text),private.cancel_uti_receipt_impl(uuid,text),
 public.schedule_uti_receipt(uuid,timestamptz,numeric,text,date[],text,text),public.confirm_uti_receipt(uuid,timestamptz,text,date[],text),
 public.cancel_uti_receipt(uuid,text) to authenticated;
