import fs from 'node:fs';
import vm from 'node:vm';
import { money, cpfMask, fmtDT, balanceMeta } from '../../src/imec-uti/domain.ts';
import { paymentMethodLabel, installmentSummary } from '../../src/imec-uti/payment-details.ts';

export const sampleAdmission = { id:'12345678-1234-1234-1234-123456789012',patientId:'sample',mode:'private',bed:3,entryAt:'2026-10-05T12:00:00Z',dischargeAt:'2026-10-08T13:00:00Z',closer:'Equipe comercial' };
export const sampleSettlement = {
  dischargeAt:sampleAdmission.dischargeAt,stayMinutes:4380,dailyUnits:3,fullDailyCount:3,halfDailyCount:0,
  dailyTotal:21000,extrasTotal:600,total:21600,received:21600,refunded:0,balance:0,
  items:[{kind:'daily',description:'Diária particular',amount:21000,units:3,occurredAt:sampleAdmission.entryAt},{kind:'extra',description:'Avaliação cardiológica',amount:600,occurredAt:'2026-10-06T14:00:00Z'}],
  payments:[
    {occurredAt:'2026-10-05T13:00:00Z',amount:10000,method:'PIX'},
    {occurredAt:'2026-10-07T15:00:00Z',amount:10000,method:'Cartão',cardType:'credit',installmentDates:['2026-11-07','2026-12-07','2027-01-07']},
    {occurredAt:'2026-10-08T13:00:00Z',amount:1000,method:'Cartão',cardType:'debit',installmentDates:[]},
    {occurredAt:'2026-10-08T13:00:00Z',amount:600,method:'Dinheiro'}
  ],refunds:[]
};

export function settlementHarness(name='Maria Helena de Oliveira Santos') {
  const source=fs.readFileSync('src/imec-uti/app.ts','utf8');
  let html='',resolveOutput:()=>void;
  const output=new Promise<void>(resolve=>{resolveOutput=resolve;});
  const listeners=new Map<string,Function>();
  const events:string[]=[];
  const win={closed:false,focus(){},print(){},close(){},document:{
    open(){},write(value:string){html=value;},close(){resolveOutput();},
    getElementById(id:string){return {addEventListener(_:string,listener:Function){listeners.set(id,listener);}}}
  }};
  const context=vm.createContext({money,cpfMask,fmtDT,balanceMeta,paymentMethodLabel,installmentSummary,Intl,Date,Blob,Uint8Array,
    patient:()=>({name,cpf:'12345678900'}),data:{currentUser:'Equipe IMEC'},
    esc:(s:unknown)=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]!)),
    window:{open:()=>win},alert:(message:string)=>{throw new Error(message);},
    logDocumentOutput:async (_:string,event:string)=>{events.push(event);}
  });
  vm.runInContext(source.slice(source.indexOf('function accommodationLabel'),source.indexOf('function settlementPreviewMarkup')),context);
  vm.runInContext(source.slice(source.indexOf('function docDateOnly'),source.indexOf('async function logDocumentOutput')),context);
  vm.runInContext(source.slice(source.indexOf('function printSettlementSheet'),source.indexOf('function dischargeModal')),context);
  return {context,events,listeners,pdf:(s=sampleSettlement)=>context.buildSettlementPdfBytes(sampleAdmission,s),
    model:(s=sampleSettlement)=>context.settlementDocumentModel(sampleAdmission,s),
    async print(s=sampleSettlement){context.printSettlementSheet(sampleAdmission,s);await output;return html;}};
}
