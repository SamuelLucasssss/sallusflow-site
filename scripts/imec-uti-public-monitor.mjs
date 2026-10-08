// IMEC UTI — public surface checks only. Never query Auth, Supabase, patient or financial endpoints.
export const PRODUCTION_ORIGIN = 'https://www.sallusflow.com.br';
export const SITE_PATH = '/imec-uti/';
export const MONITORED_RESOURCES = Object.freeze([
  SITE_PATH,
  '/imec-uti/manifest.webmanifest',
  '/imec-uti/sw.js',
  '/imec-uti/icon-192.png',
  '/imec-uti/icon-512.png',
  '/imec-uti/icon-maskable-512.png',
]);

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchWithRetries(fetcher, path, { origin = PRODUCTION_ORIGIN, attempts = 3, timeoutMs = 8000, waitMs = 600 } = {}) {
  if (!MONITORED_RESOURCES.includes(path)) throw new Error('UNAPPROVED_PUBLIC_RESOURCE');
  if (origin !== PRODUCTION_ORIGIN) throw new Error('UNAPPROVED_PRODUCTION_ORIGIN');
  let lastCode = 'NETWORK_ERROR';
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetcher(origin + path, {
        method: 'GET',
        cache: 'no-store',
        redirect: 'manual',
        headers: { 'Accept': path.endsWith('.webmanifest') ? 'application/manifest+json' : '*/*' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status === 200) return response;
      lastCode = response.status >= 300 && response.status < 400 ? 'UNEXPECTED_REDIRECT' : 'HTTP_' + response.status;
    } catch {
      lastCode = 'NETWORK_ERROR';
    }
    if (i + 1 < attempts) await wait(waitMs);
  }
  throw new Error(lastCode);
}

function checkPage(content, headers) {
  if (!/<title>IMEC UTI\b/i.test(content)) return 'APP_TITLE_MISSING';
  if (!/id="app"/i.test(content)) return 'APP_MOUNT_MISSING';
  if (!/rel="manifest"/i.test(content) || !content.includes('/imec-uti/manifest.webmanifest')) return 'PWA_MANIFEST_LINK_MISSING';
  if (!/\bno-store\b/i.test(headers.get('cache-control') ?? '')) return 'CACHE_CONTROL_MISSING';
  if (!/frame-ancestors\s+'none'/i.test(headers.get('content-security-policy') ?? '')) return 'CSP_FRAME_PROTECTION_MISSING';
  if ((headers.get('x-frame-options') ?? '').toUpperCase() !== 'DENY') return 'CLICKJACKING_PROTECTION_MISSING';
  if ((headers.get('x-content-type-options') ?? '').toLowerCase() !== 'nosniff') return 'NOSNIFF_MISSING';
  return null;
}

function checkManifest(content) {
  let m;
  try { m = JSON.parse(content); } catch { return 'MANIFEST_INVALID_JSON'; }
  if (m.start_url !== SITE_PATH || m.scope !== SITE_PATH || m.display !== 'standalone') return 'MANIFEST_SCOPE_INVALID';
  if (!Array.isArray(m.icons)) return 'MANIFEST_ICONS_MISSING';
  if (!m.icons.some((i) => i.src === '/imec-uti/icon-192.png' && i.sizes === '192x192')) return 'ICON_192_NOT_REFERENCED';
  if (!m.icons.some((i) => i.src === '/imec-uti/icon-512.png' && i.sizes === '512x512')) return 'ICON_512_NOT_REFERENCED';
  if (!m.icons.some((i) => i.src === '/imec-uti/icon-maskable-512.png' && i.purpose === 'maskable')) return 'MASKABLE_ICON_NOT_REFERENCED';
  return null;
}

function checkServiceWorker(content) {
  if (!content.includes("fetch(event.request,{cache:'no-store'})")) return 'SW_NETWORK_ONLY_FETCH_MISSING';
  if (['caches.open', 'cache.put', '.addAll(', 'indexedDB'].some((s) => content.includes(s))) return 'SW_PERSISTENT_CACHE_DETECTED';
  return null;
}

function checkPng(bytes, dimension) {
  if (bytes.byteLength < 24) return 'ICON_NOT_PNG';
  const view = new DataView(bytes);
  if (PNG_SIGNATURE.some((value, i) => view.getUint8(i) !== value)) return 'ICON_NOT_PNG';
  if (view.getUint32(16) !== dimension || view.getUint32(20) !== dimension) return 'ICON_DIMENSIONS_INVALID';
  return null;
}

export async function auditPublicSite(fetcher = fetch, options = {}) {
  const results = [];
  for (const path of MONITORED_RESOURCES) {
    try {
      const response = await fetchWithRetries(fetcher, path, options);
      let error = null;
      if (path === SITE_PATH) error = checkPage(await response.text(), response.headers);
      else if (path.endsWith('.webmanifest')) error = checkManifest(await response.text());
      else if (path.endsWith('/sw.js')) error = checkServiceWorker(await response.text());
      else error = checkPng(await response.arrayBuffer(), path.includes('192') ? 192 : 512);
      results.push({ path, ok: error === null, code: error || 'OK' });
    } catch (e) {
      const codes = ['UNAPPROVED_PUBLIC_RESOURCE', 'UNAPPROVED_PRODUCTION_ORIGIN', 'UNEXPECTED_REDIRECT', 'NETWORK_ERROR'];
      results.push({ path, ok: false, code: codes.includes(e.message) || /^HTTP_\d{3}$/.test(e.message) ? e.message : 'UNEXPECTED_ERROR' });
    }
  }
  return {
    healthy: results.every((row) => row.ok),
    results,
    checkedAt: new Date().toISOString(),
  };
}
