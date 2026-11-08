import {it} from 'node:test';
import assert from 'node:assert/strict';
import {isolatedDatabase,createSyntheticAdmission} from './fixtures/imec-uti-database.ts';

it('registra alta retroativa no mesmo leito sem alterar a ocupação atual',async()=>{
  const {db,asUser}=await isolatedDatabase();
  try{
    const active=await createSyntheticAdmission(db,{name:'Ocupação atual',bed:17,entry:'2026-10-06T18:15:00Z',rate:500});
    const create=(start:string,end:string)=>db.query<{id:string}>(
      "select public.create_uti_historical_admission('Estadia anterior',null,17,'hotel',$1,'Samuel',false,null,500,null,$2) id",[start,end]);
    const {id}=(await create('2026-10-04T22:30:00Z','2026-10-06T18:15:00Z')).rows[0];
    const {rows}=await db.query("select status, discharge_at is not null discharged from public.admissions where id=$1",[id]);
    assert.deepEqual(rows,[{status:'discharge_pending',discharged:true}]);
    assert.equal((await db.query('select sum(amount)::int total,count(*)::int days from public.charges where admission_id=$1',[id])).rows[0].total,1000);
    assert.equal((await db.query('select status from public.admissions where id=$1',[active])).rows[0].status,'active');
    await assert.rejects(()=>create('2026-10-04T22:30:00Z','2026-10-05T18:15:00Z'),/período coincide/);
    await assert.rejects(()=>create('2026-10-06T18:14:00Z','2026-10-06T18:16:00Z'),/período coincide/);
    await asUser('anon');
    await assert.rejects(()=>create('2026-10-01T15:00:00Z','2026-10-02T15:00:00Z'),/permission denied/);
  }finally{await db.close()}
});
