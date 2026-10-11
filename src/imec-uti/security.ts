export const AUTH_STORAGE_KEY = 'imec-uti-auth-v2';
export const ACTIVITY_STORAGE_KEY = 'imec-uti-last-activity-v1';
export const IDLE_TIMEOUT_MS = 20 * 60 * 1000;
export const APP_URL = 'https://www.sallusflow.com.br/imec-uti/';

export type AuthRedirect = {
  type: string | null;
  session: Record<string, unknown> | null;
};

export function decodeJwtPayload(token: string | null | undefined): Record<string, any> {
  if (!token) return {};
  try {
    const part = token.split('.')[1];
    if (!part) return {};
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    return JSON.parse(atob(base64));
  } catch {
    return {};
  }
}

export function jwtAal(token: string | null | undefined): 'aal1' | 'aal2' {
  return decodeJwtPayload(token).aal === 'aal2' ? 'aal2' : 'aal1';
}

/** Never poll protected business data while MFA enrollment or challenge is pending. */
export function canBackgroundRefresh(
  accessToken: string | null | undefined,
  remoteBusy: boolean,
  modalOpen: boolean,
  operationalReady: boolean,
  passwordOnlyMode = false,
): boolean {
  return !!accessToken && (jwtAal(accessToken) === 'aal2' || passwordOnlyMode)
    && !remoteBusy && !modalOpen && operationalReady;
}


/**
 * Supabase GoTrue REST returns the TOTP QR as raw SVG, whereas an <img>
 * element requires an image URL. Keep the graphic inline and private.
 * No third-party QR service, persistence or external request is used.
 */
export function totpQrImageSrc(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('QR Code não fornecido pelo autenticador.');
  const value = raw.trim();
  const data = /^data:image\/svg\+xml(?:;[a-z0-9=_-]+)*,([\s\S]*)$/i.exec(value);
  let svg = value;
  if (data) {
    try { svg = decodeURIComponent(data[1]); }
    catch { throw new Error('QR Code retornado em formato inválido.'); }
  }
  if (
    svg.length > 500_000 ||
    !/^(?:<\?xml[^>]*\?>\s*)?<svg(?:\s|>)/i.test(svg) ||
    !/<\/svg>\s*$/i.test(svg) ||
    /<\s*(?:script|foreignObject|iframe|image|use)\b|<!DOCTYPE\b|<!ENTITY\b|\bon[a-z]+\s*=|\b(?:xlink:)?href\s*=/i.test(svg)
  ) throw new Error('O QR Code retornado não é uma imagem SVG válida.');
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

export function normalizeSession(session: any): any {
  if (!session?.access_token) return session;
  const payload = decodeJwtPayload(session.access_token);
  const expiresAt = Number(session.expires_at || payload.exp || 0);
  return {
    ...session,
    expires_at: expiresAt,
    expires_in: session.expires_in || (expiresAt ? Math.max(0, expiresAt - Math.floor(Date.now() / 1000)) : undefined),
  };
}

export function parseAuthRedirect(urlString: string): AuthRedirect {
  const url = new URL(urlString);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const type = hash.get('type') || url.searchParams.get('type');
  const accessToken = hash.get('access_token');
  const refreshToken = hash.get('refresh_token');
  if (!accessToken) return { type, session: null };
  const expiresIn = Number(hash.get('expires_in') || 0);
  const payload = decodeJwtPayload(accessToken);
  return {
    type,
    session: normalizeSession({
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: hash.get('token_type') || 'bearer',
      expires_in: expiresIn || undefined,
      expires_at: Number(payload.exp || 0) || (expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : undefined),
    }),
  };
}

export function cleanAuthRedirectUrl(urlString: string): string {
  const url = new URL(urlString);
  url.hash = '';
  for (const key of ['type', 'token', 'token_hash']) url.searchParams.delete(key);
  return url.pathname + (url.search ? url.search : '');
}

export function passwordPolicy(password: string): { ok: boolean; message: string } {
  if (password.length < 12) return { ok: false, message: 'Use pelo menos 12 caracteres.' };
  const classes = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;
  if (classes < 3) return { ok: false, message: 'Use uma combinação de maiúsculas, minúsculas, números e símbolos.' };
  return { ok: true, message: '' };
}

export async function sha1Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-1', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function pwnedCountFromRange(range: string, fullSha1: string): number {
  const suffix = fullSha1.slice(5).toUpperCase();
  for (const line of range.split(/\r?\n/)) {
    const [candidate, count] = line.trim().split(':');
    if (candidate?.toUpperCase() === suffix) return Number(count || 0);
  }
  return 0;
}

export function isIdle(lastActivity: number, now = Date.now(), timeoutMs = IDLE_TIMEOUT_MS): boolean {
  return Number.isFinite(lastActivity) && lastActivity > 0 && now - lastActivity >= timeoutMs;
}
