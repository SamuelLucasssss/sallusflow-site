// @ts-nocheck
import {
  PRIVATE_NO_VENT, PRIVATE_VENT, HOTEL_SIMPLE, HOTEL_SUITE,
  money, businessParts, zonedLocalToDate, fmtDT, fmtDM, nowLocalInput,
  toLocalInput, parseLocal, cpfNorm, cpfMask, dayKey, monthKey,
  sameDay, sameMonth, bedRate, bedLabel, late, spParts,
  newAdmissionEstimate, roleLabel, balanceMeta
} from './domain';
import { SUPABASE_URL, SUPABASE_KEY } from './config';
import { clearAuthLinkArtifacts, initialAuthLinkType, supabase } from './supabase-client';
import {
  ABSOLUTE_SESSION_MS, IDLE_TIMEOUT_MS, pwnedCountFromRange,
  sessionExpiryReason, sha1Hex, validatePasswordPolicy
} from './security';

const USERS=['Samuel','Roberto','Aline'];
let state={page:'home', selectedId:null, patientFilter:'active', financeTab:'pending', search:''};
let data=blankData();
let authState=null;
let teamProfiles=[];
let teamClosers=[];
let remoteBusy=false;
let pendingMfaEnrollment=null;
let securityFlowBusy=false;
let activityWriteAt=0;
let inactivityTimer=null;
const SESSION_STARTED_KEY='imec-uti-session-start-v1';
const LAST_ACTIVITY_KEY='imec-uti-last-activity-v1';
const STRONG_PASSWORD_KEY='imec-uti-strong-password-v1';
const ROLE_PERMISSIONS={
  commercial:new Set(['create_admission','add_extra','add_payment','adjust_rate','discharge','update_on_duty']),
  operator:new Set(['create_admission','add_extra','discharge'])
};

const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
function blankData(){return {patients:[],admissions:[],charges:[],payments:[],refunds:[],audits:[],currentUser:'Samuel',currentRole:null,onDuty:'Samuel',seededDemo:false}}
function currentRate(a,at=new Date()){return [...a.rateHistory].filter(r=>new Date(r.effectiveAt)<=at).sort((x,y)=>new Date(y.effectiveAt)-new Date(x.effectiveAt))[0]||a.rateHistory[0]}
function totals(id){const billed=data.charges.filter(c=>c.admissionId===id).reduce((s,c)=>s+c.amount,0),received=data.payments.filter(p=>p.admissionId===id).reduce((s,p)=>s+p.amount,0),refunded=(data.refunds||[]).filter(r=>r.admissionId===id).reduce((s,r)=>s+r.amount,0),netReceived=received-refunded;return {billed,received,refunded,netReceived,balance:billed-received+refunded}}
function patient(id){return data.patients.find(p=>p.id===id)}
function admission(id){return data.admissions.find(a=>a.id===id)}
function hospitalDays(a){const st=new Date(a.entryAt), en=a.dischargeAt?new Date(a.dischargeAt):new Date();return Math.max(1,Math.ceil(Math.max(0,en-st)/86400000))}
function statusBadge(s){return s==='active'?'<span class="badge badge-brand">Internado</span>':s==='discharge_pending'?'<span class="badge badge-warn">Alta pendente</span>':s==='finalized'?'<span class="badge badge-good">Finalizado</span>':'<span class="badge badge-neutral">Cancelado</span>'}
function toast(text){const el=document.getElementById('toast');el.innerHTML=`✓ ${esc(text)}`;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2400)}
function shell(){
 document.getElementById('app').innerHTML=`
 <aside class="sidebar">
  <div class="brand"><div class="brand-mark">I</div><div><strong>IMEC UTI</strong><span>Particular & Hotelaria</span></div></div>
  <button class="btn btn-primary side-new" data-action="new">＋ Nova internação</button>
  <nav>${navItem('home','⌂','Início')}${navItem('patients','◉','Pacientes')}${navItem('finance','R$','Financeiro')}${navItem('settings','⚙','Configurações')}</nav>
  <div class="side-bottom"><div class="duty"><span>Plantão comercial</span><strong><span class="online-dot"></span>${esc(data.onDuty)}</strong></div><div class="user-chip"><div class="avatar">${esc(data.currentUser[0])}</div><div><strong>${esc(data.currentUser)}</strong><span>Usuário atual</span></div><span>•••</span></div></div>
 </aside>
 <div class="app-main"><header class="topbar"><div class="mobile-brand"><div class="brand-mark">I</div><div><strong>IMEC UTI</strong><span>Particular & Hotelaria</span></div></div><div class="top-actions"><button class="top-user" data-nav="settings"><div class="avatar small">${esc(data.currentUser[0])}</div><span>${esc(data.currentUser)}</span></button><button class="icon-btn mobile-only" data-action="new">＋</button></div></header><main class="content" id="content"></main></div>
 <nav class="bottom-nav"><button data-nav="home" class="${state.page==='home'?'active':''}"><b>⌂</b><span>Início</span></button><button data-nav="patients" class="${state.page==='patients'?'active':''}"><b>◉</b><span>Pacientes</span></button><button class="bottom-plus" data-action="new">＋</button><button data-nav="finance" class="${state.page==='finance'?'active':''}"><b>R$</b><span>Financeiro</span></button><button data-nav="settings" class="${state.page==='settings'?'active':''}"><b>⚙</b><span>Ajustes</span></button></nav>`;
}
function navItem(p,i,l){return `<button class="side-item ${state.page===p?'active':''}" data-nav="${p}"><span>${i}</span><span>${l}</span></button>`}
function render(){shell();const c=document.getElementById('content'); if(state.selectedId){const a=admission(state.selectedId); if(a){c.innerHTML=patientDetail(a);bindDetail(a);return}state.selectedId=null}
 c.innerHTML=state.page==='home'?dashboard():state.page==='patients'?patientsPage():state.page==='finance'?financePage():settingsPage();bindPage();}

