-- PostgreSQL infinity is not a real date and cannot become a promise or receipt.
alter table public.scheduled_receipts add constraint scheduled_receipts_expected_finite
check (isfinite(expected_at));
alter table public.scheduled_receipts add constraint scheduled_receipts_installments_finite
check (array_position(installment_dates,'infinity'::date) is null
 and array_position(installment_dates,'-infinity'::date) is null);
alter table public.payments add constraint payments_installments_finite
check (array_position(installment_dates,'infinity'::date) is null
 and array_position(installment_dates,'-infinity'::date) is null);
