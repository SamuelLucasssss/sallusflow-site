// Synthetic browser -> intercepted HTTP API -> real isolated PostgreSQL.
// Hosted Supabase Auth/SMTP, native mobile hardware and multi-connection concurrency
// are deliberately not claimed as homologated by this test.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { isolatedDatabase,createSyntheticAdmission,auditUsers } from '../tests/fixtures/imec-uti-database.ts';
import {toLocalInput} from '../src/imec-uti/domain.ts';

const output=path.resolve(process.env.IMEC_AUDIT_OUTPUT||'tmp/imec-audit');
fs.mkdirSync(output,{recursive:true});
const fixture=await isolatedDatabase();
const server=http.createServer((req,res)=>{
  let file=path.resolve('dist','.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!file.startsWith(path.resolve('dist')+path.sep)){res.writeHead(403).end();return;}
  if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
  if(!fs.existsSync(file)){res.writeHead(404).end();return;}
  const extension=path.extname(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'})[extension]||'application/octet-stream');
  res.end(fs.readFileSync(file));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.IMEC_CHROME_PATH?{executablePath:process.env.IMEC_CHROME_PATH}:{})});
const context=await browser.newContext({viewport:{width:1365,height:950},serviceWorkers:'block',acceptDownloads:true});
const api=[],errors=[],steps=[],visualChecks=[];let queue=Promise.resolve();let failNetwork=false;
const session=()=>({access_token:'synthetic.'+Buffer.from(JSON.stringify({sub:auditUsers.admin,aal:'aal1',session_id:auditUsers.admin,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.signature',refresh_token:'synthetic-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:auditUsers.admin,email:'admin@audit.invalid',factors:[]}});
const tables=new Set(['profiles','patients','admissions','rate_periods','charges','payments','scheduled_receipts','refunds','audits','app_settings','commercial_closers']);
const identifier=value=>{if(!/^[a-z_][a-z_0-9]*$/i.test(value))throw new Error('Invalid test identifier');return '"'+value+'"';};
await context.route('https://nxaxkczyeythvzdxqwyu.supabase.co/**',async route=>{
  if(failNetwork){await route.abort('internetdisconnected');return;}
  const request=route.request(),url=new URL(request.url());
  const work=async()=>{
    const started=performance.now();let status=200,body;
    try{
      const args=request.postDataJSON()||{};
      if(url.pathname.startsWith('/auth/v1/')){
        if(url.pathname.endsWith('/token')){if(args.password==='wrong')throw new Error('Invalid login credentials');body=session();}
        else if(url.pathname.endsWith('/user'))body=session().user;
        else if(url.pathname.endsWith('/logout'))body={};
        else throw new Error('Hosted Auth flow is not simulated');
      }else{
        await fixture.asUser('admin');
        if(url.pathname.startsWith('/rest/v1/rpc/')){
          const name=url.pathname.split('/').at(-1);const keys=Object.keys(args);
          const named=keys.map((key,i)=>`${identifier(key)} := $${i+1}`).join(',');
          body=(await fixture.db.query(`select public.${identifier(name)}(${named}) as result`,Object.values(args))).rows[0].result;
        }else{
          const table=url.pathname.split('/').at(-1);
          if(table==='system_health_checks'){body=[{id:1,checked_at:new Date().toISOString(),status:'ok',issues:[],metrics:{},source:'synthetic'}];}
          else if(table==='system_alerts'){body=[];}
          else{
            if(!tables.has(table))throw new Error('Unknown synthetic table');
            const select=url.searchParams.get('select')||'*';const cols=select==='*'?'*':select.split(',').map(identifier).join(',');
            const clauses=[],params=[];
            for(const [key,value] of url.searchParams){
              if(['select','order','limit','offset'].includes(key))continue;
              if(value==='is.null')clauses.push(`${identifier(key)} is null`);
              else if(value.startsWith('eq.')){const raw=value.slice(3);params.push(['active','mfa_required'].includes(key)?raw==='true':raw);clauses.push(`${identifier(key)}=$${params.length}`);}
              else throw new Error('Unsupported synthetic filter');
            }
            const order=(url.searchParams.get('order')||'').split(',').filter(Boolean).map(value=>{const [key,direction='asc']=value.split('.');if(!['asc','desc'].includes(direction))throw new Error('Invalid order');return `${identifier(key)} ${direction}`;}).join(',');
            const limit=Number(url.searchParams.get('limit')||1000),offset=Number(url.searchParams.get('offset')||0);
            if(!Number.isInteger(limit)||!Number.isInteger(offset))throw new Error('Invalid test range');
            body=(await fixture.db.query(`select ${cols} from public.${identifier(table)}${clauses.length?' where '+clauses.join(' and '):''}${order?' order by '+order:''} limit ${Math.min(limit,1000)} offset ${offset}`,params)).rows;
          }
        }
      }
    }catch(error){status=400;body={message:error.message};}
    api.push({method:request.method(),path:url.pathname,status,ms:Math.round(performance.now()-started),bytes:Buffer.byteLength(JSON.stringify(body??null))});
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body??null),headers:{'Access-Control-Allow-Origin':origin}});
  };
  const pending=queue.then(work);queue=pending.catch(()=>{});await pending;
});
await context.addInitScript(()=>{window.print=()=>{};});
const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
page.on('dialog',dialog=>dialog.accept('Correção sintética autorizada'));
let clicks=0,fields=0;
const click=async selector=>{
  await page.waitForFunction(()=>!document.getElementById('globalSync')?.classList.contains('show'));
  clicks++;await page.locator(selector+':visible').first().click();
};
const fill=async(selector,value)=>{fields++;await page.locator(selector).fill(value);};
const select=async(selector,value)=>{fields++;await page.locator(selector).selectOption(value);};
const wait=selector=>page.locator(selector).first().waitFor({timeout:15000});
const shot=async name=>{
  await page.waitForFunction(()=>!document.getElementById('globalSync')?.classList.contains('show')&&!document.getElementById('toast')?.classList.contains('show'));
  // Fixed navigation and offscreen skip links are captured correctly from scroll 0.
  await page.evaluate(()=>window.scrollTo(0,0));
  return page.screenshot({path:path.join(output,name+'.png'),fullPage:!await page.locator('[role=dialog]').count(),animations:'disabled'});
};
const surface=async name=>{
  const layout=await page.evaluate(()=>({
    overflow:document.documentElement.scrollWidth>innerWidth+1,
    width:innerWidth,
    icons:document.querySelectorAll('.ui-icon').length,
    dialog:!!document.querySelector('[role=dialog]'),
    fieldsOutside:[...document.querySelectorAll('.field input,.field select,.field textarea')].filter(el=>{
      const box=el.getBoundingClientRect();return box.width>0&&(box.x<0||box.right>innerWidth+1);
    }).length
  }));
  assert.equal(layout.overflow,false,name+': horizontal viewport overflow');
  assert.equal(layout.fieldsOutside,0,name+': field outside viewport');
  visualChecks.push({name,...layout});await shot(name);
};
const reviewDialog=async(action,name)=>{
  const opener=await page.locator(action+':visible').first().elementHandle();
  await click(action);await wait('[role=dialog]');await surface(name);
  await page.waitForFunction(()=>document.querySelector('[role=dialog]').contains(document.activeElement));
  await page.locator('[role=dialog]').evaluate(dialog=>{
    const focusable=[...dialog.querySelectorAll('button,input,select,textarea,[tabindex="0"]')].filter(el=>!el.disabled&&el.getClientRects().length);
    focusable.at(-1).focus();
  });
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('[role=dialog]').evaluate(dialog=>document.activeElement===dialog.querySelector('button')),true,name+': forward focus trap');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.locator('[role=dialog]').evaluate(dialog=>{
    const focusable=[...dialog.querySelectorAll('button,input,select,textarea,[tabindex="0"]')].filter(el=>!el.disabled&&el.getClientRects().length);
    return document.activeElement===focusable.at(-1);
  }),true,name+': reverse focus trap');
  // Review the lower fields and sticky actions as well as the opening state.
  await page.locator('.modal-card').evaluate(el=>el.scrollTop=el.scrollHeight);
  const actions=page.locator('.modal-actions');
  if(await actions.count()){
    const box=await actions.boundingBox();
    assert.ok(box&&box.y>=0&&box.y<page.viewportSize().height,name+': actions unreachable');
    await shot(name+'-acoes');
  }
  await page.keyboard.press('Escape');await page.locator('[role=dialog]').waitFor({state:'detached'});
  await page.waitForFunction(el=>el===document.activeElement,opener);
  assert.equal(await page.locator('#app').getAttribute('inert'),null,name+': app focus restored');
};
try{
  const start=performance.now();await page.goto(origin+'/imec-uti/');await wait('#loginForm');
  for(const width of [1365,820,390,360]){
    await page.setViewportSize({width,height:950});await surface('acesso-'+width);
    await click('#forgotPasswordBtn');await wait('#recoverForm');await surface('recuperacao-'+width);
    await click('#recoverBack');await wait('#loginForm');
  }
  await page.setViewportSize({width:1365,height:950});
  await fill('#loginEmail','admin@audit.invalid');await fill('#loginPassword','wrong');await click('#loginForm button[type=submit]');await wait('#authError .form-error');
  await fill('#loginPassword','SyntheticAuditPassword!1');await click('#loginForm button[type=submit]');await wait('.metric-grid');
  steps.push({name:'login com provedor simulado',ms:Math.round(performance.now()-start)});await shot('desktop-dashboard');
  await click('[data-action="new"]');await fill('#nName','João da Silva — Sintético');await select('#nBed','10');await select('#nMode','hotel');await fill('#nValue','400');await fill('#nEntry','2026-10-08T18:52');await select('#nHalf','0');await click('#newForm button[type=submit]');await wait('.patient-card');
  await click('[data-nav="patients"]');await page.locator('#searchPatients').focus();
  // oninput replaces the rendered node. Type through the active keyboard target,
  // rather than retaining the locator's old element for the remaining characters.
  await page.keyboard.type('Joao');fields++;
  assert.equal(await page.locator('#searchPatients').inputValue(),'Joao');
  assert.equal(await page.locator('#searchPatients').evaluate(el=>el===document.activeElement),true);
  assert.equal(await page.locator('.table-row[data-open]').count(),1);
  await fill('#searchPatients','inexistente');await wait('.empty-state');assert.equal(await page.locator('.table-row[data-open]').count(),0);
  await fill('#searchPatients','Joao');await click('.table-row[data-open]');await wait('.detail-hero');await shot('desktop-paciente');
  for(const width of [1365,820,390,360]){
    await page.setViewportSize({width,height:950});await surface('conta-ativa-'+width);
    await reviewDialog('[data-action="payment"]','pagamento-'+width);
    await reviewDialog('[data-action="extra"]','extra-'+width);
    await reviewDialog('[data-action="rate"]','diaria-'+width);
    await reviewDialog('[data-action="discharge"]','alta-'+width);
  }
  await page.setViewportSize({width:1365,height:950});
  const id=(await fixture.db.query('select id from public.admissions')).rows[0].id;
  await click('[data-action="extra"]');await fill('#eDesc','Avaliação sintética');await fill('#eUnit','100');await fill('#eWhen','2026-10-09T08:00');await click('#extraForm button:not([type=button])');await wait('.detail-hero');
  await click('[data-action="payment"]');await fill('#pValue','200');await fill('#pWhen','2026-10-09T09:00');await select('#pMethod','credit');await select('#pCount','2');
  await page.locator('[data-installment="p"]').nth(0).fill('2026-11-03');await page.locator('[data-installment="p"]').nth(1).fill('2026-12-03');fields+=2;
  await surface('credito-parcelado');
  await click('#payForm button:not([type=button])');await wait('.detail-hero');
  await click('[data-action="discharge"]');await fill('#dWhen','2026-10-10T12:00');await click('#dCalc');await wait('#settlePayValue');assert.equal(await page.locator('#settlePayValue').inputValue(),'700.00');
  await surface('acerto-com-recebimento');
  await fill('#settlePayWhen','2026-10-10T10:00');await click('#settlePayBtn');await wait('#dConfirm');
  await click('#dConfirm');await page.locator('#modalBackdrop').waitFor({state:'detached'});await wait('.detail-hero');
  const [popup]=await Promise.all([context.waitForEvent('page'),click('[data-action="settlement-sheet"]')]);await popup.locator('.patient-cpf').waitFor();assert.match(await popup.locator('body').textContent(),/Cartão de crédito · 2x/);await popup.screenshot({path:path.join(output,'folha-acerto.png'),fullPage:true});
  await popup.emulateMedia({media:'print'});await popup.pdf({path:path.join(output,'impressao-acerto.pdf'),format:'A4',printBackground:true});
  await popup.setViewportSize({width:390,height:844});await popup.emulateMedia({media:'screen'});
  assert.equal(await popup.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Folha de acerto deve caber no celular');
  await popup.screenshot({path:path.join(output,'folha-acerto-390.png'),fullPage:true});await popup.close();
  const [download]=await Promise.all([page.waitForEvent('download'),click('[data-action="settlement-pdf"]')]);await download.saveAs(path.join(output,'acerto-sintetico.pdf'));
  const account=(await fixture.db.query('select status from public.admissions where id=$1',[id])).rows[0];assert.equal(account.status,'finalized');
  assert.equal((await fixture.db.query('select sum(amount)::float8 as total from public.payments where admission_id=$1 and cancelled_at is null',[id])).rows[0].total,900);
  assert.equal((await fixture.db.query('select sum(amount)::float8 as total from public.charges where admission_id=$1 and cancelled_at is null',[id])).rows[0].total,900);
  // Additional visual states exist only in this isolated database.
  await fixture.asUser('admin');
  await createSyntheticAdmission(fixture.db,{name:'Ana Carolina de Albuquerque — Sintética',bed:12,entry:new Date().toISOString()});
  const discountId=await createSyntheticAdmission(fixture.db,{name:'Marina — Desconto sintético',bed:11});
  const discountedPreview=(await fixture.db.query('select public.preview_uti_settlement($1,$2::timestamptz) as s',[discountId,'2026-10-03T12:00:00-03:00'])).rows[0].s;
  await fixture.db.query('select public.discharge_uti($1,$2::timestamptz,$3::bigint)',[discountId,discountedPreview.dischargeAt,discountedPreview.accountVersion]);
  await fixture.db.query('select public.add_uti_payment($1,$2::timestamptz,$3,$4,$5,$6)',[discountId,'2026-10-02T14:00:00-03:00',500,'PIX',null,'visual-discount-payment']);
  const refundId=await createSyntheticAdmission(fixture.db,{name:'Rafael — Reembolso sintético',bed:13});
  await fixture.db.query('select public.add_uti_payment($1,$2::timestamptz,$3,$4,$5,$6)',[refundId,'2026-10-02T14:00:00-03:00',800,'PIX',null,'visual-refund-payment']);
  await fixture.db.query('select public.adjust_uti_rate($1,$2::timestamptz,$3,$4)',[refundId,'2026-10-01T12:00:00-03:00',100,false]);
  const refundPreview=(await fixture.db.query('select public.preview_uti_settlement($1,$2::timestamptz) as s',[refundId,'2026-10-03T12:00:00-03:00'])).rows[0].s;
  await fixture.db.query('select public.discharge_uti($1,$2::timestamptz,$3::bigint)',[refundId,refundPreview.dischargeAt,refundPreview.accountVersion]);
  await click('[data-nav="settings"]');await click('#manualRefresh');await wait('#logoutBtn');
  for(const width of [1365,820,390,360]){
    await page.setViewportSize({width,height:950});
    await click('[data-nav="patients"]');await click('[data-filter="all"]');await fill('#searchPatients','Marina');await click('.table-row[data-open]');await surface('conta-pendente-'+width);
    await reviewDialog('[data-action="discount"]','desconto-'+width);
    await reviewDialog('[data-action="discharge"]','acerto-pendente-'+width);
    await click('[data-nav="patients"]');await fill('#searchPatients','Rafael');await click('.table-row[data-open]');await surface('conta-credito-'+width);
    await reviewDialog('[data-action="refund"]','reembolso-'+width);
    await reviewDialog('[data-action="discharge"]','acerto-credito-'+width);
  }
  await click('[data-nav="patients"]');await fill('#searchPatients','Joao');
  for(const viewport of [{width:1365,height:950},{width:820,height:1180},{width:390,height:844},{width:360,height:800}]){
    await page.setViewportSize(viewport);await click('[data-nav="patients"]');await wait('#searchPatients');await click('[data-filter="all"]');
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,'Horizontal viewport overflow');await shot('pacientes-'+viewport.width);
    if(viewport.width<=600){const balance=await page.locator('.table-row[data-open]>span:nth-child(6)').boundingBox();assert.ok(balance&&balance.x+balance.width<=viewport.width,'Saldo deve ser visível sem rolagem horizontal');}
    await click('[data-action="new"]');await wait('#newForm');await shot('cadastro-'+viewport.width);await page.keyboard.press('Escape');assert.equal(await page.locator('[role=dialog]').count(),0);
  }
  await page.setViewportSize({width:1365,height:950});await click('[data-nav="finance"]');await wait('.finance-metrics');await shot('desktop-financeiro');
  for(const width of [1365,820,390,360]){
    await page.setViewportSize({width,height:950});
    await click('[data-nav="home"]');await surface('inicio-'+width);
    await click('[data-nav="finance"]');
    for(const tab of ['pending','receipts','planned','finalized']){await click('[data-ftab="'+tab+'"]');await surface('financeiro-'+tab+'-'+width);}
    await click('[data-nav="settings"]');await surface('configuracoes-'+width);
    await page.locator('.settings-diagnostics>summary').click();await surface('diagnosticos-'+width);
    await reviewDialog('#inviteUserBtn','convite-'+width);
    await reviewDialog('#changePasswordBtn','senha-'+width);
    await click('[data-nav="patients"]');await click('[data-filter="all"]');await fill('#searchPatients','Joao');await click('.table-row[data-open]');await surface('conta-finalizada-'+width);
    await reviewDialog('[data-action="corrections"]','estorno-'+width);
  }
  // 683 CSS px is the reflow width of a 1366 px screen at 200% browser zoom.
  // This checks equivalent layout reflow, without claiming a physical-device test.
  await page.setViewportSize({width:683,height:950});
  for(const route of ['home','patients','finance','settings']){
    await click('[data-nav="'+route+'"]');await surface('refluxo-200-'+route);
  }
  await page.setViewportSize({width:1365,height:950});
  await click('[data-nav="settings"]');await wait('#logoutBtn');assert.match(await page.locator('.security-status').textContent(),/e-mail e senha/);await shot('desktop-configuracoes');
  // Future promises never enter the ledger. Confirmation records the actual date.
  await click('[data-nav="patients"]');await click('[data-filter="all"]');await fill('#searchPatients','Marina');await click('.table-row[data-open]');
  const plannedWhen=toLocalInput(new Date(Date.now()+2*86400000)),actualWhen=toLocalInput(new Date(Date.now()-60000));
  await click('[data-action="payment"]');await fill('#pValue','300');await fill('#pWhen',plannedWhen);
  assert.equal(await page.locator('#pTiming').getAttribute('data-mode'),'scheduled');
  await surface('previsao-futura-formulario');await click('#pSubmit');await wait('.scheduled-panel');
  assert.match(await page.locator('.scheduled-copy>span').first().textContent(),/PIX/);
  assert.equal((await fixture.db.query('select sum(amount)::float8 as total from public.payments where admission_id=$1 and cancelled_at is null',[discountId])).rows[0].total,500);
  await click('[data-nav="finance"]');await click('[data-ftab="planned"]');await surface('previstos-financeiro');
  await click('.scheduled-patient');await click('[data-cancel-receipt]');await fill('#cancelReceiptReason','Família alterou a previsão');await click('#cancelReceiptForm button:not([type=button])');await page.locator('[role=dialog]').waitFor({state:'detached'});
  assert.equal((await fixture.db.query("select count(*)::int as n from public.scheduled_receipts where admission_id=$1 and status='cancelled'",[discountId])).rows[0].n,1);
  await click('[data-action="discharge"]');await wait('#settlePayWhen');await fill('#settlePayWhen',plannedWhen);await click('#settlePayBtn');
  await wait('#modal .scheduled-panel');await surface('previsao-no-acerto');await page.keyboard.press('Escape');await page.locator('[role=dialog]').waitFor({state:'detached'});
  await page.setViewportSize({width:360,height:950});await surface('previstos-na-conta-360');
  await click('[data-confirm-receipt]');await fill('#cWhen',plannedWhen);await click('#confirmReceiptForm button:not([type=button])');await wait('#confirmReceiptError .form-error');
  assert.equal((await fixture.db.query('select sum(amount)::float8 as total from public.payments where admission_id=$1 and cancelled_at is null',[discountId])).rows[0].total,500);
  await fill('#cWhen',actualWhen);await surface('confirmar-recebimento-posterior-360');await click('#confirmReceiptForm button:not([type=button])');await page.locator('[role=dialog]').waitFor({state:'detached'});
  assert.equal((await fixture.db.query('select status from public.admissions where id=$1',[discountId])).rows[0].status,'finalized');
  assert.equal((await fixture.db.query('select sum(amount)::float8 as total from public.payments where admission_id=$1 and cancelled_at is null',[discountId])).rows[0].total,800);
  assert.equal((await fixture.db.query("select count(*)::int as n from public.scheduled_receipts where admission_id=$1 and status='confirmed'",[discountId])).rows[0].n,1);
  // A future date can be switched back to receipt now without recording in the future.
  await click('[data-nav="patients"]');await click('[data-filter="all"]');await fill('#searchPatients','Ana Carolina');await click('.table-row[data-open]');await click('[data-action="payment"]');await fill('#pWhen',plannedWhen);
  await click('#pTiming [data-receipt-mode="received"]');assert.equal(await page.locator('#pTiming').getAttribute('data-mode'),'received');assert.notEqual(await page.locator('#pWhen').inputValue(),plannedWhen);
  await page.keyboard.press('Escape');await page.setViewportSize({width:1365,height:950});await click('[data-nav="settings"]');await wait('#logoutBtn');
  const [exported]=await Promise.all([page.waitForEvent('download'),click('[data-action="export"]')]);await exported.saveAs(path.join(output,'exportacao-sintetica.json'));
  await context.setOffline(true);await wait('#networkStatus.show');assert.match(await page.locator('#networkStatus').textContent(),/Sem conexão/);await context.setOffline(false);
  await click('#logoutBtn');await wait('#loginForm');assert.equal(await page.locator('.detail-hero').count(),0);
  assert.equal(errors.length,0,errors.join('\n'));
  fs.rmSync(path.join(output,'browser-failure.json'),{force:true});
  fs.rmSync(path.join(output,'failure.png'),{force:true});
  steps.push({name:'cadastro → extra → crédito → acerto → PDF → encerramento → exportação → logout',clicks,fields,total_ms:Math.round(performance.now()-start)});
  fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify({status:'passed',scope:'synthetic Auth + real isolated PostgreSQL',steps,visualChecks,api_calls:api.length,api_bytes:api.reduce((n,x)=>n+x.bytes,0),errors,requests:api},null,2));
  console.log(JSON.stringify({status:'passed',steps,visual_surfaces:visualChecks.length,api_calls:api.length,output},null,2));
}catch(error){fs.writeFileSync(path.join(output,'browser-failure.json'),JSON.stringify({error:error.message,api,errors},null,2));await shot('failure');throw error;}
finally{await context.close();await browser.close();await fixture.db.close();await new Promise(resolve=>server.close(resolve));}
