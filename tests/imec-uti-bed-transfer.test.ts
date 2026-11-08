import {it} from 'node:test';
import assert from 'node:assert/strict';
import {isolatedDatabase,createSyntheticAdmission} from './fixtures/imec-uti-database.ts';

it('registra a troca de leito e usa o histórico ao validar novas internações',async()=>{
  const {db,asUser}=await isolatedDatabase();
  try{
    const id=await createSyntheticAdmission(db,{name:'Transferência sintética',bed:10,entry:'2026-10-05T20:02:00Z',rate:500});
    const version=(await db.query('select account_version from public.admissions where id=$1',[id])).rows[0].account_version;
    const charges=()=>db.query('select id,amount from public.charges where admission_id=$1 order by id',[id]).then(result=>result.rows);
    const before=await charges();
    const transfer=(bed:number,at:string,expected=version)=>db.query(
      "select public.transfer_uti_bed($1,$2,$3,$4,'Transferência sintética')",[id,expected,bed,at]);
    const historical=(bed:number,start:string,end:string)=>db.query(
      "select public.create_uti_historical_admission('Estadia sintética',null,$1,'hotel',$2,'Samuel',false,null,500,null,$3)",[bed,start,end]);
    await historical(17,'2026-10-04T22:30:00Z','2026-10-06T18:15:00Z');
    await assert.rejects(()=>transfer(17,'2026-10-06T18:14:00Z'),/período coincide/);
    await asUser('commercial');
    await assert.rejects(()=>transfer(17,'2026-10-06T18:15:00Z'),/Somente administradores/);
    await asUser('admin');
    await transfer(17,'2026-10-06T18:15:00Z');
    assert.deepEqual(await charges(),before);
    assert.equal((await db.query('select bed from public.admissions where id=$1',[id])).rows[0].bed,17);
    assert.deepEqual((await db.query('select from_bed,to_bed from public.admission_bed_transfers where admission_id=$1',[id])).rows,[{from_bed:10,to_bed:17}]);
    await assert.rejects(()=>transfer(18,'2026-10-07T18:15:00Z'),/conta foi alterada/);
    await assert.rejects(()=>historical(10,'2026-10-05T20:03:00Z','2026-10-06T18:14:00Z'),/período coincide/);
    await historical(10,'2026-10-06T18:15:00Z','2026-10-07T18:15:00Z');
    await assert.rejects(()=>historical(17,'2026-10-06T18:15:00Z','2026-10-07T18:15:00Z'),/período coincide/);
    await asUser('anon');
    await assert.rejects(()=>transfer(18,'2026-10-07T18:15:00Z'),/permission denied/);
  }finally{await db.close()}
});
