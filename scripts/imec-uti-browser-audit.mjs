// Synthetic browser -> intercepted HTTP API -> real isolated PostgreSQL.
// Hosted Supabase Auth/SMTP, native mobile hardware and multi-connection concurrency
// are deliberately not claimed as homologated by this test.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { isolatedDatabase,auditUsers } from '../tests/fixtures/imec-uti-database.ts';

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
const api=[],errors=[],steps=[];let queue=Promise.resolve();let failNetwork=false;
const session=()=>({access_token:'synthetic.'+Buffer.from(JSON.stringify({sub:auditUsers.admin,aal:'aal1',session_id:auditUsers.admin,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.signature',refresh_token:'synthetic-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:auditUsers.admin,email:'admin@audit.invalid',factors:[]}});
const tables=new Set(['profiles','patients','admissions','rate_periods','charges','payments','refunds','audits','app_settings','commercial_closers']);
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
const shot=async name=>page.screenshot({path:path.join(output,name+'.png'),fullPage:true});
try{
  const start=performance.now();await page.goto(origin+'/imec-uti/');await wait('#loginForm');
  await fill('#loginEmail','admin@audit.invalid');await fill('#loginPassword','wrong');await click('#loginForm button[type=submit]');await wait('#authError .form-error');
  await fill('#loginPassword','SyntheticAuditPassword!1');await click('#loginForm button[type=submit]');await wait('.metric-grid');
  steps.push({name:'login com provedor simulado',ms:Math.round(performance.now()-start)});await shot('desktop-dashboard');
  await click('[data-action="new"]');await fill('#nName','João da Silva — Sintético');await select('#nBed','10');await select('#nMode','hotel');await fill('#nValue','400');await fill('#nEntry','2026-10-08T18:52');await select('#nHalf','0');await click('#newForm button[type=submit]');await wait('.patient-card');
  await click('[data-nav="patients"]');await page.locator('#searchPatients').pressSequentially('Joao');fields++;assert.equal(await page.locator('#searchPatients').inputValue(),'Joao');assert.equal(await page.locator('.table-row[data-open]').count(),1);
  await fill('#searchPatients','inexistente');await wait('.empty-state');assert.equal(await page.locator('.table-row[data-open]').count(),0);
  await fill('#searchPatients','Joao');await click('.table-row[data-open]');await wait('.detail-hero');await shot('desktop-paciente');
  const id=(await fixture.db.query('select id from public.admissions')).rows[0].id;
  await click('[data-action="extra"]');await fill('#eDesc','Avaliação sintética');await fill('#eUnit','100');await fill('#eWhen','2026-10-09T08:00');await click('#extraForm button:not([type=button])');await wait('.detail-hero');
  await click('[data-action="payment"]');await fill('#pValue','200');await fill('#pWhen','2026-10-09T09:00');await select('#pMethod','credit');await select('#pCount','2');
  await page.locator('[data-installment="p"]').nth(0).fill('2026-11-03');await page.locator('[data-installment="p"]').nth(1).fill('2026-12-03');fields+=2;
  await click('#payForm button:not([type=button])');await wait('.detail-hero');
  await click('[data-action="discharge"]');await fill('#dWhen','2026-10-10T12:00');await click('#dCalc');await wait('#settlePayValue');assert.equal(await page.locator('#settlePayValue').inputValue(),'700.00');
  await fill('#settlePayWhen','2026-10-10T10:00');await click('#settlePayBtn');await wait('#dConfirm');
  await click('#dConfirm');await page.locator('#modalBackdrop').waitFor({state:'detached'});await wait('.detail-hero');
  const [popup]=await Promise.all([context.waitForEvent('page'),click('[data-action="settlement-sheet"]')]);await popup.locator('.patient-cpf').waitFor();assert.match(await popup.locator('body').textContent(),/Cartão de crédito · 2x/);await popup.screenshot({path:path.join(output,'folha-acerto.png'),fullPage:true});await popup.close();
  const [download]=await Promise.all([page.waitForEvent('download'),click('[data-action="settlement-pdf"]')]);await download.saveAs(path.join(output,'acerto-sintetico.pdf'));
  const account=(await fixture.db.query('select status from public.admissions where id=$1',[id])).rows[0];assert.equal(account.status,'finalized');
  assert.equal((await fixture.db.query('select sum(amount)::float8 as total from public.payments where admission_id=$1 and cancelled_at is null',[id])).rows[0].total,900);
  assert.equal((await fixture.db.query('select sum(amount)::float8 as total from public.charges where admission_id=$1 and cancelled_at is null',[id])).rows[0].total,900);
  for(const viewport of [{width:1365,height:950},{width:820,height:1180},{width:390,height:844},{width:360,height:800}]){
    await page.setViewportSize(viewport);await click('[data-nav="patients"]');await wait('#searchPatients');await click('[data-filter="all"]');
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,'Horizontal viewport overflow');await shot('pacientes-'+viewport.width);
    if(viewport.width<=600){const balance=await page.locator('.table-row[data-open]>span:nth-child(6)').boundingBox();assert.ok(balance&&balance.x+balance.width<=viewport.width,'Saldo deve ser visível sem rolagem horizontal');}
    await click('[data-action="new"]');await wait('#newForm');await shot('cadastro-'+viewport.width);await page.keyboard.press('Escape');assert.equal(await page.locator('[role=dialog]').count(),0);
  }
  await page.setViewportSize({width:1365,height:950});await click('[data-nav="finance"]');await wait('.finance-metrics');await shot('desktop-financeiro');
  await click('[data-nav="settings"]');await wait('#logoutBtn');assert.match(await page.locator('.security-status').textContent(),/e-mail e senha/);await shot('desktop-configuracoes');
  const [exported]=await Promise.all([page.waitForEvent('download'),click('[data-action="export"]')]);await exported.saveAs(path.join(output,'exportacao-sintetica.json'));
  await context.setOffline(true);await wait('#networkStatus.show');assert.match(await page.locator('#networkStatus').textContent(),/Sem conexão/);await context.setOffline(false);
  await click('#logoutBtn');await wait('#loginForm');assert.equal(await page.locator('.detail-hero').count(),0);
  assert.equal(errors.length,0,errors.join('\n'));
  steps.push({name:'cadastro → extra → crédito → acerto → PDF → encerramento → exportação → logout',clicks,fields,total_ms:Math.round(performance.now()-start)});
  fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify({status:'passed',scope:'synthetic Auth + real isolated PostgreSQL',steps,api_calls:api.length,api_bytes:api.reduce((n,x)=>n+x.bytes,0),errors,requests:api},null,2));
  console.log(JSON.stringify({status:'passed',steps,api_calls:api.length,output},null,2));
}catch(error){fs.writeFileSync(path.join(output,'browser-failure.json'),JSON.stringify({error:error.message,api,errors},null,2));await shot('failure');throw error;}
finally{await context.close();await browser.close();await fixture.db.close();await new Promise(resolve=>server.close(resolve));}
