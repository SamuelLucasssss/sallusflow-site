import test from 'node:test';
import assert from 'node:assert/strict';
import {
  balanceMeta,
  bedLabel,
  bedRate,
  cpfMask,
  late,
  newAdmissionEstimate,
  parseLocal,
  roleLabel,
  sameDay,
  healthStatusMeta,
  alertStatusMeta,
  healthWindowSummary,
} from '../src/imec-uti/domain.ts';

test('hotelaria respeita a tabela por leito', () => {
  assert.equal(bedRate(10), 400);
  assert.equal(bedRate(16), 400);
  assert.equal(bedRate(17), 500);
  assert.equal(bedRate(19), 500);
  assert.equal(bedLabel(16), 'Hotelaria individual');
  assert.equal(bedLabel(17), 'Hotelaria com suíte');
});

test('entrada após 18h sugere meia diária', () => {
  assert.equal(late('2026-10-06T17:59'), false);
  assert.equal(late('2026-10-06T18:00'), true);
  assert.equal(late('2026-10-06T23:45'), true);
});

test('timezone operacional é America/Sao_Paulo', () => {
  assert.equal(parseLocal('2026-10-06T07:00'), '2026-10-06T10:00:00.000Z');
  assert.equal(sameDay('2026-10-06T02:30:00.000Z', '2026-10-05T23:50:00-03:00'), true);
});

test('cadastro retroativo reproduz o caso real sem contar o dia atual provisório', () => {
  const now = new Date('2026-10-06T16:00:00-03:00');
  const result = newAdmissionEstimate('2026-09-20T20:21', { value: 400, half: true }, now);
  assert.equal(result.additional, 15);
  assert.equal(result.units, 15.5);
  assert.equal(result.total, 6200);
  assert.equal(result.retro, true);
});

test('saldo distingue dívida, quitação e crédito ao paciente', () => {
  assert.deepEqual(balanceMeta(1250), { label: 'Saldo a receber', amount: 1250, kind: 'debt' });
  assert.deepEqual(balanceMeta(0), { label: 'Saldo', amount: 0, kind: 'paid' });
  assert.deepEqual(balanceMeta(-100), { label: 'Crédito a devolver', amount: 100, kind: 'credit' });
});

test('formatação de CPF e papéis permanece estável', () => {
  assert.equal(cpfMask('37723529104'), '377.235.291-04');
  assert.equal(roleLabel('admin'), 'Administrador');
  assert.equal(roleLabel('commercial'), 'Comercial');
  assert.equal(roleLabel('operator'), 'Operacional');
});


test('saúde operacional diferencia ok, alerta e crítico', () => {
  const now = new Date('2026-10-07T18:00:00.000Z');
  assert.deepEqual(healthStatusMeta('ok', '2026-10-07T17:50:00.000Z', now), { label: 'Saudável', tone: 'good', stale: false });
  assert.deepEqual(healthStatusMeta('warn', '2026-10-07T17:50:00.000Z', now), { label: 'Atenção', tone: 'warn', stale: false });
  assert.deepEqual(healthStatusMeta('critical', '2026-10-07T17:50:00.000Z', now), { label: 'Crítico', tone: 'bad', stale: false });
});

test('health check com mais de 45 minutos é tratado como atrasado', () => {
  const now = new Date('2026-10-07T18:00:00.000Z');
  assert.deepEqual(healthStatusMeta('ok', '2026-10-07T17:14:59.000Z', now), { label: 'Monitor atrasado', tone: 'warn', stale: true });
});


test('alertas distinguem ação pendente, reconhecimento e resolução', () => {
  assert.deepEqual(alertStatusMeta('critical','open'), { label:'Crítico', tone:'bad', needsAction:true });
  assert.deepEqual(alertStatusMeta('warn','open'), { label:'Atenção', tone:'warn', needsAction:true });
  assert.deepEqual(alertStatusMeta('critical','acknowledged'), { label:'Reconhecido', tone:'bad', needsAction:false });
  assert.deepEqual(alertStatusMeta('warn','resolved'), { label:'Resolvido', tone:'neutral', needsAction:false });
});

test('janela de saúde calcula disponibilidade observada sem esconder alertas', () => {
  assert.deepEqual(
    healthWindowSummary([{status:'ok'},{status:'ok'},{status:'warn'},{status:'critical'}]),
    { total:4, ok:2, warn:1, critical:1, healthyPct:50 },
  );
  assert.deepEqual(healthWindowSummary([]), { total:0, ok:0, warn:0, critical:0, healthyPct:0 });
});
