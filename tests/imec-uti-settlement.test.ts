import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentMethodLabel, installmentSummary, validateInstallmentDates } from '../src/imec-uti/payment-details.ts';
import { settlementHarness, sampleSettlement } from './fixtures/imec-uti-settlement.ts';

test('formas de recebimento distinguem crédito, débito e cartão legado',()=>{
  assert.equal(paymentMethodLabel({method:'Cartão',cardType:'credit',installmentDates:['2026-11-07','2026-12-07']}),'Cartão de crédito · 2x');
  assert.equal(paymentMethodLabel({method:'Cartão',cardType:'debit'}),'Cartão de débito');
  assert.equal(paymentMethodLabel({method:'Cartão'}),'Cartão (tipo não informado)');
  assert.equal(installmentSummary({method:'PIX'}),'');
  assert.equal(installmentSummary({cardType:'credit',installmentDates:['2026-11-07']}),'Vencimentos: 1ª 07/11/2026');
});
test('vencimentos exigem datas válidas, posteriores ao recebimento e ordenadas',()=>{
  assert.equal(validateInstallmentDates(['2026-10-07','2026-11-07'],'2026-10-07'),null);
  for(const dates of [[],[''],['2026-02-30'],['2026-10-06'],['2026-10-07','2026-10-07'],['2026-11-07','2026-10-07'],Array(25).fill('2026-11-07')]){
    assert.ok(validateInstallmentDates(dates,'2026-10-07'));
  }
});
test('modelo preserva cada recebimento e separa reembolsos sem ocultar datas',()=>{
  const model=settlementHarness().model({...sampleSettlement,refunds:[{occurredAt:'2026-10-08T14:00:00Z',amount:100,method:'PIX'}]});
  assert.equal(model.movements.length,5);
  assert.equal(model.movements[0].date,'05/10/2026');
  assert.match(model.movements[1].schedule,/3ª 07\/01\/2027/);
  assert.equal(model.movements[4].total,-100);
  assert.match(model.movements[4].method,/Reembolso/);
});
test('impressão exibe CPF discreto, parcelas e vencimentos com saída auditada',async()=>{
  const harness=settlementHarness('<Maria & Helena>');
  const html=await harness.print();
  assert.match(html,/class="patient-cpf">CPF 123\.456\.789-00/);
  assert.match(html,/&lt;Maria &amp; Helena&gt;/);
  assert.match(html,/Cartão de crédito · 3x/);
  assert.match(html,/3ª 07\/01\/2027/);
  assert.match(html,/Cartão de débito/);
  assert.deepEqual(harness.events,['print_view_opened']);
  await harness.listeners.get('settlementPrintBtn')!();
  assert.deepEqual(harness.events,['print_view_opened','print_requested']);
});
test('PDF contém CPF e todos os vencimentos e pagina contas extensas',()=>{
  const harness=settlementHarness();
  const text=Buffer.from(harness.pdf()).toString('latin1');
  assert.match(text,/CPF 123\.456\.789-00/);
  assert.match(text,/3ª 07\/01\/2027/);
  const payments=Array.from({length:45},(_,i)=>({...sampleSettlement.payments[1],amount:i+1}));
  const long=Buffer.from(harness.pdf({...sampleSettlement,payments})).toString('latin1');
  assert.ok(Number(long.match(/\/Count (\d+)/)![1])>1);
  assert.equal((long.match(/Cartão de crédito/g)||[]).length,45);
  assert.equal((long.match(/3ª 07\/01\/2027/g)||[]).length,45);
  assert.ok((long.match(/FORMA DE RECEBIMENTO/g)||[]).length>1);
});
