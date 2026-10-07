import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ABSOLUTE_SESSION_MS,
  IDLE_TIMEOUT_MS,
  pwnedCountFromRange,
  readAuthLinkType,
  sessionExpiryReason,
  sha1Hex,
  validatePasswordPolicy,
} from '../src/imec-uti/security.ts';

test('política de senha exige 12 caracteres e quatro classes', () => {
  assert.equal(validatePasswordPolicy('Curta1!').valid, false);
  assert.equal(validatePasswordPolicy('SemSimbolo123A').valid, false);
  assert.equal(validatePasswordPolicy('Forte#Hospital2026').valid, true);
});

test('SHA-1 do navegador produz o formato exigido pelo HIBP k-anonymity', async () => {
  const hash = await sha1Hex('password');
  assert.equal(hash, '5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8');
  assert.equal(hash.slice(0, 5), '5BAA6');
  assert.equal(hash.slice(5).length, 35);
});

test('range HIBP é comparado somente pelo sufixo', () => {
  const suffix = '1E4C9B93F3F0682250B6CF8331B7EE68FD8';
  assert.equal(pwnedCountFromRange(`${suffix}:3303003\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:1`, suffix), 3303003);
  assert.equal(pwnedCountFromRange('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:1', suffix), 0);
});

test('timeout distingue inatividade de limite absoluto', () => {
  const now = 100_000_000;
  assert.equal(sessionExpiryReason(now, now - 60_000, now - IDLE_TIMEOUT_MS - 1), 'idle');
  assert.equal(sessionExpiryReason(now, now - ABSOLUTE_SESSION_MS - 1, now - 1_000), 'absolute');
  assert.equal(sessionExpiryReason(now, now - 60_000, now - 60_000), null);
});

test('tipo de link reconhece convite e recuperação no hash ou query', () => {
  assert.equal(readAuthLinkType({ search: '?type=recovery', hash: '' }), 'recovery');
  assert.equal(readAuthLinkType({ search: '', hash: '#access_token=x&type=invite' }), 'invite');
  assert.equal(readAuthLinkType({ search: '', hash: '#type=signup' }), null);
});
