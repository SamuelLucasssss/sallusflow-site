// Real Edge handler + real isolated database; ONLY hosted Auth is synthetic.
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {auditUsers, type isolatedDatabase} from './imec-uti-database.ts';

export function invitationEdge(f:Awaited<ReturnType<typeof isolatedDatabase>>,currentRole:()=>keyof typeof auditUsers){
 let handler:(req:Request)=>Promise<Response>;
 const create=async(email:string,name:string,link:boolean)=>{
   await f.db.exec('reset role');const id=crypto.randomUUID();
   await f.db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3::jsonb)',[id,email,JSON.stringify({display_name:name})]);
   await f.db.query('update public.profiles set email=$2 where id=$1',[id,email]);
   return {data:{user:{id},...(link?{properties:{action_link:'https://nxaxkczyeythvzdxqwyu.supabase.co/auth/v1/verify?type=invite&token=synthetic-browser-invitation'}}:{})},error:null};
 };
 const runtime=vm.createContext({Request,Response,URL,console,
   Deno:{env:{get:(key:string)=>key==='SUPABASE_URL'?'https://nxaxkczyeythvzdxqwyu.supabase.co':key},serve:(cb:typeof handler)=>handler=cb},
   createClient:()=>({auth:{getUser:async()=>({data:{user:{id:auditUsers[currentRole()]}},error:null}),admin:{
     generateLink:async(p:any)=>create(p.email,p.options.data.display_name,true),
     inviteUserByEmail:async(email:string,p:any)=>create(email,p.data.display_name,false),
   }},rpc:async(name:string,args:Record<string,unknown>={})=>{
     await f.asUser(currentRole());const keys=Object.keys(args);if(!['is_uti_admin_secure_session','admin_update_uti_member'].includes(name))throw Error('Unexpected invitation RPC');
     const named=keys.map((k,i)=>`${k} := $${i+1}`).join(',');
     try{return {data:(await f.db.query(`select public.${name}(${named}) as r`,Object.values(args))).rows[0].r,error:null}}catch(e){return {data:null,error:{message:e.message}}}
   }}),
 });
 vm.runInContext(ts.transpile(fs.readFileSync('supabase/functions/invite-uti-user/index.ts','utf8').replace(/^import[^\n]*\n/gm,'')),runtime);
 return (request:Request)=>handler(request);
}
