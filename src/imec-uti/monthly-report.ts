import {businessParts,monthKey,money} from './domain.ts';
import {helveticaWidth} from './pdf-font-metrics.ts';

export type ReportMode='hotel'|'private';
export type ReportOrder='name'|'receipt_asc'|'receipt_desc';
export type MonthlyReportRow={admissionId:string;patientName:string;entryAt:string;dischargeAt:string|null;bedType:string;responsible?:string;privateCommissionCents?:number;netCents:number;receiptCount:number;refundCount:number;receiptDates?:string[];refundDates?:string[]};
export type MonthlyReportMovement=Omit<MonthlyReportRow,'netCents'|'receiptCount'|'refundCount'> & {key:string;occurredAt:string;amountCents:number;kind:'receipt'|'refund';method:string;cardType?:string|null;included:boolean};
export type MonthlyReport={month:string;mode?:ReportMode;order?:ReportOrder;generatedAt:string;receivedCents:number;refundedCents:number;netCents:number;receiptCount:number;refundCount:number;admissionCount:number;commissionPercent:number;commissionCents:number;privateCommissionCents?:number;rows:MonthlyReportRow[];movements?:MonthlyReportMovement[];sourceSnapshot?:string;candidateCount?:number;selectedCount?:number;manualSelection?:boolean};
export const reportLabel=(mode:ReportMode='hotel')=>mode==='private'?'Particular':'Leito humanizado';
export const reportOrderLabel=(order:ReportOrder='name')=>order==='receipt_asc'?'Recebimento: mais antigo primeiro':order==='receipt_desc'?'Recebimento: mais recente primeiro':'Nome do paciente';
export const reportOrderNote=(r:MonthlyReport)=>r.order&&r.order!=='name'?`${reportOrderLabel(r.order)}. Cada internação usa seu primeiro recebimento selecionado; reembolso isolado usa sua data.`:'Ordem alfabética por paciente.';
export function orderMonthlyReport(report:MonthlyReport,order:ReportOrder=report.order||'name'):MonthlyReport{
 if(!['name','receipt_asc','receipt_desc'].includes(order))throw new Error('Escolha uma ordenação válida.');
 const time=(value:string)=>{const n=Date.parse(value);return Number.isFinite(n)?n:null};
 const dates=(items:string[]|undefined)=>items?[...items].sort((a,b)=>(time(a)??Infinity)-(time(b)??Infinity)):items;
 const first=(row:MonthlyReportRow)=>{
   const receipt=(row.receiptDates||[]).map(time).filter((n):n is number=>n!==null);
   const refund=(row.refundDates||[]).map(time).filter((n):n is number=>n!==null);
   return receipt.length?Math.min(...receipt):refund.length?Math.min(...refund):null;
 };
 const names=(a:Pick<MonthlyReportRow,'patientName'|'entryAt'|'admissionId'>,b:Pick<MonthlyReportRow,'patientName'|'entryAt'|'admissionId'>)=>a.patientName.localeCompare(b.patientName,'pt-BR')||a.entryAt.localeCompare(b.entryAt)||a.admissionId.localeCompare(b.admissionId);
 const chronological=(a:number|null,b:number|null)=>a===null?(b===null?0:1):b===null?-1:(a-b)*(order==='receipt_desc'?-1:1);
 const rows=report.rows.map(r=>({...r,receiptDates:dates(r.receiptDates),refundDates:dates(r.refundDates)})).sort((a,b)=>(order==='name'?0:chronological(first(a),first(b)))||names(a,b));
 const movements=report.movements?[...report.movements].sort((a,b)=>(order==='name'?names(a,b):chronological(time(a.occurredAt),time(b.occurredAt)))||a.occurredAt.localeCompare(b.occurredAt)||a.key.localeCompare(b.key)):undefined;
 return {...report,order,rows,...(movements?{movements}:{})};
}
export function selectMonthlyReport(report:MonthlyReport,selected:Iterable<string>|null=null):MonthlyReport{
 if(!report.movements)return report;
 const keys=selected===null?new Set(report.movements.map(m=>m.key)):new Set(selected);
 if([...keys].some(k=>!report.movements!.some(m=>m.key===k)))throw new Error('Seleção fora da modalidade ou competência.');
 const movements=report.movements.map(m=>({...m,included:keys.has(m.key)})),groups=new Map<string,MonthlyReportRow>();let received=0,refunded=0,receipts=0,refunds=0;
 for(const m of movements){if(!m.included)continue;
   let row=groups.get(m.admissionId);if(!row){row={admissionId:m.admissionId,patientName:m.patientName,entryAt:m.entryAt,dischargeAt:m.dischargeAt,bedType:m.bedType,responsible:m.responsible,privateCommissionCents:0,netCents:0,receiptCount:0,refundCount:0,receiptDates:[],refundDates:[]};groups.set(m.admissionId,row)}
   if(m.kind==='receipt'){received+=m.amountCents;receipts++;row.netCents+=m.amountCents;row.privateCommissionCents!+=m.privateCommissionCents||0;row.receiptCount++;row.receiptDates!.push(m.occurredAt)}
   else{refunded+=m.amountCents;refunds++;row.netCents-=m.amountCents;row.refundCount++;row.refundDates!.push(m.occurredAt)}
 }
 const net=received-refunded,commission=report.mode!=='private'?Math.sign(net)*Math.round(Math.abs(net)*3/100):0;
 return {...report,movements,rows:[...groups.values()].sort((a,b)=>a.patientName.localeCompare(b.patientName,'pt-BR')||a.entryAt.localeCompare(b.entryAt)||a.admissionId.localeCompare(b.admissionId)),receivedCents:received,refundedCents:refunded,netCents:net,receiptCount:receipts,refundCount:refunds,admissionCount:groups.size,commissionCents:commission,privateCommissionCents:[...groups.values()].reduce((sum,row)=>sum+(row.privateCommissionCents||0),0),selectedCount:keys.size,candidateCount:movements.length,manualSelection:keys.size!==movements.length};
}
export const privateCommissionNote='R$ 80 por internação totalmente quitada, uma única vez, no recebimento que completou a quitação. A seleção deve incluir esse recebimento.';
export function privateCommissionSummary(report:MonthlyReport){
 return ['Samuel','Roberto'].map(name=>{const rows=report.rows.filter(row=>row.responsible?.toLocaleLowerCase('pt-BR')===name.toLocaleLowerCase('pt-BR')&&(row.privateCommissionCents||0)>0);return {name,count:rows.length,cents:rows.reduce((sum,row)=>sum+(row.privateCommissionCents||0),0)}});
}
export const reportSelectionNote=(r:MonthlyReport)=>r.manualSelection?`Seleção manual: ${r.selectedCount} de ${r.candidateCount} lançamentos da competência.`:'Todos os recebimentos e reembolsos confirmados da competência.';
export function reportRowDates(row:MonthlyReportRow):string{
 const dates=[...new Set((row.receiptDates||[]).map(reportDate))];
 const refunds=[...new Set((row.refundDates||[]).map(d=>'Reemb. '+reportDate(d)))];
 return [...dates,...refunds].join('\n')||'—';
}
export function reportColumns(mode:ReportMode='hotel'):{label:string;width:number}[]{
 const labels=['Nome do paciente','Entrada','Alta','Recebimentos','Valor líquido','Leito',...(mode==='private'?['Responsável']:[])];
 const widths=mode==='private'?[124,54,54,84,78,43,78]:[160,52,52,88,87,76];return labels.map((label,i)=>({label,width:widths[i]}));
}
export function reportRowCells(row:MonthlyReportRow,mode:ReportMode='hotel'):string[]{return [row.patientName,reportDate(row.entryAt),reportDate(row.dischargeAt),reportRowDates(row),money(row.netCents/100),row.bedType,...(mode==='private'?[row.responsible||'Não informado']:[])];}
export function previousReportMonth(now=new Date()):string{
 const [year,month]=monthKey(now).split('-').map(Number);
 return `${month===1?year-1:year}-${String(month===1?12:month-1).padStart(2,'0')}`;
}
export function reportCompetence(month:string):string{
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('Informe uma competência válida.');
 return `${month.slice(5)}/${month.slice(0,4)}`;
}
export function reportReference(month:string,mode:ReportMode='hotel'):string{return `${reportLabel(mode)} ref. competência ${reportCompetence(month)}`;}
export function reportDate(value:string|null):string{
 if(!value)return 'Em internação';
 const p=businessParts(value);return `${String(p.day).padStart(2,'0')}/${String(p.month).padStart(2,'0')}/${p.year}`;
}
export function monthlyReportFilename(report:MonthlyReport,commission=false,extension='pdf'):string{
 return `IMEC_${report.mode==='private'?'Particular':'Leito_Humanizado'}_${report.month}${report.order==='receipt_asc'?'_Recebimento_Crescente':report.order==='receipt_desc'?'_Recebimento_Decrescente':''}${report.manualSelection?'_Selecao':''}${commission?(report.mode==='private'?'_Repasse_Particular':'_Comissao_Aline_Gloria'):''}.${extension}`;
}
export function monthlyReportCsv(report:MonthlyReport,commission=false):string{
 report=orderMonthlyReport(report);
 const cell=(value:unknown)=>{
   if(typeof value==='number')return '"'+value.toFixed(2).replace('.',',')+'"';
   let s=String(value??'');if(/^[\s]*[=+\-@\t\r]/.test(s))s="'"+s;
   return '"'+s.replace(/"/g,'""')+'"';
 };
 const mode=report.mode||'hotel';
 const rows:unknown[][]=[reportColumns(mode).map(c=>c.label),
   ...report.rows.map(r=>{const cells:unknown[]=reportRowCells(r,mode);cells[4]=r.netCents/100;return cells}),
   ['TOTAL','','','',report.netCents/100],[],[reportReference(report.month,mode)],[reportSelectionNote(report)],[reportOrderNote(report)]];
 if(commission&&mode==='private'){const fees=privateCommissionSummary(report);rows.push([],['Repasse particular por quitação','','','',fees.reduce((sum,f)=>sum+f.cents,0)/100],...fees.map(f=>[f.name,`${f.count} internação(ões) quitada(s)`,'','',f.cents/100]),[privateCommissionNote])}
 if(commission&&mode==='hotel')rows.push(['Comissão Aline Glória - 3%','','','',report.commissionCents/100]);
 return '\ufeff'+rows.map(row=>row.map(cell).join(';')).join('\r\n');
}
// Browser-native PDF: Helvetica/WinAnsi, A4, repeated headers and full patient names.
const safe=(value:unknown)=>String(value??'').normalize('NFC').replace(/\u00a0/g,' ').replace(/[–—]/g,'-').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/[^\x20-\xFF]/g,'?');
const escapePdf=(value:unknown)=>safe(value).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
const documentColumns=(mode:ReportMode)=>reportColumns(mode).map((column,i)=>({...column,width:(mode==='hotel'?[160,56,56,88,87,68]:[134,54,54,82,78,43,70])[i],label:['PACIENTE','ENTRADA','ALTA','RECEBIMENTOS','LÍQUIDO','LEITO','RESPONSÁVEL'][i]}));
const documentScope=(r:MonthlyReport)=>r.manualSelection?`SELEÇÃO MANUAL - ${r.selectedCount} DE ${r.candidateCount} LANÇAMENTOS`:'RECEBIMENTOS CONFIRMADOS NA COMPETÊNCIA';
function wrap(value:string,width:number,size:number,bold=false):string[]{
 const lines:string[]=[];let line='';
 for(const word of safe(value).split(/\s+/).filter(Boolean)){
   if(line&&helveticaWidth(line+' '+word,size,bold)>width){lines.push(line);line=''}
   for(const char of word){if(line&&helveticaWidth(line+char,size,bold)>width){lines.push(line);line=''}line+=char}
   line+=' ';
 }
 if(line.trim())lines.push(line.trim());return lines.length?lines:[''];
}
export function buildMonthlyReportPdf(report:MonthlyReport,includeCommission=false):Uint8Array{
 report=orderMonthlyReport(report);
 const mode=report.mode||'hotel',columns=documentColumns(mode),left=40,rightEdge=555,width=515,bottom=103;
 const includePrivate=includeCommission&&mode==='private';
 includeCommission=includeCommission&&mode==='hotel';
 const ink=[0.12,0.16,0.17],muted=[0.39,0.44,0.44],brand=[0.07,0.36,0.34],line=[0.86,0.89,0.88],paper=[0.965,0.974,0.970];
 const pages:string[][]=[];let commands:string[]=[];let y=0;
 const color=(rgb:number[])=>rgb.join(' ');
 const text=(x:number,yy:number,size:number,value:unknown,bold=false,rgb=ink)=>commands.push(`BT ${color(rgb)} rg /F${bold?2:1} ${size} Tf ${x.toFixed(2)} ${yy.toFixed(2)} Td (${escapePdf(value)}) Tj ET`);
 const right=(end:number,yy:number,size:number,value:string,bold=false,rgb=ink)=>text(end-helveticaWidth(safe(value),size,bold),yy,size,value,bold,rgb);
 const rule=(yy:number,rgb=line,x=left,w=width)=>commands.push(`${color(rgb)} RG 0.5 w ${x} ${yy} m ${x+w} ${yy} l S`);
 const fill=(x:number,yy:number,w:number,h:number,rgb:number[])=>commands.push(`${color(rgb)} rg ${x} ${yy} ${w} ${h} re f`);
 const header=()=>{
   fill(40,789,22,22,brand);commands.push('1 1 1 RG 1.1 w 44 800 m 48 800 l 50 805 l 53 795 l 55 800 l 59 800 l S');
   text(70,802,11,'IMEC UTI',true);text(70,790,6.4,'PARTICULAR & HOTELARIA',false,muted);
   right(rightEdge,804,6.5,'RELATÓRIO MENSAL',true,muted);right(rightEdge,789,11,reportCompetence(report.month),true);
 };
 const tableHeader=()=>{
   fill(left,y-19,width,25,paper);let x=left;
   columns.forEach((c,i)=>{if(i===4)right(x+c.width-8,y-10,6.7,c.label,true,muted);else text(x+(i?5:8),y-10,6.7,c.label,true,muted);x+=c.width});y-=37;
 };
 const startPage=(first=false,withTable=true)=>{
   commands=[];pages.push(commands);header();
   if(first){
     text(left,749,24,reportLabel(mode),true);text(left,730,8.4,'Relatório de recebimentos',false,muted);
     rule(716,brand,left,32);
     fill(left,636,width,63,paper);
     text(52,682,6.8,report.manualSelection?'TOTAL LÍQUIDO DA SELEÇÃO':'TOTAL LÍQUIDO RECEBIDO',true,muted);
     text(52,653,22,money(report.netCents/100),true);
     text(360,682,6.5,'RECEBIMENTOS',true,muted);text(360,655,17,String(report.receiptCount),true);
     text(468,682,6.5,'INTERNAÇÕES',true,muted);text(468,655,17,String(report.admissionCount),true);
     text(left,617,7,documentScope(report),true,report.manualSelection?brand:muted);
     y=593;
   }else{
     text(left,757,15,reportLabel(mode),true);right(rightEdge,758,7,'CONTINUAÇÃO',false,muted);
     text(left,739,7,documentScope(report),false,muted);y=714;
   }
   if(withTable)tableHeader();
 };
 startPage(true);
 if(!report.rows.length){text(left+8,y,9,'Nenhum recebimento ou reembolso nesta seleção.',false,muted);y-=38}
 for(const row of report.rows){
   const values=reportRowCells(row,mode),lines=values.map((value,i)=>value.split('\n').flatMap(v=>wrap(v,columns[i].width-13,i===0?8.5:8,i===0||i===4)));
   const count=Math.max(...lines.map(cell=>cell.length)),fullHeight=Math.max(32,count*12+16),freshCapacity=677-bottom;
   // Ordinary rows stay intact. Only a row taller than a full page may continue.
   if(y-fullHeight<bottom&&fullHeight<=freshCapacity)startPage();
   let offset=0;
   while(offset<count){
     if(y<bottom+28)startPage();
     let active=lines.map(cell=>cell.slice(offset)),available=Math.floor((y-bottom-16)/12);
     if(offset>=lines[0].length){
       active[0]=[...wrap(row.patientName,columns[0].width-13,8.5,true).slice(0,2),'(continuação)'];
       available=Math.max(active[0].length,available);
     }
     const take=Math.min(count-offset,Math.max(1,available));
     const repeatingName=offset>=lines[0].length,cellCount=Math.max(take,repeatingName?active[0].length:0),height=Math.max(32,cellCount*12+16);
     if(y-height<bottom){startPage();continue}
     let x=left;
     active.forEach((cell,i)=>{const chunk=repeatingName&&i===0?cell:cell.slice(0,take);chunk.forEach((value,n)=>{
       if(i===4)right(x+columns[i].width-8,y-n*12,8,value,true);
       else text(x+(i?5:8),y-n*12,i===0?8.5:8,value,i===0,i===0?ink:muted);
     });x+=columns[i].width});offset+=take;y-=height;rule(y+9);
   }
 }
 const orderLines=wrap(reportOrderNote(report),width,7.2),closingHeight=116+orderLines.length*11+(includeCommission?29:0)+(includePrivate?100:0)+(report.refundCount?20:0);
 if(y-closingHeight<bottom)startPage(false,false);
 y-=18;text(left,y,9,report.manualSelection?'Total líquido selecionado':'Total líquido recebido',true);right(rightEdge,y-1,16,money(report.netCents/100),true);y-=29;
 if(report.refundCount){text(left,y,7.5,`Recebido: ${money(report.receivedCents/100)}  |  Reembolsado: ${money(report.refundedCents/100)}`,false,muted);y-=20}
 if(includeCommission){text(left,y,8.5,'Comissão Aline Glória - 3%',false,muted);right(rightEdge,y,10,money(report.commissionCents/100),true);y-=29}
 if(includePrivate){
   const fees=privateCommissionSummary(report);
   text(left,y,8.5,'Repasse particular por quitação',true);right(rightEdge,y,10,money(fees.reduce((sum,f)=>sum+f.cents,0)/100),true);y-=19;
   for(const fee of fees){text(left,y,7.5,`${fee.name} - ${fee.count} internação(ões) quitada(s)`,false,muted);right(rightEdge,y,8,money(fee.cents/100));y-=16}
   for(const value of wrap(privateCommissionNote,width,7.2)){text(left,y,7.2,value,false,muted);y-=11}y-=12;
 }

 rule(y+6);y-=15;text(left,y,8.5,reportReference(report.month,mode),true);y-=17;
 for(const value of wrap(reportSelectionNote(report),width,7.2)){text(left,y,7.2,value,false,muted);y-=11}
 for(const value of orderLines){text(left,y,7.2,value,false,muted);y-=11}
 text(left,y-2,7.2,'Competência pela data do recebimento; valores líquidos de reembolsos.',false,muted);
 pages.forEach((page,i)=>{commands=page;rule(63);text(left,47,7,'Emitido em '+reportDate(report.generatedAt),false,muted);right(rightEdge,47,7,`Página ${i+1} de ${pages.length}`,false,muted)});
 const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${pages.map((_,i)=>`${5+i*2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
   '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
 pages.forEach((page,i)=>{const stream=page.join('\n');objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6+i*2} 0 R >>`,`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)});
 let pdf='%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';const offsets=[0];
 objects.forEach((object,i)=>{offsets[i+1]=pdf.length;pdf+=`${i+1} 0 obj\n${object}\nendobj\n`});
 const xref=pdf.length;pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
 offsets.slice(1).forEach(offset=>pdf+=`${String(offset).padStart(10,'0')} 00000 n \n`);
 pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 return Uint8Array.from(pdf,c=>c.charCodeAt(0)&255);
}

export function buildMonthlyReportPrintHtml(report:MonthlyReport,includeCommission=false):string{
 report=orderMonthlyReport(report);
 const mode=report.mode||'hotel',columns=documentColumns(mode),includePrivate=includeCommission&&mode==='private';includeCommission=includeCommission&&mode==='hotel';
 const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
 const rowHtml=report.rows.map(row=>`<tr>${reportRowCells(row,mode).map((value,i)=>`<td class="${i===0?'patient':i===4?'money':''}">${esc(value).replace(/\n/g,'<br>')}</td>`).join('')}</tr>`).join('');
 return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(reportReference(report.month,mode))}</title><style>
 @page{size:A4;margin:14mm 14mm 18mm;@bottom-left{content:'IMEC UTI - ${reportLabel(mode)} - ${reportCompetence(report.month)}${report.manualSelection?' - Seleção manual':''}';font:7pt Arial;color:#66716e}@bottom-right{content:'Página ' counter(page) ' de ' counter(pages);font:7pt Arial;color:#66716e}}
 *{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#20292b;font-size:9pt;margin:0}header{display:flex;justify-content:space-between;align-items:center;margin-bottom:30px}.identity{display:flex;align-items:center;gap:10px}.mark{width:28px;height:28px;background:#125c57;display:grid;place-items:center;color:white;font-weight:bold;font-size:19px}.identity strong{display:block;font-size:11pt}.identity small{display:block;margin-top:4px;font-size:6.4pt;letter-spacing:.08em;color:#65706e}.period{text-align:right}.period small{display:block;font-size:6.5pt;letter-spacing:.09em;color:#65706e}.period strong{display:block;margin-top:6px;font-size:11pt}h1{font-size:24pt;line-height:1.15;margin:0 0 8px;font-weight:700;letter-spacing:-.035em}.subtitle{font-size:8.5pt;color:#65706e;margin:0 0 14px}.accent{width:32px;border-top:1px solid #125c57;margin-bottom:18px}.summary{display:grid;grid-template-columns:minmax(0,1fr) 110px 90px;gap:14px;padding:16px;background:#f6f8f7;border:1px solid #e6ebe8;break-inside:avoid}.summary small{display:block;font-size:6.8pt;font-weight:bold;letter-spacing:.04em;color:#65706e}.summary strong{display:block;margin-top:9px;font-size:17pt;line-height:1.2}.summary .primary strong{font-size:22pt;letter-spacing:-.025em}.scope{font-size:7pt;letter-spacing:.04em;color:#65706e;margin:16px 0 19px}.scope.manual{color:#125c57;font-weight:bold}table{width:100%;border-collapse:collapse;table-layout:fixed;margin:0 0 16px}thead{display:table-header-group}th{text-align:left;padding:9px 5px;font-size:6.7pt;color:#65706e;background:#f6f8f7;font-weight:bold}td{text-align:left;vertical-align:top;padding:12px 5px;border-bottom:1px solid #e3e8e5;font-size:8pt;line-height:1.5;color:#65706e;overflow-wrap:anywhere}.patient{font-size:8.5pt;color:#20292b;font-weight:bold}th:first-child,td:first-child{padding-left:8px}.money{text-align:right;color:#20292b;font-weight:bold;font-variant-numeric:tabular-nums}tr{break-inside:avoid}.closing{break-inside:avoid;padding-top:12px}.total,.commission{display:flex;justify-content:space-between;align-items:baseline;gap:15px}.total{font-size:9pt;font-weight:bold}.total strong{font-size:16pt;letter-spacing:-.02em}.cash{font-size:7.5pt;color:#65706e;margin:12px 0}.commission{font-size:8.5pt;color:#65706e;margin-top:16px}.commission strong{font-size:10pt;color:#20292b}.reference{font-size:8.5pt;font-weight:bold;border-top:1px solid #dce4df;padding-top:17px;margin:19px 0 8px}.note{font-size:7.2pt;color:#65706e;line-height:1.6;margin:3px 0}.issued{font-size:7pt;color:#65706e;border-top:1px solid #dce4df;padding-top:10px;margin-top:25px}.empty{padding:18px 8px;color:#65706e}.tools{display:flex;justify-content:flex-end;gap:8px;border-bottom:1px solid #e3e8e5;padding-bottom:16px;margin-bottom:24px}.tools button{font:12px Arial;padding:10px 15px;border:1px solid #dce4df;border-radius:8px;background:white;color:#125c57;cursor:pointer}@media screen{body{max-width:820px;padding:30px 25px;margin:auto}}@media print{.tools{display:none}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}@media screen and (max-width:580px){body{padding:20px 12px}.summary{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.primary{grid-column:1/-1}table{min-width:650px}.table-wrap{overflow-x:auto}}
 </style></head><body><div class="tools"><button id="printMonthly">Imprimir / salvar PDF</button><button id="closeMonthly">Fechar</button></div><header><div class="identity"><span class="mark"><svg viewBox="0 0 22 22" width="22" height="22" aria-hidden="true"><path d="M3 11h4l2-5 3 10 2-5h5" fill="none" stroke="white" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg></span><div><strong>IMEC UTI</strong><small>PARTICULAR &amp; HOTELARIA</small></div></div><div class="period"><small>RELATÓRIO MENSAL</small><strong>${reportCompetence(report.month)}</strong></div></header><h1>${reportLabel(mode)}</h1><p class="subtitle">Relatório de recebimentos</p><div class="accent"></div><section class="summary"><div class="primary"><small>${report.manualSelection?'TOTAL LÍQUIDO DA SELEÇÃO':'TOTAL LÍQUIDO RECEBIDO'}</small><strong>${esc(money(report.netCents/100))}</strong></div><div><small>RECEBIMENTOS</small><strong>${report.receiptCount}</strong></div><div><small>INTERNAÇÕES</small><strong>${report.admissionCount}</strong></div></section><p class="scope ${report.manualSelection?'manual':''}">${esc(documentScope(report))}</p>${report.rows.length?`<div class="table-wrap"><table><colgroup>${columns.map(c=>`<col style="width:${c.width/515*100}%">`).join('')}</colgroup><thead><tr>${columns.map((c,i)=>`<th class="${i===4?'money':''}">${c.label}</th>`).join('')}</tr></thead><tbody>${rowHtml}</tbody></table></div>`:'<p class="empty">Nenhum recebimento ou reembolso nesta seleção.</p>'}<section class="closing"><div class="total"><span>${report.manualSelection?'Total líquido selecionado':'Total líquido recebido'}</span><strong>${esc(money(report.netCents/100))}</strong></div>${report.refundCount?`<p class="cash">Recebido: ${esc(money(report.receivedCents/100))} &nbsp;|&nbsp; Reembolsado: ${esc(money(report.refundedCents/100))}</p>`:''}${includeCommission?`<div class="commission"><span>Comissão Aline Glória - 3%</span><strong>${esc(money(report.commissionCents/100))}</strong></div>`:''}${includePrivate?`<div class="commission"><span>Repasse particular por quitação</span><strong>${esc(money(privateCommissionSummary(report).reduce((sum,f)=>sum+f.cents,0)/100))}</strong></div>${privateCommissionSummary(report).map(f=>`<div class="commission"><span>${f.name} · ${f.count} internação(ões) quitada(s)</span><strong>${esc(money(f.cents/100))}</strong></div>`).join('')}<p class="note">${esc(privateCommissionNote)}</p>`:''}<p class="reference">${esc(reportReference(report.month,mode))}</p><p class="note">${esc(reportSelectionNote(report))}</p><p class="note">${esc(reportOrderNote(report))}</p><p class="note">Competência pela data do recebimento; valores líquidos de reembolsos.</p></section><p class="issued">Emitido em ${reportDate(report.generatedAt)}</p></body></html>`;
}
