import {businessParts,monthKey,money} from './domain.ts';

export type MonthlyReportRow={admissionId:string;patientName:string;entryAt:string;dischargeAt:string|null;bedType:string;netCents:number;receiptCount:number;refundCount:number};
export type MonthlyReport={month:string;generatedAt:string;receivedCents:number;refundedCents:number;netCents:number;receiptCount:number;refundCount:number;admissionCount:number;commissionPercent:number;commissionCents:number;rows:MonthlyReportRow[]};
export function previousReportMonth(now=new Date()):string{
 const [year,month]=monthKey(now).split('-').map(Number);
 return `${month===1?year-1:year}-${String(month===1?12:month-1).padStart(2,'0')}`;
}
export function reportCompetence(month:string):string{
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('Informe uma competência válida.');
 return `${month.slice(5)}/${month.slice(0,4)}`;
}
export function reportReference(month:string):string{return `Leito humanizado ref. competência ${reportCompetence(month)}`;}
export function reportDate(value:string|null):string{
 if(!value)return 'Em internação';
 const p=businessParts(value);return `${String(p.day).padStart(2,'0')}/${String(p.month).padStart(2,'0')}/${p.year}`;
}
export function monthlyReportFilename(report:MonthlyReport,commission=false,extension='pdf'):string{
 return `IMEC_Leito_Humanizado_${report.month}${commission?'_Comissao_Aline_Gloria':''}.${extension}`;
}
export function monthlyReportCsv(report:MonthlyReport,commission=false):string{
 const cell=(value:unknown)=>{
   if(typeof value==='number')return '"'+value.toFixed(2).replace('.',',')+'"';
   let s=String(value??'');if(/^[\s]*[=+\-@\t\r]/.test(s))s="'"+s;
   return '"'+s.replace(/"/g,'""')+'"';
 };
 const rows:unknown[][]=[['Nome do paciente','Entrada','Alta','Valor total','Tipo de leito'],
   ...report.rows.map(r=>[r.patientName,reportDate(r.entryAt),reportDate(r.dischargeAt),r.netCents/100,r.bedType]),
   ['TOTAL','','',report.netCents/100,''],['','','','',''],[reportReference(report.month),'','','','']];
 if(commission)rows.push(['Comissão Aline Glória - 3%','','',report.commissionCents/100,'']);
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
 const pages:string[][]=[];let commands:string[]=[];let y=0;
 const text=(x:number,yy:number,size:number,value:unknown,bold=false)=>commands.push(`BT /F${bold?2:1} ${size} Tf ${x.toFixed(2)} ${yy.toFixed(2)} Td (${escapePdf(value)}) Tj ET`);
 const right=(end:number,yy:number,size:number,value:string,bold=false)=>text(end-textWidth(value,size),yy,size,value,bold);
 const rule=(yy:number)=>commands.push(`0.87 G 0.5 w 40 ${yy} m 555 ${yy} l S 0 g`);
 const startPage=()=>{
   commands=['0 g'];pages.push(commands);
   text(40,802,17,'IMEC UTI',true);right(555,804,9,'Competência '+reportCompetence(report.month),true);
   text(40,777,14,'Leito humanizado',true);
   commands.push('0.4 g');text(40,759,8,'Recebimentos confirmados no mês, descontados os reembolsos.');
   text(40,746,8,`${report.receiptCount} recebimento(s) - ${report.admissionCount} internação(ões)`);commands.push('0 g');rule(732);
   text(40,716,7.5,'NOME DO PACIENTE',true);text(255,716,7.5,'ENTRADA',true);text(325,716,7.5,'ALTA',true);right(495,716,7.5,'VALOR TOTAL',true);text(510,716,7.5,'LEITO',true);
   rule(705);y=686;
 };
 startPage();
 if(!report.rows.length){text(40,y,10,'Nenhum recebimento ou reembolso de leito humanizado nesta competência.');y-=35;}
 for(const row of report.rows){
   let names=wrap(row.patientName,205,8.5),first=true;
   while(names.length){
     if(y<110)startPage();
     const space=Math.floor((y-94)/12),chunk=names.splice(0,Math.max(1,space));
     const height=Math.max(24,chunk.length*12+10);
     if(height>y-90&&pages.length>0){startPage();names=chunk.concat(names);continue;}
     chunk.forEach((name,i)=>text(40,y-i*12,8.5,name));
     if(first){text(255,y,8.5,reportDate(row.entryAt));text(325,y,8.5,row.dischargeAt?reportDate(row.dischargeAt):'Em internação');right(495,y,8.5,money(row.netCents/100));text(510,y,8.5,row.bedType);first=false;}
     y-=height;rule(y+9);
   }
 }
 const needed=includeCommission?153:119;
 if(y<needed+90)startPage();
 y-=12;text(40,y,10,'TOTAL LÍQUIDO RECEBIDO',true);right(555,y,14,money(report.netCents/100),true);y-=26;
 if(report.refundCount){commands.push('0.4 g');text(40,y,8,`Recebido: ${money(report.receivedCents/100)} | Reembolsado: ${money(report.refundedCents/100)}`);commands.push('0 g');y-=21;}
 if(includeCommission){text(40,y,9,'Comissão Aline Glória - 3%',true);right(555,y,11,money(report.commissionCents/100),true);y-=25;}
 rule(y+3);y-=18;text(40,y,10,reportReference(report.month),true);
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
