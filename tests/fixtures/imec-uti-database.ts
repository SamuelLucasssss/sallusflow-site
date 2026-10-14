import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read=(file:string)=>fs.readFileSync(`supabase/migrations/${file}`,'utf8');
export const auditUsers={admin:'00000000-0000-0000-0000-000000000001',commercial:'00000000-0000-0000-0000-000000000002',operator:'00000000-0000-0000-0000-000000000003',inactive:'00000000-0000-0000-0000-000000000004'};
export async function isolatedDatabase({hardened=true}={}){
  const db=await PGlite.create();
  await db.exec(`create role anon;create role authenticated;create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'::jsonb);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema auth,public to authenticated,anon;
  `);
  await db.exec(read('20261004014534_initial_uti_schema.sql'));
  await db.exec(`alter table public.profiles add column email text;
    alter table public.charges add column client_ref text,add column cancelled_at timestamptz,add column cancelled_by uuid references public.profiles,add column cancel_reason text;
    alter table public.payments add column client_ref text,add column cancelled_at timestamptz,add column cancelled_by uuid references public.profiles,add column cancel_reason text;
    create unique index charges_admission_client_ref_unique on public.charges(admission_id,client_ref) where client_ref is not null;
    create unique index payments_admission_client_ref_unique on public.payments(admission_id,client_ref) where client_ref is not null;
    create unique index rate_periods_admission_effective_unique on public.rate_periods(admission_id,effective_at);
    create function private.current_display_name() returns text language sql security definer set search_path=public,private,pg_temp as $$ select display_name from public.profiles where id=auth.uid() and active $$;
  `);
  await db.exec(read('20261006095619_package1_financial_integrity_and_authorization.sql'));
  await db.exec(read('20261006095753_package1_testable_role_matrix.sql'));
  await db.exec(read('20261006201531_package1_rls_least_privilege.sql'));
  await db.exec(read('20261007141153_package3_security_foundation.sql'));
  // Current session-aware role function and RPC wrappers from the repository, not mocks.
  const authSource=read('20261007124739_package3_auth_security_foundation.sql');
  const currentRole=authSource.match(/create or replace function private\.current_role\([\s\S]*?\$\$;/i);
  if(!currentRole)throw new Error('Session-aware role definition not found');
  await db.exec(currentRole[0]);
  const architecture=read('20261006013919_deep_audit_private_rpc_architecture.sql')+'\n'+read('20261006014509_audited_financial_corrections.sql');
  const sync=architecture.match(/CREATE OR REPLACE FUNCTION private\.sync_uti_charges_impl\([\s\S]*?(?:\$function\$;|\$\$;)/i);
  if(!sync)throw new Error('Sync function not found');
  await db.exec(sync[0]);
  await db.exec('revoke all on function private.sync_uti_charges_impl(uuid,timestamptz) from public,anon;grant execute on function private.sync_uti_charges_impl(uuid,timestamptz) to authenticated;');
  const adminUpdate=architecture.match(/CREATE OR REPLACE FUNCTION private\.admin_update_uti_member_impl\([\s\S]*?(?:\$function\$;|\$\$;)/i);
  if(!adminUpdate)throw new Error('Admin update function not found');
  await db.exec(adminUpdate[0]);
  await db.exec('revoke all on function private.admin_update_uti_member_impl(uuid,boolean,text) from public,anon;grant execute on function private.admin_update_uti_member_impl(uuid,boolean,text) to authenticated;');
  await db.exec(read('20261004021555_protect_last_admin.sql'));
  for(const name of ['create_uti_admission','add_uti_payment','add_uti_extra','adjust_uti_rate','cancel_uti_payment','cancel_uti_extra','sync_uti_charges','admin_update_uti_member']){
    const definition=architecture.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?(?:\\$function\\$;|\\$\\$;)`,'i'));
    if(!definition)throw new Error('Wrapper not found: '+name);
    await db.exec(definition[0]);
  }
  await db.exec(read('20261011214050_grant_rls_predicates_authenticated.sql'));
  await db.exec(read('20261011221655_settlement_card_details.sql'));
  await db.exec(read('20261012001555_uti_audited_settlement_discount.sql'));
  await db.exec(read('20261008124228_package6_document_output_audit.sql'));
  await db.exec(read('20261008125711_package6_secure_admin_json_export.sql'));
  if(hardened)await db.exec(read('20261012004235_audit_integrity_hardening.sql'));
  const scheduledMigration=fs.readdirSync('supabase/migrations').find(file=>file.endsWith('_scheduled_receipts.sql'));
  if(scheduledMigration)await db.exec(read(scheduledMigration));
  const finiteDates=fs.readdirSync('supabase/migrations').find(file=>file.endsWith('_scheduled_receipts_finite_dates.sql'));
  if(finiteDates)await db.exec(read(finiteDates));
  const receiptEdit=fs.readdirSync('supabase/migrations').find(file=>file.endsWith('_audited_receipt_edit.sql'));
  if(receiptEdit)await db.exec(read(receiptEdit));
  const monthlyReports=fs.readdirSync('supabase/migrations').find(file=>file.endsWith('_humanized_monthly_reports.sql'));
  if(monthlyReports)await db.exec(read(monthlyReports));
  const admissionEdit=fs.readdirSync('supabase/migrations').find(file=>file.endsWith('_audited_admission_initial_edit.sql'));
  if(admissionEdit)await db.exec(read(admissionEdit));
  for(const [role,id] of Object.entries(auditUsers)){
    await db.query('insert into auth.users(id,email) values($1,$2)',[id,`${role}@audit.invalid`]);
    await db.query('update public.profiles set display_name=$2,role=$3,active=$4 where id=$1',[id,`Synthetic ${role}`,role==='inactive'?'operator':role,role!=='inactive']);
    await db.query('insert into auth.sessions(id,user_id) values($1,$1)',[id]);
  }
  const asUser=async (role:keyof typeof auditUsers|'anon',aal='aal1',validSession=true)=>{
    await db.exec('reset role');
    const id=role==='anon'?'':auditUsers[role];
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[id,JSON.stringify({sub:id,aal,session_id:validSession?id:'00000000-0000-0000-0000-000000000099'})]);
    await db.exec(`set role ${role==='anon'?'anon':'authenticated'}`);
  };
  await asUser('admin');
  return {db,asUser};
}

export async function createSyntheticAdmission(db:PGlite,{name='Paciente sintético',bed=10,mode='hotel',entry='2026-10-01T12:00:00-03:00',rate=400,half=false,cpf=null}:{name?:string,bed?:number,mode?:string,entry?:string,rate?:number|string,half?:boolean,cpf?:string|null}={}){
  const result=await db.query<{id:string}>('select public.create_uti_admission($1,$2,$3,$4,$5::timestamptz,$6,$7,$8,$9::numeric,$10) as id',[name,cpf,bed,mode,entry,'Samuel',half,false,rate,'Dados sintéticos — banco isolado']);
  return result.rows[0].id;
}