function metric(label,value,note='',tone=''){return `<div class="metric-card ${tone?'metric-'+tone:''}"><div class="metric-icon">${label.includes('Receb')?'↙':label.includes('Saldo')?'$':'▣'}</div><div class="metric-copy"><span>${label}</span><strong>${value}</strong>${note?`<small>${note}</small>`:''}</div></div>`}
function empty(title,text){return `<div class="empty-state"><div class="empty-icon">▤</div><strong>${title}</strong><p>${text}</p></div>`}
function dashboard(){
  const active=data.admissions.filter(a=>a.status==='active'),pending=data.admissions.filter(a=>a.status==='discharge_pending');
  const attention=[...active,...pending].map(a=>({a,t:totals(a.id)})).filter(x=>Math.abs(x.t.balance)>0.009||x.a.status==='discharge_pending').sort((x,y)=>Math.abs(y.t.balance)-Math.abs(x.t.balance)).slice(0,5);
  const toReceive=[...active,...pending].reduce((s,a)=>s+Math.max(0,totals(a.id).balance),0);
  const credits=[...active,...pending].reduce((s,a)=>s+Math.max(0,-totals(a.id).balance),0);
  const payToday=data.payments.filter(p=>sameDay(p.occurredAt)).reduce((s,p)=>s+p.amount,0),refToday=(data.refunds||[]).filter(r=>sameDay(r.occurredAt)).reduce((s,r)=>s+r.amount,0);
  const payMonth=data.payments.filter(p=>sameMonth(p.occurredAt)).reduce((s,p)=>s+p.amount,0),refMonth=(data.refunds||[]).filter(r=>sameMonth(r.occurredAt)).reduce((s,r)=>s+r.amount,0);
  const billedMonth=data.charges.filter(c=>sameMonth(c.occurredAt)).reduce((s,c)=>s+c.amount,0);
  const commissions=data.admissions.filter(a=>a.mode==='private'&&a.status!=='cancelled'&&sameMonth(a.entryAt)).reduce((s,a)=>s+Number(a.commissionAmount||0),0);
  return `<section class="page-head"><div><span class="eyebrow">CONTROLE OPERACIONAL</span><h1>Visão geral</h1><p>Recebimentos, saldos e internações em um só lugar.</p></div>${can('create_admission')?'<button class="btn btn-primary" data-action="new">＋ Nova internação</button>':''}</section>
  <div class="metric-grid">${metric('Internados agora',active.length)}${metric('A receber',money(toReceive),credits>0?'Créditos a devolver: '+money(credits):'',toReceive>0?'warn':'good')}${metric('Caixa líquido hoje',money(payToday-refToday),refToday>0?'Reembolsado: '+money(refToday):'','good')}${metric('Caixa líquido no mês',money(payMonth-refMonth),`Cobrado: ${money(billedMonth)} • Reembolsado: ${money(refMonth)}`)}</div>
  <div class="dashboard-grid"><section class="panel"><div class="panel-head"><div><h2>Requer atenção</h2><p>Prioridades financeiras abertas.</p></div>${attention.length?`<span class="badge badge-warn">${attention.length} pendência${attention.length>1?'s':''}</span>`:''}</div>${attention.length?`<div class="attention-list">${attention.map(({a,t})=>{const p=patient(a.patientId),m=balanceMeta(t.balance);return `<button class="attention-row" data-open="${a.id}"><div class="status-rail ${a.status==='discharge_pending'?'rail-warn':'rail-bad'}"></div><div class="attention-main"><strong>${esc(p?.name)}</strong><span>Leito ${String(a.bed).padStart(2,'0')} • ${a.mode==='private'?'Particular':'Hotelaria'}${a.status==='discharge_pending'?' • Alta pendente':''}</span></div><div class="attention-value"><span>${m.label}</span><strong>${money(m.amount)}</strong></div><span>›</span></button>`}).join('')}</div>`:empty('Tudo em dia','Nenhuma pendência financeira nas internações abertas.')}</section>
  <section class="panel compact-panel"><div class="panel-head"><div><h2>Resumo do mês</h2><p>Indicadores essenciais.</p></div></div><div class="mini-stats"><div><span>Particulares iniciados</span><strong>${data.admissions.filter(a=>a.mode==='private'&&sameMonth(a.entryAt)).length}</strong></div><div><span>Hotelarias iniciadas</span><strong>${data.admissions.filter(a=>a.mode==='hotel'&&sameMonth(a.entryAt)).length}</strong></div><div><span>Comissões particulares</span><strong>${money(commissions)}</strong></div></div></section></div>
  <section class="panel"><div class="panel-head"><div><h2>Pacientes ativos</h2><p>Internações em andamento.</p></div><span class="badge badge-brand">${active.length}</span></div>${active.length?`<div class="patient-card-grid">${active.sort((a,b)=>new Date(b.entryAt)-new Date(a.entryAt)).slice(0,6).map(patientCard).join('')}</div>`:empty('Nenhuma internação ativa','Use “Nova internação” para começar o controle.')}</section>`;
}
function patientCard(a){
  const p=patient(a.patientId),t=totals(a.id),r=currentRate(a),m=balanceMeta(t.balance);
  return `<button class="patient-card" data-open="${a.id}"><div class="patient-card-top"><div class="bed-chip">${String(a.bed).padStart(2,'0')}</div><span class="badge ${a.mode==='private'?'badge-brand':'badge-neutral'}">${a.mode==='private'?'Particular':'Hotelaria'}</span></div><h3>${esc(p?.name)}</h3><p>${a.mode==='private'?(r.ventilation?'Com ventilação':'Sem ventilação'):esc(r.label)}</p><div class="patient-meta"><span>▣ Entrada ${fmtDT(a.entryAt)}</span><span>◷ ${hospitalDays(a)}º dia</span></div><div class="patient-money"><div><span>Cobrado</span><strong>${money(t.billed)}</strong></div><div><span>Recebido líquido</span><strong>${money(t.netReceived)}</strong></div></div><div class="balance-strip ${Math.abs(t.balance)<=0.009?'paid':'open'}"><span>${m.label}</span><strong>${money(m.amount)}</strong><span>›</span></div></button>`;
}
function patientsPage(){
  const q=state.search.toLowerCase().trim();
  let rows=data.admissions.filter(a=>{const p=patient(a.patientId);const ms=!q||(p?.name||'').toLowerCase().includes(q)||cpfNorm(p?.cpf).includes(cpfNorm(q));const f=state.patientFilter;const mf=f==='all'||(f==='active'&&a.status==='active')||(f==='pending'&&a.status==='discharge_pending')||(f==='finalized'&&a.status==='finalized')||(f==='private'&&a.mode==='private')||(f==='hotel'&&a.mode==='hotel');return ms&&mf}).sort((a,b)=>new Date(b.entryAt)-new Date(a.entryAt));
  const fs=[['active','Internados'],['pending','Alta pendente'],['private','Particular'],['hotel','Hotelaria'],['finalized','Finalizados'],['all','Todos']];
  return `<section class="page-head"><div><span class="eyebrow">INTERNAÇÕES</span><h1>Pacientes</h1><p>Consulte rapidamente qualquer conta em andamento ou finalizada.</p></div></section><div class="toolbar"><div class="searchbox"><span>⌕</span><input id="searchPatients" placeholder="Buscar por nome ou CPF" value="${esc(state.search)}"></div><div class="filter-chips">${fs.map(([v,l])=>`<button data-filter="${v}" class="${state.patientFilter===v?'active':''}">${l}</button>`).join('')}</div></div><section class="panel table-panel">${rows.length?`<div class="patients-table"><div class="table-row table-header"><span>Paciente</span><span>Leito</span><span>Entrada</span><span>Cobrado</span><span>Recebido líq.</span><span>Saldo</span><span>Status</span><span></span></div>${rows.map(a=>{const p=patient(a.patientId),t=totals(a.id),m=balanceMeta(t.balance);return `<button class="table-row" data-open="${a.id}"><span class="patient-cell"><strong>${esc(p?.name)}</strong><small>${a.mode==='private'?'Particular':'Hotelaria'}</small></span><span><strong>${String(a.bed).padStart(2,'0')}</strong></span><span>${fmtDT(a.entryAt)}</span><span>${money(t.billed)}</span><span>${money(t.netReceived)}</span><span class="${Math.abs(t.balance)<=0.009?'money-paid':'money-open'}" title="${m.label}">${m.kind==='credit'?'Crédito '+money(m.amount):money(m.amount)}</span><span>${statusBadge(a.status)}</span><span>›</span></button>`}).join('')}</div>`:empty('Nenhum paciente encontrado','Altere os filtros ou faça uma nova internação.')}</section>`;
}
function financePage(){
  const pending=data.admissions.filter(a=>a.status==='active'||a.status==='discharge_pending').map(a=>({a,t:totals(a.id)})).filter(x=>Math.abs(x.t.balance)>0.009).sort((x,y)=>Math.abs(y.t.balance)-Math.abs(x.t.balance));
  const movements=[...data.payments.map(x=>({...x,flow:'in'})),...(data.refunds||[]).map(x=>({...x,flow:'out'}))].sort((a,b)=>new Date(b.occurredAt)-new Date(a.occurredAt));
  const fin=data.admissions.filter(a=>a.status==='finalized').sort((a,b)=>new Date(b.dischargeAt||b.entryAt)-new Date(a.dischargeAt||a.entryAt));
  const totalOpen=pending.reduce((s,x)=>s+Math.max(0,x.t.balance),0),totalCredit=pending.reduce((s,x)=>s+Math.max(0,-x.t.balance),0);
  const payToday=data.payments.filter(p=>sameDay(p.occurredAt)).reduce((s,p)=>s+p.amount,0),refToday=(data.refunds||[]).filter(r=>sameDay(r.occurredAt)).reduce((s,r)=>s+r.amount,0);
  const payMonth=data.payments.filter(p=>sameMonth(p.occurredAt)).reduce((s,p)=>s+p.amount,0),refMonth=(data.refunds||[]).filter(r=>sameMonth(r.occurredAt)).reduce((s,r)=>s+r.amount,0);
  let body='';
  if(state.financeTab==='pending')body=pending.length?`<div class="finance-list">${pending.map(({a,t})=>{const p=patient(a.patientId),pays=data.payments.filter(x=>x.admissionId===a.id).sort((x,y)=>new Date(y.occurredAt)-new Date(x.occurredAt)),m=balanceMeta(t.balance);return `<button class="finance-row" data-open="${a.id}"><div><div class="finance-name"><strong>${esc(p?.name)}</strong>${a.status==='discharge_pending'?'<span class="badge badge-warn">Alta pendente</span>':''}</div><span>Leito ${String(a.bed).padStart(2,'0')} • Último pagamento: ${pays[0]?fmtDT(pays[0].occurredAt):'nenhum'}</span></div><div class="finance-amount"><span>${m.label}</span><strong>${money(m.amount)}</strong></div><span>›</span></button>`}).join('')}</div>`:empty('Nenhuma pendência financeira','Não há valores a receber nem créditos a devolver.');
  else if(state.financeTab==='receipts')body=movements.length?`<div class="receipt-list">${movements.map(x=>{const a=admission(x.admissionId),pt=a?patient(a.patientId):null;return `<div class="receipt-row"><div class="receipt-icon">${x.flow==='in'?'↙':'↗'}</div><div><strong>${esc(pt?.name||'Paciente')}</strong><span>${fmtDT(x.occurredAt)} • ${x.flow==='in'?'Recebimento':'Reembolso'} • ${esc(x.method)} • por ${esc(x.createdBy)}</span></div><strong>${x.flow==='in'?'+ ':'- '}${money(x.amount)}</strong></div>`}).join('')}</div>`:empty('Nenhuma movimentação','Recebimentos e reembolsos aparecerão aqui.');
  else body=fin.length?`<div class="finance-list">${fin.map(a=>{const p=patient(a.patientId),t=totals(a.id);return `<button class="finance-row" data-open="${a.id}"><div><div class="finance-name"><strong>${esc(p?.name)}</strong><span class="badge badge-good">Finalizado</span></div><span>Alta ${a.dischargeAt?fmtDT(a.dischargeAt):'—'} • ${a.mode==='private'?'Particular':'Hotelaria'}</span></div><div class="finance-amount"><span>Total</span><strong>${money(t.billed)}</strong></div><span>›</span></button>`}).join('')}</div>`:empty('Nenhuma conta finalizada','Internações quitadas e encerradas aparecerão aqui.');
  return `<section class="page-head"><div><span class="eyebrow">CAIXA & RECEBIMENTOS</span><h1>Financeiro</h1><p>Entradas, reembolsos e contas que precisam de fechamento.</p></div></section><div class="metric-grid finance-metrics">${metric('A receber',money(totalOpen),'',totalOpen>0?'warn':'good')}${metric('Crédito a devolver',money(totalCredit),'',totalCredit>0?'warn':'good')}${metric('Caixa líquido hoje',money(payToday-refToday),'','good')}${metric('Caixa líquido no mês',money(payMonth-refMonth))}</div><div class="tabs"><button data-ftab="pending" class="${state.financeTab==='pending'?'active':''}">Pendências <span>${pending.length}</span></button><button data-ftab="receipts" class="${state.financeTab==='receipts'?'active':''}">Movimentações</button><button data-ftab="finalized" class="${state.financeTab==='finalized'?'active':''}">Finalizados</button></div><section class="panel">${body}</section>`;
}
function patientDetail(a){
  const p=patient(a.patientId),t=totals(a.id),r=currentRate(a),charges=data.charges.filter(c=>c.admissionId===a.id),payments=data.payments.filter(x=>x.admissionId===a.id),refunds=(data.refunds||[]).filter(x=>x.admissionId===a.id),m=balanceMeta(t.balance);
  const daily=charges.filter(c=>c.kind==='daily').sort((x,y)=>new Date(x.occurredAt)-new Date(y.occurredAt));
  const extras=charges.filter(c=>c.kind!=='daily');
  const dailyTotal=daily.reduce((s,x)=>s+x.amount,0),dailyUnits=daily.reduce((s,x)=>s+(x.description?.startsWith('½ diária')?.5:1),0);
  const dailySummary=daily.length?{kind:'d',at:daily[daily.length-1].occurredAt,item:{amount:dailyTotal,units:dailyUnits,first:daily[0].occurredAt,last:daily[daily.length-1].occurredAt,count:daily.length}}:null;
  const timeline=[...(dailySummary?[dailySummary]:[]),...extras.map(item=>({kind:'c',at:item.occurredAt,item})),...payments.map(item=>({kind:'p',at:item.occurredAt,item})),...refunds.map(item=>({kind:'r',at:item.occurredAt,item}))].sort((x,y)=>new Date(y.at)-new Date(x.at));
  let alloc=Math.max(0,payments.reduce((s,x)=>s+x.amount,0)-refunds.reduce((s,x)=>s+x.amount,0));
  const cov=daily.map(c=>{const paid=Math.min(Math.max(alloc,0),c.amount);alloc-=paid;return {c,paid,status:paid>=c.amount?'paid':paid>0?'partial':'open'}});
  const audits=data.audits.filter(x=>x.admissionId===a.id).sort((x,y)=>new Date(y.occurredAt)-new Date(x.occurredAt));
  const canPay=can('add_payment')&&a.status!=='finalized'&&a.status!=='cancelled'&&t.balance>0.009,canRefund=data.currentRole==='admin'&&a.status!=='cancelled'&&t.balance<-.009;
  return `<div class="detail-top no-print"><button class="back-btn" data-action="back">← Voltar</button><div class="detail-actions"><button class="btn btn-secondary" data-action="print">▤ Imprimir ficha</button>${canPay?'<button class="btn btn-primary" data-action="payment">＋ Pagamento</button>':''}${canRefund?'<button class="btn btn-primary" data-action="refund">↗ Reembolso</button>':''}</div></div>
  <section class="detail-hero print-area"><div class="detail-identity"><div class="bed-large">${String(a.bed).padStart(2,'0')}</div><div><div class="detail-badges">${statusBadge(a.status)}<span class="badge ${a.mode==='private'?'badge-brand':'badge-neutral'}">${a.mode==='private'?'Particular':'Hotelaria'}</span></div><h1>${esc(p?.name)}</h1><p>CPF ${cpfMask(p?.cpf)} • Responsável pelo fechamento: <strong>${esc(a.closer)}</strong></p></div></div><div class="detail-meta-grid"><div><span>Entrada</span><strong>${fmtDT(a.entryAt)}</strong></div><div><span>Saída</span><strong>${a.dischargeAt?fmtDT(a.dischargeAt):'Em andamento'}</strong></div><div><span>Tempo de internação</span><strong>${hospitalDays(a)} dia${hospitalDays(a)>1?'s':''}</strong></div><div><span>Condição atual</span><strong>${esc(r.label)}</strong></div><div><span>Diária atual</span><strong>${money(r.negotiatedRate)}</strong></div></div></section>
  <div class="money-hero print-area"><div><span>Cobrado</span><strong>${money(t.billed)}</strong></div><div><span>Recebido líquido</span><strong>${money(t.netReceived)}</strong>${t.refunded>0?`<small>Reembolsado: ${money(t.refunded)}</small>`:''}</div><div class="balance ${Math.abs(t.balance)<=0.009?'paid':'open'}"><span>${m.label}</span><strong>${money(m.amount)}</strong></div></div>
  <div class="quick-actions no-print"><button data-action="payment" ${!canPay?'disabled':''}><div>R$</div><span>Registrar pagamento</span></button><button data-action="extra" ${!can('add_extra')||a.status==='finalized'||a.status==='cancelled'?'disabled':''}><div>＋</div><span>Adicionar extra</span></button><button data-action="rate" ${!can('adjust_rate')||a.status!=='active'?'disabled':''}><div>↻</div><span>Ajustar diária</span></button>${canRefund?'<button data-action="refund"><div>↗</div><span>Reembolsar crédito</span></button>':''}<button data-action="discharge" ${!can('discharge')||a.status==='finalized'||a.status==='cancelled'?'disabled':''}><div>→</div><span>${a.status==='discharge_pending'?'Acerto / saída':'Registrar alta'}</span></button></div>
  <div class="detail-columns print-area"><section class="panel"><div class="panel-head"><div><h2>Movimentação financeira</h2><p>Resumo da conta; as diárias são agrupadas para evitar repetição visual.</p></div></div>${timeline.length?`<div class="timeline">${timeline.map(row=>row.kind==='p'?`<div class="timeline-row payment"><div class="timeline-dot">↙</div><div><strong>Pagamento recebido</strong><span>${fmtDT(row.at)} • ${esc(row.item.method)} • ${esc(row.item.createdBy)}</span>${row.item.notes?`<small>${esc(row.item.notes)}</small>`:''}</div><strong class="good-text">+ ${money(row.item.amount)}</strong></div>`:row.kind==='r'?`<div class="timeline-row payment"><div class="timeline-dot">↗</div><div><strong>Reembolso ao paciente</strong><span>${fmtDT(row.at)} • ${esc(row.item.method)} • ${esc(row.item.createdBy)}</span>${row.item.notes?`<small>${esc(row.item.notes)}</small>`:''}</div><strong>- ${money(row.item.amount)}</strong></div>`:row.kind==='d'?`<div class="timeline-row charge"><div class="timeline-dot">▤</div><div><strong>Diárias da internação — ${Number(row.item.units).toLocaleString('pt-BR',{maximumFractionDigits:1})} diária(s)</strong><span>${fmtDM(row.item.first)} a ${fmtDM(row.item.last)} • ${row.item.count} lançamento(s)</span></div><strong>${money(row.item.amount)}</strong></div>`:`<div class="timeline-row charge"><div class="timeline-dot">＋</div><div><strong>${esc(row.item.description)}</strong><span>${fmtDT(row.at)} • ${esc(row.item.category)}</span></div><strong>${money(row.item.amount)}</strong></div>`).join('')}</div>`:empty('Sem movimentações','As diárias, extras, pagamentos e reembolsos aparecerão aqui.')}</section>
  <div class="side-stack"><section class="panel"><div class="panel-head"><div><h2>Diárias geradas</h2><p>${daily.length?Number(dailyUnits).toLocaleString('pt-BR',{maximumFractionDigits:1})+' diária(s) • '+money(dailyTotal):'Nenhuma diária gerada'}</p></div></div>${daily.length?`<details><summary style="cursor:pointer;font-weight:700;padding:10px 0">Ver detalhamento por dia (${daily.length})</summary><div class="coverage-list">${cov.map(({c,paid,status})=>`<div class="coverage-row"><div><strong>${fmtDM(c.occurredAt)}</strong><span>${esc(c.description)}</span></div><div class="coverage-right"><span>${money(c.amount)}</span><span class="badge ${status==='paid'?'badge-good':status==='partial'?'badge-warn':'badge-bad'}">${status==='paid'?'Pago':status==='partial'?`Parcial ${money(paid)}`:'Em aberto'}</span></div></div>`).join('')}</div></details>`:''}</section>
  <section class="panel no-print"><div class="panel-head"><div><h2>Auditoria</h2><p>Últimas alterações relevantes.</p></div></div><div class="audit-list">${audits.slice(0,6).map(x=>`<div><span>${esc(x.action)}</span><strong>${esc(x.detail)}</strong><small>${fmtDT(x.occurredAt)} • ${esc(x.user)}</small></div>`).join('')}</div></section></div></div>
  <div class="print-footer print-only"><strong>IMEC UTI — Extrato de internação</strong><span>Gerado em ${fmtDT(new Date().toISOString())}</span></div>`;
}

