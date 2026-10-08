// Test-only fetch interceptor: no outbound HTTP requests are ever made.
const scenario = process.env.MONITOR_TEST_SCENARIO || 'healthy';
const API_HOST = 'api.github.com';
const PUBLIC_HOST = 'www.sallusflow.com.br';
const INCIDENT_TITLE = 'IMEC UTI | Monitor externo: indisponibilidade detectada';
const INCIDENT_MARKER = '<!-- imec-uti-external-monitor-v1 -->';

function json(value, status=200) {
  return new Response(JSON.stringify(value), {status, headers:{'content-type':'application/json'}});
}
function icon(size) {
  const b=new Uint8Array(24);
  b.set([137,80,78,71,13,10,26,10]);
  const d=new DataView(b.buffer);
  d.setUint32(16,size);
  d.setUint32(20,size);
  return new Response(b,{status:200,headers:{'content-type':'image/png'}});
}

globalThis.fetch = async function testFetch(input, request = {}) {
  const url = new URL(String(input));
  if (url.hostname === API_HOST) {
    const action=(request.method || 'GET').toUpperCase();
    if (url.pathname.endsWith('/issues') && action==='GET') {
      if (scenario === 'existing' || scenario === 'recovered') {
        return json([{number:42,title:INCIDENT_TITLE,body:INCIDENT_MARKER}]);
      }
      return json([]);
    }
    if (url.pathname.endsWith('/issues') && action==='POST') {
      if(scenario!=='down')throw new Error('UNEXPECTED_GITHUB_CREATE');
      return json({number:42},201);
    }
    if (url.pathname.endsWith('/issues/42/comments') && action==='POST') {
      if(scenario!=='recovered')throw new Error('UNEXPECTED_GITHUB_COMMENT');
      return json({id:1},201);
    }
    if (url.pathname.endsWith('/issues/42') && action==='PATCH') {
      if(scenario!=='recovered')throw new Error('UNEXPECTED_GITHUB_CLOSE');
      return json({state:'closed'},200);
    }
    throw new Error('UNEXPECTED_GITHUB_REQUEST');
  }
  if(url.hostname !== PUBLIC_HOST || url.protocol!=='https:' || request.cache!=='no-store' || request.redirect!=='manual') {
    throw new Error('UNAPPROVED_NETWORK_REQUEST');
  }
  const path=url.pathname;
  if (path === '/imec-uti/') {
    if(scenario==='down' || scenario==='existing')return new Response('',{status:503});
    return new Response('<html><title>IMEC UTI | Particular & Hotelaria</title><link rel="manifest" href="/imec-uti/manifest.webmanifest"><div id="app"></div></html>',{
      status:200,
      headers:{
        'cache-control':'no-store, max-age=0',
        'content-security-policy':"default-src 'self'; frame-ancestors 'none'",
        'x-frame-options':'DENY',
        'x-content-type-options':'nosniff'
      }
    });
  }
  if(path === '/imec-uti/manifest.webmanifest')return json({
    start_url:'/imec-uti/',scope:'/imec-uti/',display:'standalone',
    icons:[
      {src:'/imec-uti/icon-192.png',sizes:'192x192'},
      {src:'/imec-uti/icon-512.png',sizes:'512x512'},
      {src:'/imec-uti/icon-maskable-512.png',sizes:'512x512',purpose:'maskable'}
    ]
  });
  if(path === '/imec-uti/sw.js')return new Response("fetch(event.request,{cache:'no-store'})",{status:200});
  if(path==='/imec-uti/icon-192.png')return icon(192);
  if(path==='/imec-uti/icon-512.png'||path==='/imec-uti/icon-maskable-512.png')return icon(512);
  throw new Error('UNEXPECTED_PUBLIC_PATH');
};
