import {it} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('scripts/security-audit.mjs','utf8').replace("import { spawnSync } from 'node:child_process';",'');
function run(result:unknown,platform='linux'){
 let code:number|undefined,options:any;
 const context={spawnSync:(_command:string,_args:string[],opts:unknown)=>{options=opts;return result},process:{platform,exit:(n:number)=>{code=n;throw new Error('exit')}},console:{log:()=>{},error:()=>{}}};
 try{vm.runInNewContext(source,context)}catch(error){assert.equal((error as Error).message,'exit')}
 return {code,options};
}
it('auditoria não aprova execução ausente, falha de rede ou relatório incompleto',()=>{
 for(const result of [{error:new Error('ENOENT'),status:null},{status:2,stdout:'{}'},{status:1,stdout:'{"error":{"code":"network"}}'},{status:0,stdout:'{}'},{status:0,stdout:'invalid'}])assert.equal(run(result).code,2);
});
it('auditoria permite relatório completo sem vulnerabilidades e resolve npm no Windows',()=>{
 const result={status:0,stdout:JSON.stringify({vulnerabilities:{},metadata:{vulnerabilities:{high:0,critical:0,total:0}}})};
 assert.equal(run(result).code,0);const windows=run(result,'win32');assert.equal(windows.code,0);assert.equal(windows.options.shell,true);assert.equal(run(result).options.shell,false);
});
it('auditoria continua bloqueando pacote High/Critical',()=>{
 const result={status:1,stdout:JSON.stringify({vulnerabilities:{dependency:{severity:'high',isDirect:false,range:'<1.1',fixAvailable:true,via:['advisory']}},metadata:{vulnerabilities:{high:1,total:1}}})};
 assert.equal(run(result).code,1);
});