function openModal(title,subtitle,body){document.getElementById('modal').innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><div class="modal-card"><div class="modal-head"><div><h2>${title}</h2>${subtitle?`<p>${subtitle}</p>`:''}</div><button class="icon-btn" data-close>×</button></div>${body}</div></div>`;document.querySelector('[data-close]').onclick=closeModal;document.getElementById('modalBackdrop').addEventListener('mousedown',e=>{if(e.target.id==='modalBackdrop')closeModal()})}
function closeModal(){document.getElementById('modal').innerHTML=''}
function field(label,html,hint=''){return `<label class="field"><span class="field-label">${label}</span>${html}${hint?`<small>${hint}</small>`:''}</label>`}
function newAdmissionModal(){
  if(!can('create_admission')){toast('Seu perfil não pode criar internações.');return}
  const beds=Array.from({length:19},(_,i)=>i+1).map(n=>`<option value="${n}">Leito ${String(n).padStart(2,'0')}${n<=9?' — Salão':n<=16?' — Individual':' — Suíte'}</option>`).join('');
  const closerNames=teamClosers.length?teamClosers.filter(x=>x.active!==false).map(x=>x.display_name):USERS;
  openModal('Nova internação','Cadastre apenas o essencial. O financeiro começa a partir daqui.',`<form class="form" id="newForm"><div class="form-section"><h3>Paciente</h3><div class="form-grid two">${field('Nome completo','<input id="nName" required autofocus autocomplete="off" placeholder="Nome do paciente">')}${field('CPF','<input id="nCpf" inputmode="numeric" autocomplete="off" placeholder="000.000.000-00">','Opcional, recomendado para evitar duplicidade')}</div></div><div class="form-section"><h3>Internação</h3><div class="form-grid three">${field('Leito',`<select id="nBed"><option value="">Selecionar</option>${beds}</select>`)}${field('Modalidade','<select id="nMode"><option value="private">Particular</option><option value="hotel">Hotelaria</option></select>')}${field('Entrada',`<input id="nEntry" type="datetime-local" value="${nowLocalInput()}">`)}</div></div><div class="form-section"><h3>Condição comercial</h3><div class="form-grid three">${field('Ventilação mecânica','<select id="nVent"><option value="0">Não</option><option value="1">Sim</option></select>')}${field('Valor padrão','<div class="read-value" id="nStandard">R$ 7.000,00</div>')}${field('Valor negociado','<div class="currency-input"><span>R$</span><input id="nValue" inputmode="decimal" placeholder="7000,00"></div>')}</div><div class="form-grid two">${field('Responsável pelo fechamento',`<select id="nCloser">${closerNames.map(u=>`<option ${u===data.onDuty?'selected':''}>${esc(u)}</option>`).join('')}</select>`)}${field('Primeira cobrança','<select id="nHalf"><option value="0">Diária inteira</option><option value="1">½ diária</option></select><small id="lateHint"></small>')}</div>${field('Observação','<textarea id="nNote" rows="2" placeholder="Opcional"></textarea>')}</div><div class="summary-box"><div><span>Diária aplicada</span><strong id="nApplied">R$ 7.000,00</strong></div><div><span>Primeiro lançamento</span><strong id="nFirst">R$ 7.000,00</strong></div><div><span>Desconto por diária</span><strong id="nDiscount">R$ 0,00</strong></div></div><div id="nRetroPreview"></div><div id="nError"></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-close2>Cancelar</button><button type="submit" class="btn btn-primary">✓ Confirmar internação</button></div></form>`);
  document.querySelector('[data-close2]').onclick=closeModal;
  const ids=['nBed','nMode','nEntry','nVent','nValue','nHalf'];ids.forEach(id=>document.getElementById(id).addEventListener('input',updateNew));
  document.getElementById('nEntry').addEventListener('change',()=>{document.getElementById('nHalf').value=late(document.getElementById('nEntry').value)?'1':'0';updateNew()});
  document.getElementById('nHalf').value=late(document.getElementById('nEntry').value)?'1':'0';
  document.getElementById('newForm').onsubmit=submitNew;updateNew();
}
function newCalc(){const bed=Number(document.getElementById('nBed').value),mode=document.getElementById('nMode').value,vent=document.getElementById('nVent').value==='1',raw=document.getElementById('nValue').value.replace(',','.');const standard=mode==='private'?(vent?PRIVATE_VENT:PRIVATE_NO_VENT):(bed>=10&&bed<=19?bedRate(bed):0);const value=raw?Number(raw):standard;return {bed,mode,vent,standard,value,half:document.getElementById('nHalf').value==='1'}}
function updateNew(){
  const x=newCalc(),entry=document.getElementById('nEntry').value,est=newAdmissionEstimate(entry,x);
  document.getElementById('nVent').disabled=x.mode==='hotel';
  document.getElementById('nStandard').textContent=x.standard?money(x.standard):(x.mode==='hotel'?'Selecione leito 10–19':'—');
  document.getElementById('nApplied').textContent=money(x.value||0);
  document.getElementById('nFirst').textContent=money((x.value||0)*(x.half?.5:1));
  document.getElementById('nDiscount').textContent=money(Math.max(0,x.standard-(x.value||0)));
  document.getElementById('lateHint').textContent=late(entry)?'Entrada após 18h: meia diária sugerida.':'';
  const retro=document.getElementById('nRetroPreview');
  if(retro)retro.innerHTML=est.retro?`<div class="form-warning"><strong>Entrada retroativa</strong><br>Ao confirmar, o sistema registrará <strong>${est.units.toLocaleString('pt-BR',{maximumFractionDigits:1})} diária(s)</strong> já vencidas até ontem, total estimado de <strong>${money(est.total)}</strong>. O dia de hoje permanece provisório e não entra na cobrança enquanto o paciente estiver internado.</div>`:'';
}
function refundModal(a){
  if(data.currentRole!=='admin'){toast('Somente administradores podem registrar reembolsos.');return}
  const t=totals(a.id),credit=Math.max(0,-t.balance);
  if(credit<=0.009){toast('Não há crédito a devolver nesta conta.');return}
  const clientRef=crypto.randomUUID();
  openModal('Registrar reembolso',`Crédito atual: ${money(credit)}`,`<form class="form" id="refundForm">${field('Valor devolvido',`<div class="currency-input large"><span>R$</span><input id="rfdValue" autofocus inputmode="decimal" value="${credit.toFixed(2)}"></div>`)}<div class="form-grid two">${field('Data e hora',`<input id="rfdWhen" type="datetime-local" value="${nowLocalInput()}">`)}${field('Forma','<select id="rfdMethod"><option>PIX</option><option>Transferência</option><option>Dinheiro</option><option>Cartão</option><option>Outro</option></select>')}</div>${field('Observação','<textarea id="rfdNotes" rows="2" placeholder="Ex.: devolução de cobrança cancelada"></textarea>','Opcional')}<div id="refundError"></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-close2>Cancelar</button><button class="btn btn-primary">↗ Registrar reembolso</button></div></form>`);
  document.querySelector('[data-close2]').onclick=closeModal;
  document.getElementById('refundForm').onsubmit=async e=>{
    e.preventDefault();if(remoteBusy)return;
    const amount=Number(document.getElementById('rfdValue').value.replace(',','.')),er=document.getElementById('refundError');
    if(!amount||amount<=0){er.innerHTML='<div class="form-error">⚠ Informe um valor válido.</div>';return}
    try{
      setLoading(true,'Registrando reembolso…');
      await rpc('add_uti_refund',{p_admission_id:a.id,p_occurred_at:parseLocal(document.getElementById('rfdWhen').value),p_amount:amount,p_method:document.getElementById('rfdMethod').value,p_notes:document.getElementById('rfdNotes').value.trim()||null,p_client_ref:clientRef});
      await loadRemote({quiet:true});closeModal();toast('Reembolso registrado com auditoria.');render();
    }catch(ex){er.innerHTML=`<div class="form-error">⚠ ${esc(ex.message)}</div>`}finally{setLoading(false)}
  };
}

function correctionsModal(a){
  if(data.currentRole!=='admin'){toast('Somente administradores podem corrigir lançamentos financeiros.');return}
  const pays=data.payments.filter(x=>x.admissionId===a.id),extras=data.charges.filter(x=>x.admissionId===a.id&&x.kind!=='daily'),refunds=(data.refunds||[]).filter(x=>x.admissionId===a.id);
  if(!pays.length&&!extras.length&&!refunds.length){toast('Não há lançamentos manuais para corrigir.');return}
  const rows=[
    ...pays.map(x=>({id:x.id,type:'payment',at:x.occurredAt,label:`Pagamento • ${x.method}`,amount:x.amount})),
    ...extras.map(x=>({id:x.id,type:'extra',at:x.occurredAt,label:x.description||x.category||'Extra',amount:x.amount})),
    ...refunds.map(x=>({id:x.id,type:'refund',at:x.occurredAt,label:`Reembolso • ${x.method}`,amount:x.amount}))
  ].sort((x,y)=>new Date(y.at)-new Date(x.at));
  openModal('Corrigir lançamento','O registro original permanece no banco e a correção fica na auditoria.',`
    <div class="form">
      <div class="settle-table-wrap"><table class="settle-table"><thead><tr><th>Data/hora</th><th>Lançamento</th><th>Valor</th><th></th></tr></thead><tbody>
      ${rows.map(x=>`<tr><td>${fmtDT(x.at)}</td><td>${esc(x.label)}</td><td>${money(x.amount)}</td><td><button class="btn btn-secondary" data-correct-type="${x.type}" data-correct-id="${x.id}">Corrigir</button></td></tr>`).join('')}
      </tbody></table></div>
      <div class="form-warning">⚠ Use apenas para corrigir lançamento feito incorretamente. O motivo é obrigatório e ficará registrado.</div>
      <div class="modal-actions"><button class="btn btn-secondary" data-close2>Fechar</button></div>
    </div>`);
  document.querySelector('[data-close2]').onclick=closeModal;
  document.querySelectorAll('[data-correct-id]').forEach(btn=>btn.onclick=async()=>{
    if(remoteBusy)return;
    const reason=prompt('Informe o motivo da correção:')?.trim();
    if(!reason)return;
    try{
      setLoading(true,'Registrando correção…');
      const type=btn.dataset.correctType,id=btn.dataset.correctId;
      if(type==='payment')await rpc('cancel_uti_payment',{p_payment_id:id,p_reason:reason});
      else if(type==='refund')await rpc('cancel_uti_refund',{p_refund_id:id,p_reason:reason});
      else await rpc('cancel_uti_extra',{p_charge_id:id,p_reason:reason});
      await loadRemote({quiet:true});closeModal();toast('Correção registrada com auditoria.');render();
    }catch(ex){alert(ex.message)}finally{setLoading(false)}
  });
}

function authHeaders(accessToken, extra={}){return {'apikey':SUPABASE_KEY,'Authorization':`Bearer ${accessToken}`,'Content-Type':'application/json',...extra}}
async function parseResponse(res){
  if(res.status===204)return null;
  const text=await res.text();
  if(!text)return null;
  let parsed;try{parsed=JSON.parse(text)}catch{parsed=text}
  if(!res.ok){const msg=parsed?.message||parsed?.msg||parsed?.error_description||parsed?.error||`Erro ${res.status}`;throw new Error(msg)}
  return parsed;
}
async function syncAuthState(){
  const {data:{session},error}=await supabase.auth.getSession();
  if(error)throw error;
  authState=session||null;
  return authState;
}
async function ensureSession(){
  try{return !!(await syncAuthState())}catch{authState=null;return false}
}
async function rest(path,{method='GET',body,prefer}={}){
  if(!await ensureSession())throw new Error('Sessão expirada. Entre novamente.');
  const headers=authHeaders(authState.access_token,prefer?{'Prefer':prefer}:{});
  const res=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  if(res.status===401){authState=null;throw new Error('Sessão expirada. Entre novamente.')}
  return parseResponse(res);
}
async function rpc(name,args={}){return rest(`rpc/${name}`,{method:'POST',body:args,prefer:'return=representation'})}
async function edge(name,body={}){
  if(!await ensureSession())throw new Error('Sessão expirada. Entre novamente.');
  const res=await fetch(`${SUPABASE_URL}/functions/v1/${name}`,{method:'POST',headers:authHeaders(authState.access_token),body:JSON.stringify(body)});
  return parseResponse(res);
}
function securityStorageKey(base){return `${base}:${authState?.user?.id||'anonymous'}`}
function startSessionClock(){
  const key=securityStorageKey(SESSION_STARTED_KEY);
  if(!localStorage.getItem(key))localStorage.setItem(key,String(Date.now()));
  touchActivity(true);
  if(inactivityTimer)clearInterval(inactivityTimer);
  inactivityTimer=setInterval(()=>enforceClientSessionTimeout(),60000);
}
function clearSessionClock(){
  if(inactivityTimer){clearInterval(inactivityTimer);inactivityTimer=null}
  for(const store of [localStorage,sessionStorage]){
    const keys=[];for(let i=0;i<store.length;i++){const key=store.key(i);if(key&&(key.startsWith(SESSION_STARTED_KEY+':')||key.startsWith(LAST_ACTIVITY_KEY+':')||key.startsWith(STRONG_PASSWORD_KEY+':')))keys.push(key)}
    keys.forEach(key=>store.removeItem(key));
  }
}
function touchActivity(force=false){
  if(!authState)return;
  const now=Date.now();
  if(!force&&now-activityWriteAt<30000)return;
  activityWriteAt=now;
  localStorage.setItem(securityStorageKey(LAST_ACTIVITY_KEY),String(now));
}
async function enforceClientSessionTimeout(){
  if(!authState)return false;
  const start=Number(localStorage.getItem(securityStorageKey(SESSION_STARTED_KEY))||0);
  const last=Number(localStorage.getItem(securityStorageKey(LAST_ACTIVITY_KEY))||0);
  const reason=sessionExpiryReason(Date.now(),start,last,IDLE_TIMEOUT_MS,ABSOLUTE_SESSION_MS);
  if(!reason)return false;
  await logoutRemote(reason==='idle'?'Sessão encerrada após 30 minutos sem atividade.':'Sessão encerrada após 12 horas. Entre novamente.');
  return true;
}
function strongPasswordConfirmed(){return sessionStorage.getItem(securityStorageKey(STRONG_PASSWORD_KEY))==='1'}
function rememberStrongPassword(){sessionStorage.setItem(securityStorageKey(STRONG_PASSWORD_KEY),'1')}
async function verifyPasswordSecurity(password){
  const policy=validatePasswordPolicy(password);
  if(!policy.valid)throw new Error(policy.errors[0]);
  const hash=await sha1Hex(password);
  const result=await edge('password-pwned-range',{prefix:hash.slice(0,5)});
  if(pwnedCountFromRange(result?.range||'',hash.slice(5))>0)throw new Error('Esta senha já apareceu em vazamentos conhecidos. Escolha outra senha.');
  return true;
}
function setLoading(on,text='Sincronizando…'){
  remoteBusy=on;
  let el=document.getElementById('globalSync');
  if(!el){el=document.createElement('div');el.id='globalSync';el.className='global-sync';document.body.appendChild(el)}
  el.textContent=text;el.classList.toggle('show',on);
}
async function withRemote(work,success){if(remoteBusy)return;try{setLoading(true);const r=await work();if(success)toast(success);return r}catch(e){alert(e.message||'Não foi possível concluir a operação.');throw e}finally{setLoading(false)}}

function mapRemote({patients,admissions,rates,charges,payments,refunds,audits,settings,profiles,closers,profile}){
  const rateMap={};(rates||[]).forEach(r=>(rateMap[r.admission_id]??=[]).push({id:r.id,effectiveAt:r.effective_at,standardRate:Number(r.standard_rate),negotiatedRate:Number(r.negotiated_rate),ventilation:r.ventilation??undefined,label:r.label,changedBy:r.changed_by_name}));
  teamProfiles=profiles||[];
  teamClosers=closers||[];
  return {
    patients:(patients||[]).map(p=>({id:p.id,name:p.name,cpf:p.cpf||undefined,createdAt:p.created_at})),
    admissions:(admissions||[]).map(a=>({id:a.id,patientId:a.patient_id,bed:a.bed,mode:a.mode,entryAt:a.entry_at,dischargeAt:a.discharge_at||undefined,status:a.status,closerId:a.closer_id||undefined,closer:a.closer_name,createdBy:a.created_by_name,halfInitial:a.half_initial,commissionAmount:Number(a.commission_amount||0),accountVersion:Number(a.account_version||1),notes:a.notes||undefined,createdAt:a.created_at,rateHistory:rateMap[a.id]||[]})),
    charges:(charges||[]).map(c=>({id:c.id,admissionId:c.admission_id,occurredAt:c.occurred_at,kind:c.kind,category:c.category,description:c.description,amount:Number(c.amount),cycleKey:c.cycle_key||undefined,createdBy:c.created_by_name})),
    payments:(payments||[]).map(p=>({id:p.id,admissionId:p.admission_id,occurredAt:p.occurred_at,amount:Number(p.amount),method:p.method,notes:p.notes||undefined,createdBy:p.created_by_name})),
    refunds:(refunds||[]).map(r=>({id:r.id,admissionId:r.admission_id,occurredAt:r.occurred_at,amount:Number(r.amount),method:r.method,notes:r.notes||undefined,createdBy:r.created_by_name})),
    audits:(audits||[]).map(a=>({id:a.id,admissionId:a.admission_id||undefined,occurredAt:a.occurred_at,user:a.user_name,action:a.action,detail:a.detail})),
    currentUser:profile.display_name,currentRole:profile.role,onDuty:settings?.on_duty_name||'Samuel',securityOnboardingAt:profile.security_onboarding_completed_at||null,seededDemo:false
  }
}
async function loadRemote({quiet=false}={}){
  if(!await ensureSession()){renderAuth();return false}
  const uid=authState.user?.id;
  if(!uid){authState=null;renderAuth();return false}
  try{
    const own=await rest(`profiles?id=eq.${encodeURIComponent(uid)}&select=id,display_name,email,role,active,security_onboarding_completed_at`);
    const profile=own?.[0];
    if(!profile){renderAccountState('Seu perfil ainda está sendo preparado.','Tente novamente em alguns segundos.');return false}
    if(!profile.active){data=blankData();data.currentUser=profile.display_name;data.currentRole=profile.role;renderPending(profile);return false}
    try{await rpc('sync_uti_charges',{})}catch(e){console.warn('sync daily charges',e)}
    const [patients,admissions,rates,charges,payments,refunds,audits,settingsRows,profiles,closers]=await Promise.all([
      rest('patients?select=*&order=created_at.asc'),
      rest('admissions?select=*&order=entry_at.desc'),
      rest('rate_periods?select=*&order=effective_at.asc'),
      rest('charges?cancelled_at=is.null&select=*&order=occurred_at.asc'),
      rest('payments?cancelled_at=is.null&select=*&order=occurred_at.asc'),
      rest('refunds?cancelled_at=is.null&select=*&order=occurred_at.asc'),
      rest('audits?select=*&order=occurred_at.asc'),
      rest('app_settings?id=eq.1&select=*'),
      rest('profiles?select=id,display_name,email,role,active,created_at&order=created_at.asc'),
      rest('commercial_closers?active=eq.true&select=id,code,display_name,commission_amount,active&order=display_name.asc')
    ]);
    data=mapRemote({patients,admissions,rates,charges,payments,refunds,audits,settings:settingsRows?.[0],profiles,closers,profile});
    if(!quiet)render();
    return true;
  }catch(e){
    if(String(e.message).toLowerCase().includes('sessão')){authState=null;renderAuth();return false}
    renderAccountState('Não foi possível carregar os dados.',e.message||'Verifique a conexão e tente novamente.');return false
  }
}
function authCard(inner){
  document.getElementById('app').innerHTML=`<main class="auth-shell"><section class="auth-card"><div class="auth-logo"><div class="brand-mark">I</div><div><strong>IMEC UTI</strong><span>Particular & Hotelaria</span></div></div>${inner}</section></main>`;
}
function renderAuth(message=''){
  const msg=message?`<div class="auth-message">${esc(message)}</div>`:'';
  authCard(`${msg}<div class="auth-copy"><span class="eyebrow">ACESSO INTERNO</span><h1>Controle financeiro da UTI</h1><p>Entre com seu acesso individual. O segundo fator será solicitado na sequência.</p></div><form id="loginForm" class="auth-form"><label class="field"><span class="field-label">E-mail</span><input id="loginEmail" type="email" autocomplete="email" required placeholder="seu@email.com"></label><label class="field"><span class="field-label">Senha</span><input id="loginPassword" type="password" autocomplete="current-password" required placeholder="••••••••••"></label><div id="authError"></div><button class="btn btn-primary auth-submit" type="submit">Entrar</button><button class="auth-link" type="button" id="forgotPasswordBtn">Esqueci minha senha</button></form><p class="auth-foot">Acesso restrito à equipe autorizada • MFA obrigatório • sessão protegida por inatividade.</p>`);
  document.getElementById('forgotPasswordBtn').onclick=forgotPasswordModal;
  document.getElementById('loginForm').onsubmit=async e=>{
    e.preventDefault();const error=document.getElementById('authError');error.innerHTML='';
    try{
      setLoading(true,'Entrando…');
      const {data:{session},error:loginError}=await supabase.auth.signInWithPassword({email:document.getElementById('loginEmail').value.trim(),password:document.getElementById('loginPassword').value});
      if(loginError)throw loginError;
      authState=session;clearSessionClock();startSessionClock();await continueSecureBoot();
    }catch(x){error.innerHTML=`<div class="form-error">⚠ ${esc(x.message)}</div>`}finally{setLoading(false)}
  };
}
function forgotPasswordModal(){
  openModal('Recuperar acesso','Enviaremos um link seguro para definir uma nova senha.',`<form class="form" id="recoveryForm">${field('E-mail','<input id="recoveryEmail" type="email" autocomplete="email" required placeholder="seu@email.com">')}<div id="recoveryError"></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-close2>Cancelar</button><button class="btn btn-primary">Enviar link</button></div></form>`);
  document.querySelector('[data-close2]').onclick=closeModal;
  document.getElementById('recoveryForm').onsubmit=async e=>{
    e.preventDefault();const er=document.getElementById('recoveryError');er.innerHTML='';
    try{
      setLoading(true,'Enviando recuperação…');
      const {error}=await supabase.auth.resetPasswordForEmail(document.getElementById('recoveryEmail').value.trim(),{redirectTo:'https://www.sallusflow.com.br/imec-uti/'});
      if(error)throw error;
      closeModal();renderAuth('Se o e-mail estiver cadastrado, o link de recuperação foi enviado.');
    }catch(ex){er.innerHTML=`<div class="form-error">⚠ ${esc(ex.message)}</div>`}finally{setLoading(false)}
  };
}
function renderPasswordSetup(profile,{linkType=null}={}){
  const recovery=linkType==='recovery',invite=linkType==='invite';
  const title=recovery?'Defina sua nova senha':invite?'Proteja seu novo acesso':'Atualize a segurança da conta';
  const copy=recovery?'Crie uma nova senha forte antes de voltar ao sistema.':invite?'Antes do primeiro acesso, defina uma senha forte e ative o autenticador.':'Sua conta precisa de uma senha forte, exclusiva e verificada contra vazamentos conhecidos.';
  authCard(`<div class="security-step">1</div><div class="auth-copy center"><span class="eyebrow">SEGURANÇA DA CONTA</span><h1>${title}</h1><p>${copy}</p></div><form id="securePasswordForm" class="auth-form"><label class="field"><span class="field-label">Nova senha</span><input id="securePassword" type="password" minlength="12" autocomplete="new-password" required placeholder="12+ caracteres"></label><label class="field"><span class="field-label">Confirmar senha</span><input id="securePassword2" type="password" minlength="12" autocomplete="new-password" required placeholder="Repita a senha"></label><div class="password-rules">12+ caracteres • maiúscula • minúscula • número • símbolo • não vazada</div><div id="securePasswordError"></div><button class="btn btn-primary auth-submit">Salvar e continuar</button></form>`);
  document.getElementById('securePasswordForm').onsubmit=async e=>{
    e.preventDefault();const er=document.getElementById('securePasswordError');er.innerHTML='';
    const password=document.getElementById('securePassword').value,confirm=document.getElementById('securePassword2').value;
    if(password!==confirm){er.innerHTML='<div class="form-error">⚠ As senhas não coincidem.</div>';return}
    try{
      setLoading(true,'Validando senha…');await verifyPasswordSecurity(password);
      const {error}=await supabase.auth.updateUser({password});if(error)throw error;
      rememberStrongPassword();clearAuthLinkArtifacts();await syncAuthState();await continueSecureBoot();
    }catch(ex){er.innerHTML=`<div class="form-error">⚠ ${esc(ex.message)}</div>`}finally{setLoading(false)}
  };
}
async function renderMfaEnrollment(profile){
  try{
    setLoading(true,'Preparando autenticador…');
    if(!pendingMfaEnrollment){
      const {data,error}=await supabase.auth.mfa.enroll({factorType:'totp',friendlyName:'IMEC UTI'});
      if(error)throw error;pendingMfaEnrollment=data;
    }
    const factor=pendingMfaEnrollment,qr=factor?.totp?.qr_code||'',secret=factor?.totp?.secret||'';
    authCard(`<div class="security-step">2</div><div class="auth-copy center"><span class="eyebrow">MFA OBRIGATÓRIO</span><h1>Ative seu autenticador</h1><p>Escaneie o QR Code no Google Authenticator, Microsoft Authenticator, 1Password ou aplicativo compatível.</p></div><div class="mfa-qr"><img src="${esc(qr)}" alt="QR Code do autenticador"></div><div class="mfa-secret"><span>Chave manual</span><strong>${esc(secret)}</strong></div><form id="mfaEnrollForm" class="auth-form"><label class="field"><span class="field-label">Código de 6 dígitos</span><input id="mfaEnrollCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required placeholder="000000"></label><div id="mfaEnrollError"></div><button class="btn btn-primary auth-submit">Ativar MFA</button></form>`);
    document.getElementById('mfaEnrollForm').onsubmit=async e=>{
      e.preventDefault();const er=document.getElementById('mfaEnrollError');er.innerHTML='';
      try{
        setLoading(true,'Confirmando segundo fator…');
        const {data:challenge,error:challengeError}=await supabase.auth.mfa.challenge({factorId:factor.id});if(challengeError)throw challengeError;
        const {error:verifyError}=await supabase.auth.mfa.verify({factorId:factor.id,challengeId:challenge.id,code:document.getElementById('mfaEnrollCode').value.trim()});if(verifyError)throw verifyError;
        pendingMfaEnrollment=null;await supabase.auth.refreshSession();await syncAuthState();await continueSecureBoot();
      }catch(ex){er.innerHTML=`<div class="form-error">⚠ ${esc(ex.message)}</div>`}finally{setLoading(false)}
    };
  }catch(ex){renderAccountState('Não foi possível preparar o MFA.',ex.message||'Tente novamente.')}finally{setLoading(false)}
}
function renderMfaChallenge(factor){
  authCard(`<div class="security-step">2</div><div class="auth-copy center"><span class="eyebrow">SEGUNDO FATOR</span><h1>Confirme seu acesso</h1><p>Digite o código atual do seu aplicativo autenticador.</p></div><form id="mfaChallengeForm" class="auth-form"><label class="field"><span class="field-label">Código de 6 dígitos</span><input id="mfaChallengeCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required autofocus placeholder="000000"></label><div id="mfaChallengeError"></div><button class="btn btn-primary auth-submit">Confirmar</button><button type="button" class="auth-link" id="mfaLogout">Usar outra conta</button></form>`);
  document.getElementById('mfaLogout').onclick=()=>logoutRemote();
  document.getElementById('mfaChallengeForm').onsubmit=async e=>{
    e.preventDefault();const er=document.getElementById('mfaChallengeError');er.innerHTML='';
    try{
      setLoading(true,'Validando código…');
      const {data:challenge,error:challengeError}=await supabase.auth.mfa.challenge({factorId:factor.id});if(challengeError)throw challengeError;
      const {error:verifyError}=await supabase.auth.mfa.verify({factorId:factor.id,challengeId:challenge.id,code:document.getElementById('mfaChallengeCode').value.trim()});if(verifyError)throw verifyError;
      await supabase.auth.refreshSession();await syncAuthState();await continueSecureBoot();
    }catch(ex){er.innerHTML=`<div class="form-error">⚠ ${esc(ex.message)}</div>`}finally{setLoading(false)}
  };
}
async function continueSecureBoot(){
  if(securityFlowBusy)return;
  securityFlowBusy=true;
  try{
    if(!await ensureSession()){renderAuth();return}
    if(await enforceClientSessionTimeout())return;
    startSessionClock();
    const uid=authState.user?.id;if(!uid){renderAuth();return}
    const own=await rest(`profiles?id=eq.${encodeURIComponent(uid)}&select=id,display_name,email,role,active,security_onboarding_completed_at`);
    const profile=own?.[0];if(!profile){renderAccountState('Seu perfil ainda está sendo preparado.','Tente novamente em alguns segundos.');return}
    if((initialAuthLinkType==='invite'||initialAuthLinkType==='recovery')&&!strongPasswordConfirmed()){renderPasswordSetup(profile,{linkType:initialAuthLinkType});return}
    const [{data:aal,error:aalError},{data:factors,error:factorsError}]=await Promise.all([supabase.auth.mfa.getAuthenticatorAssuranceLevel(),supabase.auth.mfa.listFactors()]);
    if(aalError)throw aalError;if(factorsError)throw factorsError;
    const verified=(factors?.totp||[]).find(f=>f.status==='verified');
    if(!verified){await renderMfaEnrollment(profile);return}
    if(aal?.currentLevel!=='aal2'){renderMfaChallenge(verified);return}
    if(!profile.security_onboarding_completed_at){
      if(!strongPasswordConfirmed()){renderPasswordSetup(profile);return}
      await rpc('mark_uti_security_onboarding_complete',{});
    }
    clearAuthLinkArtifacts();await loadRemote();
  }catch(ex){renderAccountState('Não foi possível validar a segurança do acesso.',ex.message||'Tente novamente.')}finally{securityFlowBusy=false}
}
function renderPending(profile){
  authCard(`<div class="pending-icon">⌛</div><div class="auth-copy center"><span class="eyebrow">ACESSO PENDENTE</span><h1>Olá, ${esc(profile.display_name)}</h1><p>Seu acesso foi criado, mas ainda precisa ser liberado por um administrador da UTI.</p></div><div class="pending-email">${esc(profile.email||'')}</div><button id="retryPending" class="btn btn-primary auth-submit">Verificar liberação</button><button id="logoutPending" class="btn btn-secondary auth-submit">Sair</button>`);
  document.getElementById('retryPending').onclick=()=>withRemote(()=>loadRemote(),null);
  document.getElementById('logoutPending').onclick=logoutRemote;
}
function renderAccountState(title,detail){authCard(`<div class="pending-icon">!</div><div class="auth-copy center"><h1>${esc(title)}</h1><p>${esc(detail)}</p></div><button id="retryState" class="btn btn-primary auth-submit">Tentar novamente</button><button id="logoutState" class="btn btn-secondary auth-submit">Sair</button>`);document.getElementById('retryState').onclick=()=>continueSecureBoot();document.getElementById('logoutState').onclick=logoutRemote}
async function logoutRemote(message=''){try{await supabase.auth.signOut({scope:'local'})}catch{}clearSessionClock();authState=null;data=blankData();renderAuth(message)}

