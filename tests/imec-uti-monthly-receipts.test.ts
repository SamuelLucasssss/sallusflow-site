import {describe,it,before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {isolatedDatabase,createSyntheticAdmission} from './fixtures/imec-uti-database.ts';
import {selectMonthlyReport,reportRowDates,monthlyReportCsv,monthlyReportFilename,buildMonthlyReportPdf,type MonthlyReport} from '../src/imec-uti/monthly-report.ts';

describe('relatórios por recebimento, modalidade e conferência',()=>{
 let f:Awaited<ReturnType<typeof isolatedDatabase>>,hotel:string,privateId:string;
 before(async()=>{f=await isolatedDatabase()});after(async()=>{await f?.db.close()});
 beforeEach(async()=>{
   await f.db.exec('reset role;begin');await f.asUser('admin');
   hotel=await createSyntheticAdmission(f.db,{name:'Humanizado sintético',bed:10,entry:'2026-09-29T12:00:00-03:00'});
   privateId=await createSyntheticAdmission(f.db,{name:'Particular sintético',bed:1,mode:'private',entry:'2026-09-29T12:00:00-03:00',rate:7000});
   for(const [id,date,value,ref] of [[hotel,'2026-09-30T15:00:00Z',100,'review-hotel-september'],[hotel,'2026-10-05T15:00:00Z',300,'review-hotel-october'],[privateId,'2026-10-05T15:00:00Z',7000,'review-private-october']] as const)
     await f.db.query('select public.add_uti_payment($1,$2::timestamptz,$3,$4,null,$5)',[id,date,value,'PIX',ref]);
   await f.db.query("select public.add_uti_card_payment($1,'2026-09-30T15:00:00Z',500,'credit',array['2026-11-03'::date],null,'review-credit-september')",[privateId]);
   await f.db.query('select public.schedule_uti_receipt($1,$2::timestamptz,50,$3,$4::date[],null,$5)',[hotel,new Date(Date.now()+86400000).toISOString(),'PIX',[],'review-forecast-excluded']);
   await f.db.exec('reset role');
   await f.db.query("update public.admissions set discharge_at='2026-09-30T15:00:00Z',closer_name=case when mode='private' then 'Roberto' else 'Samuel' end where id=any($1::uuid[])",[[hotel,privateId]]);
   await f.db.query("insert into public.refunds(admission_id,occurred_at,amount,method,created_by_name) values($1,'2026-10-06T15:00:00Z',0.50,'PIX','Synthetic admin')",[hotel]);
   await f.db.query("insert into public.payments(admission_id,occurred_at,amount,method,created_by_name,cancelled_at) values($1,'2026-10-07T15:00:00Z',100,'PIX','Synthetic admin',now())",[hotel]);
   await f.asUser('admin');
 });
 afterEach(async()=>{await f.db.exec('rollback;reset role')});
 const report=async(mode='hotel',month='2026-10-01')=>(await f.db.query<{r:MonthlyReport}>('select public.get_uti_monthly_receipts_report($1::date,$2) r',[month,mode])).rows[0].r;
 const exportReport=async(r:MonthlyReport,keys:string[]|null=null,commission=false,snapshot=r.sourceSnapshot)=>(await f.db.query<{r:MonthlyReport}>("select public.export_uti_monthly_receipts_report($1::date,$2,'pdf_downloaded',$3,$4::text[],$5) r",[r.month+'-01',r.mode,commission,keys,snapshot])).rows[0].r;
 const rejects=async(work:()=>Promise<unknown>,pattern:RegExp)=>{await f.db.exec('savepoint rejected');try{await assert.rejects(work,pattern)}finally{await f.db.exec('rollback to savepoint rejected;release savepoint rejected')}};
 it('entrada em setembro e recebimento após a alta em outubro entram em outubro, sem misturar modalidades',async()=>{
   const h=await report(),p=await report('private'),sep=await report('hotel','2026-09-01');
   assert.equal(h.netCents,29950);assert.equal(h.receiptCount,1);assert.equal(h.refundCount,1);assert.equal(h.rows[0].admissionId,hotel);assert.equal(h.movements?.length,2);
   assert.equal(sep.netCents,10000);assert.equal(sep.receiptCount,1);
   assert.equal(p.netCents,700000);assert.equal(p.rows.length,1);assert.equal(p.rows[0].admissionId,privateId);assert.equal(p.rows[0].responsible,'Roberto');assert.equal(p.rows[0].bedType,'UTI 01');assert.equal(p.commissionCents,0);assert.equal(p.commissionPercent,0);
   assert.match(reportRowDates(h.rows[0]),/05\/10\/2026\nReemb\. 06\/10\/2026/);
 });
 it('limite do mês segue São Paulo e vencimento de cartão não é recebimento',async()=>{
   // Synthetic root fixture writes isolate boundary selection from admission validation.
   await f.db.exec('reset role');await f.db.query("insert into public.payments(admission_id,occurred_at,amount,method,created_by_name) values($1,'2026-10-01T02:59:59Z',1,'PIX','Synthetic admin'),($1,'2026-10-01T03:00:00Z',2,'PIX','Synthetic admin')",[hotel]);await f.asUser('admin');
   assert.equal((await report('hotel','2026-09-01')).netCents,10100);assert.equal((await report()).netCents,30150);
   const november=await report('hotel','2026-11-01');assert.equal(november.netCents,0);
   assert.equal((await report('private','2026-09-01')).netCents,50000);assert.equal((await report('private','2026-11-01')).netCents,0);
 });
 it('seleção manual e exportação concordam com a prévia sem modificar saldo ou versão da conta',async()=>{
   const full=await report(),refund=full.movements!.find(m=>m.kind==='refund')!;
   const version=(await f.db.query('select account_version from public.admissions where id=$1',[hotel])).rows[0];
   const client=selectMonthlyReport(full,[refund.key]),server=await exportReport(full,[refund.key],true);
   for(const k of ['netCents','receivedCents','refundedCents','receiptCount','refundCount','commissionCents','selectedCount','manualSelection'] as const)assert.equal(client[k],server[k]);
   assert.equal(server.netCents,-50);assert.equal(server.commissionCents,-2);assert.equal(server.candidateCount,2);assert.equal(server.manualSelection,true);
   assert.deepEqual((await f.db.query('select account_version from public.admissions where id=$1',[hotel])).rows[0],version);
   const audit=(await f.db.query("select admission_id,detail from public.audits where action='Relatório mensal — PDF' limit 1")).rows[0];assert.equal(audit.admission_id,null);assert.match(audit.detail,/Seleção: 1\/2/);assert.doesNotMatch(audit.detail,/Humanizado sintético/);
 });
 it('seleção vazia fica identificada; exportar todos preserva os totais e a API anterior',async()=>{
   const full=await report(),empty=await exportReport(full,[]);assert.equal(empty.netCents,0);assert.equal(empty.manualSelection,true);assert.equal(empty.selectedCount,0);
   const all=await exportReport(full);assert.equal(all.netCents,29950);assert.equal(all.manualSelection,false);
   const old=(await f.db.query<{r:MonthlyReport}>("select public.get_uti_humanized_monthly_report('2026-10-01') r")).rows[0].r;assert.equal(all.netCents,old.netCents);
 });
 it('rejeita seleção inválida, outra modalidade e outro mês',async()=>{
   const h=await report(),p=await report('private');const key=h.movements![0].key;
   await rejects(()=>exportReport(h,[p.movements![0].key]),/fora da modalidade/);
   await rejects(()=>exportReport(h,[key,key]),/inválida/);
   await rejects(()=>exportReport(h,[null as unknown as string]),/inválida/);
   assert.equal((await exportReport(p,null,true)).commissionPercent,0);
   await rejects(()=>report('invalid'),/Escolha/);await rejects(()=>report('hotel','2026-10-05'),/primeiro dia/);
   const sep=await report('hotel','2026-09-01');await rejects(()=>exportReport(h,[sep.movements![0].key]),/fora da modalidade/);
 });
 it('alteração depois da conferência impede exportação e auditoria com total obsoleto',async()=>{
   const old=await report(),audits=(await f.db.query('select count(*) n from public.audits')).rows[0].n;
   await f.db.exec('reset role');await f.db.query("update public.payments set amount=301 where admission_id=$1 and client_ref='review-hotel-october'",[hotel]);await f.asUser('admin');
   await rejects(()=>exportReport(old),/recebimentos mudaram/);assert.equal((await f.db.query('select count(*) n from public.audits')).rows[0].n,audits);
   const fresh=await report();assert.notEqual(fresh.sourceSnapshot,old.sourceSnapshot);assert.equal((await exportReport(fresh)).netCents,30050);
 });
 it('permite membros ativos e bloqueia inativo, sessão revogada e anônimo',async()=>{
   const h=await report();for(const role of ['commercial','operator'] as const){await f.asUser(role);assert.equal((await report()).netCents,29950);await exportReport(h)}
   await f.asUser('inactive');await rejects(()=>report(),/Sessão inválida/);await rejects(()=>exportReport(h),/Sessão inválida/);
   await f.asUser('admin','aal1',false);await rejects(()=>report(),/Sessão inválida/);
   await f.asUser('anon');await rejects(()=>report(),/permission denied/);await rejects(()=>exportReport(h),/permission denied/);
 });
 it('PDF e CSV particulares incluem responsável e data recebida; seleção tem identificação explícita',async()=>{
   const p=await report('private'),pdf=Buffer.from(buildMonthlyReportPdf(p,true)).toString('latin1'),csv=monthlyReportCsv(p,true);
   assert.match(pdf,/RESPONSÁVEL/);assert.match(pdf,/Roberto/);assert.match(pdf,/29\/09\/2026/);assert.match(pdf,/30\/09\/2026/);assert.match(pdf,/05\/10\/2026/);assert.doesNotMatch(pdf,/Aline/);assert.doesNotMatch(csv,/Aline/);assert.match(csv,/Responsável/);assert.match(monthlyReportFilename(p,true),/Particular/);
   const h=await report(),manual=selectMonthlyReport(h,[h.movements![0].key]);assert.match(monthlyReportCsv(manual),/Seleção manual: 1 de 2/);assert.match(Buffer.from(buildMonthlyReportPdf(manual)).toString('latin1'),/TOTAL LÍQUIDO DA SELEÇÃO/);assert.match(monthlyReportFilename(manual),/_Selecao/);
   assert.throws(()=>selectMonthlyReport(h,['foreign']),/fora da modalidade/);
 });
});
