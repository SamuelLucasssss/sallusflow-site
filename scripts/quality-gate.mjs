import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const fail = (message) => errors.push(message);
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const pkg = JSON.parse(read('package.json'));
for (const [group, deps] of Object.entries({ dependencies: pkg.dependencies || {}, devDependencies: pkg.devDependencies || {} })) {
  for (const [name, version] of Object.entries(deps)) {
    if (version === 'latest' || /^[~^*]/.test(String(version))) fail(`${group} ${name} não está fixado: ${version}`);
  }
}
if (!pkg.engines?.node?.includes('22')) fail('Node.js 22 não está declarado em engines.');

const legacyHtml = path.join(root, 'public/imec-uti/index.html');
if (fs.existsSync(legacyHtml)) fail('HTML monolítico legado ainda existe em public/imec-uti/index.html.');

const app = read('src/imec-uti/app.ts');
const functionNames = [...app.matchAll(/(?:^|\n)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
const counts = new Map();
for (const name of functionNames) counts.set(name, (counts.get(name) || 0) + 1);
for (const [name, count] of counts) if (count > 1) fail(`Função duplicada no app.ts: ${name} x${count}`);

for (const token of [
  'imec-uti-standalone-v1',
  'demoData(',
  'ensureCharges(',
  "authFetch('signup'",
  'function renderSignup',
  'save();',
  "data-action=\"import\"",
  "data-action=\"clear\"",
]) {
  if (app.includes(token)) fail(`Código legado/proibido encontrado: ${token}`);
}

for (const required of [
  "rpc('add_uti_refund'",
  "rpc('discharge_uti'",
  'p_expected_version:Number(fresh.accountVersion)',
  "edge('invite-uti-user'",
  'Entrada retroativa',
  'let data=blankData()',
  'let authState=null',
  'let remoteBusy=false',
  'async function securityGate()',
  'async function renderMfaEnrollment()',
  'async function renderMfaChallenge(',
  'async function checkPasswordSafety(',
  'IDLE_TIMEOUT_MS',
  'parseAuthRedirect',
  'operationalHealthPanel',
  'system_health_checks?select=id,checked_at,status,issues,metrics,source',
  'system_alerts?select=id,alert_key,code,severity,message,details,status',
  "rpc('acknowledge_uti_alert'",
  'observabilityPanel',
  'systemAlertBanner',
]) {
  if (!app.includes(required)) fail(`Proteção crítica ausente do app: ${required}`);
}

const security = read('src/imec-uti/security.ts');
for (const required of ['IDLE_TIMEOUT_MS = 20 * 60 * 1000','passwordPolicy','sha1Hex','pwnedCountFromRange','parseAuthRedirect','jwtAal']) {
  if (!security.includes(required)) fail(`Primitiva de segurança ausente: ${required}`);
}
const resilience = read('supabase/migrations/20261007175954_package4_operational_resilience.sql');
for (const required of ['system_health_checks','private.run_uti_health_check','imec-uti-health-check','*/15 * * * *','90 days']) {
  if (!resilience.includes(required)) fail(`Proteção de resiliência ausente: ${required}`);
}
const domain = read('src/imec-uti/domain.ts');
if (!domain.includes('healthStatusMeta')) fail('Sem semântica de status para o monitor operacional.');

const observability = read('supabase/migrations/20261008110831_package5_observability_alert_lifecycle.sql');
for (const required of ['system_alerts','system_alerts_unresolved_key_uidx','system_health_alert_reconcile','imec-uti-observability-watchdog','acknowledge_uti_alert','180 days']) {
  if (!observability.includes(required)) fail(`Proteção de observabilidade ausente: ${required}`);
}
for (const required of ['alertStatusMeta','healthWindowSummary']) {
  if (!domain.includes(required)) fail(`Sem semântica gerencial de observabilidade: ${required}`);
}

const observabilityIndexes = read('supabase/migrations/20261008111321_package5_observability_index_foreign_keys.sql');
for (const required of ['system_alerts_health_check_id_idx','system_alerts_acknowledged_by_idx']) {
  if (!observabilityIndexes.includes(required)) fail(`Índice de observabilidade ausente: ${required}`);
}

const observabilityHardening = read('supabase/migrations/20261008111820_package5_observability_race_and_failure_isolation.sql');
for (const required of ['pg_advisory_xact_lock','system_health_observability_enrichment','OBSERVABILITY_WATCHDOG_FAILURES','exception when others','Health check #']) {
  if (!observabilityHardening.includes(required)) fail(`Hardening final de observabilidade ausente: ${required}`);
}
if (!app.includes("healthMeta=healthStatusMeta(data.health?.status,data.health?.checkedAt)")) fail('Banner não possui fallback independente do pipeline de alertas.');

const package6 = read('supabase/migrations/20261008124228_package6_document_output_audit.sql');
for (const required of ['log_uti_document_event','private.is_active_member()','print_requested','print_view_opened','pdf_downloaded','admission_statement','settlement_sheet','settlement_pdf']) {
  if (!package6.includes(required)) fail(`Auditoria documental do Pacote 6 ausente: ${required}`);
}
for (const required of ['MODAL_FOCUSABLE','aria-modal="true"',"e.key==='Escape'","e.key!=='Tab'","setAttribute('inert','')","rpc('log_uti_document_event'","register('/imec-uti/sw.js'","updateNetworkStatus"]) {
  if (!app.includes(required)) fail(`Refinamento do Pacote 6 ausente no app: ${required}`);
}
const exportAudit = read('supabase/migrations/20261008125711_package6_secure_admin_json_export.sql');
for (const required of ['log_uti_data_export','private.is_admin()','Exportação administrativa de dados']) {
  if (!exportAudit.includes(required)) fail(`Proteção de exportação administrativa ausente: ${required}`);
}
if (!app.includes("rpc('log_uti_data_export'")) fail('Exportação JSON de dados pessoais não está auditada.');
if (!app.includes("window.confirm('Esta exportação")) fail('Exportação JSON sem confirmação contextual.');
if (app.includes('href="${pdfUrl}"')) fail('Existe atalho de download de PDF sem auditoria no fluxo de impressão.');

const package6Page = read('src/pages/imec-uti/index.astro');
for (const required of ['manifest.webmanifest','class="skip-link"','id="networkStatus"','aria-live="polite"']) {
  if (!package6Page.includes(required)) fail(`Shell acessível/PWA incompleto: ${required}`);
}

const package6Css = read('src/imec-uti/styles.css');
for (const required of ['safe-area-inset-top','safe-area-inset-bottom','safe-area-inset-left','safe-area-inset-right',':focus-visible','prefers-reduced-motion: reduce','.network-status','.skip-link']) {
  if (!package6Css.includes(required)) fail(`CSS de acessibilidade/safe-area ausente: ${required}`);
}
if (package6Css.includes('font-family: Inter,')) fail('Fonte Inter é declarada sem estar carregada; use stack de sistema.');

const pwaManifest = JSON.parse(read('public/imec-uti/manifest.webmanifest'));
if (pwaManifest.start_url !== '/imec-uti/' || pwaManifest.scope !== '/imec-uti/' || pwaManifest.display !== 'standalone') fail('Manifest do IMEC UTI não está restrito ao app.');
if (!Array.isArray(pwaManifest.icons) || pwaManifest.icons.length < 2) fail('Manifest do IMEC UTI sem ícones normal/maskable.');

const pwaWorker = read('public/imec-uti/sw.js');
for (const forbidden of ['caches.open','cache.put','.addAll(','indexedDB']) {
  if (pwaWorker.includes(forbidden)) fail(`PWA online-only não pode persistir dados: ${forbidden}`);
}
for (const required of ["fetch(event.request,{cache:'no-store'})",'Sem conexão','Cache-Control']) {
  if (!pwaWorker.includes(required)) fail(`Service worker online-only incompleto: ${required}`);
}

const externalMonitor = read('scripts/imec-uti-public-monitor.mjs');
const externalMonitorRunner = read('scripts/imec-uti-monitor-runner.mjs');
const externalMonitorWorkflow = read('.github/workflows/imec-uti-uptime.yml');
for (const required of ['https://www.sallusflow.com.br', "cache: 'no-store'", "redirect: 'manual'", 'MANIFEST_SCOPE_INVALID', 'CSP_FRAME_PROTECTION_MISSING', 'SW_PERSISTENT_CACHE_DETECTED', 'MONITORED_RESOURCES']) {
  if (!externalMonitor.includes(required)) fail('Monitoramento público do Pacote 7 incompleto: ' + required);
}
for (const required of ['INCIDENT_MARKER', 'existingIncident', 'issues', 'state_reason', 'No open incident.']) {
  if (!externalMonitorRunner.includes(required)) fail('Ciclo de incidentes do Pacote 7 incompleto: ' + required);
}
for (const required of ["cron: '*/15 * * * *'", 'workflow_dispatch:', 'issues: write', 'contents: read', 'persist-credentials: false', 'node scripts/imec-uti-monitor-runner.mjs']) {
  if (!externalMonitorWorkflow.includes(required)) fail('Workflow externo do Pacote 7 incompleto: ' + required);
}
if (externalMonitor.includes('supabase.co') || externalMonitor.includes('auth/v1') || externalMonitor.includes('rest/v1')) fail('Monitor externo não deve acessar dados restritos.');

const incidentTest = read('tests/imec-uti-package7-incidents.test.ts');
for (const required of ["scenario('down')","scenario('existing')","scenario('recovered')","Incident opened: #42","Incident resolved: #42"]) {
  if (!incidentTest.includes(required)) fail('Teste de incidente do Pacote 7 ausente: ' + required);
}
if (!read('tests/fixtures/imec-uti-fake-fetch.mjs').includes('globalThis.fetch = async function testFetch')) fail('Teste de incidente não intercepta requisições externas.');

const vercelConfig = read('vercel.json');
for (const header of ['Content-Security-Policy','Strict-Transport-Security','X-Content-Type-Options','Permissions-Policy','frame-ancestors']) {
  if (!vercelConfig.includes(header)) fail(`Header de segurança ausente: ${header}`);
}
for (const edgePath of ['supabase/functions/invite-uti-user/index.ts','supabase/functions/password-pwned-range/index.ts']) {
  const edge = read(edgePath);
  if (!edge.includes('@supabase/supabase-js@2.117.2')) fail(`Dependência Supabase não fixada em ${edgePath}`);
}
if (!read('supabase/functions/invite-uti-user/index.ts').includes('aal !== "aal2"')) fail('Convite administrativo não exige AAL2.');
if (!read('supabase/functions/invite-uti-user/index.ts').includes('is_uti_admin_secure_session')) fail('Convite administrativo não valida sessão ativa no banco.');

const config = read('src/imec-uti/config.ts');
if (!config.includes('sb_publishable_')) fail('Frontend deve usar apenas chave publishable do Supabase.');
if (/service[_-]?role|sb_secret_/i.test(config)) fail('Segredo de Supabase encontrado no código cliente.');

const migrationDir = path.join(root, 'supabase/migrations');
const migrations = fs.readdirSync(migrationDir).filter((name) => name.endsWith('.sql')).sort();
if (migrations.length !== 33) fail(`Esperadas 33 migrations versionadas; encontradas ${migrations.length}.`);
if (new Set(migrations).size !== migrations.length) fail('Há migrations com nome duplicado.');

for (const file of migrations) {
  const sql = fs.readFileSync(path.join(migrationDir, file), 'utf8');
  if (/'[A-Za-z0-9+/]{40,}={0,2}'/.test(sql)) fail(`Possível material de credencial/base64 em ${file}`);
  if (/sb_secret_|service_role_key|SUPABASE_SERVICE_ROLE_KEY/i.test(sql)) fail(`Possível segredo em ${file}`);
}

if (errors.length) {
  console.error('\nQUALITY GATE FAILED\n- ' + errors.join('\n- '));
  process.exit(1);
}
console.log(`Quality gate OK: ${functionNames.length} funções únicas, ${migrations.length} migrations, dependências fixas.`);
