import {describe,it,before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {isolatedDatabase,createSyntheticAdmission} from './fixtures/imec-uti-database.ts';
import {selectMonthlyReport,privateCommissionSummary,buildMonthlyReportPdf,buildMonthlyReportPrintHtml,monthlyReportCsv,type MonthlyReport} from '../src/imec-uti/monthly-report.ts';

describe('responsável particular — PostgreSQL isolado',()=>{
 let f:Awaited<ReturnType<typeof isolatedDatabase>>,id:string;
 before(async()=>{f=await isolatedDatabase()});after(async()=>{await f?.db.close()});
 beforeEach(async()=>{await f.db.exec('reset role;begin');await f.asUser('admin');id=await createSyntheticAdmission(f.db,{mode:'private',bed:1,rate:7000})});
 afterEach(async()=>{await f.db.exec('rollback;reset role')});
 const account=async()=>(await f.db.query<any>('select * from public.admissions where id=$1',[id])).rows[0];
 const save=async(code='roberto',ref='private-responsible-change-01',version?:unknown,reason='Responsável confirmado pelo gestor')=>f.db.query('select public.set_uti_private_responsible($1,$2::bigint,$3,$4,$5)',[id,version===undefined?(await account()).account_version:version,code,reason,ref]);
 const rejects=async(fn:()=>Promise<unknown>,pattern:RegExp)=>{await f.db.exec('savepoint denied');try{await assert.rejects(fn,pattern)}finally{await f.db.exec('rollback to savepoint denied;release savepoint denied')}};
 const report=async(month='2026-11-01')=>(await f.db.query<{r:MonthlyReport}>("select public.get_uti_monthly_receipts_report($1::date,'private') r",[month])).rows[0].r;
 const discharge=async()=>{const p=(await f.db.query<any>("select public.preview_uti_settlement($1,'2026-10-02T15:00:00Z') r",[id])).rows[0].r;await f.db.query('select public.discharge_uti($1,$2::timestamptz,$3::bigint)',[id,p.dischargeAt,p.accountVersion])};
 const pay=async(date:string,value:number,ref:string)=>f.db.query('select public.add_uti_payment($1,$2::timestamptz,$3,$4,null,$5)',[id,date,value,'PIX',ref]);
 it('nova internação exige Samuel ou Roberto explicitamente e mantém os R$80 por internação',async()=>{
   for(const closer of ['',null,'Aline'])await rejects(()=>f.db.query("select public.create_uti_admission('Particular novo',null,2,'private','2026-10-01T15:00:00Z',$1,false,false,7000,null)",[closer]),/Samuel ou Roberto/);
   const other=(await f.db.query<{id:string}>("select public.create_uti_admission('Particular novo',null,2,'private','2026-10-01T15:00:00Z','Roberto',false,false,7000,null) id")).rows[0].id;
   const a=(await f.db.query<any>('select closer_name,commission_amount from public.admissions where id=$1',[other])).rows[0];assert.equal(a.closer_name,'Roberto');assert.equal(Number(a.commission_amount),80);
 });
 it('altera Samuel para Roberto com R$80 uma vez e preserva cobranças e recebimentos',async()=>{
   await f.db.query("select public.add_uti_payment($1,'2026-10-02T15:00:00Z',100,'PIX',null,'responsible-payment-test-01')",[id]);
   const before=await account(),ledger=(await f.db.query('select to_jsonb(c) data from public.charges c where admission_id=$1 order by id',[id])).rows;
   await save();const a=await account();assert.equal(a.closer_name,'Roberto');assert.equal(Number(a.commission_amount),80);assert.equal(a.account_version,Number(before.account_version)+1);
   assert.deepEqual((await f.db.query('select to_jsonb(c) data from public.charges c where admission_id=$1 order by id',[id])).rows,ledger);
   assert.equal(Number((await f.db.query('select sum(amount) total from public.payments where admission_id=$1',[id])).rows[0].total),100);
   const history=(await f.db.query<any>('select before_data,after_data from public.private_responsible_edits where admission_id=$1',[id])).rows[0];assert.equal(history.before_data.closerName,'Samuel');assert.equal(history.after_data.closerName,'Roberto');
   const report=(await f.db.query<any>("select public.get_uti_monthly_receipts_report('2026-10-01','private') r")).rows[0].r;assert.equal(report.rows[0].responsible,'Roberto');
 });
 it('retry não duplica; versão antiga e identificador divergente não sobrescrevem',async()=>{
   const v=(await account()).account_version;await save('roberto',undefined,v);await save('roberto',undefined,v);
   assert.equal((await f.db.query('select count(*)::int n from public.private_responsible_edits')).rows[0].n,1);
   await rejects(()=>save('samuel',undefined,v),/Identificador/);
   await rejects(()=>save('samuel','private-responsible-stale-02',v),/conta foi alterada/);
 });
 it('valida responsável, motivo, referência, modalidade e cancelamento',async()=>{
   await rejects(()=>save('aline'),/Samuel ou Roberto/);await rejects(()=>save('roberto','short'),/Identificador/);await rejects(()=>save('roberto',undefined,undefined,'curto'),/motivo/);
   await rejects(()=>save('samuel'),/responsável atual/);await rejects(()=>save('roberto',undefined,null),/conta foi alterada/);
   await f.db.exec('reset role');await f.db.query("update public.admissions set mode='hotel' where id=$1",[id]);await f.asUser('admin');await rejects(()=>save(),/particular não cancelada/);
   await f.db.exec('reset role');await f.db.query("update public.admissions set mode='private',status='cancelled' where id=$1",[id]);await f.asUser('admin');await rejects(()=>save(),/particular não cancelada/);
 });
 it('bloqueia perfis sem permissão, sessão revogada, anônimo e alteração direta do histórico',async()=>{
   const v=(await account()).account_version;
   for(const role of ['commercial','operator','inactive'] as const){await f.asUser(role);await rejects(()=>save('roberto',undefined,v),/Somente administradores/)}
   await f.asUser('admin','aal1',false);await rejects(()=>save('roberto',undefined,v),/Somente administradores/);
   await f.asUser('anon');await rejects(()=>save('roberto',undefined,v),/permission denied/);
   await f.asUser('admin');await rejects(()=>f.db.exec('truncate public.private_responsible_edits'),/permission denied/);await rejects(()=>f.db.exec('delete from public.private_responsible_edits'),/permission denied/);
 });
 it('repasse ocorre uma vez no mês da quitação, mesmo com pagamentos em meses diferentes',async()=>{
   await pay('2026-10-02T15:00:00Z',3500,'private-fee-october-partial');await discharge();
   assert.equal((await report('2026-10-01')).privateCommissionCents,0);
   await pay('2026-11-01T15:00:00Z',1500,'private-fee-november-partial');assert.equal((await report()).privateCommissionCents,0);
   await pay('2026-11-02T15:00:00Z',2000,'private-fee-november-settled');
   const oct=await report('2026-10-01'),nov=await report();assert.equal(oct.privateCommissionCents,0);assert.equal(nov.privateCommissionCents,8000);assert.equal(nov.receiptCount,2);
   assert.deepEqual(privateCommissionSummary(nov),[{name:'Samuel',count:1,cents:8000},{name:'Roberto',count:0,cents:0}]);
   const qualifying=nov.movements!.find(m=>m.privateCommissionCents===8000)!;
   const without=selectMonthlyReport(nov,nov.movements!.filter(m=>m.key!==qualifying.key).map(m=>m.key));assert.equal(without.privateCommissionCents,0);
   const only=selectMonthlyReport(nov,[qualifying.key]);assert.equal(only.privateCommissionCents,8000);assert.equal(only.netCents,200000);
   await save();const changed=await report();assert.equal(privateCommissionSummary(changed)[1].cents,8000);assert.notEqual(nov.sourceSnapshot,changed.sourceSnapshot);
 });
 it('recebimento antes da alta só habilita repasse com conta encerrada e quitada',async()=>{
   await pay('2026-10-02T15:00:00Z',7000,'private-fee-prepaid-original');assert.equal((await report('2026-10-01')).privateCommissionCents,0);
   await discharge();const r=await report('2026-10-01');assert.equal(r.privateCommissionCents,8000);
   for(const doc of [Buffer.from(buildMonthlyReportPdf(r,true)).toString('latin1'),buildMonthlyReportPrintHtml(r,true),monthlyReportCsv(r,true)]){assert.match(doc,/Repasse particular por quitação/);assert.match(doc,/80,00/);assert.doesNotMatch(doc,/Aline/)}
   assert.doesNotMatch(Buffer.from(buildMonthlyReportPdf(r)).toString('latin1'),/Repasse particular/);
 });
 it('pagamento cancelado e saldo pendente não geram repasse',async()=>{
   await pay('2026-10-02T15:00:00Z',7000,'private-fee-cancelled-original');await discharge();
   await f.db.query("select public.cancel_uti_payment((select id from public.payments where client_ref='private-fee-cancelled-original'),'Pagamento cancelado no teste')");
   assert.equal((await report('2026-10-01')).privateCommissionCents,0);
 });
});