async function inviteUserModal(){
  if(data.currentRole!=='admin'){toast('Somente administradores podem convidar usuários.');return}
  openModal('Convidar usuário','O convite será enviado com retorno direto para o IMEC UTI.',`<form class="form" id="inviteForm">${field('Nome','<input id="inviteName" autocomplete="off" required placeholder="Nome do usuário">')}<div class="form-grid two">${field('E-mail','<input id="inviteEmail" type="email" autocomplete="off" required placeholder="usuario@empresa.com">')}${field('Perfil','<select id="inviteRole"><option value="operator">Operacional</option><option value="commercial">Comercial</option><option value="admin">Administrador</option></select>')}</div><div class="security-note"><span>✓</span><div><strong>Convite seguro</strong><span>O link direciona para https://www.sallusflow.com.br/imec-uti/ e o acesso permanece pendente até ser liberado.</span></div></div><div id="inviteError"></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-close2>Cancelar</button><button class="btn btn-primary">Enviar convite</button></div></form>`);
  document.querySelector('[data-close2]').onclick=closeModal;
  document.getElementById('inviteForm').onsubmit=async e=>{
    e.preventDefault();if(remoteBusy)return;
    const er=document.getElementById('inviteError');er.innerHTML='';
    try{
      setLoading(true,'Enviando convite…');
      const result=await edge('invite-uti-user',{display_name:document.getElementById('inviteName').value.trim(),email:document.getElementById('inviteEmail').value.trim(),role:document.getElementById('inviteRole').value});
      if(!result?.ok)throw new Error(result?.error||'Não foi possível enviar o convite.');
      await loadRemote({quiet:true});closeModal();toast('Convite enviado para '+result.email+'.');render();
    }catch(ex){er.innerHTML=`<div class="form-error">⚠ ${esc(ex.message)}</div>`}finally{setLoading(false)}
  };
}

