export const PASSWORD_MIN_LENGTH = 12;
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const ABSOLUTE_SESSION_MS = 12 * 60 * 60 * 1000;

export type PasswordPolicyResult = {
  valid: boolean;
  errors: string[];
};

export function validatePasswordPolicy(password: string): PasswordPolicyResult {
  const value = String(password || '');
  const errors: string[] = [];
  if (value.length < PASSWORD_MIN_LENGTH) errors.push(`Use pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`);
  if (!/[a-z]/.test(value)) errors.push('Inclua uma letra minúscula.');
  if (!/[A-Z]/.test(value)) errors.push('Inclua uma letra maiúscula.');
  if (!/\d/.test(value)) errors.push('Inclua um número.');
  if (!/[^A-Za-z0-9]/.test(value)) errors.push('Inclua um símbolo.');
  return { valid: errors.length === 0, errors };
}

export async function sha1Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function pwnedCountFromRange(rangeText: string, suffix: string): number {
  const wanted = String(suffix || '').trim().toUpperCase();
  if (!/^[A-F0-9]{35}$/.test(wanted)) return 0;
  for (const line of String(rangeText || '').split(/\r?\n/)) {
    const [candidate, rawCount] = line.trim().split(':');
    if (candidate?.toUpperCase() === wanted) return Number(rawCount || 0) || 0;
  }
  return 0;
}

export function sessionExpiryReason(
  nowMs: number,
  sessionStartedAtMs: number,
  lastActivityAtMs: number,
  idleTimeoutMs = IDLE_TIMEOUT_MS,
  absoluteTimeoutMs = ABSOLUTE_SESSION_MS,
): 'idle' | 'absolute' | null {
  if (!Number.isFinite(sessionStartedAtMs) || sessionStartedAtMs <= 0) return null;
  if (nowMs - sessionStartedAtMs >= absoluteTimeoutMs) return 'absolute';
  if (Number.isFinite(lastActivityAtMs) && lastActivityAtMs > 0 && nowMs - lastActivityAtMs >= idleTimeoutMs) return 'idle';
  return null;
}

export function readAuthLinkType(locationLike: { search?: string; hash?: string }):
  | 'invite'
  | 'recovery'
  | null {
  const search = new URLSearchParams(String(locationLike.search || '').replace(/^\?/, ''));
  const hash = new URLSearchParams(String(locationLike.hash || '').replace(/^#/, ''));
  const type = search.get('type') || hash.get('type');
  return type === 'invite' || type === 'recovery' ? type : null;
}
