import {describe,it,before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {isolatedDatabase,createSyntheticAdmission} from './fixtures/imec-uti-database.ts';
import {parseSettlementTotal} from '../src/imec-uti/settlement-total.ts';

describe('total acordado do acerto — PostgreSQL isolado',()=>{
 let f:Awaited<ReturnType<typeof isolatedDatabase>>,id:string;
 before(async()=>{f=await isolatedDatabase()});after(async()=>{await f?.db.close()});
 beforeEach(async()=>{
   await f.db.exec('reset role;begin');await f.asUser('admin');
   id=await createSyntheticAdmission(f.db,{name:'Total acordado sintético',entry:'2026-09-01T12:00:00-03:00'});
   await f.db.query("select public.add_uti_payment($1,'2026-09-15T15:00:00Z',3700,'PIX',null,'agreed-total-original-payment')",[id]);
   const s=(await f.db.query<{s:any}>("select public.preview_uti_settlement($1,'2026-09-10T15:00:00Z') s",[id])).rows[0].s;
   await f.db.query('select public.discharge_uti($1,$2::timestamptz,$3::bigint)',[id,s.dischargeAt,s.accountVersion]);
 });
 afterEach(async()=>{await f.db.exec('rollback;reset role')});
 const account=async()=>(await f.db.query<any>(`select a.account_version version,a.status,
   (select sum(amount) from public.charges where admission_id=a.id and cancelled_at is null)::float8 billed,
   (select coalesce(sum(amount),0) from public.payments where admission_id=a.id and cancelled_at is null)::float8 received,
   (select coalesce(sum(amount),0) from public.refunds where admission_id=a.id and cancelled_at is null)::float8 refunded from public.admissions a where id=$1`,[id])).rows[0];
 const save=async(total:unknown,ref='settlement-total-unique-test-01',version?:unknown,reason='Valor combinado com a família')=>{
   const v=version===undefined?(await account()).version:version;
   return (await f.db.query<{s:string}>('select public.set_uti_settlement_total($1,$2::bigint,$3::numeric,$4,$5) s',[id,v,total,reason,ref])).rows[0].s;
 };
 const rejected=async(work:()=>Promise<unknown>,pattern:RegExp)=>{await f.db.exec('savepoint rejected');try{await assert.rejects(work,pattern)}finally{await f.db.exec('rollback to savepoint rejected;release savepoint rejected')}};
 it('R$3600 cobrados e R$3700 recebidos viram R$3700 quitados, preservando dinheiro e diárias',async()=>{
   const before=(await f.db.query('select to_jsonb(p) p from public.payments p where admission_id=$1',[id])).rows;
   const days=(await f.db.query("select to_jsonb(c) c from public.charges c where admission_id=$1 and kind='daily' order by id",[id])).rows;
   assert.equal((await account()).billed,3600);assert.equal(await save(3700),'finalized');
   const a=await account();assert.equal(a.billed,3700);assert.equal(a.received,3700);assert.equal(a.refunded,0);
   assert.deepEqual((await f.db.query('select to_jsonb(p) p from public.payments p where admission_id=$1',[id])).rows,before);
   assert.deepEqual((await f.db.query("select to_jsonb(c) c from public.charges c where admission_id=$1 and kind='daily' order by id",[id])).rows,days);
   const e=(await f.db.query<any>('select previous_total,agreed_total,before_data,after_data,created_by from public.settlement_total_edits where admission_id=$1',[id])).rows[0];
   assert.equal(Number(e.previous_total),3600);assert.equal(Number(e.agreed_total),3700);assert.equal(e.before_data.balance,-100);assert.equal(e.after_data.balance,0);assert.ok(e.created_by);
   assert.equal((await f.db.query("select count(*)::int n from public.audits where admission_id=$1 and action='Total do acerto ajustado'",[id])).rows[0].n,1);
 });
 it('permite corrigir conta quitada e sinaliza saldo a receber ou crédito conforme o novo total',async()=>{
   await save(3700);assert.equal(await save(3900,'settlement-total-second-test'),'discharge_pending');
   let a=await account();assert.equal(a.billed-a.received+a.refunded,200);
   assert.equal(await save(3500,'settlement-total-third-test'),'discharge_pending');a=await account();assert.equal(a.billed-a.received+a.refunded,-200);assert.equal(a.received,3700);
   const c=(await f.db.query<any>("select category,amount from public.charges where admission_id=$1 and client_ref='settlement-total-third-test'",[id])).rows[0];assert.equal(c.category,'Desconto no acerto');assert.equal(Number(c.amount),-400);
 });
 it('desconto pode zerar total; não representa pagamento ou reembolso automático',async()=>{
   await save(0);const a=await account();assert.equal(a.billed,0);assert.equal(a.received,3700);assert.equal(a.refunded,0);assert.equal(a.status,'discharge_pending');
 });
 it('retry é idempotente após quitação; payload divergente não reutiliza a referência',async()=>{
   const version=(await account()).version;await save(3700,undefined,version);await save(3700,undefined,version);
   assert.equal((await f.db.query('select count(*)::int n from public.settlement_total_edits where admission_id=$1',[id])).rows[0].n,1);
   await rejected(()=>save(3800,undefined,version),/Identificador/);await rejected(()=>save(3700,undefined,version,'Outro motivo combinado'),/Identificador/);
 });
 it('versão antiga e total sem mudança não sobrescrevem o financeiro',async()=>{
   const old=(await account()).version;await save(3750);await rejected(()=>save(3800,'settlement-total-stale-test',old),/conta foi alterada/);
   await rejected(()=>save(3750,'settlement-total-nochange-test'),/já é o valor atual/);assert.equal((await account()).billed,3750);
 });
 it('não aceita valores inválidos, precisão excedente, motivo curto ou referência inválida',async()=>{
   for(const total of [null,-1,1000000.01,'NaN','Infinity','-Infinity',3700.001])await rejected(()=>save(total),/total válido/);
   await rejected(()=>save(3700,'short'),/Identificador/);await rejected(()=>save(3700,undefined,undefined,'curto'),/motivo/);
   await rejected(()=>save(3700,undefined,null),/conta foi alterada/);assert.equal((await account()).billed,3600);
 });
 it('internação ativa ou cancelada não permite ajuste',async()=>{
   await f.db.exec('reset role');await f.db.query("update public.admissions set status='active',discharge_at=null where id=$1",[id]);await f.asUser('admin');
   await rejected(()=>save(3700),/Confirme a alta/);
   await f.db.exec('reset role');await f.db.query("update public.admissions set status='cancelled' where id=$1",[id]);await f.asUser('admin');await rejected(()=>save(3700),/Confirme a alta/);
 });
 it('previsões reservadas não podem ultrapassar o saldo após redução',async()=>{
   await save(5000);await f.db.query('select public.schedule_uti_receipt($1,$2::timestamptz,1000,$3,$4::date[],null,$5)',[id,new Date(Date.now()+86400000).toISOString(),'PIX',[],'settlement-total-pending-test']);
   await rejected(()=>save(4000,'settlement-total-reserved-test'),/previsões acima/);assert.equal((await account()).billed,5000);
 });
 it('reembolsos existentes entram no líquido sem alteração ou novo desembolso',async()=>{
   await f.db.query("select public.add_uti_refund($1,'2026-09-16T15:00:00Z',100,'PIX',null,'settlement-total-real-refund')",[id]);
   assert.equal((await account()).status,'finalized');await save(3500);const a=await account();assert.equal(a.refunded,100);assert.equal(a.received,3700);assert.equal(a.billed-a.received+a.refunded,-100);
 });
 it('bloqueia comercial, operador, inativo, sessão revogada, anônimo e escrita direta no histórico',async()=>{
   const version=(await account()).version;
   for(const role of ['commercial','operator','inactive'] as const){await f.asUser(role);await rejected(()=>save(3700,undefined,version),/Somente administradores/);assert.equal((await f.db.query('select count(*)::int n from public.settlement_total_edits')).rows[0].n,0)}
   await f.asUser('admin','aal1',false);await rejected(()=>save(3700,undefined,version),/Somente administradores/);
   await f.asUser('anon');await rejected(()=>f.db.query("select public.set_uti_settlement_total($1,0,3700,'Motivo sintético','settlement-total-anon-test')",[id]),/permission denied/);
   await f.asUser('admin');await rejected(()=>f.db.exec('truncate public.settlement_total_edits'),/permission denied/);await rejected(()=>f.db.exec('delete from public.settlement_total_edits'),/permission denied/);
 });
});

it('valor acordado aceita formatos usuais e rejeita entradas ambíguas ou inválidas',()=>{
 for(const text of ['3700','3700,00','3.700,00','3700.00'])assert.equal(parseSettlementTotal(text),3700);
 assert.equal(parseSettlementTotal('1.234'),1234);assert.equal(parseSettlementTotal('1.000.000,00'),1000000);assert.equal(parseSettlementTotal('0,00'),0);
 for(const text of ['', '-100','1e3','NaN','1,234','37,000.00','3700.001','1000000.01','3..700','3.700,000'])assert.equal(parseSettlementTotal(text),null,text);
});