async function changePasswordModal(){
  openModal('Alterar senha','A nova senha precisa atender à política de segurança e não pode constar em vazamentos conhecidos.',`<form class="form" id="passwordForm">${field('Nova senha','<input id="newPassword" type="password" minlength="12" autocomplete="new-password" placeholder="12+ caracteres">')}${field('Confirmar nova senha','<input id="confirmPassword" type="password" minlength="12" autocomplete="new-password" placeholder="Repita a nova senha">')}<div class="password-rules">Maiúscula • minúscula • número • símbolo • 12+ caracteres • não vazada</div><div id="passwordError"></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-close2>Cancelar</button><button class="btn btn-primary">Salvar nova senha</button></div></form>`);
  document.querySelector('[data-close2]').onclick=closeModal;
  document.getElementById('passwordForm').onsubmit=async e=>{
    e.preventDefault();const a=document.getElementById('newPassword').value,b=document.getElementById('confirmPassword').value,er=document.getElementById('passwordError');er.innerHTML='';
    if(a!==b){er.innerHTML='<div class="form-error">⚠ As senhas não coincidem.</div>';return}
    try{setLoading(true,'Validando senha…');await verifyPasswordSecurity(a);const {error}=await supabase.auth.updateUser({password:a});if(error)throw error;rememberStrongPassword();closeModal();toast('Senha alterada com sucesso.')}
    catch(ex){er.innerHTML=`<div class="form-error">⚠ ${esc(ex.message)}</div>`}finally{setLoading(false)}
  };
}
async function boot(){
  setLoading(true,'Validando acesso…');
  try{await syncAuthState();if(!authState){clearSessionClock();renderAuth();return}if(initialAuthLinkType)clearSessionClock();startSessionClock();await continueSecureBoot()}
  catch(ex){renderAuth('Sua sessão não pôde ser restaurada. Entre novamente.')}finally{setLoading(false)}
}

function can(permission){return data?.currentRole==='admin'||!!ROLE_PERMISSIONS[data?.currentRole]?.has(permission)}
function settingsPage(){
  const members=teamProfiles.map(p=>`<div class="member-row"><div class="member-ident"><div class="avatar small">${esc((p.display_name||'?')[0])}</div><div><strong>${esc(p.display_name)}</strong><span>${esc(p.email||'Sem e-mail')}</span></div></div><div class="member-controls">${data.currentRole==='admin'?`<select data-member-role="${p.id}"><option value="operator" ${p.role==='operator'?'selected':''}>Operacional</option><option value="commercial" ${p.role==='commercial'?'selected':''}>Comercial</option><option value="admin" ${p.role==='admin'?'selected':''}>Administrador</option></select><label class="switch-label"><input type="checkbox" data-member-active="${p.id}" ${p.active?'checked':''}> <span>${p.active?'Ativo':'Pendente'}</span></label><button class="btn btn-secondary" data-save-member="${p.id}">Salvar</button>`:`<span class="badge ${p.active?'badge-good':'badge-warn'}">${p.active?'Ativo':'Pendente'}</span><span class="badge badge-neutral">${roleLabel(p.role)}</span>`}</div></div>`).join('');
  return `<section class="page-head"><div><span class="eyebrow">CONFIGURAÇÕES</span><h1>Operação e acessos</h1><p>Banco central da UTI, usuários individuais e auditoria compartilhada.</p></div><button class="btn btn-secondary" id="manualRefresh">↻ Atualizar</button></section><div class="settings-grid"><section class="panel"><div class="panel-head"><div><h2>Operação</h2><p>Escala comercial e identificação do usuário conectado.</p></div></div><div class="settings-fields"><label class="field"><span class="field-label">Usuário conectado</span><div class="read-value">${esc(data.currentUser)} • ${roleLabel(data.currentRole)}</div></label><label class="field"><span class="field-label">Plantão comercial atual</span><select id="onDuty">${['Samuel','Roberto'].map(u=>`<option ${u===data.onDuty?'selected':''}>${u}</option>`).join('')}</select></label></div></section><section class="panel"><div class="panel-head"><div><h2>Acessos da equipe</h2><p>${data.currentRole==='admin'?'Libere usuários e defina o perfil de acesso.':'Consulte quem possui acesso ao sistema.'}</p></div></div><div class="member-list">${members||'<div class="empty-state">Nenhum usuário cadastrado.</div>'}</div></section><section class="panel"><div class="panel-head"><div><h2>Dados e segurança</h2><p>Os dados estão no banco exclusivo IMEC UTI e sincronizam entre aparelhos.</p></div></div><div class="backup-actions">${data.currentRole==='admin'?'<button class="btn btn-secondary" id="inviteUserBtn">＋ Convidar usuário</button><button class="btn btn-secondary" data-action="export">⇩ Exportar dados</button>':''}<button class="btn btn-secondary" id="changePasswordBtn">⌘ Alterar senha</button><button class="btn btn-secondary" id="logoutBtn">⇥ Sair da conta</button></div><div class="security-note"><span>◈</span><div><strong>Produção centralizada e protegida</strong><span>MFA obrigatório, sessão com expiração por inatividade, RLS ativo, auditoria por usuário, trava de leito duplicado e diárias reconciliadas no servidor.</span></div></div></section></div>`
}

async function submitNew(e){
  e.preventDefault();if(remoteBusy)return;
  const name=document.getElementById('nName').value.trim(),cpf=cpfNorm(document.getElementById('nCpf').value),entry=document.getElementById('nEntry').value,closer=document.getElementById('nCloser').value,note=document.getElementById('nNote').value.trim(),x=newCalc(),est=newAdmissionEstimate(entry,x),err=document.getElementById('nError');
  const fail=m=>{err.innerHTML=`<div class="form-error">⚠ ${esc(m)}</div>`;return false};
  if(!name)return fail('Informe o nome do paciente.');
  if(!x.bed||x.bed<1||x.bed>19)return fail('Selecione um leito entre 01 e 19.');
  if(x.mode==='hotel'&&x.bed<10)return fail('Hotelaria está disponível nos leitos 10 a 19.');
  if(!x.value||x.value<=0)return fail('Informe um valor de diária válido.');
  try{
    setLoading(true,'Salvando internação…');
    const aid=await rpc('create_uti_admission',{p_name:name,p_cpf:cpf||null,p_bed:x.bed,p_mode:x.mode,p_entry_at:parseLocal(entry),p_closer:closer,p_half_initial:x.half,p_ventilation:x.mode==='private'?x.vent:null,p_negotiated_rate:x.value,p_notes:note||null});
    await loadRemote({quiet:true});
    closeModal();
    state.selectedId=null;
    state.page='home';
    toast(est.retro?`Internação criada: ${est.units.toLocaleString('pt-BR',{maximumFractionDigits:1})} diária(s) retroativas registradas.`:'Internação criada com sucesso.');
    render();
  }catch(ex){fail(ex.message)}finally{setLoading(false)}
}

