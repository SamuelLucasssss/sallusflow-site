import fs from 'node:fs';
import { auditPublicSite, PRODUCTION_ORIGIN } from './imec-uti-public-monitor.mjs';

const INCIDENT_TITLE = 'IMEC UTI | Monitor externo: indisponibilidade detectada';
const INCIDENT_MARKER = '<!-- imec-uti-external-monitor-v1 -->';
const API = 'https://api.github.com';
const output = (message) => process.stdout.write(message + '\n');

function summary(message) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, message + '\n');
  }
}
async function github(path, options = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN_NOT_CONFIGURED');
  const response = await fetch(API + path, {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('GITHUB_API_HTTP_' + response.status);
  return response.json();
}
function repoPath() {
  const repo = process.env.GITHUB_REPOSITORY || '';
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) throw new Error('INVALID_GITHUB_REPOSITORY');
  return '/repos/' + repo;
}
async function existingIncident(repo) {
  for (let page = 1; page <= 5; page++) {
    const issues = await github(repo + '/issues?state=open&per_page=100&page=' + page);
    const match = issues.find((i) => !i.pull_request && i.title === INCIDENT_TITLE && (i.body || '').includes(INCIDENT_MARKER));
    if (match) return match;
    if (issues.length < 100) break;
  }
  return null;
}

const report = await auditPublicSite();
const failures = report.results.filter((r) => !r.ok);
summary('## IMEC UTI — monitoramento externo');
summary('**' + (report.healthy ? 'SAUDÁVEL' : 'FALHA') + '** · ' + report.checkedAt + ' · ' + PRODUCTION_ORIGIN + '/imec-uti/');
summary('');
summary('| Superfície pública | Estado | Código |');
summary('|---|---|---|');
for (const row of report.results) {
  summary('| ' + row.path + ' | ' + (row.ok ? 'OK' : 'Falha') + ' | ' + row.code + ' |');
}
output('Public monitoring: ' + (report.healthy ? 'healthy' : 'FAILED') + '; endpoints=' + report.results.length + '; failures=' + failures.length);

try {
  if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY) {
    const repo = repoPath();
    const incident = await existingIncident(repo);
    if (!report.healthy && !incident) {
      const body = [
        INCIDENT_MARKER,
        '### Monitor externo do IMEC UTI detectou falha',
        'Serviço: ' + PRODUCTION_ORIGIN + '/imec-uti/',
        'Horário UTC: ' + report.checkedAt,
        '',
        'Falhas observadas (somente superfícies públicas):',
        ...failures.map((f) => '- ' + f.path + ': ' + f.code),
        '',
        'Não foram consultados ou anexados dados de pacientes, autenticação nem informações financeiras.',
        'Investigar Vercel, domínio, CDN, headers de segurança, PWA e último deploy.',
        'Esta issue será fechada automaticamente após a recuperação.'
      ].join('\n');
      const created = await github(repo + '/issues', { method: 'POST', body: { title: INCIDENT_TITLE, body } });
      output('Incident opened: #' + created.number);
    } else if (report.healthy && incident) {
      await github(repo + '/issues/' + incident.number + '/comments', { method: 'POST', body: { body: 'Monitor externo confirmou recuperação em ' + report.checkedAt + ' UTC; todas as verificações públicas passaram.' } });
      await github(repo + '/issues/' + incident.number, { method: 'PATCH', body: { state: 'closed', state_reason: 'completed' } });
      output('Incident resolved: #' + incident.number);
    } else {
      output(report.healthy ? 'No open incident.' : 'Existing incident remains open.');
    }
  } else {
    output('GitHub Issue integration not configured; using exit status only.');
  }
} catch (e) {
  output('Incident tracker failed: ' + (e?.message || 'UNKNOWN_ERROR'));
  process.exitCode = 1;
}
if (!report.healthy) process.exitCode = 1;
