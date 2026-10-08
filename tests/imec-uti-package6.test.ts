import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(path, 'utf8');

test('PWA do IMEC UTI é instalável sem cache de dados operacionais', () => {
  const manifest = JSON.parse(read('public/imec-uti/manifest.webmanifest'));
  assert.equal(manifest.start_url, '/imec-uti/');
  assert.equal(manifest.scope, '/imec-uti/');
  assert.equal(manifest.display, 'standalone');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2);

  const sw = read('public/imec-uti/sw.js');
  assert.ok(sw.includes("fetch(event.request,{cache:'no-store'})"));
  assert.match(sw, /Sem conexão/);
  for (const forbidden of ['caches.open', 'cache.put', '.addAll(', 'indexedDB']) {
    assert.equal(sw.includes(forbidden), false, `service worker não deve persistir dados: ${forbidden}`);
  }
});

test('shell expõe navegação e regiões de status acessíveis', () => {
  const page = read('src/pages/imec-uti/index.astro');
  assert.match(page, /rel="manifest" href="\/imec-uti\/manifest\.webmanifest"/);
  assert.match(page, /class="skip-link"/);
  assert.match(page, /id="networkStatus"[^>]+aria-live="polite"/);
  assert.match(page, /id="toast"[^>]+aria-live="polite"/);
});

test('modais mantêm foco e saídas documentais passam por auditoria', () => {
  const app = read('src/imec-uti/app.ts');
  assert.match(app, /role="dialog"/);
  assert.match(app, /aria-modal="true"/);
  assert.match(app, /e\.key==='Escape'/);
  assert.match(app, /e\.key!=='Tab'/);
  assert.match(app, /setAttribute\('inert',''\)/);
  assert.match(app, /log_uti_document_event/);
  assert.match(app, /print_requested','admission_statement/);
  assert.match(app, /print_view_opened','settlement_sheet/);
  assert.match(app, /pdf_downloaded','settlement_pdf/);
  assert.equal(app.includes('href="${pdfUrl}"'), false, 'atalho de PDF sem auditoria não pode reaparecer');
});

test('exportação administrativa de dados é auditada e limitada', () => {
  const app = read('src/imec-uti/app.ts');
  const sql = read('supabase/migrations/20261008125711_package6_secure_admin_json_export.sql');
  assert.ok(app.includes("rpc('log_uti_data_export'"));
  assert.ok(app.includes("window.confirm('Esta exportação"));
  assert.ok(app.includes('o download foi bloqueado'));
  assert.ok(sql.includes('private.is_admin()'));
  assert.ok(sql.includes('revoke all on function public.log_uti_data_export() from public, anon'));
});

test('interface respeita safe-area, foco visível e preferência de movimento', () => {
  const css = read('src/imec-uti/styles.css');
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /safe-area-inset-left/);
  assert.match(css, /safe-area-inset-right/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /font-family:\s*system-ui/);
  assert.equal(css.includes('font-family: Inter,'), false);
});
