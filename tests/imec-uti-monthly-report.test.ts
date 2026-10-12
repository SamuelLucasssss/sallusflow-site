import {describe,it,before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {isolatedDatabase,createSyntheticAdmission} from './fixtures/imec-uti-database.ts';
import {buildMonthlyReportPdf,monthlyReportCsv,previousReportMonth,reportCompetence,reportDate,type MonthlyReport} from '../src/imec-uti/monthly-report.ts';

describe('relatório mensal humanizado — PostgreSQL isolado',()=>{
 let f:Awaited<ReturnType<typeof isolatedDatabase>>,a:string,b:string;
 before(async()=>{f=await isolatedDatabase();});after(async()=>{await f?.db.close();});
 beforeEach(async()=>{
   await f.db.exec('reset role;begin');await f.asUser('admin');
   a=await createSyntheticAdmission(f.db,{name:'Ana sintética',bed:10,entry:'2026-09-01T12:00:00-03:00',rate:500});
   b=await createSyntheticAdmission(f.db,{name:'Bia sintética',bed:17,entry:'2026-09-02T12:00:00-03:00',rate:500});
   const p=await createSyntheticAdmission(f.db,{name:'Particular sintético',bed:1,mode:'private',entry:'2026-09-01T12:00:00-03:00',rate:7000});
   for(const [id,date,value,ref] of [[a,'2026-09-10T15:00:00Z',300,'report-a-september-01'],[a,'2026-10-01T02:59:59Z',200,'report-a-september-02'],[b,'2026-09-20T15:00:00Z',1000,'report-b-september-01'],[p,'2026-09-20T15:00:00Z',7000,'report-private-receipt']] as const)
     await f.db.query('select public.add_uti_payment($1,$2::timestamptz,$3,$4,null,$5)',[id,date,value,'PIX',ref]);
   await f.db.query('select public.add_uti_card_payment($1,$2::timestamptz,700,$3,$4::date[],null,$5)',[a,'2026-10-01T03:00:00Z','credit',['2026-11-03','2026-12-02','2027-01-04','2027-02-01','2027-03-04'],'report-a-credit-october']);
   await f.db.query('select public.schedule_uti_receipt($1,$2::timestamptz,800,$3,$4::date[],null,$5)',[a,new Date(Date.now()+86400000).toISOString(),'PIX',[],'report-forecast-excluded']);
   await f.db.exec('reset role');
   await f.db.query("insert into public.refunds(admission_id,occurred_at,amount,method,created_by_name) values($1,'2026-09-21T15:00:00Z',100,'PIX','Synthetic admin')",[b]);
   await f.db.query("insert into public.payments(admission_id,occurred_at,amount,method,created_by_name,cancelled_at) values($1,'2026-09-22T15:00:00Z',50,'PIX','Synthetic admin',now())",[a]);
   await f.asUser('admin');
 });
 afterEach(async()=>{await f.db.exec('rollback;reset role');});
 const report=async(month='2026-09-01')=>(await f.db.query<{r:MonthlyReport}>('select public.get_uti_humanized_monthly_report($1::date) as r',[month])).rows[0].r;
 const rejects=async(work:()=>Promise<unknown>,pattern:RegExp)=>{await f.db.exec('savepoint rejected');try{await assert.rejects(work,pattern)}finally{await f.db.exec('rollback to savepoint rejected;release savepoint rejected')}};
 it('agrupa pagamentos parciais por internação; tipo simples/suíte e comissão líquida fecham',async()=>{
   const r=await report();assert.equal(r.receivedCents,150000);assert.equal(r.refundedCents,10000);assert.equal(r.netCents,140000);assert.equal(r.commissionCents,4200);
   assert.equal(r.receiptCount,3);assert.equal(r.admissionCount,2);assert.equal(r.refundCount,1);
   assert.deepEqual(r.rows.map(x=>[x.patientName,x.bedType,x.netCents]),[['Ana sintética','Simples',50000],['Bia sintética','Suíte',90000]]);
   assert.equal(r.rows.reduce((sum,x)=>sum+x.netCents,0),r.netCents);
 });
 it('limite mensal respeita São Paulo e crédito é integral no recebimento, sem usar vencimentos',async()=>{
   const oct=await report('2026-10-01');assert.equal(oct.netCents,70000);assert.equal(oct.receiptCount,1);assert.equal(oct.commissionCents,2100);
   const nov=await report('2026-11-01');assert.equal(nov.receiptCount,0);assert.equal(nov.netCents,0);
 });
 it('reembolso de recebimento de outro mês aparece como linha negativa na competência correta',async()=>{
   const c=await createSyntheticAdmission(f.db,{name:'Clara sintética',bed:11,entry:'2026-08-01T12:00:00-03:00',rate:400});
   await f.db.query("select public.add_uti_payment($1,'2026-08-20T15:00:00Z',300,'PIX',null,'report-previous-month-paid')",[c]);
   await f.db.exec('reset role');await f.db.query("insert into public.refunds(admission_id,occurred_at,amount,method,created_by_name) values($1,'2026-09-15T15:00:00Z',200,'PIX','Synthetic admin')",[c]);await f.asUser('admin');
   const r=await report();assert.equal(r.netCents,120000);assert.equal(r.commissionCents,3600);assert.equal(r.rows.find(x=>x.admissionId===c)?.netCents,-20000);
 });
 it('competência sem movimentações tem zero real; uma data intermediária é rejeitada',async()=>{
   const r=await report('2026-05-01');assert.deepEqual(r.rows,[]);assert.equal(r.netCents,0);assert.equal(r.commissionCents,0);
   await rejects(()=>report('2026-09-15'),/primeiro dia/);await rejects(()=>report('infinity'),/primeiro dia/);
 });
 it('arredondamento dos 3% em centavos mantém ajustes negativos, sem inventar comissão mínima',async()=>{
   const c=await createSyntheticAdmission(f.db,{name:'Ajuste sintético',bed:11,entry:'2026-06-01T12:00:00-03:00',rate:400});
   await f.db.query("select public.add_uti_payment($1,'2026-06-20T15:00:00Z',300,'PIX',null,'report-adjustment-paid')",[c]);
   await f.db.exec('reset role');await f.db.query("insert into public.refunds(admission_id,occurred_at,amount,method,created_by_name) values($1,'2026-07-15T15:00:00Z',0.50,'PIX','Synthetic admin')",[c]);await f.asUser('admin');
   const r=await report('2026-07-01');assert.equal(r.netCents,-50);assert.equal(r.commissionCents,-2);
 });
 it('consulta não modifica o financeiro; saída documental é auditada sem dados de pacientes',async()=>{
   const version=(await f.db.query('select account_version from public.admissions where id=$1',[a])).rows[0].account_version;
   await report();assert.equal((await f.db.query('select account_version from public.admissions where id=$1',[a])).rows[0].account_version,version);
   await f.db.query("select public.log_uti_report_event('2026-09-01','pdf_downloaded',true)");
   const row=(await f.db.query("select admission_id,detail from public.audits where action='Relatório mensal — PDF'")).rows[0];assert.equal(row.admission_id,null);assert.match(row.detail,/09\/2026/);assert.doesNotMatch(row.detail,/Ana sintética/);
 });
 it('membros ativos seguem o acesso existente; sessão inválida, inativo e anônimo são bloqueados',async()=>{
   for(const role of ['commercial','operator'] as const){await f.asUser(role);assert.equal((await report()).netCents,140000);}
   await f.asUser('inactive');await rejects(()=>report(),/Sessão inválida/);
   await f.asUser('admin','aal1',false);await rejects(()=>report(),/Sessão inválida/);
   await f.asUser('anon');await rejects(()=>report(),/permission denied/);
 });
});

const sample:MonthlyReport={month:'2026-09',generatedAt:'2026-10-12T12:00:00Z',receivedCents:150000,refundedCents:10000,netCents:140000,receiptCount:3,refundCount:1,admissionCount:2,commissionPercent:3,commissionCents:4200,rows:[{admissionId:'synthetic-1',patientName:'Paciente sintético',entryAt:'2026-09-01T15:00:00Z',dischargeAt:null,bedType:'Suíte',netCents:140000,receiptCount:3,refundCount:1}]};
describe('documentos do relatório mensal',()=>{
 it('competência e datas não dependem do fuso do dispositivo',()=>{
   assert.equal(previousReportMonth(new Date('2027-01-01T03:00:00Z')),'2026-12');assert.equal(previousReportMonth(new Date('2026-10-01T02:59:00Z')),'2026-08');
   assert.equal(reportCompetence('2026-09'),'09/2026');assert.equal(reportDate('2026-10-01T02:59:59Z'),'30/09/2026');
 });
 it('PDF é A4 e omite comissão por padrão; versão opcional inclui Aline e taxa de 3%',()=>{
   const normal=Buffer.from(buildMonthlyReportPdf(sample)).toString('latin1'),fee=Buffer.from(buildMonthlyReportPdf(sample,true)).toString('latin1');
   assert.match(normal,/%PDF-1.4/);assert.match(normal,/MediaBox \[0 0 595.28 841.89\]/);assert.doesNotMatch(normal,/Aline/);assert.match(fee,/Aline Glória - 3%/);assert.match(fee,/42,00/);
 });
 it('múltiplas páginas repetem cabeçalho e mantêm todos os nomes, sem cortar linhas',()=>{
   const large={...sample,rows:Array.from({length:90},(_,i)=>({...sample.rows[0],patientName:`Paciente sintético ${i} de Albuquerque e Vasconcelos`,admissionId:String(i)}))};
   const pdf=Buffer.from(buildMonthlyReportPdf(large)).toString('latin1');assert.match(pdf,/\/Count [3-9]/);assert.equal((pdf.match(/NOME DO PACIENTE/g)||[]).length,Number(pdf.match(/\/Count (\d+)/)?.[1]));assert.match(pdf,/Paciente sintético 89/);
 });
 it('CSV é compatível com Excel em português, protege fórmulas e preserva centavos negativos',()=>{
   const csv=monthlyReportCsv({...sample,rows:[{...sample.rows[0],patientName:'=1+1',netCents:-10000}]},true);
   assert.ok(csv.startsWith('\ufeff'));assert.match(csv,/"'=1\+1"/);assert.match(csv,/"-100,00"/);assert.match(csv,/Aline Glória - 3%/);
 });
});