function paymentModal(a){
  const t=totals(a.id),paymentRef=crypto.randomUUID();
  openModal('Registrar pagamento',`Saldo atual: ${money(t.balance)}`,`<form class="form" id="payForm">${field('Valor recebido','<div class="currency-input large"><span>R$</span><input id="pValue" autofocus inputmode="decimal" placeholder="0,00"></div>')}<div class="form-grid two">${field('Data e hora',`<input id="pWhen" type="datetime-local" value="${nowLocalInput()}">`)}${field('Forma de pagamento','<select id="pMethod"><option>PIX</option><option>Cartão</option><option>Transferência</option><option>Dinheiro</option><option>Outro</option></select>')}</div>${field('Observação','<textarea id="pNotes" rows="2" placeholder="Ex.: pagamento parcial da família"></textarea>','Opcional')}<div id="payWarn"></div><div id="payError"></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-close2>Cancelar</button><button class="btn btn-primary">↙ Registrar recebimento</button></div></form>`);
  document.querySelector('[data-close2]').onclick=closeModal;
  document.getElementById('pValue').oninput=e=>{
    const v=Number(e.target.value.replace(',','.'));
    document.getElementById('payWarn').innerHTML=v>t.balance?'<div class="form-warning">⚠ O valor está acima do saldo exibido. O servidor confirmará o saldo atualizado antes de registrar.</div>':'';
  };
  document.getElementById('payForm').onsubmit=async e=>{
    e.preventDefault();
    if(remoteBusy)return;
    const v=Number(document.getElementById('pValue').value.replace(',','.'));
    if(!v||v<=0)return;
    try{
      setLoading(true,'Registrando pagamento…');
      const status=await rpc('add_uti_payment',{
        p_admission_id:a.id,
        p_occurred_at:parseLocal(document.getElementById('pWhen').value),
        p_amount:v,
        p_method:document.getElementById('pMethod').value,
        p_notes:document.getElementById('pNotes').value.trim()||null,
        p_client_ref:paymentRef
      });
      await loadRemote({quiet:true});closeModal();
      toast(status==='finalized'?'Pagamento registrado e conta finalizada.':'Pagamento registrado.');render();
    }catch(ex){document.getElementById('payError').innerHTML=`<div class="form-error">⚠ ${esc(ex.message)}</div>`}
    finally{setLoading(false)}
  };
}
function extraModal(a){
  const cats=['Cardiologia','Outra especialidade','Hemodiálise','Torgena','Ecalta','Medicamento de alto custo','Outro medicamento','Outro serviço'],extraRef=crypto.randomUUID();
  openModal('Adicionar extra','Especialidades, hemodiálise, medicamentos e outros serviços.',`<form class="form" id="extraForm">${field('Categoria',`<select id="eCat">${cats.map(x=>`<option>${x}</option>`).join('')}</select>`)}${field('Descrição','<input id="eDesc" placeholder="Descrição do serviço ou medicamento">','Para medicamentos de alto custo, utilize a cotação do dia')}<div class="form-grid three">${field('Quantidade','<input id="eQty" value="1" inputmode="decimal">')}${field('Valor unitário','<div class="currency-input"><span>R$</span><input id="eUnit" inputmode="decimal" placeholder="0,00"></div>')}${field('Data e hora',`<input id="eWhen" type="datetime-local" value="${nowLocalInput()}">`)}</div><div class="summary-box"><div><span>Total do extra</span><strong id="eTotal">R$ 0,00</strong></div></div><div id="extraError"></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-close2>Cancelar</button><button class="btn btn-primary">＋ Adicionar cobrança</button></div></form>`);
  document.querySelector('[data-close2]').onclick=closeModal;
  const up=()=>{const q=Number(document.getElementById('eQty').value.replace(',','.'))||0,u=Number(document.getElementById('eUnit').value.replace(',','.'))||0;document.getElementById('eTotal').textContent=money(q*u)};
  document.getElementById('eQty').oninput=up;document.getElementById('eUnit').oninput=up;
  document.getElementById('extraForm').onsubmit=async e=>{
    e.preventDefault();if(remoteBusy)return;
    const q=Number(document.getElementById('eQty').value.replace(',','.'))||0,u=Number(document.getElementById('eUnit').value.replace(',','.'))||0,v=q*u;if(v<=0)return;
    try{
      setLoading(true,'Adicionando cobrança…');
      const cat=document.getElementById('eCat').value,desc=document.getElementById('eDesc').value.trim()||cat;
      await rpc('add_uti_extra',{
        p_admission_id:a.id,
        p_occurred_at:parseLocal(document.getElementById('eWhen').value),
        p_category:cat,p_description:desc,p_amount:v,p_client_ref:extraRef
      });
      await loadRemote({quiet:true});closeModal();toast('Cobrança adicional lançada.');render();
    }catch(ex){document.getElementById('extraError').innerHTML=`<div class="form-error">⚠ ${esc(ex.message)}</div>`}
    finally{setLoading(false)}
  };
}
function rateModal(a){const r=currentRate(a),isPrivate=a.mode==='private';openModal('Ajustar diária','A alteração vale dali para frente; cobranças anteriores permanecem intactas.',`<form class="form" id="rateForm">${isPrivate?field('Ventilação mecânica',`<select id="rVent"><option value="0" ${!r.ventilation?'selected':''}>Não</option><option value="1" ${r.ventilation?'selected':''}>Sim</option></select>`):''}<div class="form-grid two">${field('Validade a partir de',`<input id="rWhen" type="datetime-local" value="${nowLocalInput()}">`)}${field('Nova diária',`<div class="currency-input"><span>R$</span><input id="rValue" value="${r.negotiatedRate}" inputmode="decimal"></div>`)}</div><div class="summary-box"><div><span>Valor padrão</span><strong id="rStandard">—</strong></div><div><span>Valor aplicado</span><strong id="rApplied">${money(r.negotiatedRate)}</strong></div></div><div id="rateError"></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-close2>Cancelar</button><button class="btn btn-primary">↻ Salvar condição</button></div></form>`);document.querySelector('[data-close2]').onclick=closeModal;const upd=()=>{const vent=isPrivate&&document.getElementById('rVent').value==='1',std=isPrivate?(vent?PRIVATE_VENT:PRIVATE_NO_VENT):bedRate(a.bed),val=Number(document.getElementById('rValue').value.replace(',','.'))||0;document.getElementById('rStandard').textContent=money(std);document.getElementById('rApplied').textContent=money(val)};if(isPrivate)document.getElementById('rVent').onchange=e=>{const std=e.target.value==='1'?PRIVATE_VENT:PRIVATE_NO_VENT;document.getElementById('rValue').value=std;upd()};document.getElementById('rValue').oninput=upd;upd();document.getElementById('rateForm').onsubmit=async e=>{e.preventDefault();if(remoteBusy)return;const vent=isPrivate&&document.getElementById('rVent').value==='1',v=Number(document.getElementById('rValue').value.replace(',','.'));if(!v||v<=0)return;try{setLoading(true,'Salvando condição…');await rpc('adjust_uti_rate',{p_admission_id:a.id,p_effective_at:parseLocal(document.getElementById('rWhen').value),p_negotiated_rate:v,p_ventilation:isPrivate?vent:null});await loadRemote({quiet:true});closeModal();toast('Nova condição salva para as próximas diárias.');render()}catch(ex){document.getElementById('rateError').innerHTML=`<div class="form-error">⚠ ${esc(ex.message)}</div>`}finally{setLoading(false)}}}
function accommodationLabel(a){
  return a.bed<=9?'Salão':a.bed<=16?'Humanizado':'Humanizado com suíte';
}
function stayText(minutes){
  const m=Math.max(0,Number(minutes)||0),days=Math.floor(m/1440),hours=Math.floor((m%1440)/60),mins=m%60;
  return [days?days+' dia'+(days===1?'':'s'):'',hours?hours+'h':'',mins?mins+'min':''].filter(Boolean).join(' ')||'0 min';
}
function settlementComposition(s){
  const full=Number(s.fullDailyCount||0),half=Number(s.halfDailyCount||0),parts=[];
  if(full)parts.push(full+' diária'+(full===1?' integral':'s integrais'));
  if(half)parts.push(half+' meia diária');
  return parts.join(' + ')||'Sem diárias';
}
function settlementPreviewMarkup(a,s){
  const items=(s.items||[]).slice().sort((x,y)=>new Date(x.occurredAt)-new Date(y.occurredAt));
  const pays=(s.payments||[]).slice().sort((x,y)=>new Date(x.occurredAt)-new Date(y.occurredAt));
  const refunds=(s.refunds||[]).slice().sort((x,y)=>new Date(x.occurredAt)-new Date(y.occurredAt));
  const bal=Number(s.balance||0),m=balanceMeta(bal),net=Number(s.received||0)-Number(s.refunded||0);
  return `
    <div class="settle-count">
      <div><strong>${Number(s.dailyUnits||0).toLocaleString('pt-BR',{maximumFractionDigits:1})} diária(s)</strong><span>${esc(settlementComposition(s))}</span></div>
      <div style="text-align:right"><strong>${stayText(s.stayMinutes)}</strong><span>Permanência registrada</span></div>
    </div>
    <div class="settle-kpis">
      <div class="settle-kpi"><span>Diárias</span><strong>${money(Number(s.dailyTotal||0))}</strong></div>
      <div class="settle-kpi"><span>Extras</span><strong>${money(Number(s.extrasTotal||0))}</strong></div>
      <div class="settle-kpi"><span>Recebido líquido</span><strong>${money(net)}</strong>${Number(s.refunded||0)>0?`<small>Reembolsado: ${money(Number(s.refunded||0))}</small>`:''}</div>
      <div class="settle-kpi balance ${Math.abs(bal)<=0.009?'paid':'open'}"><span>${m.label}</span><strong>${money(m.amount)}</strong></div>
    </div>
    <div class="settle-section-title">Composição da conta</div>
    <div class="settle-table-wrap"><table class="settle-table"><thead><tr><th>Data/hora</th><th>Descrição</th><th>Tipo</th><th>Valor</th></tr></thead><tbody>
      ${items.map(x=>`<tr><td>${fmtDT(x.occurredAt)}</td><td>${esc(x.description||'Lançamento')}</td><td>${x.kind==='daily'?'Diária':esc(x.category||'Extra')}</td><td>${money(Number(x.amount||0))}</td></tr>`).join('')}
    </tbody></table></div>
    ${pays.length?`<div class="settle-section-title">Pagamentos realizados</div><div class="settle-table-wrap"><table class="settle-table"><thead><tr><th>Data/hora</th><th>Forma</th><th>Registrado por</th><th>Valor</th></tr></thead><tbody>${pays.map(x=>`<tr><td>${fmtDT(x.occurredAt)}</td><td>${esc(x.method)}</td><td>${esc(x.createdBy||'—')}</td><td>${money(Number(x.amount||0))}</td></tr>`).join('')}</tbody></table></div>`:''}
    ${refunds.length?`<div class="settle-section-title">Reembolsos realizados</div><div class="settle-table-wrap"><table class="settle-table"><thead><tr><th>Data/hora</th><th>Forma</th><th>Registrado por</th><th>Valor</th></tr></thead><tbody>${refunds.map(x=>`<tr><td>${fmtDT(x.occurredAt)}</td><td>${esc(x.method)}</td><td>${esc(x.createdBy||'—')}</td><td>- ${money(Number(x.amount||0))}</td></tr>`).join('')}</tbody></table></div>`:''}
    ${bal>0.009&&can('add_payment')?`<div class="settle-paybox"><h3>Registrar recebimento antes da alta</h3><div class="settle-paygrid">
      ${field('Valor',`<div class="currency-input"><span>R$</span><input id="settlePayValue" inputmode="decimal" value="${bal.toFixed(2)}"></div>`)}
      ${field('Forma','<select id="settlePayMethod"><option>PIX</option><option>Cartão</option><option>Transferência</option><option>Dinheiro</option><option>Outro</option></select>')}
      ${field('Data/hora',`<input id="settlePayWhen" type="datetime-local" value="${nowLocalInput()}">`)}
      <button class="btn btn-secondary" id="settlePayBtn">↙ Receber</button>
    </div><div id="settlePayError"></div></div>`:''}
    ${bal<-.009?(data.currentRole==='admin'?`<div class="settle-paybox"><h3>Crédito a devolver ao paciente</h3><div class="settle-paygrid">
      ${field('Valor',`<div class="currency-input"><span>R$</span><input id="settleRefundValue" inputmode="decimal" value="${(-bal).toFixed(2)}"></div>`)}
      ${field('Forma','<select id="settleRefundMethod"><option>PIX</option><option>Transferência</option><option>Dinheiro</option><option>Cartão</option><option>Outro</option></select>')}
      ${field('Data/hora',`<input id="settleRefundWhen" type="datetime-local" value="${nowLocalInput()}">`)}
      <button class="btn btn-secondary" id="settleRefundBtn">↗ Reembolsar</button>
    </div><div id="settleRefundError"></div></div>`:`<div class="form-warning">⚠ Existe crédito de ${money(-bal)} a devolver. Um administrador deve registrar o reembolso antes da finalização.</div>`):''}
  `;
}
async function fetchSettlement(a,dis){
  return rpc('preview_uti_settlement',{p_admission_id:a.id,p_discharge_at:dis});
}

