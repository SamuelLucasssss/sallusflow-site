import test from 'node:test';
import assert from 'node:assert/strict';
import { appHarness } from './fixtures/imec-uti-app.ts';
import { ACTIVITY_STORAGE_KEY } from '../src/imec-uti/security.ts';

test('buscar por nome não inclui todos os CPFs e aceita acentos',()=>{
  const h=appHarness();
  h.run(`data.patients=[{id:'one',name:'João Silva',cpf:'12345678900'},{id:'two',name:'Maria Santos',cpf:'98765432100'}];
    data.admissions=data.patients.map((p,i)=>({id:p.id,patientId:p.id,status:'active',entryAt:'2026-10-01T12:00:00Z',bed:i+1,mode:'private'}));
    state.search='Joao';state.patientFilter='all';`);
  const html=h.run('patientsPage()');assert.match(html,/João Silva/);assert.equal(html.includes('Maria Santos'),false);
  h.run("state.search='987.654'");assert.equal(h.run('patientsPage()').includes('João Silva'),false);assert.match(h.run('patientsPage()'),/Maria Santos/);
});
test('renovação simultânea usa uma requisição e não reinicia a inatividade',async()=>{
  let requests=0;
  const h=appHarness({fetch:async()=>{requests++;await new Promise(resolve=>setTimeout(resolve,10));return new Response(JSON.stringify({access_token:'new-synthetic',refresh_token:'refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'synthetic'}}));}});
  h.run("storeAuth({access_token:'old-synthetic',refresh_token:'refresh',expires_at:1,user:{id:'synthetic'}})");
  const previous=String(Date.now()-60_000);h.values.set(ACTIVITY_STORAGE_KEY,previous);
  await Promise.all([h.run('ensureSession()'),h.run('ensureSession()'),h.run('ensureSession()')]);
  assert.equal(requests,1);assert.equal(h.values.get(ACTIVITY_STORAGE_KEY),previous);
});
test('resposta atrasada do refresh não restaura sessão depois de sair',async()=>{
  let release:(value:Response)=>void;
  const h=appHarness({fetch:()=>new Promise<Response>(resolve=>{release=resolve;})});
  h.run("storeAuth({access_token:'old',refresh_token:'refresh',expires_at:1,user:{id:'synthetic'}})");
  const pending=h.run('ensureSession()');h.run('storeAuth(null)');
  release!(new Response(JSON.stringify({access_token:'stale',refresh_token:'refresh',expires_at:Math.floor(Date.now()/1000)+3600})));
  await pending;assert.equal(h.run('authState'),null);
});
test('carga atrasada não recoloca dados financeiros na tela após logout',async()=>{
  let release:(value:unknown[])=>void;
  const h=appHarness();
  h.context.pendingPatients=new Promise(resolve=>{release=resolve;});
  h.run(`storeAuth({access_token:'synthetic',user:{id:'synthetic'},expires_at:9999999999});
    securityGate=async()=>true;rpc=async()=>null;renderAuth=()=>{};render=()=>{};
    rest=async (path,options={})=>path.startsWith('profiles?id=')?[{id:'synthetic',display_name:'Synthetic',role:'admin',active:true}]:path.startsWith('patients?')?{rows:await pendingPatients,total:0}:options.withCount?{rows:[],total:0}:[];`);
  const pending=h.run('loadRemote()');await new Promise(resolve=>setTimeout(resolve,0));
  h.run('storeAuth(null);data=blankData()');release!([]);await pending;
  assert.equal(h.run('data.currentRole'),null);assert.equal(h.run('authState'),null);
});
test('histórico com 1001 registros é carregado em páginas sem truncar saldos',async()=>{
  const h=appHarness();
  h.run(`var syntheticRows=Array.from({length:1001},(_,id)=>({id,amount:1}));
    rest=async path=>{const url=new URL('https://audit.invalid/'+path);return {rows:syntheticRows.slice(Number(url.searchParams.get('offset')),Number(url.searchParams.get('offset'))+Math.min(100,Number(url.searchParams.get('limit')))),total:syntheticRows.length};};`);
  const rows=await h.run("restAll('payments?select=*&order=occurred_at.asc,id.asc')");
  assert.equal(rows.length,1001);assert.equal(rows.reduce((sum:number,row:any)=>sum+row.amount,0),1001);
});
test('401 atrasado não encerra uma sessão nova',async()=>{
  let release:(response:Response)=>void;
  const h=appHarness({fetch:()=>new Promise<Response>(resolve=>{release=resolve;})});
  h.run("storeAuth({access_token:'old',expires_at:9999999999,user:{id:'old'}})");
  const pending=h.run("rest('patients?select=*')");await new Promise(resolve=>setTimeout(resolve,0));
  h.run("storeAuth({access_token:'new',expires_at:9999999999,user:{id:'new'}})");
  release!(new Response('{}',{status:401}));await assert.rejects(()=>pending,/sessão mudou/);
  assert.equal(h.run('authState.user.id'),'new');
});
test('proteção de senha não aprova resposta vazia do serviço de vazamentos',async()=>{
  const h=appHarness();h.run("sha1Hex=async()=> 'ABCDE'+'0'.repeat(35);edge=async()=>({ok:true,range:''});");
  await assert.rejects(()=>h.run("checkPasswordSafety('SyntheticAuditPassword!1')"),/verificar a segurança/);
});
test('logout apaga dados locais imediatamente mesmo com rede pendente',async()=>{
  let release:(response:Response)=>void;
  const h=appHarness({fetch:()=>new Promise<Response>(resolve=>{release=resolve;})});
  h.run("renderAuth=()=>{};storeAuth({access_token:'synthetic',expires_at:9999999999});data.currentRole='admin';");
  const pending=h.run('logoutRemote()');
  assert.equal(h.run('authState'),null);assert.equal(h.run('data.currentRole'),null);
  release!(new Response('{}'));await pending;
});
test('perfil inativo vai para acesso pendente sem iniciar cadastro MFA',async()=>{
  const h=appHarness();
  h.run(`var screen='';storeAuth({access_token:'synthetic',expires_at:9999999999,user:{id:'synthetic'}});
    currentAuthUser=async()=>({id:'synthetic',factors:[]});
    rest=async path=>path.startsWith('app_settings')?[]:[{id:'synthetic',active:false}];
    renderPending=()=>screen='pending';renderMfaEnrollment=async()=>screen='mfa';`);
  assert.equal(await h.run('securityGate()'),false);assert.equal(h.run('screen'),'pending');
});
test('falha de rede na política de acesso não inicia MFA automaticamente',async()=>{
  const h=appHarness();
  h.run(`var screen='';storeAuth({access_token:'synthetic',expires_at:9999999999,user:{id:'synthetic'}});
    currentAuthUser=async()=>({id:'synthetic',factors:[]});rest=async()=>{throw new Error('Network');};
    renderAccountState=()=>screen='retry';renderMfaEnrollment=async()=>screen='mfa';`);
  assert.equal(await h.run('securityGate()'),false);assert.equal(h.run('screen'),'retry');
});
test('cartão do paciente calcula desconto sem variável global indefinida',()=>{
  const h=appHarness();
  h.run(`data.patients=[{id:'patient',name:'Paciente sintético'}];
    data.charges=[{admissionId:'account',kind:'adjustment',amount:-300}];
    totals=()=>({billed:3000,netReceived:3000,balance:0});
    currentRate=()=>({label:'Hotelaria'});hospitalDays=()=>2;`);
  const card=h.run("patientCard({id:'account',patientId:'patient',bed:10,mode:'hotel',entryAt:'2026-10-01T10:00:00-03:00'})");
  assert.match(card,/Total após desconto/);assert.match(card,/Desconto no acerto/);
});
