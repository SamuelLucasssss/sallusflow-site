import {describe,it,before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {isolatedDatabase,createSyntheticAdmission} from './fixtures/imec-uti-database.ts';

describe('correção de entrada e primeira diária — PostgreSQL isolado',()=>{
 let f:Awaited<ReturnType<typeof isolatedDatabase>>,id:string,version:number;
 const original='2026-10-01T12:00:00-03:00';
 before(async()=>{f=await isolatedDatabase();});after(async()=>{await f?.db.close();});
 const account=async()=>(await f.db.query('select to_jsonb(a) a from public.admissions a where id=$1',[id])).rows[0].a;
 const currentVersion=async()=>Number((await account()).account_version);
 const billed=async()=>Number((await f.db.query('select coalesce(sum(amount),0) n from public.charges where admission_id=$1 and cancelled_at is null',[id])).rows[0].n);
 const withRateChange=async()=>{
   id=await createSyntheticAdmission(f.db,{bed:11});
   await f.db.query("select public.adjust_uti_rate($1,'2026-10-02T07:00:00-03:00',300,false)",[id]);
   const s=(await f.db.query("select public.preview_uti_settlement($1,'2026-10-03T12:00:00-03:00') s",[id])).rows[0].s;
   await f.db.query('select public.discharge_uti($1,$2::timestamptz,$3::bigint)',[id,s.dischargeAt,s.accountVersion]);version=await currentVersion();
 };
 const edit=async(o:{entry?:string|null,half?:boolean|null,reason?:string,ref?:string,version?:number|null}={})=>
   (await f.db.query('select public.edit_uti_admission_initial($1,$2::bigint,$3::timestamptz,$4::boolean,$5,$6) status',
     [id,o.version===undefined?version:o.version,o.entry===undefined?original:o.entry,o.half===undefined?true:o.half,o.reason??'Primeira diária informada incorretamente',o.ref??'admission-edit-reference-001'])).rows[0].status;
 const rejects=async(work:()=>Promise<unknown>,pattern:RegExp)=>{
   await f.db.exec('savepoint expected_error');try{await assert.rejects(work,pattern);}finally{await f.db.exec('rollback to savepoint expected_error;release savepoint expected_error');}
 };
 beforeEach(async()=>{
   await f.db.exec('reset role;begin');await f.asUser('admin');id=await createSyntheticAdmission(f.db);
   const s=(await f.db.query('select public.preview_uti_settlement($1,$2::timestamptz) s',[id,'2026-10-03T12:00:00-03:00'])).rows[0].s;
   await f.db.query('select public.discharge_uti($1,$2::timestamptz,$3::bigint)',[id,s.dischargeAt,s.accountVersion]);version=await currentVersion();
 });
 afterEach(async()=>{await f.db.exec('rollback;reset role');});
 it('troca integral por meia e volta a integral, preservando as outras diárias e registrando antes/depois',async()=>{
   const old=(await f.db.query('select * from public.charges where admission_id=$1 and occurred_at=$2::timestamptz',[id,original])).rows[0];
   const later=(await f.db.query('select to_jsonb(c) c from public.charges c where admission_id=$1 and occurred_at>$2::timestamptz and cancelled_at is null',[id,original])).rows;
   await edit();assert.equal(await billed(),600);assert.equal((await account()).half_initial,true);
   const previous=(await f.db.query('select * from public.charges where id=$1',[old.id])).rows[0];assert.ok(previous.cancelled_at);assert.equal(previous.amount,old.amount);
   assert.deepEqual((await f.db.query('select to_jsonb(c) c from public.charges c where admission_id=$1 and occurred_at>$2::timestamptz and cancelled_at is null',[id,original])).rows,later);
   const e=(await f.db.query('select before_data,after_data from public.admission_initial_edits where admission_id=$1',[id])).rows[0];assert.equal(e.before_data.halfInitial,false);assert.equal(e.after_data.halfInitial,true);
   assert.equal(e.before_data.billed,800);assert.equal(e.after_data.billed,600);
   await edit({half:false,version:await currentVersion(),ref:'admission-edit-restore-integral'});assert.equal(await billed(),800);
 });
 it('corrige entrada retroativa às 23:40, move apenas a condição inicial e recalcula os dias',async()=>{
   await withRateChange();
   const rate=(await f.db.query("select to_jsonb(r) r from public.rate_periods r where admission_id=$1 and effective_at='2026-10-02T07:00:00-03:00'",[id])).rows[0].r;
   const entry='2026-09-30T23:40:00-03:00';await edit({entry});
   assert.equal((await account()).entry_at,'2026-10-01T02:40:00+00:00');assert.equal(await billed(),900);
   assert.deepEqual((await f.db.query('select to_jsonb(r) r from public.rate_periods r where id=$1',[rate.id])).rows[0].r,rate);
   assert.equal((await f.db.query("select to_char(effective_at at time zone 'America/Sao_Paulo','YYYY-MM-DD HH24:MI') as dt from public.rate_periods where admission_id=$1 order by effective_at limit 1",[id])).rows[0].dt,'2026-09-30 23:40');
 });
 it('conta quitada ganha crédito ou reabre saldo sem mudar os pagamentos',async()=>{
   await f.db.query("select public.add_uti_payment($1,'2026-10-02T14:00:00-03:00',800,'PIX',null,'admission-edit-original-payment')",[id]);version=await currentVersion();
   const p=(await f.db.query('select to_jsonb(p) p from public.payments p where admission_id=$1',[id])).rows;
   assert.equal(await edit(),'discharge_pending');assert.equal(await billed(),600);
   assert.deepEqual((await f.db.query('select to_jsonb(p) p from public.payments p where admission_id=$1',[id])).rows,p);
   assert.equal(await edit({half:false,version:await currentVersion(),ref:'admission-edit-full-restored'}),'finalized');
 });
 it('repetição da mesma solicitação é idempotente; versão antiga e referência divergente não sobrescrevem',async()=>{
   await edit();const v=await currentVersion();await edit();assert.equal(await currentVersion(),v);
   await rejects(()=>edit({half:false}),/Identificador já utilizado/);
   await rejects(()=>edit({half:false,ref:'admission-edit-stale-reference'}),/conta foi alterada/);
   assert.equal((await f.db.query('select count(*)::int n from public.admission_initial_edits where admission_id=$1',[id])).rows[0].n,1);
 });
 it('datas futuras, infinitas, ausentes, depois da alta e motivo curto são rejeitados',async()=>{
   for(const entry of ['infinity','-infinity',null,new Date(Date.now()+86400000).toISOString()])await rejects(()=>edit({entry}),/entrada válida/);
   await rejects(()=>edit({entry:'2026-10-04T12:00:00-03:00'}),/posterior à alta/);
   await rejects(()=>edit({reason:'erro'}),/motivo/);await rejects(()=>edit({half:null}),/Escolha/);
   await rejects(()=>edit({half:false}),/Nenhuma alteração/);assert.equal(await billed(),800);
 });
 it('entrada não pode avançar além de recebimentos, extras ou condições posteriores',async()=>{
   await withRateChange();
   await f.db.query("select public.add_uti_payment($1,'2026-10-01T13:00:00-03:00',100,'PIX',null,'admission-edit-early-payment')",[id]);version=await currentVersion();
   await rejects(()=>edit({entry:'2026-10-01T14:00:00-03:00'}),/lançamentos anteriores/);
   await rejects(()=>edit({entry:'2026-10-02T08:00:00-03:00'}),/alteração de diária/);
 });
 it('redução não ultrapassa o saldo reservado por previsões e desfaz toda a tentativa',async()=>{
   await f.db.query('select public.schedule_uti_receipt($1,$2::timestamptz,800,$3,$4::date[],null,$5)',[id,new Date(Date.now()+86400000).toISOString(),'PIX',[],'admission-edit-reserved-forecast']);version=await currentVersion();
   await rejects(()=>edit(),/previsões primeiro/);assert.equal(await billed(),800);assert.equal((await account()).half_initial,false);
   assert.equal((await f.db.query('select count(*)::int n from public.admission_initial_edits where admission_id=$1',[id])).rows[0].n,0);
 });
 it('histórico de ocupação do leito bloqueia extensão sobre outra internação',async()=>{
   await f.db.exec('reset role');const other=await createSyntheticAdmission(f.db,{name:'Outro paciente sintético',bed:11,entry:'2026-09-29T12:00:00-03:00'});
   await f.db.query("update public.admissions set bed=10,status='finalized',discharge_at='2026-09-30T23:50:00-03:00' where id=$1",[other]);await f.asUser('admin');
   await rejects(()=>edit({entry:'2026-09-30T23:40:00-03:00'}),/leito estava ocupado/);
 });
 it('internação cancelada, sessão inválida, comercial, operador, inativo e anônimo não permitem correção',async()=>{
   for(const role of ['commercial','operator','inactive'] as const){await f.asUser(role);await rejects(()=>edit(),/Somente administradores/);}
   await f.asUser('admin','aal1',false);await rejects(()=>edit(),/Somente administradores/);
   await f.asUser('anon');await rejects(()=>edit(),/permission denied/);
   await f.asUser('admin');await rejects(()=>f.db.query("update public.admission_initial_edits set reason='Alteração direta proibida'"),/permission denied/);
   await f.db.exec("reset role");await f.db.query("update public.admissions set status='cancelled' where id=$1",[id]);await f.asUser('admin');await rejects(()=>edit(),/cancelada/);
 });
});
