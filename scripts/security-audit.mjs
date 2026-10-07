import { spawnSync } from 'node:child_process';

const result = spawnSync('npm', ['audit', '--json'], {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
});

let report;
try {
  report = JSON.parse(result.stdout || '{}');
} catch {
  console.error(result.stdout || result.stderr || 'npm audit não retornou JSON válido.');
  process.exit(2);
}

const vulnerabilities = Object.entries(report.vulnerabilities || {})
  .map(([name, value]) => ({
    name,
    severity: value.severity,
    direct: Boolean(value.isDirect),
    range: value.range,
    fix: value.fixAvailable,
    via: (value.via || []).map((item) => typeof item === 'string' ? item : item.title).slice(0, 4),
  }))
  .sort((a, b) => {
    const rank = { critical: 4, high: 3, moderate: 2, low: 1 };
    return (rank[b.severity] || 0) - (rank[a.severity] || 0) || a.name.localeCompare(b.name);
  });

if (!vulnerabilities.length) {
  console.log('npm audit: 0 vulnerabilidades conhecidas.');
  process.exit(0);
}

console.log('npm audit — vulnerabilidades encontradas:');
for (const v of vulnerabilities) {
  console.log(`- [${v.severity.toUpperCase()}] ${v.name} ${v.range} | direct=${v.direct} | fix=${JSON.stringify(v.fix)}`);
  if (v.via.length) console.log(`  via: ${v.via.join(' | ')}`);
}

const meta = report.metadata?.vulnerabilities || {};
console.log('Resumo:', JSON.stringify(meta));

const blocking = vulnerabilities.filter((v) => v.severity === 'critical' || v.severity === 'high');
if (blocking.length) {
  console.error(`Security gate bloqueado: ${blocking.length} pacote(s) High/Critical.`);
  process.exit(1);
}
