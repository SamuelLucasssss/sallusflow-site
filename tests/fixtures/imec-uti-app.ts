import fs from 'node:fs';
import vm from 'node:vm';
import * as domain from '../../src/imec-uti/domain.ts';
import * as security from '../../src/imec-uti/security.ts';
import * as payment from '../../src/imec-uti/payment-details.ts';
import * as reports from '../../src/imec-uti/monthly-report.ts';

export function appHarness(overrides:Record<string,unknown>={}){
  const values=new Map<string,string>();
  const context=vm.createContext({...domain,...security,...payment,...reports,URL,Blob,Date,Intl,Response,Uint8Array,crypto,console,
    SUPABASE_URL:'https://audit.invalid',SUPABASE_KEY:'publishable-synthetic',
    localStorage:{getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)},
    document:{querySelector:()=>null,getElementById:()=>null},window:{},navigator:{onLine:true},
    ...overrides
  });
  let source=fs.readFileSync('src/imec-uti/app.ts','utf8');
  source=source.slice(0,source.indexOf("\ndocument.addEventListener('click',async e=>"));
  source=source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\r?\n/gm,'');
  vm.runInContext(source,context);
  return {context,values,run:(code:string)=>vm.runInContext(code,context)};
}
