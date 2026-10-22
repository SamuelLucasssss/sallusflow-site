import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function invitationHarness({aal='aal1',activeAdmin=true,mfaRequired=false,validUser=true,activationError=false,inviteError=false,link='https://audit.invalid/auth/v1/verify?type=invite&token=synthetic-one-use-token'}={}){
 const token='synthetic.'+Buffer.from(JSON.stringify({aal})).toString('base64url')+'.signature';
 let handler:(req:Request)=>Promise<Response>;let sent=0,generated=0;const calls:{name:string,args:any,jwt:string}[]=[];
 const context=vm.createContext({Request,Response,URL,console,
   Deno:{env:{get:(key:string)=>key==='SUPABASE_URL'?'https://audit.invalid':key},serve:(cb:typeof handler)=>handler=cb},
   createClient:(_:string,_key:string,options:any)=>({
     auth:{getUser:async()=>({data:{user:validUser?{id:'synthetic-admin'}:null},error:null}),admin:{
       inviteUserByEmail:async()=>{sent++;return {data:{user:{id:'synthetic-invited'}},error:inviteError?{message:'Email address not authorized'}:null}},
       generateLink:async()=>{generated++;return {data:{user:{id:'synthetic-invited'},properties:{action_link:link}},error:null}},
     }},
     rpc:async(name:string,args:any)=>{
       const jwt=options?.global?.headers?.Authorization||'';calls.push({name,args,jwt});
       return name==='is_uti_admin_secure_session'?{data:activeAdmin&&(!mfaRequired||aal==='aal2')&&jwt===`Bearer ${token}`,error:null}:{data:null,error:activationError?{message:'revoked'}:null};
     },
   }),
 });
 const source=fs.readFileSync('supabase/functions/invite-uti-user/index.ts','utf8').replace(/^import[^\n]*\n/gm,'');vm.runInContext(ts.transpile(source),context);
 return {call:(body:Record<string,unknown>={})=>handler!(new Request('https://audit.invalid/invite',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({email:'referral@audit.invalid',display_name:'Synthetic referral',role:'referral',delivery:'email',...body})})),get sent(){return sent},get generated(){return generated},calls};
}
test('administrador com senha libera e audita o convidado em uma ação com seu próprio JWT',async()=>{
 const h=invitationHarness();const r=await h.call();assert.equal(r.status,200);const b=await r.json();assert.equal(b.activated,true);assert.equal(b.action_link,null);assert.equal(h.sent,1);
 assert.deepEqual(h.calls.map(x=>x.name),['is_uti_admin_secure_session','admin_update_uti_member']);assert.equal(h.calls[1].args.p_active,true);assert.equal(h.calls[1].args.p_role,'referral');assert.ok(h.calls.every(x=>x.jwt.startsWith('Bearer synthetic.')));
});
test('MFA configurado continua exigido; conta revogada não convida nem ativa',async()=>{
 for(const setting of [{mfaRequired:true},{activeAdmin:false}]){const h=invitationHarness(setting);assert.equal((await h.call()).status,403);assert.equal(h.sent,0);assert.equal(h.generated,0);}
 const h=invitationHarness({aal:'aal2',mfaRequired:true});assert.equal((await h.call()).status,200);
});
test('link de primeiro acesso cria acesso ativo sem enviar e-mail',async()=>{
 const h=invitationHarness();const r=await h.call({delivery:'link'});assert.equal(r.status,200);const b=await r.json();assert.match(b.action_link,/auth\/v1\/verify/);assert.equal(b.activated,true);assert.equal(h.sent,0);assert.equal(h.generated,1);
});
test('sessão inválida, perfil e entrega inválidos não criam usuários',async()=>{
 const h=invitationHarness({validUser:false});assert.equal((await h.call()).status,400);assert.equal(h.sent,0);
 for(const body of [{role:'owner'},{delivery:'unsafe'},{display_name:'a'},{email:'invalid'}]){const h=invitationHarness();assert.equal((await h.call(body)).status,400);assert.equal(h.sent,0);assert.equal(h.generated,0);}
});
test('falha na liberação não devolve link nem anuncia sucesso',async()=>{
 const h=invitationHarness({activationError:true});const r=await h.call({delivery:'link'});assert.equal(r.status,400);const b=await r.json();assert.ok(!b.action_link);assert.match(b.error,/liberação não foi concluída/);
});
test('link fora do domínio do projeto é rejeitado antes da liberação',async()=>{
 const h=invitationHarness({link:'https://wrong.invalid/auth/v1/verify?type=invite&token=synthetic'});const r=await h.call({delivery:'link'});assert.equal(r.status,400);assert.equal(h.calls.length,1);assert.doesNotMatch(JSON.stringify(await r.json()),/token=synthetic/);
});
test('falha no envio orienta usar link sem dizer que e-mail foi enviado',async()=>{
 const h=invitationHarness({inviteError:true});const r=await h.call();assert.equal(r.status,400);assert.match((await r.json()).error,/Link de primeiro acesso/);assert.equal(h.calls.length,1);
});
