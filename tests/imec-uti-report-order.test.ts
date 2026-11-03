import {it} from 'node:test';
import assert from 'node:assert/strict';
import {orderMonthlyReport,selectMonthlyReport,monthlyReportCsv,buildMonthlyReportPdf,buildMonthlyReportPrintHtml,reportOrderNote,type MonthlyReport,type MonthlyReportRow} from '../src/imec-uti/monthly-report.ts';

const row=(id:string,name:string,dates:string[],refunds:string[]=[]):MonthlyReportRow=>({admissionId:id,patientName:name,entryAt:'2026-09-29T15:00:00Z',dischargeAt:'2026-10-02T15:00:00Z',bedType:'Simples',responsible:'Samuel',netCents:10000,receiptCount:dates.length,refundCount:refunds.length,receiptDates:dates,refundDates:refunds});
const base:MonthlyReport={month:'2026-10',mode:'hotel',generatedAt:'2026-11-03T15:00:00Z',receivedCents:40000,refundedCents:0,netCents:40000,receiptCount:4,refundCount:0,admissionCount:4,commissionPercent:3,commissionCents:1200,rows:[row('a','Ana sintética',['2026-10-20T15:00:00Z']),row('z','Zeca sintético',['2026-10-05T15:00:00Z']),row('b','Bruno sintético',['2026-10-15T15:00:00Z']),row('r','Reembolso sintético',[],['2026-10-10T15:00:00Z'])]};
it('ordena recebimentos antigos ou recentes sem usar entrada, alta ou nome como data',()=>{
 assert.deepEqual(orderMonthlyReport(base,'receipt_asc').rows.map(r=>r.admissionId),['z','r','b','a']);
 assert.deepEqual(orderMonthlyReport(base,'receipt_desc').rows.map(r=>r.admissionId),['a','b','r','z']);
 assert.deepEqual(orderMonthlyReport(base,'name').rows.map(r=>r.admissionId),['a','b','r','z']);
 assert.deepEqual(base.rows.map(r=>r.admissionId),['a','z','b','r']);
 const sorted=orderMonthlyReport(base,'receipt_asc');assert.equal(sorted.netCents,base.netCents);assert.equal(sorted.commissionCents,base.commissionCents);
});
it('compara instantes completos, desempata por nome e mantém datas desconhecidas no final',()=>{
 const report={...base,rows:[row('z','Zeca',['2026-10-05T09:00:00-03:00']),row('b','Bruno',['2026-10-05T12:00:00Z']),row('a','Ana',['2026-10-05T11:59:59Z']),row('x','Sem data',[])]};
 assert.deepEqual(orderMonthlyReport(report,'receipt_asc').rows.map(r=>r.admissionId),['a','b','z','x']);
 assert.deepEqual(orderMonthlyReport(report,'receipt_desc').rows.map(r=>r.admissionId),['b','z','a','x']);
});
it('agrupamento usa primeiro recebimento selecionado e não o pagamento excluído da conferência',()=>{
 const rows=[row('a','Ana',['2026-10-20T15:00:00Z','2026-10-03T15:00:00Z']),row('b','Bruno',['2026-10-10T15:00:00Z'])];
 const movements=rows.flatMap(r=>r.receiptDates!.map((occurredAt,i)=>({...r,key:r.admissionId+i,occurredAt,amountCents:10000,kind:'receipt' as const,method:'PIX',included:true})));
 const report={...base,rows,movements};const full=orderMonthlyReport(selectMonthlyReport(report),'receipt_asc');assert.equal(full.rows[0].admissionId,'a');
 assert.deepEqual(full.rows[0].receiptDates,['2026-10-03T15:00:00Z','2026-10-20T15:00:00Z']);
 const selected=orderMonthlyReport(selectMonthlyReport(report,['a0','b0']),'receipt_asc');assert.deepEqual(selected.rows.map(r=>r.admissionId),['b','a']);assert.equal(selected.netCents,20000);assert.equal(selected.manualSelection,true);
 assert.deepEqual(rows[0].receiptDates,['2026-10-20T15:00:00Z','2026-10-03T15:00:00Z']);
});
it('PDF, impressão e CSV aplicam a mesma ordem e documentam o critério',()=>{
 for(const mode of ['hotel','private'] as const){
  const report={...base,mode,order:'receipt_asc' as const};
  for(const document of [Buffer.from(buildMonthlyReportPdf(report)).toString('latin1'),buildMonthlyReportPrintHtml(report),monthlyReportCsv(report)]){
   assert.ok(document.indexOf('Zeca sintético')<document.indexOf('Bruno sintético'));assert.ok(document.indexOf('Bruno sintético')<document.indexOf('Ana sintética'));assert.match(document,/mais antigo primeiro/);
  }
  assert.match(reportOrderNote(report),/primeiro recebimento selecionado/);
 }
});
it('ordenação vazia é válida e opções desconhecidas são rejeitadas',()=>{
 assert.deepEqual(orderMonthlyReport({...base,rows:[]},'receipt_desc').rows,[]);
 assert.throws(()=>orderMonthlyReport(base,'unknown' as any),/ordenação válida/);
});
