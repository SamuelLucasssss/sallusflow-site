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
]) {
  if (!app.includes(required)) fail(`Proteção crítica ausente do app: ${required}`);
}

const config = read('src/imec-uti/config.ts');
if (!config.includes('sb_publishable_')) fail('Frontend deve usar apenas chave publishable do Supabase.');
if (/service[_-]?role|sb_secret_/i.test(config)) fail('Segredo de Supabase encontrado no código cliente.');

const migrationDir = path.join(root, 'supabase/migrations');
const migrations = fs.readdirSync(migrationDir).filter((name) => name.endsWith('.sql')).sort();
if (migrations.length !== 23) fail(`Esperadas 23 migrations versionadas; encontradas ${migrations.length}.`);
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
