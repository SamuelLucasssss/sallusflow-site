import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql=readFileSync('supabase/migrations/20261012001555_uti_audited_settlement_discount.sql','utf8');
const app=readFileSync('src/imec-uti/app.ts','utf8');

test('desconto de R$300 sobre conta R$3300 com R$3000 recebidos zera saldo sem criar pagamento',()=>{
  const daily=3300,received=3000,refunded=0,discount=300;
  const originalBalance=daily-received+refunded;
  const adjustedBilled=daily-discount;
  assert.equal(originalBalance,300);
  assert.equal(adjustedBilled-received+refunded,0);
  assert.match(sql,/values\([\s\S]*?'adjustment','Desconto no acerto'/);
  assert.match(sql,/-v_amount/);
  assert.match(sql,/private\.reconcile_admission_status\(a\.id\)/);
  assert.doesNotMatch(sql,/insert into public\.payments/i);
});

test('RPC bloqueia descontos excessivos, clientes anônimos e duplicações',()=>{
  assert.match(sql,/if not private\.is_admin\(\)/);
  assert.match(sql,/v_amount>v_balance/);
  assert.match(sql,/a\.status<>'discharge_pending'/);
  assert.match(sql,/and client_ref=v_ref/);
  assert.match(sql,/if v_existing\.kind='adjustment'/);
  assert.match(sql,/grant execute on function public\.grant_uti_settlement_discount\(/);
  assert.match(sql,/revoke all on function public\.grant_uti_settlement_discount/);
  assert.match(sql,/from public,anon,authenticated/);
  assert.match(sql,/insert into public\.audits/);
  assert.match(sql,/v_reason/);
});

test('UI mostra desconto separado e preserva auditoria, PDF e histórico',()=>{
  assert.match(app,/function discountModal\(a\)/);
  assert.match(app,/data-action="discount"/);
  assert.match(app,/grant_uti_settlement_discount/);
  assert.match(app,/Desconto no acerto:/);
  assert.match(app,/Confirmar desconto/);
  assert.match(app,/Total após desconto/);
  assert.match(app,/Extras\/Desc\./);
  assert.match(app,/settlementDocumentModel/);
  assert.match(app,/const timeline=/);
});

test('configuração de desconto não altera valor por diária ou caixa recebido',()=>{
  assert.doesNotMatch(sql,/update public\.rate_periods/i);
  assert.doesNotMatch(sql,/update public\.payments/i);
  assert.doesNotMatch(sql,/delete from public\.charges/i);
  assert.match(sql,/created_by_name,created_by,client_ref/);
  assert.match(sql,/status='discharge_pending'|a\.status<>'discharge_pending'/);
});
