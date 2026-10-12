import {describe,it,before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {isolatedDatabase,createSyntheticAdmission} from './fixtures/imec-uti-database.ts';

describe('edição administrativa de recebimentos — PostgreSQL isolado',()=>{
 let f:Awaited<ReturnType<typeof isolatedDatabase>>,id:string,pid:string,version:number;
 const when='2026-10-02T14:00:00-03:00';
 const dates=['2026-11-03','2026-12-02','2027-01-04','2027-02-01','2027-03-04'];
 before(async()=>{f=await isolatedDatabase();});
 after(async()=>{await f?.db.close();});
 beforeEach(async()=>{
   await f.db.exec('reset role;begin');await f.asUser('admin');id=await createSyntheticAdmission(f.db);
   const s=(await f.db.query('select public.preview_uti_settlement($1,$2::timestamptz) as s',[id,'2026-10-03T12:00:00-03:00'])).rows[0].s;
   await f.db.query('select public.discharge_uti($1,$2::timestamptz,$3::bigint)',[id,s.dischargeAt,s.accountVersion]);
   await f.db.query('select public.add_uti_payment($1,$2::timestamptz,$3,$4,$5,$6)',[id,when,800,'PIX','Observação original','edit-fixture-original']);
   pid=(await f.db.query('select id from public.payments where admission_id=$1',[id])).rows[0].id;
   version=await currentVersion();
 });
 afterEach(async()=>{await f.db.exec('rollback;reset role');});
 const currentVersion=async()=>Number((await f.db.query('select account_version from public.admissions where id=$1',[id])).rows[0].account_version);
 const edit=async(o:{amount?:number|string,when?:string,method?:string,card?:string|null,dates?:string[],notes?:string|null,reason?:string,ref?:string,version?:number|null}={})=>
   (await f.db.query('select public.edit_uti_payment($1,$2::bigint,$3::numeric,$4::timestamptz,$5,$6,$7::date[],$8,$9,$10) as status',
    [pid,o.version===undefined?version:o.version,o.amount??800,o.when??when,o.method??'Cartão',o.card===undefined?'credit':o.card,o.dates??dates,o.notes===undefined?'Observação corrigida':o.notes,o.reason??'Forma de pagamento incorreta',o.ref??'receipt-edit-reference-001'])).rows[0].status;
 const rejects=async(work:()=>Promise<unknown>,pattern:RegExp)=>{
   await f.db.exec('savepoint expected_error');
   try{await assert.rejects(work,pattern);}finally{await f.db.exec('rollback to savepoint expected_error;release savepoint expected_error');}
 };
 const payment=async()=>(await f.db.query('select to_jsonb(p) as p from public.payments p where id=$1',[pid])).rows[0].p;

 it('PIX para crédito 5x em conta finalizada mantém identidade, valor e responsável, com antes/depois',async()=>{
   const old=await payment();assert.equal(await edit(),'finalized');const p=await payment();
   assert.equal(p.id,old.id);assert.equal(p.amount,old.amount);assert.equal(p.occurred_at,old.occurred_at);
   assert.equal(p.created_by,old.created_by);assert.equal(p.created_at,old.created_at);assert.equal(p.client_ref,old.client_ref);
   assert.equal(p.method,'Cartão');assert.equal(p.card_type,'credit');assert.deepEqual(p.installment_dates,dates);
   assert.equal(await currentVersion(),version+1);
   const e=(await f.db.query('select before_data,after_data,reason from public.payment_edits where payment_id=$1',[pid])).rows[0];
   assert.deepEqual(e.before_data,old);assert.deepEqual(e.after_data,p);assert.equal(e.reason,'Forma de pagamento incorreta');
   assert.equal((await f.db.query("select count(*)::int n from public.audits where admission_id=$1 and action='Recebimento editado'",[id])).rows[0].n,1);
 });
 it('redução do valor reabre saldo após alta, sem mudar diárias ou criar novo pagamento',async()=>{
   const charges=(await f.db.query('select jsonb_agg(to_jsonb(c) order by id) as rows from public.charges c where admission_id=$1',[id])).rows[0].rows;
   assert.equal(await edit({amount:500}),'discharge_pending');
   assert.deepEqual((await f.db.query('select jsonb_agg(to_jsonb(c) order by id) as rows from public.charges c where admission_id=$1',[id])).rows[0].rows,charges);
   assert.equal((await f.db.query('select count(*)::int n from public.payments where admission_id=$1',[id])).rows[0].n,1);
   assert.equal(await edit({amount:800,version:await currentVersion(),ref:'receipt-edit-second-restore'}),'finalized');
 });
 it('repetição de resposta perdida é idempotente; referência divergente não sobrescreve',async()=>{
   await edit();assert.equal(await edit(),'finalized');assert.equal(await currentVersion(),version+1);
   await rejects(()=>edit({notes:'Outro conteúdo'}),/Identificador já utilizado/);
   assert.equal((await f.db.query('select count(*)::int n from public.payment_edits where payment_id=$1',[pid])).rows[0].n,1);
 });
 it('versão desatualizada e motivo ausente não gravam nenhuma correção',async()=>{
   await rejects(()=>edit({version:version-1}),/conta foi alterada/);await rejects(()=>edit({version:null}),/conta foi alterada/);
   await rejects(()=>edit({reason:'erro'}),/motivo/);assert.equal((await payment()).method,'PIX');
 });
 it('valores, datas futuras, anteriores à entrada e parcelas inválidas são rejeitados',async()=>{
   for(const amount of ['NaN','Infinity',0,-1,800.001,1000001])await rejects(()=>edit({amount}),/valor positivo/);
   for(const date of ['infinity','2026-09-30T12:00:00-03:00',new Date(Date.now()+86400000).toISOString()])await rejects(()=>edit({when:date}),/data real|anterior à entrada/);
   for(const ds of [[],['infinity'],['2026-10-01'],[dates[1],dates[0]]])await rejects(()=>edit({dates:ds}),/vencimentos|Vencimento|ordem crescente/);
   await rejects(()=>edit({card:null}),/crédito ou débito/);await rejects(()=>edit({method:'PIX'}),/crédito ou débito/);
   assert.equal((await payment()).method,'PIX');
 });
 it('aumento não pode criar excesso de recebimento ou consumir saldo reservado por previsão',async()=>{
   await rejects(()=>edit({amount:801}),/saldo disponível/);
   await edit({amount:500});version=await currentVersion();
   await f.db.query('select public.schedule_uti_receipt($1,$2::timestamptz,$3,$4,$5::date[],$6,$7)',[id,new Date(Date.now()+86400000).toISOString(),300,'PIX',[],null,'edit-reserved-forecast']);version=await currentVersion();
   await rejects(()=>edit({amount:600,ref:'edit-over-reserved-balance'}),/saldo disponível/);
 });
 it('trocar crédito por dinheiro ou débito limpa parcelas; alteração de data aceita dias após a alta',async()=>{
   await edit();version=await currentVersion();
   await edit({method:'Dinheiro',card:null,dates:[],notes:null,when:new Date(Date.now()-60000).toISOString(),ref:'edit-credit-to-cash-reference'});
   assert.deepEqual((await payment()).installment_dates,[]);assert.equal((await payment()).notes,null);
   version=await currentVersion();await edit({method:'Cartão',card:'debit',dates:[],ref:'edit-cash-to-debit-reference'});assert.equal((await payment()).card_type,'debit');
 });
 it('redução não pode deixar recebimentos líquidos abaixo dos reembolsos realizados',async()=>{
   await f.db.exec('reset role');await f.db.query('update public.rate_periods set negotiated_rate=200 where admission_id=$1',[id]);
   await f.db.query('select private.reconcile_daily_charges($1,$2::timestamptz,$3)',[id,'2026-10-03T12:00:00-03:00','Synthetic admin']);
   await f.db.query('select private.reconcile_admission_status($1)',[id]);await f.asUser('admin');
   await f.db.query('select public.add_uti_refund($1,$2::timestamptz,$3,$4,$5,$6)',[id,when,300,'PIX',null,'edit-fixture-refund']);version=await currentVersion();
   await rejects(()=>edit({amount:200}),/reembolsos já realizados/);
 });
 it('pagamento estornado não admite correção',async()=>{
   await f.db.query('select public.cancel_uti_payment($1,$2)',[pid,'Estorno sintético autorizado']);version=await currentVersion();
   await rejects(()=>edit(),/cancelados não podem ser editados/);
 });
 it('comercial, operador, inativo, sessão inválida e anônimo não podem editar ou gravar revisões diretamente',async()=>{
   for(const role of ['commercial','operator','inactive'] as const){await f.asUser(role);await rejects(()=>edit(),/Somente administradores/);}
   await f.asUser('admin','aal1',false);await rejects(()=>edit(),/Somente administradores/);
   await f.asUser('anon');await rejects(()=>edit(),/permission denied/);
   await f.asUser('admin');await rejects(()=>f.db.query('update public.payment_edits set reason=$1',['Gravação não autorizada']),/permission denied/);
 });
 it('edição de pagamento confirmado mantém vínculo da previsão e não permite duplicar confirmação',async()=>{
   await edit({amount:500});version=await currentVersion();
   const s=(await f.db.query('select public.schedule_uti_receipt($1,$2::timestamptz,$3,$4,$5::date[],$6,$7) as id',[id,new Date(Date.now()+86400000).toISOString(),300,'PIX',[],null,'edit-confirmed-forecast'])).rows[0].id;
   await f.db.query('select public.confirm_uti_receipt($1,$2::timestamptz,$3,$4::date[],$5)',[s,when,'PIX',[],null]);
   pid=(await f.db.query('select payment_id from public.scheduled_receipts where id=$1',[s])).rows[0].payment_id;version=await currentVersion();
   await edit({amount:300,ref:'edit-confirmed-payment-reference'});
   assert.equal((await f.db.query('select payment_id from public.scheduled_receipts where id=$1',[s])).rows[0].payment_id,pid);
   await rejects(()=>f.db.query('select public.confirm_uti_receipt($1,$2::timestamptz,$3,$4::date[],$5)',[s,when,'PIX',[],null]),/Identificador|confirmad[oa]|divergente/);
   assert.equal((await f.db.query('select count(*)::int n from public.payments where admission_id=$1',[id])).rows[0].n,2);
 });
});