function docDateOnly(v){
  if(!v)return '—';
  return new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(v));
}
function docDateShort(v){
  if(!v)return '—';
  return new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit'}).format(new Date(v));
}
function docIsoDate(v){
  if(!v)return 'sem-data';
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(v));
  const o=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return o.year+'-'+o.month+'-'+o.day;
}
function settlementDocumentId(a){
  const raw=String(a?.id||'').replace(/[^a-zA-Z0-9]/g,'').toUpperCase();
  return raw.slice(0,10)||'SEM-ID';
}
function settlementPdfFileName(a,s){
  const p=patient(a.patientId),base=String(p?.name||'Paciente').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,48)||'Paciente';
  return 'IMEC_Acerto_'+base+'_'+docIsoDate(s?.dischargeAt||a.dischargeAt||new Date())+'.pdf';
}
function settlementDocumentModel(a,s){
  const p=patient(a.patientId);
  const items=(s.items||[]).slice().sort((x,y)=>new Date(x.occurredAt)-new Date(y.occurredAt));
  const pays=(s.payments||[]).slice().sort((x,y)=>new Date(x.occurredAt)-new Date(y.occurredAt));
  const refunds=(s.refunds||[]).slice().sort((x,y)=>new Date(x.occurredAt)-new Date(y.occurredAt));
  const dailyGroups=[];
  items.filter(x=>x.kind==='daily').forEach(x=>{const description=x.description||'Diária',amount=Number(x.amount||0),units=Number(x.units||1),last=dailyGroups[dailyGroups.length-1];if(last&&last.description===description&&Math.abs(last.unitAmount-amount)<0.009){last.qty+=units;last.total+=amount;last.last=x.occurredAt}else dailyGroups.push({description,unitAmount:amount,qty:units,total:amount,first:x.occurredAt,last:x.occurredAt})});
  let lines=dailyGroups.map(g=>({description:g.description,qty:g.qty,total:g.total,period:g.first===g.last?docDateShort(g.first):docDateShort(g.first)+' a '+docDateShort(g.last)}));
  lines=lines.concat(items.filter(x=>x.kind!=='daily').map(x=>({description:x.description||x.category||'Extra',qty:1,total:Number(x.amount||0),period:docDateShort(x.occurredAt)})));
  if(lines.length>6){const kept=lines.slice(0,5),rest=lines.slice(5);kept.push({description:'Outros lançamentos - consultar sistema',qty:rest.reduce((n,x)=>n+Number(x.qty||1),0),total:rest.reduce((n,x)=>n+Number(x.total||0),0),period:'Diversos'});lines=kept}
  const payMap=new Map();
  pays.forEach(x=>{const key='Recebimento - '+(x.method||'Outro'),g=payMap.get(key)||{method:key,qty:0,total:0,first:x.occurredAt,last:x.occurredAt};g.qty++;g.total+=Number(x.amount||0);g.last=x.occurredAt;payMap.set(key,g)});
  refunds.forEach(x=>{const key='Reembolso - '+(x.method||'Outro'),g=payMap.get(key)||{method:key,qty:0,total:0,first:x.occurredAt,last:x.occurredAt};g.qty++;g.total-=Number(x.amount||0);g.last=x.occurredAt;payMap.set(key,g)});
  const payGroups=[...payMap.values()].map(g=>({method:g.method,qty:g.qty,total:g.total,period:g.first===g.last?docDateShort(g.first):docDateShort(g.first)+' a '+docDateShort(g.last)}));
  const bal=Number(s.balance||0);
  return {patient:p,lines,payGroups,status:bal<-.009?'CRÉDITO A DEVOLVER':bal>.009?'ACERTO COM PENDÊNCIA':'ACERTO QUITADO',statusClass:Math.abs(bal)<=.009?'ok':'pending',docId:settlementDocumentId(a)};
}
function pdfSafeText(v){
  return String(v??'').normalize('NFC').replace(/\u00a0/g,' ').replace(/[–—]/g,'-').replace(/•/g,'-').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/[^\x20-\xFF]/g,'?');
}
function pdfEscape(v){
  return pdfSafeText(v).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
}
function pdfShort(v,n){
  const s=pdfSafeText(v);return s.length>n?s.slice(0,Math.max(1,n-3))+'...':s;
}
function pdfWrap(v,n,maxLines=2){
  const words=pdfSafeText(v).split(/\s+/).filter(Boolean),lines=[];let idx=0;
  while(idx<words.length&&lines.length<maxLines){
    let current='';
    while(idx<words.length){
      const next=current?current+' '+words[idx]:words[idx];
      if(next.length<=n||!current){current=next;idx++;}else break;
    }
    if(lines.length===maxLines-1&&idx<words.length){
      if(current.length>n-3)current=current.slice(0,n-3);
      current=current.replace(/\s+$/,'')+'...';
      idx=words.length;
    }
    lines.push(current);
  }
  return lines.length?lines:['Paciente'];
}
function buildSettlementPdfBytes(a,s){
  const m=settlementDocumentModel(a,s),p=m.patient||{},cmd=[];
  const t=(x,y,size,value,bold=false)=>cmd.push('BT /F'+(bold?'2':'1')+' '+size+' Tf '+x+' '+y+' Td ('+pdfEscape(value)+') Tj ET');
  const line=(x1,y1,x2,y2)=>cmd.push(x1+' '+y1+' m '+x2+' '+y2+' l S');
  const rect=(x,y,w,h)=>cmd.push(x+' '+y+' '+w+' '+h+' re S');
  cmd.push('0.04 0.43 0.45 RG','1.4 w');line(40,786,555,786);
  cmd.push('0.04 0.43 0.45 rg');t(40,804,19,'IMEC UTI',true);cmd.push('0 g');
  t(40,790,9,'Folha de Acerto - Particular & Hotelaria');
  t(405,806,8,'Documento '+m.docId,true);t(405,792,8,m.status,true);
  const patientLines=pdfWrap(p.name||'Paciente',56,2);
  t(40,758,16,patientLines[0],true);
  if(patientLines[1])t(40,740,14,patientLines[1],true);
  cmd.push('0.82 G','0.7 w');
  rect(40,696,165,34);rect(215,696,165,34);rect(390,696,165,34);
  t(50,717,7,'MODALIDADE',true);t(50,703,10,a.mode==='private'?'Particular':'Hotelaria',true);
  t(225,717,7,'ACOMODAÇÃO',true);t(225,703,10,pdfShort(accommodationLabel(a),25),true);
  t(400,717,7,'LEITO',true);t(400,703,10,String(a.bed).padStart(2,'0'),true);
  rect(40,654,165,34);rect(215,654,165,34);rect(390,654,165,34);
  t(50,675,7,'ENTRADA',true);t(50,661,9,fmtDT(a.entryAt),true);
  t(225,675,7,'SAÍDA',true);t(225,661,9,fmtDT(s.dischargeAt||a.dischargeAt),true);
  t(400,675,7,'PERMANÊNCIA',true);t(400,661,9,pdfShort(stayText(s.stayMinutes),24),true);
  rect(40,609,515,35);
  t(50,629,13,Number(s.dailyUnits||0).toLocaleString('pt-BR',{maximumFractionDigits:1})+' diária(s)',true);
  t(50,615,8,pdfShort(settlementComposition(s),55));
  t(386,629,8,'Regra de alta',true);t(386,615,8,'O dia da saída não é cobrado');
  const fin=[['Diárias',s.dailyTotal],['Extras',s.extrasTotal],['Total',s.total],['Recebido',s.received],['Reembolsado',s.refunded],['Saldo',s.balance]];
  const fw=515/6;
  fin.forEach((x,i)=>{const xx=40+i*fw;rect(xx,558,fw,38);t(xx+7,583,7,x[0].toUpperCase(),true);t(xx+7,567,9,pdfShort(money(x[0]==='Saldo'?Math.abs(Number(x[1]||0)):Number(x[1]||0)),18),true)});
  t(40,536,8,'RESUMO DA COMPOSIÇÃO',true);line(40,530,555,530);
  t(42,518,7,'PERÍODO',true);t(145,518,7,'DESCRIÇÃO',true);t(442,518,7,'QTD.',true);t(490,518,7,'VALOR',true);
  let y=502;
  m.lines.forEach(x=>{t(42,y,7,pdfShort(x.period,18));t(145,y,7,pdfShort(x.description,46));t(445,y,7,Number(x.qty).toLocaleString('pt-BR',{maximumFractionDigits:1}));t(486,y,7,pdfShort(money(x.total),15));y-=18});
  t(40,390,8,'MOVIMENTAÇÕES DE CAIXA',true);line(40,384,555,384);
  if(!m.payGroups.length){t(42,367,8,'Nenhuma movimentação registrada.');}
  else{
    t(42,367,7,'PERÍODO',true);t(205,367,7,'FORMA',true);t(405,367,7,'QTD.',true);t(475,367,7,'VALOR',true);
    let py=350;m.payGroups.forEach(x=>{t(42,py,7,pdfShort(x.period,25));t(205,py,7,pdfShort(x.method,24));t(408,py,7,String(x.qty));t(472,py,7,pdfShort(money(x.total),16));py-=17});
  }
  cmd.push('0.65 G');rect(40,88,515,185);t(50,252,8,'COMPROVANTES DE MOVIMENTAÇÃO',true);t(50,237,7,'Anexar nesta área os comprovantes originais de recebimentos ou reembolsos.');
  t(40,60,7,'Responsável pelo fechamento: '+pdfShort(a.closer||'—',34),true);
  t(40,47,7,'Emitido por: '+pdfShort(data.currentUser||'—',30)+' - '+fmtDT(new Date().toISOString()));
  t(395,47,7,'Conferência / Visto');line(395,58,555,58);
  const stream=cmd.join('\n');
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    '<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream'
  ];
  let pdf='%PDF-1.4\n%\xE2\xE3\xCF\xD3\n',offsets=[0];
  objects.forEach((obj,i)=>{offsets[i+1]=pdf.length;pdf+=(i+1)+' 0 obj\n'+obj+'\nendobj\n'});
  const xref=pdf.length;
  pdf+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n';
  for(let i=1;i<=objects.length;i++)pdf+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';
  pdf+='trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';
  const bytes=new Uint8Array(pdf.length);
  for(let i=0;i<pdf.length;i++)bytes[i]=pdf.charCodeAt(i)&255;
  return bytes;
}
function buildSettlementPdfBlob(a,s){
  return new Blob([buildSettlementPdfBytes(a,s)],{type:'application/pdf'});
}
async function downloadSettlementPdf(a,knownSettlement=null){
  let loading=false;
  const isiOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const iosWindow=isiOS?window.open('','_blank'):null;
  try{
    let s=knownSettlement;
    if(!s){loading=true;setLoading(true,'Gerando PDF…');s=await fetchSettlement(a,a.dischargeAt)}
    const blob=buildSettlementPdfBlob(a,s),url=URL.createObjectURL(blob),fileName=settlementPdfFileName(a,s);
    if(isiOS){
      if(iosWindow)iosWindow.location.href=url;else window.location.href=url;
    }else{
      const link=document.createElement('a');link.href=url;link.download=fileName;document.body.appendChild(link);link.click();link.remove();
    }
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    toast('PDF do acerto gerado.');
  }catch(ex){if(iosWindow)try{iosWindow.close()}catch{};alert('Não foi possível gerar o PDF: '+ex.message)}
  finally{if(loading)setLoading(false)}
}

