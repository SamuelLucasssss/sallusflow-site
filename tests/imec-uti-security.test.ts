import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IDLE_TIMEOUT_MS,
  cleanAuthRedirectUrl,
  isIdle,
  jwtAal,
  canBackgroundRefresh,
  parseAuthRedirect,
  passwordPolicy,
  pwnedCountFromRange,
} from '../src/imec-uti/security.ts';

function jwt(payload: Record<string, unknown>) {
  const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc(payload)}.`;
}

test('AAL do JWT distingue sessão simples de MFA', () => {
  assert.equal(jwtAal(jwt({ aal: 'aal1' })), 'aal1');
  assert.equal(jwtAal(jwt({ aal: 'aal2' })), 'aal2');
  assert.equal(jwtAal('inválido'), 'aal1');
});

test('callback implícito de convite/recuperação é interpretado sem vazar o hash', () => {
  const token = jwt({ aal: 'aal1', exp: 2_000_000_000 });
  const parsed = parseAuthRedirect(`https://www.sallusflow.com.br/imec-uti/#access_token=${token}&refresh_token=r1&type=invite&expires_in=3600`);
  assert.equal(parsed.type, 'invite');
  assert.equal(parsed.session?.access_token, token);
  assert.equal(cleanAuthRedirectUrl('https://www.sallusflow.com.br/imec-uti/#access_token=secret&type=recovery'), '/imec-uti/');
});

test('política de senha exige 12 caracteres e diversidade', () => {
  assert.equal(passwordPolicy('curta123!').ok, false);
  assert.equal(passwordPolicy('abcdefghijkl').ok, false);
  assert.equal(passwordPolicy('SenhaMuitoForte123!').ok, true);
});

test('parser de HaveIBeenPwned encontra apenas o sufixo SHA1 exato', () => {
  const full = 'ABCDE' + 'F'.repeat(35);
  const range = `${'A'.repeat(35)}:12\n${'F'.repeat(35)}:987\n`;
  assert.equal(pwnedCountFromRange(range, full), 987);
  assert.equal(pwnedCountFromRange('', full), 0);
});

test('sessão expira após 20 minutos de inatividade', () => {
  const now = 1_000_000_000;
  assert.equal(IDLE_TIMEOUT_MS, 1_200_000);
  assert.equal(isIdle(now - IDLE_TIMEOUT_MS + 1, now), false);
  assert.equal(isIdle(now - IDLE_TIMEOUT_MS, now), true);
});

test('cadastro ou desafio MFA (AAL1) nunca reinicia por polling em segundo plano', () => {
  const aal1=jwt({ aal:'aal1' }), aal2=jwt({ aal:'aal2' });
  for(const busy of [true,false]){
    for(const modal of [true,false]){
      for(const ready of [true,false]){
        assert.equal(canBackgroundRefresh(aal1,busy,modal,ready),false,
          'AAL1 deve preservar QR Code, código e autenticação em andamento');
      }
    }
  }
  assert.equal(canBackgroundRefresh(aal2,false,false,true),true);
  assert.equal(canBackgroundRefresh(aal2,true,false,true),false);
  assert.equal(canBackgroundRefresh(aal2,false,true,true),false);
  assert.equal(canBackgroundRefresh(aal2,false,false,false),false);
  assert.equal(canBackgroundRefresh(null,false,false,true),false);
});
