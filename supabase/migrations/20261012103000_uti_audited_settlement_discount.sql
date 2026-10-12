-- Settlement discount is an auditable negative adjustment, never a fictitious payment.
-- Daily charges and the original receipts remain unchanged.
alter table public.charges drop constraint if exists charges_amount_check;
alter table public.charges add constraint charges_amount_check
check (
  amount = round(amount,2)
  and (amount >= 0 or (kind = 'adjustment' and category = 'Desconto no acerto' and amount < 0))
);

create or replace function private.grant_uti_settlement_discount_impl(
  p_admission_id uuid,
  p_amount numeric,
  p_reason text,
  p_client_ref text
)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  a public.admissions;
  v_amount numeric:=round(p_amount,2);
  v_reason text:=trim(coalesce(p_reason,''));
  v_ref text:=trim(coalesce(p_client_ref,''));
  v_id uuid;
  v_existing public.charges;
  v_balance numeric;
  v_user text;
  v_status text;
begin
  if not private.is_admin() then raise exception 'Somente administradores podem conceder descontos no acerto.'; end if;
  if p_admission_id is null then raise exception 'Internação inválida.'; end if;
  if v_amount is null or v_amount<=0 or v_amount>1000000 or p_amount<>v_amount then
    raise exception 'Informe um desconto positivo, limitado a duas casas decimais.'; end if;
  if char_length(v_reason)<8 or char_length(v_reason)>220 then
    raise exception 'Informe o motivo do desconto (8 a 220 caracteres).'; end if;
  if char_length(v_ref)<16 or char_length(v_ref)>120 then
    raise exception 'Identificador da operação inválido.'; end if;

  select * into a from public.admissions where id=p_admission_id for update;
  if not found then raise exception 'Internação não encontrada.'; end if;

  -- Retry must be idempotent even after the first request finalizes the account.
  select * into v_existing from public.charges
  where admission_id=p_admission_id and client_ref=v_ref;
  if found then
    if v_existing.kind='adjustment' and v_existing.category='Desconto no acerto'
       and v_existing.amount=-v_amount and v_existing.cancelled_at is null then
      return v_existing.id;
    end if;
    raise exception 'A referência desta operação já foi utilizada.';
  end if;

  if a.status<>'discharge_pending' or a.discharge_at is null then
    raise exception 'O desconto de acerto só pode ser concedido após a alta, com saldo pendente.'; end if;

  select coalesce((select sum(amount) from public.charges where admission_id=a.id and cancelled_at is null),0)
        -coalesce((select sum(amount) from public.payments where admission_id=a.id and cancelled_at is null),0)
        +coalesce((select sum(amount) from public.refunds where admission_id=a.id and cancelled_at is null),0)
  into v_balance;
  if v_balance<=0 or v_amount>v_balance then
    raise exception 'O desconto não pode superar o saldo financeiro pendente.'; end if;

  v_user:=private.current_display_name();
  insert into public.charges(
    admission_id,occurred_at,kind,category,description,amount,
    created_by_name,created_by,client_ref
  )
  values(
    a.id,a.discharge_at,'adjustment','Desconto no acerto',
    'Desconto concedido: '||v_reason,-v_amount,
    v_user,auth.uid(),v_ref
  )
  returning id into v_id;

  v_status:=private.reconcile_admission_status(a.id);
  insert into public.audits(admission_id,user_name,user_id,action,detail)
  values(a.id,v_user,auth.uid(),'Desconto concedido no acerto',
         'R$ '||to_char(v_amount,'FM999G999G990D00')||
         ' • Motivo: '||v_reason||' • Novo saldo: R$ '||
         to_char(v_balance-v_amount,'FM999G999G990D00')||' • Situação: '||v_status);
  return v_id;
end;
$$;

create or replace function public.grant_uti_settlement_discount(
  p_admission_id uuid,
  p_amount numeric,
  p_reason text,
  p_client_ref text
)
returns uuid language sql set search_path=public,private,pg_temp
as $$
  select private.grant_uti_settlement_discount_impl(
    p_admission_id,p_amount,p_reason,p_client_ref
  )
$$;

revoke all on function private.grant_uti_settlement_discount_impl(uuid,numeric,text,text)
from public,anon,authenticated;
revoke all on function public.grant_uti_settlement_discount(uuid,numeric,text,text)
from public,anon,authenticated;
grant execute on function private.grant_uti_settlement_discount_impl(uuid,numeric,text,text)
to authenticated;
grant execute on function public.grant_uti_settlement_discount(uuid,numeric,text,text)
to authenticated;
