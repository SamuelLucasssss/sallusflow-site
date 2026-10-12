import {describe,it,before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {isolatedDatabase,createSyntheticAdmission} from './fixtures/imec-uti-database.ts';

describe('recebimentos posteriores e previstos — PostgreSQL isolado',()=>{
 let f:Awaited<ReturnType<typeof isolatedDatabase>>;
 let id:string;
 const future=()=>new Date(Date.now()+2*86400000).toISOString();
 const actual=()=>new Date(Date.now()-60000).toISOString();
 before(async()=>{f=await isolatedDatabase();});
 after(async()=>{await f?.db.close();});
 beforeEach(async()=>{
   await f.db.exec('reset role;begin');await f.asUser('admin');
   id=await createSyntheticAdmission(f.db);
   const s=(await f.db.query('select public.preview_uti_settlement($1,$2::timestamptz) as s',[id,'2026-10-03T12:00:00-03:00'])).rows[0].s;
   await f.db.query('select public.discharge_uti($1,$2::timestamptz,$3::bigint)',[id,s.dischargeAt,s.accountVersion]);
 });
 afterEach(async()=>{await f.db.exec('rollback;reset role');});
 const schedule=async(amount=800,ref='scheduled-synthetic-reference',method='PIX',dates:string[]=[],when=future())=>
   (await f.db.query('select public.schedule_uti_receipt($1,$2::timestamptz,$3,$4,$5::date[],$6,$7) as id',[id,when,amount,method,dates,'Previsão sintética',ref])).rows[0].id;
 const confirm=async(s:string,when=actual(),method='PIX',dates:string[]=[])=>
   (await f.db.query('select public.confirm_uti_receipt($1,$2::timestamptz,$3,$4::date[],$5) as status',[s,when,method,dates,'Confirmado sinteticamente'])).rows[0].status;
 const rejects=async(work:()=>Promise<unknown>,pattern:RegExp)=>{
   await f.db.exec('savepoint expected_error');
   try{await assert.rejects(work,pattern);}finally{await f.db.exec('rollback to savepoint expected_error;release savepoint expected_error');}
 };
 const financial=async()=> (await f.db.query(`select a.status,
   (select coalesce(sum(amount),0)::float8 from public.charges where admission_id=a.id and cancelled_at is null) as billed,
   (select coalesce(sum(amount),0)::float8 from public.payments where admission_id=a.id and cancelled_at is null) as received
   from public.admissions a where id=$1`,[id])).rows[0];

 it('pagamento real dias após a alta quita sem gerar diárias posteriores',async()=>{
   await f.db.query('select public.add_uti_payment($1,$2::timestamptz,$3,$4,$5,$6)',[id,actual(),800,'PIX',null,'actual-late-receipt']);
   assert.deepEqual(await financial(),{status:'finalized',billed:800,received:800});
 });
 it('previsão futura não cria pagamento, não reduz saldo e não finaliza',async()=>{
   await schedule();assert.deepEqual(await financial(),{status:'discharge_pending',billed:800,received:0});
   assert.equal((await f.db.query('select count(*)::int as n from public.payments where admission_id=$1',[id])).rows[0].n,0);
 });
 it('datas infinitas não podem contaminar previsões ou parcelas confirmadas',async()=>{
   await rejects(()=>schedule(800,'infinite-future-schedule','PIX',[],'infinity'),/expected_finite/);
   await rejects(()=>schedule(800,'infinite-card-schedule','credit',['infinity']),/installments_finite/);
   const s=await schedule();await rejects(()=>confirm(s,actual(),'credit',['infinity']),/installments_finite/);
   assert.equal((await financial()).received,0);
 });
 it('confirmar agora usa a data real e retry não duplica após a finalização',async()=>{
   const when=actual(),s=await schedule();assert.equal(await confirm(s,when),'finalized');assert.equal(await confirm(s,when),'finalized');
   assert.deepEqual(await financial(),{status:'finalized',billed:800,received:800});
   assert.equal((await f.db.query('select count(*)::int as n from public.payments where admission_id=$1',[id])).rows[0].n,1);
   assert.equal((await f.db.query("select count(*)::int as n from public.audits where admission_id=$1 and action='Recebimento previsto confirmado'",[id])).rows[0].n,1);
   await rejects(()=>confirm(s,'2026-10-04T12:00:00-03:00'),/outros dados/);
 });
 it('não confirma data futura ou anterior à entrada',async()=>{
   const s=await schedule();await rejects(()=>confirm(s,future()),/sem data futura/);
   await rejects(()=>confirm(s,'2026-09-30T12:00:00-03:00'),/anterior à entrada/);
   assert.equal((await financial()).received,0);
 });
 it('previsões parciais reservam o saldo e só suas confirmações movimentam a conta',async()=>{
   const when=future(),s=await schedule(300,'partial-schedule-one','PIX',[],when);
   assert.equal(await schedule(300,'partial-schedule-one','PIX',[],when),s);
   await rejects(()=>schedule(501,'excess-schedule-two'),/supera o saldo/);
   const second=await schedule(500,'partial-schedule-two');
   assert.equal(await confirm(s),'discharge_pending');assert.equal((await financial()).received,300);
   assert.equal(await confirm(second),'finalized');assert.equal((await financial()).received,800);
 });
 it('cancelamento preserva a previsão e não cria movimentação financeira',async()=>{
   const s=await schedule();await f.db.query('select public.cancel_uti_receipt($1,$2)',[s,'Família alterou a previsão']);
   await f.db.query('select public.cancel_uti_receipt($1,$2)',[s,'Família alterou a previsão']);
   await rejects(()=>confirm(s),/cancelada/);
   assert.equal((await financial()).received,0);
   assert.equal((await f.db.query('select status from public.scheduled_receipts where id=$1',[s])).rows[0].status,'cancelled');
 });
 it('crédito planejado confirma parcelas e vencimentos em uma transação',async()=>{
   const expected=future();const date=new Date(expected);date.setUTCMonth(date.getUTCMonth()+1);
   const dates=[date.toISOString().slice(0,10)];date.setUTCMonth(date.getUTCMonth()+1);dates.push(date.toISOString().slice(0,10));
   const s=await schedule(800,'planned-card-synthetic','credit',dates,expected),when=actual();
   assert.equal(await confirm(s,when,'credit',dates),'finalized');assert.equal(await confirm(s,when,'credit',dates),'finalized');
   const payment=(await f.db.query('select method,card_type,cardinality(installment_dates) as n from public.payments where admission_id=$1',[id])).rows[0];
   assert.deepEqual(payment,{method:'Cartão',card_type:'credit',n:2});
 });
 it('operacional, inativo e anônimo não alteram previsões; escrita direta é negada',async()=>{
   const s=await schedule();
   await f.asUser('operator');await rejects(()=>confirm(s),/perfil não pode/);await rejects(()=>schedule(100,'operator-schedule-ref'),/perfil não pode/);
   await f.asUser('inactive');assert.equal((await f.db.query('select id from public.scheduled_receipts')).rows.length,0);await rejects(()=>confirm(s),/perfil não pode/);
   await f.asUser('anon');await rejects(()=>f.db.query('select id from public.scheduled_receipts'),/permission denied/);
   await f.asUser('commercial');await rejects(()=>f.db.query("update public.scheduled_receipts set status='confirmed' where id=$1",[s]),/permission denied/);
   assert.equal(await confirm(s),'finalized');
 });
 it('confirmação com saldo já quitado ou reduzido é recusada sem pagamentos extras',async()=>{
   const s=await schedule();
   await f.db.query('select public.grant_uti_settlement_discount($1,$2,$3,$4)',[id,300,'Negociação sintética autorizada','synthetic-scheduled-discount']);
   await rejects(()=>confirm(s),/maior que o saldo/);assert.equal((await financial()).received,0);
 });
});
