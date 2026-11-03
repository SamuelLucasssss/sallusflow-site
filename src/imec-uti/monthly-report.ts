import {businessParts,monthKey,money} from './domain.ts';

export type ReportMode='hotel'|'private';
export type MonthlyReportRow={admissionId:string;patientName:string;entryAt:string;dischargeAt:string|null;bedType:string;responsible?:string;netCents:number;receiptCount:number;refundCount:number;receiptDates?:string[];refundDates?:string[]};
export type MonthlyReportMovement=Omit<MonthlyReportRow,'netCents'|'receiptCount'|'refundCount'> & {key:string;occurredAt:string;amountCents:number;kind:'receipt'|'refund';method:string;cardType?:string|null;included:boolean};
export type MonthlyReport={month:string;mode?:ReportMode;generatedAt:string;receivedCents:number;refundedCents:number;netCents:number;receiptCount:number;refundCount:number;admissionCount:number;commissionPercent:number;commissionCents:number;rows:MonthlyReportRow[];movements?:MonthlyReportMovement[];sourceSnapshot?:string;candidateCount?:number;selectedCount?:number;manualSelection?:boolean};
export const reportLabel=(mode:ReportMode='hotel')=>mode==='private'?'Particular':'Leito humanizado';
export function selectMonthlyReport(report:MonthlyReport,selected:Iterable<string>|null=null):MonthlyReport{
 if(!report.movements)return report;
 const keys=selected===null?new Set(report.movements.map(m=>m.key)):new Set(selected);
 if([...keys].some(k=>!report.movements!.some(m=>m.key===k)))throw new Error('Seleção fora da modalidade ou competência.');
 const movements=report.movements.map(m=>({...m,included:keys.has(m.key)})),groups=new Map<string,MonthlyReportRow>();let received=0,refunded=0,receipts=0,refunds=0;
 for(const m of movements){if(!m.included)continue;
   let row=groups.get(m.admissionId);if(!row){row={admissionId:m.admissionId,patientName:m.patientName,entryAt:m.entryAt,dischargeAt:m.dischargeAt,bedType:m.bedType,responsible:m.responsible,netCents:0,receiptCount:0,refundCount:0,receiptDates:[],refundDates:[]};groups.set(m.admissionId,row)}
   if(m.kind==='receipt'){received+=m.amountCents;receipts++;row.netCents+=m.amountCents;row.receiptCount++;row.receiptDates!.push(m.occurredAt)}
   else{refunded+=m.amountCents;refunds++;row.netCents-=m.amountCents;row.refundCount++;row.refundDates!.push(m.occurredAt)}
 }
 const net=received-refunded,commission=report.mode!=='private'?Math.sign(net)*Math.round(Math.abs(net)*3/100):0;
 return {...report,movements,rows:[...groups.values()].sort((a,b)=>a.patientName.localeCompare(b.patientName,'pt-BR')||a.entryAt.localeCompare(b.entryAt)||a.admissionId.localeCompare(b.admissionId)),receivedCents:received,refundedCents:refunded,netCents:net,receiptCount:receipts,refundCount:refunds,admissionCount:groups.size,commissionCents:commission,selectedCount:keys.size,candidateCount:movements.length,manualSelection:keys.size!==movements.length};
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
 return `IMEC_${report.mode==='private'?'Particular':'Leito_Humanizado'}_${report.month}${report.manualSelection?'_Selecao':''}${commission&&report.mode!=='private'?'_Comissao_Aline_Gloria':''}.${extension}`;
}
export function monthlyReportCsv(report:MonthlyReport,commission=false):string{
 const cell=(value:unknown)=>{
   if(typeof value==='number')return '"'+value.toFixed(2).replace('.',',')+'"';
   let s=String(value??'');if(/^[\s]*[=+\-@\t\r]/.test(s))s="'"+s;
   return '"'+s.replace(/"/g,'""')+'"';
 };
 const mode=report.mode||'hotel';
 const rows:unknown[][]=[reportColumns(mode).map(c=>c.label),
   ...report.rows.map(r=>{const cells:unknown[]=reportRowCells(r,mode);cells[4]=r.netCents/100;return cells}),
   ['TOTAL','','','',report.netCents/100],[],[reportReference(report.month,mode)],[reportSelectionNote(report)]];
 if(commission&&mode==='hotel')rows.push(['Comissão Aline Glória - 3%','','','',report.commissionCents/100]);
 return '\ufeff'+rows.map(row=>row.map(cell).join(';')).join('\r\n');
}
// Browser-native PDF: Helvetica/WinAnsi, A4, repeated headers and full patient names.
const safe=(value:unknown)=>String(value??'').normalize('NFC').replace(/\u00a0/g,' ').replace(/[–—]/g,'-').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/[^\x20-\xFF]/g,'?');
const escapePdf=(value:unknown)=>safe(value).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
function textWidth(value:string,size:number):number{
 return Array.from(safe(value)).reduce((n,c)=>n+(/[ilI.,:;'!|]/.test(c)?0.25:/[MWmw]/.test(c)?0.9:c===' '?0.28:/[A-ZÀ-Ý]/.test(c)?0.7:0.56)*size,0);
}
function wrap(value:string,width:number,size:number):string[]{
 const lines:string[]=[];let line='';
 for(const word of safe(value).split(/\s+/).filter(Boolean)){
   if(line&&textWidth(line+' '+word,size)>width){lines.push(line);line='';}
   for(const char of word){if(textWidth(line+char,size)>width){lines.push(line);line='';}line+=char;}
   line+=' ';
 }
 if(line.trim())lines.push(line.trim());return lines.length?lines:['Paciente'];
}
export function buildMonthlyReportPdf(report:MonthlyReport,includeCommission=false):Uint8Array{
 const mode=report.mode||'hotel',columns=reportColumns(mode);includeCommission=includeCommission&&mode==='hotel';
 const pages:string[][]=[];let commands:string[]=[];let y=0;
 const text=(x:number,yy:number,size:number,value:unknown,bold=false)=>commands.push(`BT /F${bold?2:1} ${size} Tf ${x.toFixed(2)} ${yy.toFixed(2)} Td (${escapePdf(value)}) Tj ET`);
 const right=(end:number,yy:number,size:number,value:string,bold=false)=>text(end-textWidth(value,size),yy,size,value,bold);
 const rule=(yy:number)=>commands.push(`0.87 G 0.5 w 40 ${yy} m 555 ${yy} l S 0 g`);
 const startPage=()=>{
   commands=['0 g'];pages.push(commands);
   text(40,802,17,'IMEC UTI',true);right(555,804,9,'Competência '+reportCompetence(report.month),true);
   text(40,777,14,reportLabel(mode),true);
   commands.push('0.4 g');text(40,759,8,'Recebimentos confirmados no mês, descontados os reembolsos.');
   text(40,746,8,`${report.receiptCount} recebimento(s) - ${report.admissionCount} internação(ões)`);commands.push('0 g');rule(732);
   let x=40;columns.forEach((c,i)=>{if(i===4)right(x+c.width-7,716,7,c.label.toUpperCase(),true);else text(x,716,7,c.label.toUpperCase(),true);x+=c.width;});
   rule(705);y=686;
 };
 startPage();
 if(!report.rows.length){text(40,y,9,'Nenhum recebimento ou reembolso nesta seleção.');y-=35;}
 for(const row of report.rows){
   const lines=reportRowCells(row,mode).map((value,i)=>value.split('\n').flatMap(line=>wrap(line,columns[i].width-8,i===0?8.5:7.5)));
   let offset=0;const count=Math.max(...lines.map(cell=>cell.length));
   while(offset<count){
     if(y<110)startPage();
     const space=Math.max(1,Math.floor((y-104)/12)),take=Math.min(count-offset,space),height=Math.max(26,take*12+12);
     if(height>y-90){startPage();continue;}
     let x=40;lines.forEach((cell,i)=>{cell.slice(offset,offset+take).forEach((line,n)=>{if(i===4)right(x+columns[i].width-7,y-n*12,7.5,line);else text(x,y-n*12,i===0?8.5:7.5,line)});x+=columns[i].width});offset+=take;
     y-=height;rule(y+9);
   }
 }
 const needed=includeCommission?153:119;
 if(y<needed+90)startPage();
 y-=12;text(40,y,10,report.manualSelection?'TOTAL LÍQUIDO DA SELEÇÃO':'TOTAL LÍQUIDO RECEBIDO',true);right(555,y,14,money(report.netCents/100),true);y-=26;
 if(report.refundCount){commands.push('0.4 g');text(40,y,8,`Recebido: ${money(report.receivedCents/100)} | Reembolsado: ${money(report.refundedCents/100)}`);commands.push('0 g');y-=21;}
 if(includeCommission){text(40,y,9,'Comissão Aline Glória - 3%',true);right(555,y,11,money(report.commissionCents/100),true);y-=25;}
 rule(y+3);y-=18;text(40,y,10,reportReference(report.month,mode),true);y-=18;text(40,y,8,reportSelectionNote(report));
 pages.forEach((page,i)=>{
   commands=page;rule(63);commands.push('0.4 g');text(40,48,7,'Emitido em '+reportDate(report.generatedAt));right(555,48,7,`Página ${i+1} de ${pages.length}`);
 });
 const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${pages.map((_,i)=>`${5+i*2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
   '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
 pages.forEach((page,i)=>{const stream=page.join('\n');objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6+i*2} 0 R >>`,`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);});
 let pdf='%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';const offsets=[0];
 objects.forEach((object,i)=>{offsets[i+1]=pdf.length;pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;});
 const xref=pdf.length;pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
 offsets.slice(1).forEach(offset=>pdf+=`${String(offset).padStart(10,'0')} 00000 n \n`);
 pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 return Uint8Array.from(pdf,c=>c.charCodeAt(0)&255);
}
