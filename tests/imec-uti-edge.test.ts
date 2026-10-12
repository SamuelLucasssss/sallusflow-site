import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function invitationHarness({aal='aal2',activeAdmin=true}={}){
  const token='synthetic.'+Buffer.from(JSON.stringify({aal})).toString('base64url')+'.signature';
  let handler:(req:Request)=>Promise<Response>;let sent=0;let rpcJwt='';
  const context=vm.createContext({Request,Response,atob,console,
    Deno:{env:{get:(key:string)=>key},serve:(callback:typeof handler)=>{handler=callback;}},
    createClient:(_:string,key:string,options:any)=>({
      auth:{getUser:async()=>({data:{user:{id:'synthetic'}},error:null}),admin:{inviteUserByEmail:async()=>{sent++;return {data:{user:{id:'synthetic'}},error:null};}}},
      rpc:async()=>{rpcJwt=options?.global?.headers?.Authorization||'';return {data:activeAdmin&&rpcJwt===`Bearer ${token}`,error:null};},
      from:()=>({update:()=>({eq:async()=>({error:null})})})
    })
  });
  const source=fs.readFileSync('supabase/functions/invite-uti-user/index.ts','utf8').replace(/^import[^\n]*\n/gm,'');
  vm.runInContext(ts.transpile(source),context);
  return {call:()=>handler!(new Request('https://audit.invalid/invite',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({email:'operator@audit.invalid',display_name:'Synthetic operator',role:'operator'})})),get sent(){return sent;},get rpcJwt(){return rpcJwt;}};
}
test('convite AAL2 verifica a sessão no banco com o JWT do chamador',async()=>{
  const h=invitationHarness();const response=await h.call();assert.equal(response.status,200);assert.equal(h.sent,1);assert.match(h.rpcJwt,/^Bearer synthetic\./);
});
test('convite continua bloqueado para AAL1 e para administrador revogado',async()=>{
  for(const settings of [{aal:'aal1'},{activeAdmin:false}]){const h=invitationHarness(settings);assert.equal((await h.call()).status,403);assert.equal(h.sent,0);}
});
