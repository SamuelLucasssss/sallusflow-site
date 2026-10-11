export type PaymentDetails = {
  method?: string;
  cardType?: 'credit' | 'debit' | null;
  installmentDates?: string[] | null;
};

export function paymentMethodLabel(payment: PaymentDetails): string {
  if (payment.method !== 'Cartão') return payment.method || 'Não informado';
  if (payment.cardType === 'debit') return 'Cartão de débito';
  if (payment.cardType === 'credit') {
    const count = payment.installmentDates?.length || 0;
    return `Cartão de crédito${count ? ` · ${count}x` : ''}`;
  }
  return 'Cartão (tipo não informado)';
}

export function installmentDateLabel(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

export function installmentSummary(payment: PaymentDetails): string {
  if (payment.cardType !== 'credit') return '';
  const dates = payment.installmentDates || [];
  if (!dates.length) return 'Vencimentos não informados';
  return 'Vencimentos: ' + dates.map((date, i) => `${i + 1}ª ${installmentDateLabel(date)}`).join(' · ');
}

export function validateInstallmentDates(dates: string[], receivedDate: string): string | null {
  if (!dates.length || dates.length > 24) return 'Informe de 1 a 24 parcelas.';
  let previous = receivedDate;
  for (const [index, date] of dates.entries()) {
    const parsed = new Date(`${date}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      return 'Informe o vencimento de todas as parcelas.';
    }
    if (date < receivedDate) return 'O vencimento não pode ser anterior ao recebimento.';
    if (index > 0 && date <= previous) return 'Os vencimentos devem estar em ordem crescente.';
    previous = date;
  }
  return null;
}
