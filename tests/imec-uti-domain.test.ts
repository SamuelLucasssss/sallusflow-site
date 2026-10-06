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