function printSettlementSheet(a,knownSettlement=null){
  const win=window.open('','_blank');
  if(!win){alert('O navegador bloqueou a janela de impressão. Permita pop-ups para este site.');return}
  win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Folha de Acerto — IMEC UTI</title><style>body{font-family:Arial,sans-serif;padding:32px;color:#172326} .loading{margin-top:80px;text-align:center;color:#6d7b7e}</style></head><body><div class="loading">Preparando Folha de Acerto…</div></body></html>');
  const build=async()=>{
    try{
      const s=knownSettlement||await fetchSettlement(a,a.dischargeAt);
      const model=settlementDocumentModel(a,s),p=model.patient,printItems=model.lines,payGroups=model.payGroups,status=model.status,statusClass=model.statusClass;
      const pdfBlob=buildSettlementPdfBlob(a,s),pdfUrl=URL.createObjectURL(pdfBlob),fileName=settlementPdfFileName(a,s);
      win.document.open();
      win.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Folha de Acerto — ${esc(p?.name||'Paciente')}</title><style>
        @page{size:A4 portrait;margin:13mm}
        *{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;color:#172326;background:#eef3f3;padding:12px;font-size:9.5pt}.sheet{width:184mm;min-height:271mm;margin:0 auto;background:#fff;padding:0;display:flex;flex-direction:column}
        .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0b6f72;padding-bottom:10px;margin-bottom:12px}
        .brand{font-size:18pt;font-weight:800;color:#07575a}.brand small{display:block;font-size:9pt;color:#6d7b7e;font-weight:600;margin-top:2px}
        .status{font-size:8.5pt;font-weight:800;padding:6px 9px;border-radius:6px}.status.ok{background:#eaf7f0;color:#16794a}.status.pending{background:#fff7df;color:#8b5a0e}
        .patient{font-size:17pt;font-weight:800;margin:0 0 10px;overflow-wrap:anywhere}.grid{display:grid;grid-template-columns:1.25fr 1fr 1fr;gap:8px;margin-bottom:10px}
        .box{border:1px solid #dfe7e7;border-radius:7px;padding:8px}.box span{display:block;color:#6d7b7e;font-size:7.5pt;text-transform:uppercase;font-weight:700;letter-spacing:.03em}.box strong{display:block;margin-top:3px;font-size:10pt}
        .period{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px}
        .daily{border:1px solid #cfe4e4;background:#f3f9f9;border-radius:7px;padding:9px;margin:10px 0;display:flex;justify-content:space-between;align-items:center}.daily strong{font-size:14pt;color:#07575a}.daily small{display:block;color:#6d7b7e;margin-top:2px}
        .finance{display:grid;grid-template-columns:repeat(6,1fr);border:1px solid #dfe7e7;border-radius:7px;overflow:hidden;margin:10px 0 12px}.finance div{padding:8px;border-right:1px solid #dfe7e7}.finance div:last-child{border-right:0}.finance span{display:block;color:#6d7b7e;font-size:7.5pt}.finance strong{display:block;margin-top:3px;font-size:10.5pt}.finance .saldo strong{font-size:12pt}
        h2{font-size:9pt;text-transform:uppercase;letter-spacing:.05em;color:#5d6d70;margin:12px 0 6px}
        table{width:100%;border-collapse:collapse;font-size:8.5pt}th{background:#f5f8f8;color:#5d6d70;text-align:left;font-size:7.5pt;text-transform:uppercase}th,td{border:1px solid #e1e8e8;padding:5px 6px}th:last-child,td:last-child{text-align:right}
        .proof{margin-top:12px;border:1px dashed #9caaaa;border-radius:6px;padding:9px;flex:1;min-height:145px}.proof h2{margin-top:0}.proof p{color:#6d7b7e;margin:3px 0 0;font-size:8pt}.proof-space{min-height:105px}
        .footer{display:flex;justify-content:space-between;gap:20px;border-top:1px solid #d7dfdf;padding-top:8px;margin-top:10px;font-size:8pt;color:#6d7b7e}.sign{margin-top:28px;width:210px;border-top:1px solid #7b888a;padding-top:4px;text-align:center;color:#46575a}
        .no-print{width:184mm;margin:0 auto 10px;display:flex;justify-content:flex-end;gap:7px}.no-print button,.no-print a{border:0;background:#0b6f72;color:#fff;padding:9px 13px;border-radius:7px;font-weight:700;cursor:pointer;text-decoration:none;font:inherit}.no-print .ghost{background:#fff;color:#435456;border:1px solid #cfd8d8}.doc-side{text-align:right}.doc-side small{display:block;color:#6d7b7e;font-size:7.5pt;margin-top:5px}
        @media print{html,body{background:#fff!important;padding:0!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.no-print{display:none}.sheet{width:auto;min-height:271mm;margin:0}.proof{break-inside:avoid}thead{display:table-header-group}tr{break-inside:avoid}}
      </style></head><body>
      <div class="no-print"><button onclick="window.print()">Imprimir / Salvar PDF</button><a href="${pdfUrl}" download="${esc(fileName)}">Baixar PDF</a><button class="ghost" onclick="window.close()">Fechar</button></div>
      <main class="sheet">
      <div class="top"><div><div class="brand">IMEC UTI<small>Folha de Acerto — Particular & Hotelaria</small></div></div><div class="doc-side"><div class="status ${statusClass}">${status}</div><small>Documento ${model.docId}</small></div></div>
      <div class="patient">${esc(p?.name||'Paciente')}</div>
      <div class="grid">
        <div class="box"><span>Modalidade</span><strong>${a.mode==='private'?'Particular':'Hotelaria'}</strong></div>
        <div class="box"><span>Acomodação</span><strong>${accommodationLabel(a)}</strong></div>
        <div class="box"><span>Leito</span><strong>${String(a.bed).padStart(2,'0')}</strong></div>
      </div>
      <div class="period">
        <div class="box"><span>Entrada</span><strong>${fmtDT(a.entryAt)}</strong></div>
        <div class="box"><span>Saída</span><strong>${fmtDT(s.dischargeAt||a.dischargeAt)}</strong></div>
        <div class="box"><span>Permanência</span><strong>${stayText(s.stayMinutes)}</strong></div>
      </div>
      <div class="daily"><div><strong>${Number(s.dailyUnits||0).toLocaleString('pt-BR',{maximumFractionDigits:1})} diária(s)</strong><small>${esc(settlementComposition(s))}</small></div><div style="text-align:right"><span style="font-size:8pt;color:#6d7b7e">Regra de alta</span><small>O dia da saída não é cobrado</small></div></div>
      <div class="finance">
        <div><span>Diárias</span><strong>${money(Number(s.dailyTotal||0))}</strong></div>
        <div><span>Extras</span><strong>${money(Number(s.extrasTotal||0))}</strong></div>
        <div><span>Total</span><strong>${money(Number(s.total||0))}</strong></div>
        <div><span>Recebido</span><strong>${money(Number(s.received||0))}</strong></div>
        <div><span>Reembolsado</span><strong>${money(Number(s.refunded||0))}</strong></div>
        <div class="saldo"><span>Saldo</span><strong>${money(Math.abs(Number(s.balance||0)))}</strong></div>
      </div>
      <h2>Resumo da composição</h2>
      <table><thead><tr><th>Período</th><th>Descrição</th><th>Qtd.</th><th>Valor</th></tr></thead><tbody>${printItems.map(x=>`<tr><td>${esc(x.period)}</td><td>${esc(x.description)}</td><td>${Number(x.qty).toLocaleString('pt-BR',{maximumFractionDigits:1})}</td><td>${money(x.total)}</td></tr>`).join('')}</tbody></table><div style="font-size:7.5pt;color:#6d7b7e;margin-top:4px">O detalhamento completo permanece disponível no sistema.</div>
      ${payGroups.length?`<h2>Movimentações de caixa</h2><table><thead><tr><th>Período</th><th>Tipo / forma</th><th>Qtd.</th><th>Valor</th></tr></thead><tbody>${payGroups.map(x=>`<tr><td>${esc(x.period)}</td><td>${esc(x.method)}</td><td>${x.qty}</td><td>${money(x.total)}</td></tr>`).join('')}</tbody></table>`:''}
      <div class="proof"><h2>Comprovantes de movimentação financeira</h2><p>Anexar abaixo os comprovantes originais de recebimentos ou reembolsos registrados nesta conta.</p><div class="proof-space"></div></div>
      <div class="footer"><div><strong>Responsável pelo fechamento:</strong> ${esc(a.closer||'—')}<br><strong>Documento emitido por:</strong> ${esc(data.currentUser)} • ${fmtDT(new Date().toISOString())}</div><div class="sign">Conferência / Visto</div></div>
      </main></body></html>`);
      win.document.close();
      try{win.focus()}catch{}
      setTimeout(()=>URL.revokeObjectURL(pdfUrl),900000);
    }catch(e){
      win.document.body.innerHTML='<p style="font-family:Arial;padding:30px;color:#b42318">Não foi possível gerar a folha: '+esc(e.message)+'</p>';
    }
  };
  build();
}

function dischargeModal(a){
  if(!can('discharge')){toast('Seu perfil não pode registrar alta.');return}
  const alreadyDischarged=!!a.dischargeAt;
  const def=a.dischargeAt?toLocalInput(new Date(a.dischargeAt)):nowLocalInput();
  let lastPreview=null,lastDis=null,confirmedSnapshot=null;
  openModal('Alta e acerto','Informe a saída, confira a sugestão automática e somente depois confirme o fechamento.',`
    <div class="form">
      <div class="settle-intro">
        <div class="settle-patient"><span>Paciente</span><strong>${esc(patient(a.patientId)?.name||'Paciente')}</strong><small>Leito ${String(a.bed).padStart(2,'0')} • ${a.mode==='private'?'Particular':'Hotelaria'} • ${accommodationLabel(a)}</small></div>
        <div class="settle-rule"><span>Regra IMEC</span><strong>O dia da saída não gera diária.</strong><small>A data e hora ficam registradas para controle, mas a cobrança termina no dia anterior.</small></div>
      </div>
      <div class="settle-actions-top">
        ${field('Data e hora de saída',`<input id="dWhen" type="datetime-local" value="${def}" ${alreadyDischarged?'disabled':''}>`,'Entrada: '+fmtDT(a.entryAt))}
        <button class="btn btn-secondary" id="dCalc">Calcular acerto</button>
      </div>
      <div id="dPreview" class="settlement-preview"></div>
      <div id="dError"></div>
      <div class="modal-actions" id="dActions"><button class="btn btn-secondary" data-close2>Cancelar</button></div>
    </div>`);
  document.getElementById('modalBackdrop')?.classList.add('settlement-modal');
  document.querySelector('[data-close2]').onclick=closeModal;
  const getDis=()=>a.dischargeAt||parseLocal(document.getElementById('dWhen').value);
  const snapshot=s=>JSON.stringify([Number(s.accountVersion||0),Number(s.total||0),Number(s.received||0),Number(s.refunded||0),Number(s.balance||0),Number(s.dailyUnits||0)]);

  const bindPreviewActions=()=>{
    const payBtn=document.getElementById('settlePayBtn');
    if(payBtn){
      const paymentRef=crypto.randomUUID();
      payBtn.onclick=async()=>{
        if(remoteBusy)return;
        const val=Number(document.getElementById('settlePayValue').value.replace(',','.')),method=document.getElementById('settlePayMethod').value,when=parseLocal(document.getElementById('settlePayWhen').value),er=document.getElementById('settlePayError');
        er.innerHTML='';
        if(!val||val<=0){er.innerHTML='<div class="form-error">⚠ Informe um valor válido.</div>';return}
        try{
          setLoading(true,'Registrando recebimento…');
          await rpc('add_uti_payment',{p_admission_id:a.id,p_occurred_at:when,p_amount:val,p_method:method,p_notes:'Recebimento no acerto de alta',p_client_ref:paymentRef});
          await loadRemote({quiet:true});a=admission(a.id);await calculate();toast('Pagamento registrado.');
        }catch(ex){er.innerHTML=`<div class="form-error">⚠ ${esc(ex.message)}</div>`}finally{setLoading(false)}
      };
    }
    const refundBtn=document.getElementById('settleRefundBtn');
    if(refundBtn){
      const refundRef=crypto.randomUUID();
      refundBtn.onclick=async()=>{
        if(remoteBusy)return;
        const val=Number(document.getElementById('settleRefundValue').value.replace(',','.')),method=document.getElementById('settleRefundMethod').value,when=parseLocal(document.getElementById('settleRefundWhen').value),er=document.getElementById('settleRefundError');
        er.innerHTML='';
        if(!val||val<=0){er.innerHTML='<div class="form-error">⚠ Informe um valor válido.</div>';return}
        try{
          setLoading(true,'Registrando reembolso…');
          await rpc('add_uti_refund',{p_admission_id:a.id,p_occurred_at:when,p_amount:val,p_method:method,p_notes:'Reembolso no acerto de alta',p_client_ref:refundRef});
          await loadRemote({quiet:true});a=admission(a.id);await calculate();toast('Reembolso registrado.');
        }catch(ex){er.innerHTML=`<div class="form-error">⚠ ${esc(ex.message)}</div>`}finally{setLoading(false)}
      };
    }
  };

  const renderActions=()=>{
    const box=document.getElementById('dActions');
    box.innerHTML='<button class="btn btn-secondary" data-close2>Cancelar</button>'+
      (alreadyDischarged&&lastPreview?'<button class="btn btn-secondary sheet-trigger" id="dPrint">▤ Visualizar / imprimir</button><button class="btn btn-secondary sheet-trigger" id="dPdf">⇩ Baixar PDF</button>':'')+
      (!alreadyDischarged&&lastPreview?'<button class="btn btn-primary" id="dConfirm">✓ Confirmar alta</button>':'')+
      (alreadyDischarged?'<button class="btn btn-primary" id="dDone">Concluir</button>':'');
    box.querySelector('[data-close2]').onclick=closeModal;
    const pr=document.getElementById('dPrint');if(pr)pr.onclick=()=>printSettlementSheet(a,lastPreview);
    const pd=document.getElementById('dPdf');if(pd)pd.onclick=()=>downloadSettlementPdf(a,lastPreview);
    const done=document.getElementById('dDone');if(done)done.onclick=closeModal;
    const cf=document.getElementById('dConfirm');if(cf)cf.onclick=confirmDischarge;
  };

  const calculate=async()=>{
    const dis=getDis(),er=document.getElementById('dError');
    er.innerHTML='';
    if(!dis||new Date(dis)<new Date(a.entryAt)){document.getElementById('dPreview').innerHTML='<div class="form-error">⚠ A saída não pode ser anterior à entrada do paciente.</div>';lastPreview=null;renderActions();return}
    try{
      setLoading(true,'Calculando acerto…');
      const s=await fetchSettlement(a,dis);
      lastPreview=s;lastDis=dis;confirmedSnapshot=snapshot(s);
      document.getElementById('dPreview').innerHTML=settlementPreviewMarkup(a,s);
      bindPreviewActions();renderActions();
    }catch(ex){lastPreview=null;document.getElementById('dPreview').innerHTML='';er.innerHTML=`<div class="form-error">⚠ ${esc(ex.message)}</div>`;renderActions()}
    finally{setLoading(false)}
  };

  const confirmDischarge=async()=>{
    if(remoteBusy)return;
    const dis=getDis(),er=document.getElementById('dError');er.innerHTML='';
    if(!lastPreview||dis!==lastDis){er.innerHTML='<div class="form-warning">⚠ Recalcule o acerto antes de confirmar.</div>';return}
    try{
      setLoading(true,'Conferindo e registrando alta…');
      const fresh=await fetchSettlement(a,dis),freshSnap=snapshot(fresh);
      if(freshSnap!==confirmedSnapshot){
        lastPreview=fresh;confirmedSnapshot=freshSnap;
        document.getElementById('dPreview').innerHTML=settlementPreviewMarkup(a,fresh);
        bindPreviewActions();renderActions();
        er.innerHTML='<div class="form-warning">⚠ A conta foi atualizada desde a última conferência. Revise os novos valores e confirme novamente.</div>';
        return;
      }
      const status=await rpc('discharge_uti',{p_admission_id:a.id,p_discharge_at:dis,p_expected_version:Number(fresh.accountVersion)});
      await loadRemote({quiet:true});a=admission(a.id);lastPreview=await fetchSettlement(a,a.dischargeAt);
      closeModal();
      toast(status==='finalized'?'Alta registrada e conta finalizada.':'Alta registrada; ainda existe uma pendência financeira.');
      render();
    }catch(ex){er.innerHTML=`<div class="form-error">⚠ ${esc(ex.message)}</div>`}finally{setLoading(false)}
  };

  document.getElementById('dCalc').onclick=calculate;
  if(!alreadyDischarged)document.getElementById('dWhen').oninput=()=>{lastPreview=null;document.getElementById('dPreview').innerHTML='';renderActions()};
  calculate();
}

function bindDetail(a){
  document.querySelectorAll('[data-action="back"]').forEach(b=>b.onclick=()=>{state.selectedId=null;render()});
  document.querySelectorAll('[data-action="payment"]').forEach(b=>b.onclick=()=>paymentModal(a));
  document.querySelectorAll('[data-action="refund"]').forEach(b=>b.onclick=()=>refundModal(a));
  document.querySelectorAll('[data-action="extra"]').forEach(b=>b.onclick=()=>extraModal(a));
  document.querySelectorAll('[data-action="rate"]').forEach(b=>b.onclick=()=>rateModal(a));
  document.querySelectorAll('[data-action="discharge"]').forEach(b=>{const sp=b.querySelector('span');if(sp)sp.textContent=a.dischargeAt?'Acerto / saída':'Alta e acerto';b.onclick=()=>dischargeModal(a)});
  document.querySelectorAll('[data-action="print"]').forEach(b=>b.onclick=()=>window.print());
  const actions=document.querySelector('.detail-actions');
  const hasCorrectable=data.payments.some(x=>x.admissionId===a.id)||data.charges.some(x=>x.admissionId===a.id&&x.kind!=='daily')||(data.refunds||[]).some(x=>x.admissionId===a.id);
  if(actions&&data.currentRole==='admin'&&hasCorrectable&&!actions.querySelector('[data-action="corrections"]')){
    const cb=document.createElement('button');cb.className='btn btn-secondary';cb.dataset.action='corrections';cb.innerHTML='↺ Corrigir lançamento';cb.onclick=()=>correctionsModal(a);actions.insertBefore(cb,actions.firstChild);
  }
  if(actions&&a.dischargeAt&&!actions.querySelector('[data-action="settlement-sheet"]')){
    const pdf=document.createElement('button');pdf.className='btn btn-secondary';pdf.dataset.action='settlement-pdf';pdf.innerHTML='⇩ Baixar PDF';pdf.onclick=()=>downloadSettlementPdf(a);actions.insertBefore(pdf,actions.firstChild);
    const b=document.createElement('button');b.className='btn btn-secondary';b.dataset.action='settlement-sheet';b.innerHTML='▤ Imprimir acerto';b.onclick=()=>printSettlementSheet(a);actions.insertBefore(b,actions.firstChild);
  }
}


function bindPage(){
  document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{state.selectedId=b.dataset.open;render()});
  const s=document.getElementById('searchPatients');if(s)s.oninput=e=>{state.search=e.target.value;render()};
  document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{state.patientFilter=b.dataset.filter;render()});
  document.querySelectorAll('[data-ftab]').forEach(b=>b.onclick=()=>{state.financeTab=b.dataset.ftab;render()});
  const od=document.getElementById('onDuty');if(od)od.onchange=async e=>{const next=e.target.value;try{setLoading(true);await rpc('update_uti_on_duty',{p_name:next});await loadRemote({quiet:true});toast('Plantão comercial atualizado.');render()}catch(ex){alert(ex.message);render()}finally{setLoading(false)}};
  const mr=document.getElementById('manualRefresh');if(mr)mr.onclick=()=>withRemote(async()=>{const ok=await loadRemote({quiet:true});if(!ok)throw new Error('Não foi possível atualizar os dados.');render()},'Dados atualizados.');
  const iu=document.getElementById('inviteUserBtn');if(iu)iu.onclick=inviteUserModal;const cp=document.getElementById('changePasswordBtn');if(cp)cp.onclick=changePasswordModal;const lo=document.getElementById('logoutBtn');if(lo)lo.onclick=logoutRemote;
  document.querySelectorAll('[data-save-member]').forEach(btn=>btn.onclick=async()=>{const id=btn.dataset.saveMember,role=document.querySelector(`[data-member-role="${id}"]`).value,active=document.querySelector(`[data-member-active="${id}"]`).checked;try{setLoading(true,'Atualizando acesso…');await rpc('admin_update_uti_member',{p_user_id:id,p_active:active,p_role:role});await loadRemote({quiet:true});toast('Acesso atualizado.');render()}catch(ex){alert(ex.message)}finally{setLoading(false)}});
}

async function backgroundRefresh(){if(!authState||remoteBusy||document.querySelector('.modal-backdrop'))return;try{await loadRemote({quiet:true});render()}catch{}}


document.addEventListener('click',e=>{const nav=e.target.closest('[data-nav]');if(nav){state.page=nav.dataset.nav;state.selectedId=null;render();return}const act=e.target.closest('[data-action]');if(!act)return;const a=act.dataset.action;if(a==='new')newAdmissionModal();if(a==='export'){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),x=document.createElement('a');x.href=url;x.download=`imec-uti-dados-visiveis-${new Date().toISOString().slice(0,10)}.json`;x.click();URL.revokeObjectURL(url)}});
setInterval(backgroundRefresh,45000);
['pointerdown','keydown','touchstart','scroll'].forEach(eventName=>window.addEventListener(eventName,()=>touchActivity(),{passive:true}));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){touchActivity(true);enforceClientSessionTimeout().then(expired=>{if(!expired)backgroundRefresh()})}});
supabase.auth.onAuthStateChange((event,session)=>{authState=session||null;if(event==='SIGNED_OUT'){clearSessionClock();data=blankData();renderAuth()}});
boot();
