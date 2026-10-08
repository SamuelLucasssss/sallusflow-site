const CACHE_PREFIX='imec-uti-online-only-';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',(event)=>{
  event.waitUntil(
    caches.keys()
      .then((keys)=>Promise.all(keys.filter((key)=>key.startsWith(CACHE_PREFIX)).map((key)=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});
self.addEventListener('fetch',(event)=>{
  if(event.request.method!=='GET')return;
  event.respondWith(
    fetch(event.request,{cache:'no-store'}).catch(()=>{
      if(event.request.mode==='navigate'){
        return new Response(
          '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>IMEC UTI — sem conexão</title><body style="font-family:system-ui,sans-serif;padding:32px;color:#172326;background:#f4f7f7"><main><h1>Sem conexão</h1><p>O IMEC UTI funciona somente online para não armazenar dados operacionais no dispositivo. Reconecte-se e tente novamente.</p></main></body></html>',
          {status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}}
        );
      }
      return Response.error();
    })
  );
});
