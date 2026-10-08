import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { auditPublicSite, fetchWithRetries, MONITORED_RESOURCES, PRODUCTION_ORIGIN } from '../scripts/imec-uti-public-monitor.mjs';

function image(size) {
  const bytes = new Uint8Array(24);
  bytes.set([137,80,78,71,13,10,26,10],0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16,size);
  view.setUint32(20,size);
  return bytes;
}
const manifest=JSON.stringify({
  start_url:'/imec-uti/',scope:'/imec-uti/',display:'standalone',
  icons:[
    {src:'/imec-uti/icon-192.png',sizes:'192x192'},
    {src:'/imec-uti/icon-512.png',sizes:'512x512'},
    {src:'/imec-uti/icon-maskable-512.png',sizes:'512x512',purpose:'maskable'}
  ]
});
const page='<html><head><title>IMEC UTI | Particular & Hotelaria</title><link rel="manifest" href="/imec-uti/manifest.webmanifest"></head><body><div id="app"></div></body></html>';
const sw="self.addEventListener('fetch', (event) => {event.respondWith(fetch(event.request,{cache:'no-store'}))});";
function fixture(path, { noCsp = false, invalidManifest = false, swCaching = false, badIcon = false } = {}) {
  if(path === '/imec-uti/') return new Response(page,{status:200,headers:{
    'cache-control':'no-store, max-age=0',
    'content-security-policy':noCsp?'default-src self':"default-src 'self'; frame-ancestors 'none'",
    'x-frame-options':'DENY',
    'x-content-type-options':'nosniff'
  }});
  if(path.endsWith('.webmanifest'))return new Response(invalidManifest?'{}':manifest,{status:200});
  if(path.endsWith('sw.js'))return new Response(swCaching?sw+"cache.put('hi')":sw,{status:200});
  const size=path.includes('192')?192:512;
  return new Response(image(badIcon?300:size),{status:200});
}
function fakeFetch(options={}) {
  const requests=[];
  const fetcher=async (url,request)=>{
    const u=new URL(url);
    requests.push({url,request});
    return fixture(u.pathname, options);
  };
  return {fetcher,requests};
}

test('public monitor checks exactly six public resources without protected endpoints',async()=>{
  const {fetcher,requests}=fakeFetch();
  const report=await auditPublicSite(fetcher,{attempts:1});
  assert.equal(report.healthy,true);
  assert.equal(report.results.length,6);
  assert.deepEqual(requests.map(x=>new URL(x.url).pathname),MONITORED_RESOURCES);
  assert.ok(requests.every(x=>x.url.startsWith(PRODUCTION_ORIGIN)));
  assert.ok(requests.every(x=>x.request.cache==='no-store' && x.request.redirect==='manual'));
  assert.equal(requests.some(x=>/auth|rest\/v1|patients|payment/i.test(x.url)),false);
});

test('monitor raises failure if security headers disappear',async()=>{
  const report=await auditPublicSite(fakeFetch({noCsp:true}).fetcher,{attempts:1});
  assert.equal(report.healthy,false);
  assert.deepEqual(report.results.filter(x=>!x.ok),[
    {path:'/imec-uti/',ok:false,code:'CSP_FRAME_PROTECTION_MISSING'}
  ]);
});

test('monitor raises failure on manifest drift, persistent SW cache and invalid PNG',async()=>{
  const report=await auditPublicSite(fakeFetch({invalidManifest:true,swCaching:true,badIcon:true}).fetcher,{attempts:1});
  assert.equal(report.healthy,false);
  assert.ok(report.results.some(x=>x.code==='MANIFEST_SCOPE_INVALID'));
  assert.ok(report.results.some(x=>x.code==='SW_PERSISTENT_CACHE_DETECTED'));
  assert.ok(report.results.some(x=>x.code==='ICON_DIMENSIONS_INVALID'));
});

test('HTTP unavailability is retried and sanitised before incident output',async()=>{
  let attempts=0;
  const r=await auditPublicSite(async(url)=>{
    if(new URL(url).pathname==='/imec-uti/'){attempts++;return new Response('',{status:503})}
    return fixture(new URL(url).pathname);
  },{attempts:3,waitMs:0});
  assert.equal(r.healthy,false);
  assert.equal(attempts,3);
  assert.deepEqual(r.results[0],{path:'/imec-uti/',ok:false,code:'HTTP_503'});
  assert.ok(r.results.every(x=>Object.keys(x).sort().join(',')==='code,ok,path'));
});

test('monitor rejects non-allowlisted resources or origins',async()=>{
  await assert.rejects(fetchWithRetries(fetch,'/rest/v1/patients'),/UNAPPROVED_PUBLIC_RESOURCE/);
  await assert.rejects(fetchWithRetries(fetch,'/imec-uti/',{origin:'https://example.com'}),/UNAPPROVED_PRODUCTION_ORIGIN/);
});

test('workflow uses GitHub-hosted runner, read-only checkout and scoped issue permission',()=>{
  const source=fs.readFileSync('.github/workflows/imec-uti-uptime.yml','utf8');
  assert.match(source,/cron: '\*\/15 \* \* \* \*'/);
  assert.match(source,/workflow_dispatch:/);
  assert.match(source,/issues: write/);
  assert.match(source,/contents: read/);
  assert.match(source,/persist-credentials: false/);
  assert.match(source,/node scripts\/imec-uti-monitor-runner\.mjs/);
});
