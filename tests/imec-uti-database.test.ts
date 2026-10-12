import { describe,it,before,after,beforeEach,afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedDatabase,createSyntheticAdmission,auditUsers } from './fixtures/imec-uti-database.ts';

describe('PostgreSQL isolado: integridade financeira, sessão e autorização',()=>{
  let fixture:Awaited<ReturnType<typeof isolatedDatabase>>;
  before(async()=>{fixture=await isolatedDatabase();});
  after(async()=>{await fixture?.db.close();});
  beforeEach(async()=>{await fixture.db.exec('reset role;begin');await fixture.asUser('admin');});
  afterEach(async()=>{await fixture.db.exec('rollback;reset role');});
  const preview=async(id:string,date='2026-10-03T12:00:00-03:00')=>(await fixture.db.query<{s:any}>('select public.preview_uti_settlement($1,$2::timestamptz) as s',[id,date])).rows[0].s;
  const pay=(id:string,amount:number,ref='receipt',date='2026-10-02T14:00:00-03:00')=>fixture.db.query('select public.add_uti_payment($1,$2::timestamptz,$3,$4,$5,$6)',[id,date,amount,'PIX',null,ref]);
  const rejects=async(work:()=>Promise<unknown>,pattern?:RegExp)=>{
    await fixture.db.exec('savepoint expected_failure');
    try{await assert.rejects(work,pattern);}finally{await fixture.db.exec('rollback to savepoint expected_failure;release savepoint expected_failure');}
  };

  it('duas diárias, extras e pagamentos parciais fecham exatamente no banco',async()=>{
    const id=await createSyntheticAdmission(fixture.db);
    await fixture.db.query('select public.add_uti_extra($1,$2::timestamptz,$3,$4,$5,$6)',[id,'2026-10-02T10:00:00-03:00','Cardiologia','Avaliação sintética',100,'extra']);
    const s=await preview(id);assert.equal(s.dailyTotal,800);assert.equal(s.extrasTotal,100);assert.equal(s.total,900);
    await fixture.db.query('select public.discharge_uti($1,$2::timestamptz,$3::bigint)',[id,s.dischargeAt,s.accountVersion]);
    await pay(id,400,'partial');assert.equal((await preview(id)).balance,500);
    await pay(id,500,'final');const end=await preview(id);assert.equal(end.balance,0);assert.equal(end.received,900);
    assert.equal((await fixture.db.query('select status from public.admissions where id=$1',[id])).rows[0].status,'finalized');
  });
  it('meia diária, virada de mês e ano bissexto respeitam o dia de saída',async()=>{
    const id=await createSyntheticAdmission(fixture.db,{entry:'2024-02-28T23:59:00-03:00',half:true});
    const s=await preview(id,'2024-03-01T00:01:00-03:00');
    assert.equal(s.dailyTotal,600);assert.equal(s.dailyUnits,1.5);assert.equal(s.fullDailyCount,1);assert.equal(s.halfDailyCount,1);
    assert.equal((await preview(id,'2024-02-28T23:59:00-03:00')).dailyTotal,200);
  });
  it('histórico de tarifas e reconciliação preservam os lançamentos originais',async()=>{
    const id=await createSyntheticAdmission(fixture.db);
    await fixture.db.query('select public.adjust_uti_rate($1,$2::timestamptz,$3,$4)',[id,'2026-10-02T06:59:00-03:00',500,false]);
    const s=await preview(id);assert.equal(s.dailyTotal,900);
    const history=await fixture.db.query('select count(*)::int as n from public.charges where admission_id=$1 and cancelled_at is not null',[id]);
    assert.ok(history.rows[0].n>0);
  });
  it('retry do PIX quitado retorna sucesso sem duplicar recebimento ou auditoria',async()=>{
    const id=await createSyntheticAdmission(fixture.db),s=await preview(id);
    await fixture.db.query('select public.discharge_uti($1,$2::timestamptz,$3::bigint)',[id,s.dischargeAt,s.accountVersion]);
    await pay(id,800);await pay(id,800);
    assert.equal((await preview(id)).received,800);
    assert.equal((await fixture.db.query("select count(*)::int as n from public.audits where admission_id=$1 and action='Pagamento registrado'",[id])).rows[0].n,1);
  });
  it('desconto da main zera saldo com ajuste negativo e preserva recebimentos',async()=>{
    const id=await createSyntheticAdmission(fixture.db),s=await preview(id);
    await fixture.db.query('select public.discharge_uti($1,$2::timestamptz,$3::bigint)',[id,s.dischargeAt,s.accountVersion]);
    await pay(id,500,'receipt-before-discount');
    const discount=()=>fixture.db.query('select public.grant_uti_settlement_discount($1,$2,$3,$4)',[id,300,'Negociação sintética autorizada','synthetic-discount-ref']);
    await rejects(()=>fixture.db.query('select public.grant_uti_settlement_discount($1,$2,$3,$4)',[id,301,'Negociação sintética autorizada','excess-discount-reference']),/saldo/);
    await discount();await discount();
    const end=await preview(id);assert.equal(end.total,500);assert.equal(end.received,500);assert.equal(end.balance,0);
    assert.equal((await fixture.db.query('select status from public.admissions where id=$1',[id])).rows[0].status,'finalized');
    assert.equal((await fixture.db.query('select count(*)::int as n from public.payments where admission_id=$1',[id])).rows[0].n,1);
    assert.equal((await fixture.db.query("select count(*)::int as n from public.charges where admission_id=$1 and kind='adjustment'",[id])).rows[0].n,1);
    assert.equal((await fixture.db.query("select count(*)::int as n from public.audits where admission_id=$1 and action='Desconto concedido no acerto'",[id])).rows[0].n,1);
  });
  it('a mesma referência com outro valor é rejeitada',async()=>{
    const id=await createSyntheticAdmission(fixture.db);await pay(id,100);
    await rejects(()=>pay(id,200),/Identificador já utilizado/);
    assert.equal((await preview(id)).received,100);
  });
  it('diária NaN é rejeitada antes de contaminar a conta',async()=>{
    await rejects(()=>createSyntheticAdmission(fixture.db,{rate:'NaN'}),/diária inválido|finite/i);
  });
  it('a segunda tentativa de ocupar o mesmo leito é bloqueada pela constraint',async()=>{
    await createSyntheticAdmission(fixture.db);
    await rejects(()=>createSyntheticAdmission(fixture.db,{name:'Outro sintético'}),/leito já possui/);
    assert.equal((await fixture.db.query('select count(*)::int as n from public.admissions')).rows[0].n,1);
  });
  it('versão antiga do acerto não pode concluir alta depois de novo extra',async()=>{
    const id=await createSyntheticAdmission(fixture.db),s=await preview(id);
    await fixture.db.query('select public.add_uti_extra($1,$2::timestamptz,$3,$4,$5,$6)',[id,'2026-10-02T10:00:00-03:00','Outro serviço','Extra sintético',25,'extra']);
    await rejects(()=>fixture.db.query('select public.discharge_uti($1,$2::timestamptz,$3::bigint)',[id,s.dischargeAt,s.accountVersion]),/Recalcule/);
  });
  it('operacional não recebe e comercial não estorna; admin preserva histórico',async()=>{
    const id=await createSyntheticAdmission(fixture.db);await fixture.asUser('operator');
    await rejects(()=>pay(id,100),/perfil não pode/);
    await fixture.asUser('commercial');await pay(id,100);
    const payment=(await fixture.db.query('select id from public.payments where admission_id=$1',[id])).rows[0].id;
    await rejects(()=>fixture.db.query('select public.cancel_uti_payment($1,$2)',[payment,'Teste sintético']),/administradores/);
    await fixture.asUser('admin');await fixture.db.query('select public.cancel_uti_payment($1,$2)',[payment,'Teste sintético']);
    assert.equal((await preview(id)).received,0);
  });
  it('crédito e reembolso reconciliam a conta e rejeitam devolução acima do crédito',async()=>{
    const id=await createSyntheticAdmission(fixture.db);await pay(id,800);
    await fixture.db.query('select public.adjust_uti_rate($1,$2::timestamptz,$3,$4)',[id,'2026-10-01T12:00:00-03:00',100,false]);
    const s=await preview(id);assert.equal(s.balance,-600);
    await fixture.db.query('select public.discharge_uti($1,$2::timestamptz,$3::bigint)',[id,s.dischargeAt,s.accountVersion]);
    await rejects(()=>fixture.db.query('select public.add_uti_refund($1,$2::timestamptz,$3,$4,$5,$6)',[id,'2026-10-03T14:00:00-03:00',601,'PIX',null,'refund']),/maior|excede/);
    await fixture.db.query('select public.add_uti_refund($1,$2::timestamptz,$3,$4,$5,$6)',[id,'2026-10-03T14:00:00-03:00',600,'PIX',null,'refund']);
    assert.equal((await preview(id)).balance,0);
  });
  it('RLS não quebra nos predicados privados e bloqueia inativo ou sessão revogada',async()=>{
    await createSyntheticAdmission(fixture.db);
    for(const role of ['admin','commercial','operator'] as const){await fixture.asUser(role);assert.equal((await fixture.db.query('select id from public.patients')).rows.length,1);}
    await fixture.asUser('inactive');assert.equal((await fixture.db.query('select id from public.patients')).rows.length,0);
    await fixture.asUser('admin','aal1',false);assert.equal((await fixture.db.query('select id from public.patients')).rows.length,0);
    await rejects(()=>pay('00000000-0000-0000-0000-000000000099',100),/perfil não pode/);
    await fixture.asUser('anon');await rejects(()=>fixture.db.query('select id from public.patients'),/permission denied/);
  });
  it('MFA continua opcional por flag e escrita financeira direta continua negada',async()=>{
    await createSyntheticAdmission(fixture.db);await fixture.asUser('admin');
    await rejects(()=>fixture.db.query('update public.payments set amount=1'),/permission denied/);
    await fixture.db.exec('reset role;update public.app_settings set mfa_required=true');
    await fixture.asUser('admin','aal1');assert.equal((await fixture.db.query('select id from public.patients')).rows.length,0);
    await fixture.asUser('admin','aal2');assert.equal((await fixture.db.query('select id from public.patients')).rows.length,1);
  });
  it('admin libera outro perfil e não pode desativar o último administrador',async()=>{
    await fixture.db.query('select public.admin_update_uti_member($1,$2,$3)',[auditUsers.inactive,true,'operator']);
    await fixture.asUser('inactive');assert.equal((await fixture.db.query('select private.is_active_member() as allowed')).rows[0].allowed,true);
    await rejects(()=>fixture.db.query('select public.admin_update_uti_member($1,$2,$3)',[auditUsers.admin,false,'operator']),/administrador/);
    await fixture.asUser('admin');await rejects(()=>fixture.db.query('select public.admin_update_uti_member($1,$2,$3)',[auditUsers.admin,false,'operator']),/administrador ativo/);
  });
});
