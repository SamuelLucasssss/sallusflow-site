import { createClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL } from './config';
import { readAuthLinkType } from './security';

export const initialAuthLinkType =
  typeof window === 'undefined' ? null : readAuthLinkType(window.location);

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'implicit',
    storageKey: 'imec-uti-auth-v2',
  },
});

export function clearAuthLinkArtifacts(): void {
  if (typeof window === 'undefined') return;
  if (!window.location.hash && !/[?&]type=(?:invite|recovery)(?:&|$)/.test(window.location.search)) return;
  window.history.replaceState({}, document.title, window.location.pathname);
}
