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

it('programa o valor escolhido para o próximo ciclo e preserva diárias lançadas nas duas direções',async()=>{
  const {db,asUser}=await isolatedDatabase();
  try{
    for(const [from,to,beforeRate,chosenRate] of [[10,17,400,510],[17,10,500,400]]){
      await db.exec('reset role;begin');await asUser('admin');
      const id=await createSyntheticAdmission(db,{name:'Tarifa sintética',bed:from,entry:'2026-10-05T20:02:00Z',rate:beforeRate});
      const version=(await db.query('select account_version from public.admissions where id=$1',[id])).rows[0].account_version;
      const charges=()=>db.query("select id,amount from public.charges where admission_id=$1 and cancelled_at is null order by id",[id]).then(result=>result.rows);
      const before=await charges();
      const transfer=(rate:number|string)=>db.query(
        "select public.transfer_uti_bed_with_rate($1,$2,$3,'2026-10-06T18:15:00Z','Tarifa escolhida no teste',$4)",[id,version,to,rate]);
      await db.exec('savepoint invalid_rate');
      await assert.rejects(()=>transfer('NaN'),/valor positivo/);
      await db.exec('rollback to savepoint invalid_rate');
      await transfer(chosenRate);
      assert.deepEqual(await charges(),before);
      const {rows:[schedule]}=await db.query(`select next_daily_rate::float8 rate,
        (rate_effective_at at time zone 'America/Sao_Paulo')::time::text cycle,
        rate_effective_at>now() prospective,rate_effective_at
        from public.admission_bed_transfers where admission_id=$1`,[id]);
      assert.equal(schedule.rate,chosenRate);
      assert.equal(schedule.cycle,'07:00:00');
      assert.equal(schedule.prospective,true);
      await db.exec('reset role');
      const projected=await db.query(`select amount::float8 amount from private.compute_daily_charge_rows($1,$2::timestamptz+interval '1 day')
        where occurred_at between $2::timestamptz-interval '1 day' and $2::timestamptz order by occurred_at`,[id,schedule.rate_effective_at]);
      assert.deepEqual(projected.rows,[{amount:beforeRate},{amount:chosenRate}]);
      await db.exec('rollback');
    }
  }finally{await db.close()}
});
