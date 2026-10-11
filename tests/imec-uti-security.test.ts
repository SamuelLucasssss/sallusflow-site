import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IDLE_TIMEOUT_MS,
  cleanAuthRedirectUrl,
  isIdle,
  jwtAal,
  canBackgroundRefresh,
  totpQrImageSrc,
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


test('QR MFA do Supabase é convertido de SVG bruto para data URL privada', () => {
  const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="M0 0h48v48H0z"/></svg>';
  const uri=totpQrImageSrc(svg);
  assert.ok(uri.startsWith('data:image/svg+xml;charset=utf-8,'));
  assert.equal(decodeURIComponent(uri.slice(uri.indexOf(',')+1)),svg);
  assert.match(uri,/%3Csvg/);
  assert.equal(totpQrImageSrc('data:image/svg+xml;utf-8,'+encodeURIComponent(svg)),uri);
  const xml='<?xml version="1.0" encoding="UTF-8"?>\\n'+svg;
  assert.equal(decodeURIComponent(totpQrImageSrc(xml).split(',')[1]),xml);
});

test('QR MFA rejeita URLs externas, SVG ativo e dados inválidos', () => {
  for(const value of [
    '',
    'https://qr.example.com/?secret=example',
    'javascript:alert(1)',
    '<svg><script>alert(1)</script></svg>',
    '<svg onload="alert(1)"></svg>',
    '<svg><foreignObject>teste</foreignObject></svg>',
    '<svg><image href="https://example.org/track"/></svg>',
    '<!DOCTYPE svg><svg></svg>',
    'data:image/png;base64,AAAA'
  ]) assert.throws(()=>totpQrImageSrc(value));
});

test('interface MFA usa URL de imagem, oculta chave manual e disponibiliza fallback', () => {
  const fs=require('node:fs');
  const app=fs.readFileSync('src/imec-uti/app.ts','utf8');
  const vercel=fs.readFileSync('vercel.json','utf8');
  assert.match(app,/totpQrImageSrc\(enrolled\?\.totp\?\.qr_code\)/);
  assert.match(app,/id="mfaQrImage"/);
  assert.match(app,/id="mfaQrFallback"/);
  assert.match(app,/<details><summary>Usar chave manual/);
  assert.match(vercel,/img-src 'self' data:/);
});
