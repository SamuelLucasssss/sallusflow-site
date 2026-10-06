export const BUSINESS_TZ = 'America/Sao_Paulo' as const;
export const PRIVATE_NO_VENT = 7000;
export const PRIVATE_VENT = 10000;
export const HOTEL_SIMPLE = 400;
export const HOTEL_SUITE = 500;

export type AdmissionEstimateInput = { value: number; half: boolean };

export type BalanceMeta =
  | { label: 'Crédito a devolver'; amount: number; kind: 'credit' }
  | { label: 'Saldo a receber'; amount: number; kind: 'debt' }
  | { label: 'Saldo'; amount: 0; kind: 'paid' };

export const money = (value: unknown): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));

export const businessParts = (date: Date | string | number) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: BUSINESS_TZ,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(date))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;

export function zonedLocalToDate(value: string): Date {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return new Date(value);
  const [, ys, mos, ds, hs, mis, ss = '0'] = match;
  const y = +ys, mo = +mos, d = +ds, h = +hs, mi = +mis, s = +ss;
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const p = businessParts(new Date(guess));
    const represented = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess = wall - (represented - guess);
  }
  return new Date(guess);
}

export const fmtDT = (iso: Date | string | number): string =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: BUSINESS_TZ, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));

export const fmtDM = (iso: Date | string | number): string =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: BUSINESS_TZ, day: '2-digit', month: '2-digit' }).format(new Date(iso));

export function toLocalInput(date: Date): string {
  const p = businessParts(date);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export const nowLocalInput = (): string => toLocalInput(new Date());
export const parseLocal = (value: string): string => zonedLocalToDate(value).toISOString();
export const cpfNorm = (value: unknown): string => String(value || '').replace(/\D/g, '').slice(0, 11);

export function cpfMask(value: unknown): string {
  const normalized = cpfNorm(value);
  return normalized ? normalized.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : 'Não informado';
}

export const dayKey = (value: Date | string | number): string => {
  const p = businessParts(value);
  return `${p.year}-${p.month}-${p.day}`;
};
export const monthKey = (value: Date | string | number): string => {
  const p = businessParts(value);
  return `${p.year}-${p.month}`;
};
export const sameDay = (a: Date | string | number, b: Date | string | number = new Date()): boolean => dayKey(a) === dayKey(b);
export const sameMonth = (a: Date | string | number, b: Date | string | number = new Date()): boolean => monthKey(a) === monthKey(b);
export const bedRate = (bed: number): number => bed >= 17 ? HOTEL_SUITE : HOTEL_SIMPLE;
export const bedLabel = (bed: number): string => bed >= 17 ? 'Hotelaria com suíte' : 'Hotelaria individual';
export const late = (value: string): boolean => {
  const match = String(value).match(/T(\d{2}):/);
  return match ? Number(match[1]) >= 18 : businessParts(value).hour >= 18;
};

export function spParts(value: Date | string | number) {
  const p = businessParts(value);
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute };
}

export function newAdmissionEstimate(entryValue: string, input: AdmissionEstimateInput) {
  if (!entryValue || !input?.value || input.value <= 0) return { additional: 0, units: 0, total: 0, retro: false };
  const ep = spParts(parseLocal(entryValue));
  const np = spParts(new Date());
  const entryDay = Date.UTC(ep.year, ep.month - 1, ep.day);
  const today = Date.UTC(np.year, np.month - 1, np.day);
  const limit = today - (np.hour < 7 ? 86_400_000 : 0);
  const diff = Math.floor((limit - entryDay) / 86_400_000);
  const additional = Math.max(0, diff - 1);
  const initialUnits = input.half ? 0.5 : 1;
  return { additional, units: initialUnits + additional, total: input.value * (initialUnits + additional), retro: additional > 0 };
}

export function roleLabel(role: string | null | undefined): string {
  return role === 'admin' ? 'Administrador' : role === 'commercial' ? 'Comercial' : 'Operacional';
}

export function balanceMeta(value: unknown): BalanceMeta {
  const n = Number(value || 0);
  if (n < -0.009) return { label: 'Crédito a devolver', amount: -n, kind: 'credit' };
  if (n > 0.009) return { label: 'Saldo a receber', amount: n, kind: 'debt' };
  return { label: 'Saldo', amount: 0, kind: 'paid' };
}
