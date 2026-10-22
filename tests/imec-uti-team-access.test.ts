import {describe,it,before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {isolatedDatabase,createSyntheticAdmission,auditUsers} from './fixtures/imec-uti-database.ts';
import {appHarness} from './fixtures/imec-uti-app.ts';

describe('acesso da equipe — PostgreSQL isolado',()=>{
 let f:Awaited<ReturnType<typeof isolatedDatabase>>,id:string;
 before(async()=>{f=await isolatedDatabase();});after(async()=>{await f?.db.close();});
 beforeEach(async()=>{await f.db.exec('reset role;begin');await f.asUser('admin');id=await createSyntheticAdmission(f.db);});
 afterEach(async()=>{await f.db.exec('rollback;reset role');});
 const rejects=async(work:()=>Promise<unknown>,pattern:RegExp)=>{await f.db.exec('savepoint denied');try{await assert.rejects(work,pattern);}finally{await f.db.exec('rollback to savepoint denied;release savepoint denied');}};
 it('indicação e consulta cadastra paciente, lê status e recebe relatório sem MFA quando opcional',async()=>{
   await f.asUser('referral');const newId=await createSyntheticAdmission(f.db,{bed:11,name:'Indicação sintética'});assert.ok(newId);
   assert.equal((await f.db.query('select id from public.admissions')).rows.length,2);
   assert.ok((await f.db.query("select public.get_uti_humanized_monthly_report('2026-10-01') as r")).rows[0].r);
 });
 it('alta é exclusiva do administrador, inclusive quando a conta já tem saída',async()=>{
   const s=(await f.db.query("select public.preview_uti_settlement($1,'2026-10-03T12:00:00-03:00') s",[id])).rows[0].s;
   for(const role of ['referral','operator','commercial'] as const){await f.asUser(role);await rejects(()=>f.db.query('select public.discharge_uti($1,$2::timestamptz,$3::bigint)',[id,s.dischargeAt,s.accountVersion]),/perfil não pode|administrador/);}
   await f.asUser('admin');await f.db.query('select public.discharge_uti($1,$2::timestamptz,$3::bigint)',[id,s.dischargeAt,s.accountVersion]);
   await f.asUser('referral');await rejects(()=>f.db.query('select public.discharge_uti($1,$2::timestamptz,$3::bigint)',[id,s.dischargeAt,s.accountVersion]),/perfil não pode|administrador/);
 });
 it('indicação não recebe, concede descontos, ajusta diárias nem altera acessos',async()=>{
   await f.asUser('referral');
   await rejects(()=>f.db.query("select public.add_uti_payment($1,'2026-10-02T12:00:00-03:00',100,'PIX',null,'referral-denied-payment')",[id]),/perfil não pode/);
   await rejects(()=>f.db.query("select public.adjust_uti_rate($1,'2026-10-02T12:00:00-03:00',100,false)",[id]),/perfil não pode/);
   await rejects(()=>f.db.query("select public.add_uti_extra($1,'2026-10-02T12:00:00-03:00','Outro','Extra',100,'referral-denied-extra')",[id]),/perfil não pode/);
   await rejects(()=>f.db.query("select public.grant_uti_settlement_discount($1,100,'Desconto não autorizado','referral-denied-discount')",[id]),/administradores/);
   await rejects(()=>f.db.query("select public.admin_update_uti_member($1,true,'admin')",[auditUsers.referral]),/administradores/);
   await rejects(()=>f.db.query("update public.profiles set role='admin' where id=$1",[auditUsers.referral]),/permission denied/);
 });
 it('liberação pelo administrador tem auditoria e preserva o último administrador',async()=>{
   await f.db.query("select public.admin_update_uti_member($1,true,'referral')",[auditUsers.inactive]);
   const p=(await f.db.query('select active,role from public.profiles where id=$1',[auditUsers.inactive])).rows[0];assert.deepEqual(p,{active:true,role:'referral'});
   const audit=(await f.db.query("select user_id,detail from public.audits where action='Acesso atualizado'")).rows[0];assert.equal(audit.user_id,auditUsers.admin);assert.match(audit.detail,/referral.*ativo/);
   await rejects(()=>f.db.query("select public.admin_update_uti_member($1,true,'referral')",[auditUsers.admin]),/administrador ativo/);
 });
 it('guarda de convite respeita a política real de MFA e a sessão revogada',async()=>{
   const allowed=async()=>(await f.db.query('select public.is_uti_admin_secure_session() allowed')).rows[0].allowed;
   assert.equal(await allowed(),true);await f.asUser('referral');assert.equal(await allowed(),false);
   await f.asUser('admin','aal1',false);assert.equal(await allowed(),false);
   await f.db.exec('reset role;update public.app_settings set mfa_required=true');await f.asUser('admin');assert.equal(await allowed(),false);
   await f.asUser('admin','aal2');assert.equal(await allowed(),true);
 });
});

it('interface permite indicação e consulta e mantém alta apenas para o administrador',()=>{
 const h=appHarness();h.run("data.currentRole='referral'");assert.equal(h.run("can('create_admission')"),true);
 for(const permission of ['discharge','add_payment','add_extra','adjust_rate'])assert.equal(h.run(`can('${permission}')`),false);
 for(const role of ['operator','commercial']){h.run(`data.currentRole='${role}'`);assert.equal(h.run("can('discharge')"),false);}
 h.run("data.currentRole='admin'");assert.equal(h.run("can('discharge')"),true);
});

it('sair limpa a tela selecionada e a busca antes da entrada de outra pessoa',()=>{
 const h=appHarness();h.run("state.page='settings';state.selectedId='synthetic-patient';state.search='Busca anterior';storeAuth(null)");
 assert.equal(h.run('state.page'),'home');assert.equal(h.run('state.selectedId'),null);assert.equal(h.run('state.search'),'');
});
