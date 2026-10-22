// @ts-nocheck
import {
  PRIVATE_NO_VENT, PRIVATE_VENT, HOTEL_SIMPLE, HOTEL_SUITE,
  money, businessParts, zonedLocalToDate, fmtDT, fmtDM, nowLocalInput,
  toLocalInput, parseLocal, cpfNorm, cpfMask, dayKey, monthKey,
  sameDay, sameMonth, bedRate, bedLabel, late, spParts, matchesPatientSearch,
  newAdmissionEstimate, roleLabel, balanceMeta, healthStatusMeta,
  alertStatusMeta, healthWindowSummary
} from './domain';
import { SUPABASE_URL, SUPABASE_KEY } from './config';
import { paymentMethodLabel, installmentSummary, validateInstallmentDates } from './payment-details';
import {previousReportMonth,reportCompetence,reportReference,reportDate,monthlyReportFilename,monthlyReportCsv,buildMonthlyReportPdf} from './monthly-report';
import {
  AUTH_STORAGE_KEY, ACTIVITY_STORAGE_KEY, IDLE_TIMEOUT_MS, APP_URL,
  jwtAal, normalizeSession, parseAuthRedirect, cleanAuthRedirectUrl,
  passwordPolicy, sha1Hex, pwnedCountFromRange, isIdle, canBackgroundRefresh, totpQrImageSrc
} from './security';

const USERS=['Samuel','Roberto','Aline'];
// Small, local SVG vocabulary: no icon font, network dependency or decorative labels.
const ICON_PATHS={
 home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
 patients:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-16a3 3 0 0 1 0 6m4 10v-3a6 6 0 0 0-3-5"/>',
 wallet:'<path d="M20 8V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v11H5a3 3 0 0 1-3-3V6"/><path d="M20 12h-5v5h5"/><path d="M17 14.5h.01"/>',
 settings:'<path d="M3 6h3m4 0h11M3 12h11m4 0h3M3 18h3m4 0h11"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',
 check:'<path d="m5 12 4 4L19 6"/>',
 close:'<path d="m6 6 12 12M6 18 18 6"/>',
 search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
 arrowLeft:'<path d="m12 5-7 7 7 7M5 12h15"/>',
 arrowRight:'<path d="m12 5 7 7-7 7M19 12H4"/>',
 chevron:'<path d="m9 5 7 7-7 7"/>',
 down:'<path d="M12 3v16m-6-6 6 6 6-6"/>',
 up:'<path d="M12 21V5m-6 6 6-6 6 6"/>',
 bed:'<path d="M3 5v16m18-8v8M3 17h18M7 9h3a3 3 0 0 1 3 3v1H3V9Z"/><path d="M13 8h5a3 3 0 0 1 3 3v2h-8Z"/>',
 calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-12 4h.01m4 0h.01"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 document:'<path d="M14 3H5v18h14V8Zm0 0v5h5M8 12h8m-8 4h6"/>',
 printer:'<path d="M6 8V3h12v5M6 17H3V9h18v8h-3"/><path d="M6 14h12v7H6Zm11-3h.01"/>',
 refresh:'<path d="M20 7a9 9 0 0 0-15-2L3 8m0-5v5h5m-4 9a9 9 0 0 0 15 2l2-3m0 5v-5h-5"/>',
 shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
 lock:'<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
 logout:'<path d="M9 3H3v18h6m6-14 5 5-5 5M8 12h12"/>',
 credit:'<rect x="2" y="4" width="20" height="16" rx="3"/><path d="M2 9h20M6 15h4"/>',
 minus:'<path d="M5 12h14"/>',
 edit:'<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15Z"/>',
 info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
 history:'<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7m2-4v5l3 2"/>',
 spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
 activity:'<path d="M2 12h5l3-8 4 16 3-8h5"/>'
};
function icon(name){return `<svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_PATHS[name]||ICON_PATHS.document}</svg>`}
function polishIcons(root){
 if(!root?.querySelectorAll)return;
 const actions={new:'plus',payment:'credit',extra:'plus',discount:'minus',rate:'refresh','edit-admission':'edit',refund:'up',discharge:'arrowRight',print:'printer',back:'arrowLeft',export:'down',corrections:'history','settlement-sheet':'document','settlement-pdf':'down'};
 const controls={manualRefresh:'refresh',inviteUserBtn:'plus',changePasswordBtn:'lock',logoutBtn:'logout',dCalc:'refresh',dConfirm:'check',dPrint:'printer',dPdf:'down',dDone:'check',settlePayBtn:'check',settleRefundBtn:'up'};
 root.querySelectorAll('button').forEach(button=>{
   const name=button.hasAttribute('data-close')?'close':actions[button.dataset.action]||controls[button.id]||(button.type==='submit'&&button.closest('form')?(button.closest('#loginForm')?'arrowRight':'check'):null);
   if(!name||button.querySelector('.ui-icon'))return;
   const tile=button.closest('.quick-actions')?button.querySelector('div'):null;
   if(tile){tile.innerHTML=icon(name);return}
   button.innerHTML=icon(name)+button.innerHTML.replace(/^[＋+✓↙↗↻↺→←▤⇩⌘⇥≡×]\s*/u,'');
 });
 root.querySelectorAll('.searchbox>span').forEach(el=>el.innerHTML=icon('search'));
 root.querySelectorAll('.patient-meta').forEach(el=>{el.querySelectorAll('span').forEach((span,i)=>span.innerHTML=icon(i?'clock':'calendar')+span.innerHTML.replace(/^[▣◷]\s*/u,''))});
 root.querySelectorAll('.timeline-dot,.receipt-icon').forEach(el=>{const text=el.textContent.trim();const incoming=['↙','✓'].includes(text),outgoing=text==='↗';el.innerHTML=icon(incoming?'down':outgoing?'up':'document');if(outgoing)el.classList.add('outgoing')});
 root.querySelectorAll('.security-note>span,.security-shield').forEach(el=>el.innerHTML=icon('shield'));
 root.querySelectorAll('.balance-strip>span:last-child,.attention-row>span:last-child,.finance-row>span:last-child,.table-row>span:last-child').forEach(el=>{if(el.textContent.trim()==='›')el.innerHTML=icon('chevron')});
 root.querySelectorAll('[data-member-role]').forEach(el=>el.setAttribute('aria-label','Perfil de acesso de '+el.closest('.member-row').querySelector('.member-ident strong').textContent));
 root.querySelectorAll('[data-save-member]').forEach(el=>el.setAttribute('aria-label','Salvar acesso de '+el.closest('.member-row').querySelector('.member-ident strong').textContent));
}
const ROLE_PERMISSIONS={
  commercial:new Set(['create_admission','add_extra','add_payment','adjust_rate','update_on_duty']),
  operator:new Set(['create_admission','add_extra']),
  referral:new Set(['create_admission'])
};
let state={page:'home', selectedId:null, patientFilter:'active', financeTab:'pending', search:'',reportMonth:previousReportMonth(),reportCommission:false};
let monthlyReportState={report:null,loading:false,error:'',revision:0};
let data=blankData();
let authState=null;
let authEpoch=0;
let refreshAuthInFlight=null;
let passwordOnlyMode=false;
let teamProfiles=[];
let teamClosers=[];
let remoteBusy=false;
let idleGuardStarted=false;
let modalReturnFocus=null;
const MODAL_FOCUSABLE='a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
function blankData(){return {patients:[],admissions:[],charges:[],payments:[],scheduledReceipts:[],refunds:[],audits:[],health:null,healthHistory:[],alerts:[],currentUser:'Samuel',currentRole:null,onDuty:'Samuel',seededDemo:false}}
function currentRate(a,at=new Date()){return [...a.rateHistory].filter(r=>new Date(r.effectiveAt)<=at).sort((x,y)=>new Date(y.effectiveAt)-new Date(x.effectiveAt))[0]||a.rateHistory[0]}
function totals(id){const billed=data.charges.filter(c=>c.admissionId===id).reduce((s,c)=>s+c.amount,0),received=data.payments.filter(p=>p.admissionId===id).reduce((s,p)=>s+p.amount,0),refunded=(data.refunds||[]).filter(r=>r.admissionId===id).reduce((s,r)=>s+r.amount,0),netReceived=received-refunded;return {billed,received,refunded,netReceived,balance:billed-received+refunded}}
function patient(id){return data.patients.find(p=>p.id===id)}
function admission(id){return data.admissions.find(a=>a.id===id)}
function hospitalDays(a){const st=new Date(a.entryAt), en=a.dischargeAt?new Date(a.dischargeAt):new Date();return Math.max(1,Math.ceil(Math.max(0,en-st)/86400000))}
function statusBadge(s){return s==='active'?'<span class="badge badge-brand">Internado</span>':s==='discharge_pending'?'<span class="badge badge-warn">Alta pendente</span>':s==='finalized'?'<span class="badge badge-good">Finalizado</span>':'<span class="badge badge-neutral">Cancelado</span>'}
function toast(text){const el=document.getElementById('toast');if(!el)return;el.textContent=`✓ ${text}`;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2400)}
function shell(){
 const pageName=state.selectedId?'Conta do paciente':({home:'Visão geral',patients:'Pacientes',finance:'Financeiro',reports:'Relatórios',settings:'Operação e acessos'})[state.page];
 document.getElementById('app').innerHTML=`
 <aside class="sidebar">
  <div class="brand"><div class="brand-mark">${icon('activity')}</div><div><strong>IMEC UTI</strong><span>Particular & Hotelaria</span></div></div>
  <button class="btn btn-primary side-new" data-action="new">${icon('plus')} Nova internação</button>
  <div class="nav-caption">ESPAÇO DE TRABALHO</div>
  <nav aria-label="Navegação principal">${navItem('home','home','Início')}${navItem('patients','patients','Pacientes')}${navItem('finance','wallet','Financeiro')}${navItem('reports','document','Relatórios')}${navItem('settings','settings','Configurações')}</nav>
  <div class="side-bottom"><div class="duty"><span>Plantão comercial</span><strong>${icon('clock')}${esc(data.onDuty)}</strong></div><div class="user-chip"><div class="avatar">${esc(data.currentUser[0])}</div><div><strong>${esc(data.currentUser)}</strong><span>${esc(roleLabel(data.currentRole))}</span></div></div></div>
 </aside>
 <div class="app-main"><header class="topbar"><div class="mobile-brand"><div class="brand-mark">${icon('activity')}</div><div><strong>IMEC UTI</strong><span>Particular & Hotelaria</span></div></div><div class="top-context"><span>IMEC UTI</span>${icon('chevron')}<strong>${pageName}</strong></div><div class="top-actions"><span class="top-date">${new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'long',timeZone:'America/Sao_Paulo'}).format(new Date())}</span><button class="top-user" data-nav="settings" aria-label="Abrir configurações do usuário"><div class="avatar small">${esc(data.currentUser[0])}</div><span>${esc(data.currentUser)}</span></button><button class="icon-btn mobile-only" data-action="new" aria-label="Nova internação">${icon('plus')}</button></div></header><main class="content" id="content" tabindex="-1"></main></div>
 <nav class="bottom-nav" aria-label="Navegação principal móvel"><button data-nav="home" class="${state.page==='home'?'active':''}" aria-current="${state.page==='home'?'page':'false'}">${icon('home')}<span>Início</span></button><button data-nav="patients" class="${state.page==='patients'?'active':''}" aria-current="${state.page==='patients'?'page':'false'}">${icon('patients')}<span>Pacientes</span></button><button data-nav="finance" class="${state.page==='finance'?'active':''}" aria-current="${state.page==='finance'?'page':'false'}">${icon('wallet')}<span>Financeiro</span></button><button data-nav="reports" class="${state.page==='reports'?'active':''}" aria-current="${state.page==='reports'?'page':'false'}">${icon('document')}<span>Relatórios</span></button><button data-nav="settings" class="${state.page==='settings'?'active':''}" aria-current="${state.page==='settings'?'page':'false'}">${icon('settings')}<span>Ajustes</span></button></nav>`;
 if(data.currentRole==='referral'){
   const root=document.getElementById('app');
   root.querySelectorAll('.bottom-nav [data-nav="finance"]').forEach(b=>b.remove());
   const bottom=root.querySelector('.bottom-nav');if(bottom)bottom.style.gridTemplateColumns='repeat(4,minmax(0,1fr))';
   root.querySelectorAll('[data-action="new"]').forEach(b=>{b.innerHTML=icon('plus')+(b.classList.contains('icon-btn')?'':'Nova indicação');b.setAttribute('aria-label','Nova indicação')});
 }
}
function navItem(p,i,l){return data.currentRole==='referral'&&p==='finance'?'':`<button class="side-item ${state.page===p?'active':''}" data-nav="${p}" aria-current="${state.page===p?'page':'false'}">${icon(i)}<span>${l}</span>${state.page===p?'<span class="nav-active-dot" aria-hidden="true"></span>':''}</button>`}
function unresolvedSystemAlerts(){return (data.alerts||[]).filter(a=>a.status!=='resolved')}
function systemAlertBanner(){
  if(data.currentRole!=='admin')return '';
  const unresolved=unresolvedSystemAlerts();
  const healthMeta=healthStatusMeta(data.health?.status,data.health?.checkedAt);
  const healthIssue=Array.isArray(data.health?.issues)?data.health.issues[0]:null;
  if(!unresolved.length){
    if(data.health && data.health.status==='ok' && !healthMeta.stale)return '';
    const critical=data.health?.status==='critical';
    const message=healthMeta.stale?'O monitor de saúde está atrasado.':healthIssue?.message||'A saúde operacional requer verificação.';
    return `<button class="system-alert-banner ${critical?'critical':'warn'}" data-nav="settings"><span class="system-alert-icon">${critical?'!':'△'}</span><span><strong>${healthMeta.stale?'Monitor atrasado':critical?'Saúde operacional crítica':'Saúde operacional em atenção'}</strong><small>${esc(message)}</small></span><b>Revisar →</b></button>`;
  }
  const actionable=unresolved.filter(a=>alertStatusMeta(a.severity,a.status).needsAction);
  const critical=unresolved.filter(a=>a.severity==='critical');
  const lead=actionable[0]||critical[0]||unresolved[0];
  return `<button class="system-alert-banner ${critical.length?'critical':'warn'}" data-nav="settings"><span class="system-alert-icon">${critical.length?'!':'△'}</span><span><strong>${critical.length?critical.length+' alerta(s) crítico(s)':unresolved.length+' alerta(s) operacional(is)'}</strong><small>${esc(lead?.message||'Abra a central de observabilidade para revisar.')}</small></span><b>Revisar →</b></button>`;
}
function render(){shell();const c=document.getElementById('content'); if(state.selectedId){const a=admission(state.selectedId); if(a){c.innerHTML=systemAlertBanner()+patientDetail(a);bindDetail(a);polishIcons(document.getElementById('app'));return}state.selectedId=null}
 const page=state.page==='home'?dashboard():state.page==='patients'?patientsPage():state.page==='finance'?financePage():state.page==='reports'?monthlyReportsPage():settingsPage();
 c.innerHTML=systemAlertBanner()+page;polishIcons(document.getElementById('app'));bindPage();}

function metric(label,value,note='',tone=''){const symbol=label.includes('Internados')?'bed':label.includes('Crédito')?'up':label.includes('Recebido')?'down':'wallet';return `<div class="metric-card ${tone?'metric-'+tone:''}"><div class="metric-icon">${icon(symbol)}</div><div class="metric-copy"><span>${label}</span><strong>${value}</strong>${note?`<small>${note}</small>`:''}</div></div>`}
function empty(title,text){return `<div class="empty-state"><div class="empty-icon">${icon(title==='Tudo em dia'?'check':'document')}</div><strong>${title}</strong><p>${text}</p></div>`}
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
  <div class="metric-grid">${metric('Internados agora',active.length)}${metric('A receber',money(toReceive),credits>0?'Créditos a devolver: '+money(credits):'',toReceive>0?'warn':'good')}${metric('Recebido líquido hoje',money(payToday-refToday),refToday>0?'Reembolsado: '+money(refToday):'','good')}${metric('Recebido líquido no mês',money(payMonth-refMonth),`Cobrado: ${money(billedMonth)} • Reembolsado: ${money(refMonth)}`)}</div>
  <div class="dashboard-grid"><section class="panel"><div class="panel-head"><div><h2>Requer atenção</h2><p>Prioridades financeiras abertas.</p></div>${attention.length?`<span class="badge badge-warn">${attention.length} pendência${attention.length>1?'s':''}</span>`:''}</div>${attention.length?`<div class="attention-list">${attention.map(({a,t})=>{const p=patient(a.patientId),m=balanceMeta(t.balance);return `<button class="attention-row" data-open="${a.id}"><div class="status-rail ${a.status==='discharge_pending'?'rail-warn':'rail-bad'}"></div><div class="attention-main"><strong>${esc(p?.name)}</strong><span>Leito ${String(a.bed).padStart(2,'0')} • ${a.mode==='private'?'Particular':'Hotelaria'}${a.status==='discharge_pending'?' • Alta pendente':''}</span></div><div class="attention-value"><span>${m.label}</span><strong>${money(m.amount)}</strong></div><span>›</span></button>`}).join('')}</div>`:empty('Tudo em dia','Nenhuma pendência financeira nas internações abertas.')}</section>
  <section class="panel compact-panel"><div class="panel-head"><div><h2>Resumo do mês</h2><p>Indicadores essenciais.</p></div></div><div class="mini-stats"><div><span>Particulares iniciados</span><strong>${data.admissions.filter(a=>a.mode==='private'&&sameMonth(a.entryAt)).length}</strong></div><div><span>Hotelarias iniciadas</span><strong>${data.admissions.filter(a=>a.mode==='hotel'&&sameMonth(a.entryAt)).length}</strong></div><div><span>Comissões particulares</span><strong>${money(commissions)}</strong></div></div></section></div>
  <section class="panel"><div class="panel-head"><div><h2>Pacientes ativos</h2><p>Internações em andamento.</p></div><span class="badge badge-brand">${active.length}</span></div>${active.length?`<div class="patient-card-grid">${active.sort((a,b)=>new Date(b.entryAt)-new Date(a.entryAt)).slice(0,6).map(patientCard).join('')}</div>`:empty('Nenhuma internação ativa','Use “Nova internação” para começar o controle.')}</section>`;
}
function monthlyReportsPage(){
 const s=monthlyReportState,r=s.report?.month===state.reportMonth?s.report:null,ready=!!r&&!s.loading&&!s.error;
 return `<section class="page-head"><div><span class="eyebrow">RELATÓRIOS</span><h1>Leito humanizado</h1><p>Recebimentos do mês e comissão da Aline Glória.</p></div></section>
 <section class="report-toolbar panel"><div class="report-period">${field('Competência',`<input id="reportMonth" type="month" value="${state.reportMonth}" aria-label="Competência do relatório">`)}<button id="reportRefresh" class="icon-btn" aria-label="Atualizar relatório" ${s.loading?'disabled':''}>${icon('refresh')}</button></div><div class="report-export"><label class="report-option"><input type="checkbox" id="reportCommission" ${state.reportCommission?'checked':''}>Incluir comissão na exportação</label><div class="report-buttons"><button id="reportPdf" class="btn btn-primary" ${!ready?'disabled':''}>${icon('down')}Baixar PDF</button><button id="reportPrint" class="btn btn-secondary" ${!ready?'disabled':''}>${icon('printer')}Imprimir</button><button id="reportCsv" class="btn btn-secondary" ${!ready?'disabled':''}>${icon('document')}Planilha CSV</button></div></div></section>
 <div class="report-body" aria-live="polite">${s.loading?'<div class="panel report-loading">Carregando os recebimentos da competência…</div>':s.error?`<div class="panel"><div class="form-error">${esc(s.error)}</div><p>Use atualizar para tentar novamente.</p></div>`:r?`
 <div class="report-metrics"><div class="metric-card"><div class="metric-copy"><span>Total líquido recebido</span><strong id="reportNet">${money(r.netCents/100)}</strong><small>Recebido: ${money(r.receivedCents/100)} · Reembolsado: ${money(r.refundedCents/100)}</small></div></div><div class="metric-card"><div class="metric-copy"><span>Recebimentos confirmados</span><strong id="reportCount">${r.receiptCount}</strong><small>${r.admissionCount} internação(ões)${r.refundCount?' · '+r.refundCount+' reembolso(s)':''}</small></div></div><div class="metric-card"><div class="metric-copy"><span>Aline Glória · 3%</span><strong id="reportFee">${money(r.commissionCents/100)}</strong><small>Comissão sobre o recebido líquido</small></div></div></div>
 <section class="panel report-sheet"><div class="panel-head"><div><h2>Recebimentos · ${reportCompetence(r.month)}</h2><p>Valores líquidos recebidos na competência, agrupados por internação.</p></div></div>${r.rows.length?`<div class="report-table-wrap"><table class="report-table"><thead><tr><th>Nome do paciente</th><th>Entrada</th><th>Alta</th><th>Valor total</th><th>Tipo de leito</th></tr></thead><tbody>${r.rows.map(row=>`<tr><td><button class="report-patient" data-report-open="${row.admissionId}">${esc(row.patientName)}</button></td><td>${reportDate(row.entryAt)}</td><td>${reportDate(row.dischargeAt)}</td><td>${money(row.netCents/100)}</td><td><span class="badge badge-neutral">${esc(row.bedType)}</span></td></tr>`).join('')}</tbody><tfoot><tr><th colspan="3">Total líquido</th><td>${money(r.netCents/100)}</td><td></td></tr></tfoot></table></div>`:empty('Sem movimentações nesta competência','Nenhum recebimento confirmado ou reembolso de leito humanizado foi encontrado.')}<div class="report-reference">${esc(reportReference(r.month))}</div><p class="report-note">O mês considera a data do recebimento ou reembolso. Crédito parcelado entra integralmente no mês do recebimento confirmado; previsões não entram.</p></section>`:''}</div>`;
}
async function loadMonthlyReport(){
 const month=state.reportMonth,revision=++monthlyReportState.revision,epoch=authEpoch;
 monthlyReportState.loading=true;monthlyReportState.error='';render();
 try{
   reportCompetence(month);const report=await rpc('get_uti_humanized_monthly_report',{p_month:month+'-01'});
   if(revision!==monthlyReportState.revision||epoch!==authEpoch)return;
   monthlyReportState.report=report;
 }catch(ex){if(revision===monthlyReportState.revision&&epoch===authEpoch)monthlyReportState.error=ex.message||'Não foi possível carregar o relatório.'}
 finally{if(revision===monthlyReportState.revision&&epoch===authEpoch){monthlyReportState.loading=false;if(state.page==='reports'&&!state.selectedId)render()}}
}
function monthlyReportPrintHtml(r,commission){
 return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(reportReference(r.month))}</title><style>@page{size:A4;margin:16mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#202629;font-size:10pt;margin:0}.tools{padding:14px 0;display:flex;gap:10px}button{padding:10px 16px;border:1px solid #dce4df;border-radius:8px;background:white;color:#12635e;cursor:pointer}.head{display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid #dce4df;padding-bottom:14px}h1{font-size:18pt;margin:0 0 8px}h2{font-size:14pt;margin:18px 0 6px}p{color:#667275;font-size:9pt;line-height:1.5}table{border-collapse:collapse;width:100%;table-layout:fixed;margin:20px 0}thead{display:table-header-group}th,td{text-align:left;border-bottom:1px solid #e4e8e7;padding:10px 5px;vertical-align:top;overflow-wrap:anywhere}th{font-size:8pt;color:#667275}th:first-child,td:first-child{padding-left:0;width:40%}th:nth-child(2),th:nth-child(3){width:14%}th:nth-child(4){width:20%}th:nth-child(5){width:12%}td:nth-child(4),th:nth-child(4){text-align:right;font-variant-numeric:tabular-nums}tr{break-inside:avoid}.totals{margin:20px 0;break-inside:avoid}.totals div{display:flex;justify-content:space-between;padding:8px 0}.total{font-size:13pt;font-weight:bold}.reference{border-top:1px solid #dce4df;padding-top:16px;font-weight:bold;break-inside:avoid}.empty{padding:24px 0}.issued{font-size:8pt;color:#667275}@media print{.tools{display:none}}@media screen{body{max-width:800px;margin:30px auto;padding:0 20px}}</style></head><body><div class="tools"><button id="printMonthly">Imprimir / salvar PDF</button><button id="closeMonthly">Fechar</button></div><div class="head"><h1>IMEC UTI</h1><strong>Competência ${reportCompetence(r.month)}</strong></div><h2>Leito humanizado</h2><p>${r.receiptCount} recebimento(s) · ${r.admissionCount} internação(ões)<br>Valores líquidos recebidos na competência, descontados os reembolsos.</p>${r.rows.length?`<table><thead><tr><th>Nome do paciente</th><th>Entrada</th><th>Alta</th><th>Valor total</th><th>Leito</th></tr></thead><tbody>${r.rows.map(x=>`<tr><td>${esc(x.patientName)}</td><td>${reportDate(x.entryAt)}</td><td>${reportDate(x.dischargeAt)}</td><td>${money(x.netCents/100)}</td><td>${esc(x.bedType)}</td></tr>`).join('')}</tbody></table>`:'<p class="empty">Nenhuma movimentação nesta competência.</p>'}<div class="totals"><div class="total"><span>Total líquido recebido</span><span>${money(r.netCents/100)}</span></div>${r.refundCount?`<div><span>Recebido: ${money(r.receivedCents/100)}</span><span>Reembolsado: ${money(r.refundedCents/100)}</span></div>`:''}${commission?`<div><strong>Comissão Aline Glória · 3%</strong><strong>${money(r.commissionCents/100)}</strong></div>`:''}</div><div class="reference">${esc(reportReference(r.month))}</div><p class="issued">Emitido em ${reportDate(r.generatedAt)}</p></body></html>`;
}
async function exportMonthlyReport(kind){
 if(remoteBusy||monthlyReportState.loading)return;
 const month=state.reportMonth,commission=state.reportCommission,epoch=authEpoch;
 const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const popup=kind==='print'||(kind==='pdf'&&ios)?window.open('','_blank'):null;
 if(kind==='print'&&!popup){toast('Permita a janela de impressão ou use Baixar PDF.');return}
 if(popup){popup.document.write('<!doctype html><html lang="pt-BR"><title>Preparando relatório</title><body style="font-family:Arial;padding:32px">Preparando relatório…</body></html>');popup.document.close();}
 try{
   setLoading(true,'Preparando relatório…');
   const r=await rpc('get_uti_humanized_monthly_report',{p_month:month+'-01'});
   if(epoch!==authEpoch||!authState)throw new Error('Sua sessão mudou. Entre novamente para gerar o relatório.');
   await rpc('log_uti_report_event',{p_month:month+'-01',p_event:kind==='print'?'print_requested':kind==='csv'?'csv_downloaded':'pdf_downloaded',p_include_commission:commission});
   if(epoch!==authEpoch||!authState)throw new Error('Sua sessão mudou. Entre novamente para gerar o relatório.');
   if(kind==='print'){
     popup.document.open();popup.document.write(monthlyReportPrintHtml(r,commission));popup.document.close();
     popup.document.getElementById('printMonthly').onclick=()=>popup.print();popup.document.getElementById('closeMonthly').onclick=()=>popup.close();
     popup.focus();popup.print();
   }else{
     const blob=kind==='csv'?new Blob([monthlyReportCsv(r,commission)],{type:'text/csv;charset=utf-8'}):new Blob([buildMonthlyReportPdf(r,commission)],{type:'application/pdf'});
     const url=URL.createObjectURL(blob);
     if(kind==='pdf'&&ios){if(popup)popup.location.href=url;else window.location.href=url;}
     else{const link=document.createElement('a');link.href=url;link.download=monthlyReportFilename(r,commission,kind==='csv'?'csv':'pdf');document.body.appendChild(link);link.click();link.remove();}
     setTimeout(()=>URL.revokeObjectURL(url),60000);toast(kind==='csv'?'Planilha CSV gerada.':'PDF pronto para imprimir.');
   }
   if(state.reportMonth===month)monthlyReportState.report=r;if(state.page==='reports'&&!state.selectedId)render();
 }catch(ex){if(popup)popup.close();toast('Não foi possível gerar o relatório: '+ex.message)}finally{setLoading(false)}
}
function patientCard(a){
  const p=patient(a.patientId),t=totals(a.id),r=currentRate(a),m=balanceMeta(t.balance);
  const discountTotal=data.charges.filter(x=>x.admissionId===a.id&&x.kind==='adjustment'&&x.amount<0).reduce((sum,x)=>sum-x.amount,0);
  return `<button class="patient-card" data-open="${a.id}"><div class="patient-card-top"><div class="bed-chip">${String(a.bed).padStart(2,'0')}</div><span class="badge ${a.mode==='private'?'badge-brand':'badge-neutral'}">${a.mode==='private'?'Particular':'Hotelaria'}</span></div><h3>${esc(p?.name)}</h3><p>${a.mode==='private'?(r.ventilation?'Com ventilação':'Sem ventilação'):esc(r.label)}</p><div class="patient-meta"><span>▣ Entrada ${fmtDT(a.entryAt)}</span><span>◷ ${hospitalDays(a)}º dia</span></div><div class="patient-money"><div><span>${discountTotal>0?'Total após desconto':'Cobrado'}</span><strong>${money(t.billed)}</strong>${discountTotal>0?`<small>Desconto no acerto: − ${money(discountTotal)}</small>`:''} </div><div><span>Recebido líquido</span><strong>${money(t.netReceived)}</strong></div></div><div class="balance-strip ${Math.abs(t.balance)<=0.009?'paid':'open'}"><span>${m.label}</span><strong>${money(m.amount)}</strong><span>›</span></div></button>`;
}
function patientsPage(){
  const q=state.search.toLowerCase().trim();
  let rows=data.admissions.filter(a=>{const p=patient(a.patientId);const ms=matchesPatientSearch(p,q);const f=state.patientFilter;const mf=f==='all'||(f==='active'&&a.status==='active')||(f==='pending'&&a.status==='discharge_pending')||(f==='finalized'&&a.status==='finalized')||(f==='private'&&a.mode==='private')||(f==='hotel'&&a.mode==='hotel');return ms&&mf}).sort((a,b)=>new Date(b.entryAt)-new Date(a.entryAt));
  const fs=[['active','Internados'],['pending','Alta pendente'],['private','Particular'],['hotel','Hotelaria'],['finalized','Finalizados'],['all','Todos']];
  return `<section class="page-head"><div><span class="eyebrow">INTERNAÇÕES</span><h1>Pacientes</h1><p>Consulte rapidamente qualquer conta em andamento ou finalizada.</p></div></section><div class="toolbar"><div class="searchbox"><span>⌕</span><input id="searchPatients" aria-label="Buscar paciente por nome ou CPF" placeholder="Buscar por nome ou CPF" value="${esc(state.search)}"></div><div class="filter-chips">${fs.map(([v,l])=>`<button data-filter="${v}" class="${state.patientFilter===v?'active':''}">${l}</button>`).join('')}</div></div><section class="panel table-panel">${rows.length?`<div class="patients-table"><div class="table-row table-header"><span>Paciente</span><span>Leito</span><span>Entrada</span><span>Cobrado</span><span>Recebido líq.</span><span>Saldo</span><span>Status</span><span></span></div>${rows.map(a=>{const p=patient(a.patientId),t=totals(a.id),m=balanceMeta(t.balance);return `<button class="table-row" data-open="${a.id}"><span class="patient-cell"><strong>${esc(p?.name)}</strong><small>${a.mode==='private'?'Particular':'Hotelaria'}</small></span><span><strong>${String(a.bed).padStart(2,'0')}</strong></span><span>${fmtDT(a.entryAt)}</span><span>${money(t.billed)}</span><span>${money(t.netReceived)}</span><span class="${Math.abs(t.balance)<=0.009?'money-paid':'money-open'}" title="${m.label}">${m.kind==='credit'?'Crédito '+money(m.amount):money(m.amount)}</span><span>${statusBadge(a.status)}</span><span>›</span></button>`}).join('')}</div>`:empty('Nenhum paciente encontrado','Altere os filtros ou faça uma nova internação.')}</section>`;
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
  else if(state.financeTab==='planned')body=scheduledReceiptPanel()||empty('Nenhum recebimento previsto','Use Receber depois ao registrar um recebimento.');
  else body=fin.length?`<div class="finance-list">${fin.map(a=>{const p=patient(a.patientId),t=totals(a.id);return `<button class="finance-row" data-open="${a.id}"><div><div class="finance-name"><strong>${esc(p?.name)}</strong><span class="badge badge-good">Finalizado</span></div><span>Alta ${a.dischargeAt?fmtDT(a.dischargeAt):'—'} • ${a.mode==='private'?'Particular':'Hotelaria'}</span></div><div class="finance-amount"><span>Total</span><strong>${money(t.billed)}</strong></div><span>›</span></button>`}).join('')}</div>`:empty('Nenhuma conta finalizada','Internações quitadas e encerradas aparecerão aqui.');
  return `<section class="page-head"><div><span class="eyebrow">RECEBIMENTOS</span><h1>Financeiro</h1><p>Entradas, reembolsos e contas que precisam de fechamento.</p></div></section><div class="metric-grid finance-metrics">${metric('A receber',money(totalOpen),'',totalOpen>0?'warn':'good')}${metric('Crédito a devolver',money(totalCredit),'',totalCredit>0?'warn':'good')}${metric('Recebido líquido hoje',money(payToday-refToday),'','good')}${metric('Recebido líquido no mês',money(payMonth-refMonth))}</div><div class="tabs"><button data-ftab="pending" class="${state.financeTab==='pending'?'active':''}">Pendências <span>${pending.length}</span></button><button data-ftab="receipts" class="${state.financeTab==='receipts'?'active':''}">Movimentações</button><button data-ftab="planned" class="${state.financeTab==='planned'?'active':''}">Previstos</button><button data-ftab="finalized" class="${state.financeTab==='finalized'?'active':''}">Finalizados</button></div><section class="panel">${body}</section>`;
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
  const canPay=can('add_payment')&&a.status!=='finalized'&&a.status!=='cancelled'&&t.balance>0.009,canRefund=data.currentRole==='admin'&&a.status!=='cancelled'&&t.balance<-.009,canDiscount=data.currentRole==='admin'&&a.status==='discharge_pending'&&t.balance>0.009,discountTotal=extras.filter(x=>x.kind==='adjustment'&&x.amount<0).reduce((sum,x)=>sum-x.amount,0);
  return `<div class="detail-top no-print"><button class="back-btn" data-action="back">← Voltar</button><div class="detail-actions"><button class="btn btn-secondary" data-action="print">▤ Imprimir ficha</button>${canPay?'<button class="btn btn-primary" data-action="payment">＋ Pagamento</button>':''}${canRefund?'<button class="btn btn-primary" data-action="refund">↗ Reembolso</button>':''}</div></div>
  <section class="detail-hero print-area"><div class="detail-identity"><div class="bed-large">${String(a.bed).padStart(2,'0')}</div><div><div class="detail-badges">${statusBadge(a.status)}<span class="badge ${a.mode==='private'?'badge-brand':'badge-neutral'}">${a.mode==='private'?'Particular':'Hotelaria'}</span></div><h1>${esc(p?.name)}</h1><p>CPF ${cpfMask(p?.cpf)} • Responsável pelo fechamento: <strong>${esc(a.closer)}</strong></p></div></div><div class="detail-meta-grid"><div><span>Entrada</span><strong>${fmtDT(a.entryAt)}</strong></div><div><span>Saída</span><strong>${a.dischargeAt?fmtDT(a.dischargeAt):'Em andamento'}</strong></div><div><span>Tempo de internação</span><strong>${hospitalDays(a)} dia${hospitalDays(a)>1?'s':''}</strong></div><div><span>Condição atual</span><strong>${esc(r.label)}</strong></div><div><span>Diária atual</span><strong>${money(r.negotiatedRate)}</strong></div></div></section>
  <div class="money-hero print-area"><div><span>Cobrado</span><strong>${money(t.billed)}</strong></div><div><span>Recebido líquido</span><strong>${money(t.netReceived)}</strong>${t.refunded>0?`<small>Reembolsado: ${money(t.refunded)}</small>`:''}</div><div class="balance ${Math.abs(t.balance)<=0.009?'paid':'open'}"><span>${m.label}</span><strong>${money(m.amount)}</strong></div></div>
  <div class="quick-actions no-print"><button data-action="payment" ${!canPay?'disabled':''}><div>R$</div><span>Registrar pagamento</span></button><button data-action="extra" ${!can('add_extra')||a.status==='finalized'||a.status==='cancelled'?'disabled':''}><div>＋</div><span>Adicionar extra</span></button>${canDiscount?'<button data-action="discount"><div>−</div><span>Conceder desconto</span></button>':''}<button data-action="rate" ${!can('adjust_rate')||a.status!=='active'?'disabled':''}><div>↻</div><span>Ajustar diária</span></button>${canRefund?'<button data-action="refund"><div>↗</div><span>Reembolsar crédito</span></button>':''}<button data-action="discharge" ${!can('discharge')||a.status==='finalized'||a.status==='cancelled'?'disabled':''}><div>→</div><span>${a.status==='discharge_pending'?'Acerto / saída':'Registrar alta'}</span></button></div>
  ${scheduledReceiptPanel(a)}<div class="detail-columns print-area"><section class="panel"><div class="panel-head"><div><h2>Movimentação financeira</h2><p>Resumo da conta; as diárias são agrupadas para evitar repetição visual.</p></div></div>${timeline.length?`<div class="timeline">${timeline.map(row=>row.kind==='p'?`<div class="timeline-row payment"><div class="timeline-dot">↙</div><div><strong>Pagamento recebido</strong><span>${fmtDT(row.at)} • ${esc(paymentMethodLabel(row.item))} • ${esc(row.item.createdBy)}</span>${row.item.notes?`<small>${esc(row.item.notes)}</small>`:''}${editReceiptButton(row.item)}</div><strong class="good-text">+ ${money(row.item.amount)}</strong></div>`:row.kind==='r'?`<div class="timeline-row payment"><div class="timeline-dot">↗</div><div><strong>Reembolso ao paciente</strong><span>${fmtDT(row.at)} • ${esc(paymentMethodLabel(row.item))} • ${esc(row.item.createdBy)}</span>${row.item.notes?`<small>${esc(row.item.notes)}</small>`:''}</div><strong>- ${money(row.item.amount)}</strong></div>`:row.kind==='d'?`<div class="timeline-row charge"><div class="timeline-dot">▤</div><div><strong>Diárias da internação — ${Number(row.item.units).toLocaleString('pt-BR',{maximumFractionDigits:1})} diária(s)</strong><span>${fmtDM(row.item.first)} a ${fmtDM(row.item.last)} • ${row.item.count} lançamento(s)</span></div><strong>${money(row.item.amount)}</strong></div>`:`<div class="timeline-row charge"><div class="timeline-dot">${row.item.amount<0?'−':'＋'}</div><div><strong>${esc(row.item.description)}</strong><span>${fmtDT(row.at)} • ${esc(row.item.category)}</span></div><strong>${row.item.amount<0?'− ':''}${money(Math.abs(row.item.amount))}</strong></div>`).join('')}</div>`:empty('Sem movimentações','As diárias, extras, pagamentos e reembolsos aparecerão aqui.')}</section>
  <div class="side-stack"><section class="panel"><div class="panel-head"><div><h2>Diárias geradas</h2><p>${daily.length?Number(dailyUnits).toLocaleString('pt-BR',{maximumFractionDigits:1})+' diária(s) • '+money(dailyTotal):'Nenhuma diária gerada'}</p></div></div>${daily.length?`<details><summary style="cursor:pointer;font-weight:700;padding:10px 0">Ver detalhamento por dia (${daily.length})</summary><div class="coverage-list">${cov.map(({c,paid,status})=>`<div class="coverage-row"><div><strong>${fmtDM(c.occurredAt)}</strong><span>${esc(c.description)}</span></div><div class="coverage-right"><span>${money(c.amount)}</span><span class="badge ${status==='paid'?'badge-good':status==='partial'?'badge-warn':'badge-bad'}">${status==='paid'?'Pago':status==='partial'?`Parcial ${money(paid)}`:'Em aberto'}</span></div></div>`).join('')}</div></details>`:''}</section>
  <section class="panel no-print"><div class="panel-head"><div><h2>Auditoria</h2><p>Últimas alterações relevantes.</p></div></div><div class="audit-list">${audits.slice(0,6).map(x=>`<div><span>${esc(x.action)}</span><strong>${esc(x.detail)}</strong><small>${fmtDT(x.occurredAt)} • ${esc(x.user)}</small></div>`).join('')}</div></section></div></div>
  <div class="print-footer print-only"><strong>IMEC UTI — Extrato de internação</strong><span>Gerado em ${fmtDT(new Date().toISOString())}</span></div>`;
}

function modalFocusables(){
  const card=document.querySelector('#modal [role="dialog"]');
  if(!card)return [];
  return [...card.querySelectorAll(MODAL_FOCUSABLE)].filter(el=>!el.hasAttribute('disabled')&&el.getAttribute('aria-hidden')!=='true'&&el.getClientRects().length>0);
}
function modalKeydown(e){
  const card=document.querySelector('#modal [role="dialog"]');
  if(!card)return;
  if(e.key==='Escape'){e.preventDefault();closeModal();return}
  if(e.key!=='Tab')return;
  const focusable=modalFocusables();
  if(!focusable.length){e.preventDefault();card.focus();return}
  const first=focusable[0],last=focusable[focusable.length-1];
  if(!card.contains(document.activeElement)){
    e.preventDefault();
    (e.shiftKey?last:first).focus();
    return;
  }
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
}
function openModal(title,subtitle,body){
  const existingModal=!!document.querySelector('.modal-backdrop');
  const originalFocus=existingModal?modalReturnFocus:(document.activeElement instanceof HTMLElement?document.activeElement:null);
  if(existingModal)closeModal({restore:false});
  modalReturnFocus=originalFocus;
  const host=document.getElementById('modal');
  const app=document.getElementById('app');
  if(app)app.setAttribute('inert','');
  document.body.classList.add('modal-open');
  host.innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modalTitle" ${subtitle?'aria-describedby="modalSubtitle"':''} tabindex="-1"><div class="modal-head"><div><h2 id="modalTitle">${esc(title)}</h2>${subtitle?`<p id="modalSubtitle">${esc(subtitle)}</p>`:''}</div><button class="icon-btn" data-close aria-label="Fechar janela">×</button></div>${body}</section></div>`;
  polishIcons(host);
  host.querySelector('[data-close]').onclick=()=>closeModal();
  host.querySelector('#modalBackdrop').addEventListener('mousedown',e=>{if(e.target.id==='modalBackdrop')closeModal()});
  document.addEventListener('keydown',modalKeydown);
  requestAnimationFrame(()=>{
    const autofocus=host.querySelector('[autofocus]');
    const focusable=modalFocusables();
    (autofocus||focusable[0]||host.querySelector('[role="dialog"]'))?.focus();
  });
}
function closeModal({restore=true}={}){
  document.removeEventListener('keydown',modalKeydown);
  const app=document.getElementById('app');
  if(app)app.removeAttribute('inert');
  document.body.classList.remove('modal-open');
  const host=document.getElementById('modal');if(host)host.innerHTML='';
  const target=modalReturnFocus;modalReturnFocus=null;
  if(restore)requestAnimationFrame(()=>{const next=target?.isConnected?target:document.getElementById('content');next?.focus()});
}
function field(label,html,hint=''){return `<label class="field"><span class="field-label">${label}</span>${html}${hint?`<small>${hint}</small>`:''}</label>`}
function newAdmissionModal(){
  if(!can('create_admission')){toast('Seu perfil não pode criar internações.');return}
  const beds=Array.from({length:19},(_,i)=>i+1).map(n=>`<option value="${n}">Leito ${String(n).padStart(2,'0')}${n<=9?' — Salão':n<=16?' — Individual':' — Suíte'}</option>`).join('');
  const closerNames=teamClosers.length?teamClosers.filter(x=>x.active!==false).map(x=>x.display_name):USERS;
  openModal(data.currentRole==='referral'?'Nova indicação':'Nova internação','Cadastre apenas o essencial. O financeiro começa a partir daqui.',`<form class="form" id="newForm"><div class="form-section"><h3>Paciente</h3><div class="form-grid two">${field('Nome completo','<input id="nName" required autofocus autocomplete="off" placeholder="Nome do paciente">')}${field('CPF','<input id="nCpf" inputmode="numeric" autocomplete="off" placeholder="000.000.000-00">','Opcional, recomendado para evitar duplicidade')}</div></div><div class="form-section"><h3>Internação</h3><div class="form-grid three">${field('Leito',`<select id="nBed"><option value="">Selecionar</option>${beds}</select>`)}${field('Modalidade','<select id="nMode"><option value="private">Particular</option><option value="hotel">Hotelaria</option></select>')}${field('Entrada',`<input id="nEntry" type="datetime-local" value="${nowLocalInput()}">`)}</div></div><div class="form-section"><h3>Condição comercial</h3><div class="form-grid three">${field('Ventilação mecânica','<select id="nVent"><option value="0">Não</option><option value="1">Sim</option></select>')}${field('Valor padrão','<div class="read-value" id="nStandard">R$ 7.000,00</div>')}${field('Valor negociado','<div class="currency-input"><span>R$</span><input id="nValue" inputmode="decimal" placeholder="7000,00"></div>')}</div><div class="form-grid two">${field('Responsável pelo fechamento',`<select id="nCloser">${closerNames.map(u=>`<option ${u===data.onDuty?'selected':''}>${esc(u)}</option>`).join('')}</select>`)}${field('Primeira cobrança','<select id="nHalf"><option value="0">Diária inteira</option><option value="1">½ diária</option></select><small id="lateHint"></small>')}</div>${field('Observação','<textarea id="nNote" rows="2" placeholder="Opcional"></textarea>')}</div><div class="summary-box"><div><span>Diária aplicada</span><strong id="nApplied">R$ 7.000,00</strong></div><div><span>Primeiro lançamento</span><strong id="nFirst">R$ 7.000,00</strong></div><div><span>Desconto por diária</span><strong id="nDiscount">R$ 0,00</strong></div></div><div id="nRetroPreview"></div><div id="nError"></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-close2>Cancelar</button><button type="submit" class="btn btn-primary">✓ Confirmar internação</button></div></form>`);
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
  openModal('Estornar lançamento','O valor será retirado da conta. O registro original ficará na auditoria.',`
    <div class="form">
      <div class="settle-table-wrap"><table class="settle-table"><thead><tr><th>Data/hora</th><th>Lançamento</th><th>Valor</th><th></th></tr></thead><tbody>
      ${rows.map(x=>`<tr><td>${fmtDT(x.at)}</td><td>${esc(x.label)}</td><td>${money(x.amount)}</td><td><button class="btn btn-secondary" data-correct-type="${x.type}" data-correct-id="${x.id}">Estornar</button></td></tr>`).join('')}
      </tbody></table></div>
      <div class="form-warning">⚠ Use apenas para corrigir lançamento feito incorretamente. O motivo é obrigatório e ficará registrado.</div>
      <div class="modal-actions"><button class="btn btn-secondary" data-close2>Fechar</button></div>
    </div>`);
  document.querySelector('[data-close2]').onclick=closeModal;
  document.querySelectorAll('[data-correct-id]').forEach(btn=>btn.onclick=async()=>{
    if(remoteBusy)return;
    const reason=prompt('Informe o motivo do estorno:')?.trim();
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
async function authFetch(path,body){
  const res=await fetch(`${SUPABASE_URL}/auth/v1/${path}`,{method:'POST',headers:{'apikey':SUPABASE_KEY,'Content-Type':'application/json'},body:JSON.stringify(body)});
  return parseResponse(res)
}
async function authApi(path,{method='GET',body}={}){
  if(!authState?.access_token)throw new Error('Sessão ausente.');
  const res=await fetch(`${SUPABASE_URL}/auth/v1/${path}`,{method,headers:authHeaders(authState.access_token),body:body===undefined?undefined:JSON.stringify(body)});
  return parseResponse(res)
}
function touchActivity(){
  const now=Date.now();
  try{localStorage.setItem(ACTIVITY_STORAGE_KEY,String(now))}catch{}
}
function lastActivity(){
  try{return Number(localStorage.getItem(ACTIVITY_STORAGE_KEY)||0)}catch{return 0}
}
function sessionIdle(){
  const last=lastActivity();
  return last>0&&isIdle(last,Date.now(),IDLE_TIMEOUT_MS)
}
function startIdleGuard(){
  if(idleGuardStarted)return;
  idleGuardStarted=true;
  let lastWrite=0;
  const activity=()=>{
    const now=Date.now();
    if(now-lastWrite<15000)return;
    lastWrite=now;touchActivity();
  };
  ['pointerdown','keydown','touchstart','scroll'].forEach(evt=>window.addEventListener(evt,activity,{passive:true}));
  setInterval(()=>{if(authState&&sessionIdle())expireIdleSession()},60000);
}
async function expireIdleSession(){
  if(!authState)return;
  const token=authState.access_token;
  storeAuth(null);data=blankData();renderAuth('Sua sessão foi encerrada após 20 minutos sem atividade.');
  try{await fetch(`${SUPABASE_URL}/auth/v1/logout`,{method:'POST',headers:authHeaders(token)})}catch{}
}
function storeAuth(session,{activity=true,preserveEpoch=false}={}){
  if(!preserveEpoch){authEpoch++;monthlyReportState={report:null,loading:false,error:'',revision:monthlyReportState.revision+1};}
  if(!session){passwordOnlyMode=false;state.page='home';state.selectedId=null;state.search='';state.patientFilter='active';state.financeTab='pending';}
  authState=session?normalizeSession(session):null;
  try{
    if(authState){localStorage.setItem(AUTH_STORAGE_KEY,JSON.stringify(authState));if(activity)touchActivity()}
    else{localStorage.removeItem(AUTH_STORAGE_KEY);localStorage.removeItem(ACTIVITY_STORAGE_KEY)}
  }catch{}
}
function restoreAuth(){try{return normalizeSession(JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY)||'null'))}catch{return null}}
async function refreshAuth(){
  if(!authState?.refresh_token)throw new Error('Sessão expirada. Entre novamente.');
  const epoch=authEpoch;
  if(refreshAuthInFlight?.epoch===epoch)return refreshAuthInFlight.promise;
  const token=authState.refresh_token;
  const promise=(async()=>{
    const next=await authFetch('token?grant_type=refresh_token',{refresh_token:token});
    if(!authState||epoch!==authEpoch)throw new Error('A sessão mudou durante a renovação.');
    storeAuth(next,{activity:false,preserveEpoch:true});return authState;
  })();
  refreshAuthInFlight={epoch,promise};
  try{return await promise}finally{if(refreshAuthInFlight?.promise===promise)refreshAuthInFlight=null}
}
async function ensureSession(){
  if(!authState)return false;
  if(sessionIdle()){await expireIdleSession();return false}
  const exp=Number(authState.expires_at||0)*1000;
  if(exp && Date.now()<exp-60000)return true;
  const epoch=authEpoch;
  try{await refreshAuth();return epoch===authEpoch&&!!authState}catch{if(epoch===authEpoch)storeAuth(null);return false}
}
async function rest(path,{method='GET',body,prefer,withCount=false}={}){
  if(!await ensureSession())throw new Error('Sessão expirada. Entre novamente.');
  const epoch=authEpoch;
  const preference=prefer||(withCount?'count=exact':null);
  const headers=authHeaders(authState.access_token,preference?{'Prefer':preference}:{});
  const res=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  if(epoch!==authEpoch)throw new Error('A sessão mudou durante a consulta.');
  if(res.status===401){storeAuth(null);throw new Error('Sessão expirada. Entre novamente.')}
  const parsed=await parseResponse(res);
  if(!withCount)return parsed;
  const range=res.headers.get('Content-Range')||'',total=/\/(\d+)$/.exec(range);
  return {rows:parsed,total:total?Number(total[1]):null};
}
async function rpc(name,args={}){return rest(`rpc/${name}`,{method:'POST',body:args,prefer:'return=representation'})}
async function restAll(path){
  const separator=path.includes('?')?'&':'?';
  const rows=[],pageSize=500;
  for(let offset=0;;){
    const result=await rest(`${path}${separator}limit=${pageSize}&offset=${offset}`,{withCount:true});
    const page=result.rows,total=result.total;
    if(!Array.isArray(page))throw new Error('Resposta de dados inválida.');
    rows.push(...page);
    if(total!==null&&rows.length>=total)return rows;
    if(total===null&&page.length<pageSize)return rows;
    if(!page.length)throw new Error('O histórico mudou durante a consulta. Atualize os dados.');
    offset+=page.length;
  }
}
async function edge(name,body={}){
  if(!await ensureSession())throw new Error('Sessão expirada. Entre novamente.');
  const res=await fetch(`${SUPABASE_URL}/functions/v1/${name}`,{method:'POST',headers:authHeaders(authState.access_token),body:JSON.stringify(body)});
  return parseResponse(res);
}
function setLoading(on,text='Sincronizando…'){
  remoteBusy=on;
  let el=document.getElementById('globalSync');
  if(!el){el=document.createElement('div');el.id='globalSync';el.className='global-sync';document.body.appendChild(el)}
  el.textContent=text;el.classList.toggle('show',on);
}
async function withRemote(work,success){if(remoteBusy)return;try{setLoading(true);const r=await work();if(success)toast(success);return r}catch(e){alert(e.message||'Não foi possível concluir a operação.');throw e}finally{setLoading(false)}}

async function currentAuthUser(){
  if(!await ensureSession())return null;
  const epoch=authEpoch;
  const user=await authApi('user');
  if(epoch!==authEpoch||!authState)throw new Error('A sessão mudou durante a validação.');
  if(user&&authState&&!authState.user){authState={...authState,user};storeAuth(authState,{activity:false,preserveEpoch:true})}
  return user;
}
function verifiedTotpFactors(user){return (user?.factors||[]).filter(f=>f.factor_type==='totp'&&f.status==='verified')}
function unverifiedTotpFactors(user){return (user?.factors||[]).filter(f=>f.factor_type==='totp'&&f.status!=='verified')}
async function cleanupUnverifiedFactors(){
  const user=await currentAuthUser();
  for(const factor of unverifiedTotpFactors(user)){
    try{await authApi(`factors/${encodeURIComponent(factor.id)}`,{method:'DELETE'})}catch{}
  }
}
async function verifyMfaCode(factorId,code){
  const challenge=await authApi(`factors/${encodeURIComponent(factorId)}/challenge`,{method:'POST',body:{}});
  const verified=await authApi(`factors/${encodeURIComponent(factorId)}/verify`,{method:'POST',body:{challenge_id:challenge.id,code}});
  if(verified?.access_token)storeAuth({...authState,...verified});
  else await refreshAuth();
  if(jwtAal(authState?.access_token)!=='aal2')throw new Error('Não foi possível elevar a segurança da sessão.');
}
async function renderMfaChallenge(user){
  const factor=verifiedTotpFactors(user)[0];
  if(!factor){await renderMfaEnrollment();return}
  authCard(`<div class="security-shield">◈</div><div class="auth-copy center"><span class="eyebrow">SEGUNDO FATOR</span><h1>Confirme seu acesso</h1><p>Digite o código de 6 dígitos do seu aplicativo autenticador.</p></div><form id="mfaChallengeForm" class="auth-form"><label class="field"><span class="field-label">Código do autenticador</span><input id="mfaCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="000000"></label><div id="mfaError"></div><button class="btn btn-primary auth-submit">Confirmar acesso</button><button id="mfaLogout" type="button" class="btn btn-secondary auth-submit">Sair</button></form>`);
  document.getElementById('mfaLogout').onclick=logoutRemote;
  document.getElementById('mfaChallengeForm').onsubmit=async e=>{
    e.preventDefault();const er=document.getElementById('mfaError');er.innerHTML='';
    try{setLoading(true,'Validando segundo fator…');await verifyMfaCode(factor.id,document.getElementById('mfaCode').value.trim());await loadRemote()}
    catch(ex){er.innerHTML=`<div class="form-error">⚠ ${esc(ex.message)}</div>`}finally{setLoading(false)}
  };
}
async function renderMfaEnrollment(){
  try{
    setLoading(true,'Preparando autenticação em dois fatores…');
    await cleanupUnverifiedFactors();
    const enrolled=await authApi('factors',{method:'POST',body:{factor_type:'totp',friendly_name:'IMEC UTI'}});
    const qr=totpQrImageSrc(enrolled?.totp?.qr_code),secret=enrolled?.totp?.secret||'';
    if(!enrolled?.id||!qr||!secret)throw new Error('A configuração do autenticador está incompleta. Tente novamente.');
    authCard(`<div class="security-shield">◈</div><div class="auth-copy center"><span class="eyebrow">PROTEÇÃO OBRIGATÓRIA</span><h1>Ative a autenticação em dois fatores</h1><p>Escaneie o QR Code com seu aplicativo autenticador. Se estiver no mesmo celular, abra a chave manual abaixo e cadastre-a no aplicativo.</p></div><div class="mfa-qr"><img id="mfaQrImage" src="${esc(qr)}" alt="QR Code para autenticação em dois fatores"><p id="mfaQrFallback" class="form-error" hidden>Não foi possível exibir o QR Code. Use a chave manual abaixo.</p></div><div class="mfa-secret"><details><summary>Usar chave manual (alternativa ao QR Code)</summary><code>${esc(secret)}</code></details><small>Não compartilhe esta chave nem envie capturas dela.</small></div><form id="mfaEnrollForm" class="auth-form"><label class="field"><span class="field-label">Código de 6 dígitos</span><input id="mfaEnrollCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="000000"></label><div id="mfaEnrollError"></div><button class="btn btn-primary auth-submit">Ativar e continuar</button><button id="mfaEnrollLogout" type="button" class="btn btn-secondary auth-submit">Sair</button></form>`);
    const qrImage=document.getElementById('mfaQrImage');
    qrImage.addEventListener('error',()=>{
      qrImage.hidden=true;
      document.getElementById('mfaQrFallback').hidden=false;
    });
    document.getElementById('mfaEnrollLogout').onclick=logoutRemote;
    document.getElementById('mfaEnrollForm').onsubmit=async e=>{
      e.preventDefault();const er=document.getElementById('mfaEnrollError');er.innerHTML='';
      try{
        setLoading(true,'Ativando proteção…');
        await verifyMfaCode(enrolled.id,document.getElementById('mfaEnrollCode').value.trim());
        try{await rpc('mark_uti_security_onboarding_complete',{})}catch{}
        await loadRemote();
      }catch(ex){er.innerHTML=`<div class="form-error">⚠ ${esc(ex.message)}</div>`}finally{setLoading(false)}
    };
  }catch(ex){renderAccountState('Não foi possível preparar o segundo fator.',ex.message||'Tente novamente.')}
  finally{setLoading(false)}
}
async function securityGate(){
  const epoch=authEpoch;
  if(!await ensureSession()){
    if(epoch!==authEpoch&&authState)return false;
    // A stale localStorage token must never leave an empty app shell.
    data=blankData();
    if(!document.getElementById('loginForm'))renderAuth('Sua sessão expirou. Entre novamente.');
    return false;
  }
  let user;
  try{user=await currentAuthUser()}
  catch(ex){
    if(epoch!==authEpoch)return false;
    const message=String(ex?.message||'');
    if(/session not found|sessão.*(inválida|expirada)|invalid (jwt|token)|token.*expir|401|403|unauthorized/i.test(message)){
      storeAuth(null);data=blankData();renderAuth('Sua sessão não é mais válida. Entre novamente.');
    }else renderAccountState('Não foi possível validar o acesso.',message||'Verifique sua conexão e tente novamente.');
    return false;
  }
  if(epoch!==authEpoch)return false;
  if(!user){storeAuth(null);data=blankData();renderAuth('Entre novamente para continuar.');return false}
  if(jwtAal(authState.access_token)==='aal2'){passwordOnlyMode=false;return true}
  // AAL1 is accepted only when the authenticated backend policy has MFA disabled.
  // The settings SELECT remains RLS-protected by active membership and session checks.
  passwordOnlyMode=false;
  try{
    const policy=await rest('app_settings?id=eq.1&select=mfa_required');
    if(policy?.[0]?.mfa_required===false){passwordOnlyMode=true;return true}
    if(!policy?.length){
      const own=await rest(`profiles?id=eq.${encodeURIComponent(user.id)}&select=id,display_name,email,role,active`);
      if(epoch!==authEpoch||!authState)return false;
      if(own?.[0]?.active===false){data=blankData();renderPending(own[0]);return false}
    }
  }catch(error){
    if(epoch!==authEpoch)return false;
    renderAccountState('Não foi possível confirmar o acesso.','Verifique a conexão e tente novamente.');
    return false;
  }

  const factors=verifiedTotpFactors(user);
  if(factors.length){await renderMfaChallenge(user);return false}
  await renderMfaEnrollment();return false;
}
async function checkPasswordSafety(password){
  const policy=passwordPolicy(password);
  if(!policy.ok)throw new Error(policy.message);
  const hash=await sha1Hex(password);
  const result=await edge('password-pwned-range',{prefix:hash.slice(0,5)});
  if(result?.ok!==true||typeof result.range!=='string'||!result.range.trim())throw new Error('Não foi possível verificar a segurança da senha. Tente novamente.');
  const count=pwnedCountFromRange(result.range,hash);
  if(count>0)throw new Error('Esta senha aparece em vazamentos conhecidos. Escolha uma senha diferente.');
  return true;
}

function mapRemote({patients,admissions,rates,charges,payments,scheduledReceipts,refunds,audits,settings,profiles,closers,profile,healthHistory,alerts}){
  const rateMap={};(rates||[]).forEach(r=>(rateMap[r.admission_id]??=[]).push({id:r.id,effectiveAt:r.effective_at,standardRate:Number(r.standard_rate),negotiatedRate:Number(r.negotiated_rate),ventilation:r.ventilation??undefined,label:r.label,changedBy:r.changed_by_name}));
  teamProfiles=profiles||[];
  teamClosers=closers||[];
  return {
    patients:(patients||[]).map(p=>({id:p.id,name:p.name,cpf:p.cpf||undefined,createdAt:p.created_at})),
    admissions:(admissions||[]).map(a=>({id:a.id,patientId:a.patient_id,bed:a.bed,mode:a.mode,entryAt:a.entry_at,dischargeAt:a.discharge_at||undefined,status:a.status,closerId:a.closer_id||undefined,closer:a.closer_name,createdBy:a.created_by_name,halfInitial:a.half_initial,commissionAmount:Number(a.commission_amount||0),accountVersion:Number(a.account_version||1),notes:a.notes||undefined,createdAt:a.created_at,rateHistory:rateMap[a.id]||[]})),
    charges:(charges||[]).map(c=>({id:c.id,admissionId:c.admission_id,occurredAt:c.occurred_at,kind:c.kind,category:c.category,description:c.description,amount:Number(c.amount),cycleKey:c.cycle_key||undefined,createdBy:c.created_by_name})),
    payments:(payments||[]).map(p=>({id:p.id,admissionId:p.admission_id,occurredAt:p.occurred_at,amount:Number(p.amount),method:p.method,cardType:p.card_type,installmentDates:p.installment_dates,notes:p.notes||undefined,createdBy:p.created_by_name})),
    scheduledReceipts:(scheduledReceipts||[]).map(p=>({id:p.id,admissionId:p.admission_id,expectedAt:p.expected_at,amount:Number(p.amount),method:p.method,installmentDates:p.installment_dates||[],notes:p.notes||'',status:p.status,createdBy:p.created_by_name})),
    refunds:(refunds||[]).map(r=>({id:r.id,admissionId:r.admission_id,occurredAt:r.occurred_at,amount:Number(r.amount),method:r.method,notes:r.notes||undefined,createdBy:r.created_by_name})),
    audits:(audits||[]).map(a=>({id:a.id,admissionId:a.admission_id||undefined,occurredAt:a.occurred_at,user:a.user_name,action:a.action,detail:a.detail})),
    health:healthHistory?.[0]?{id:healthHistory[0].id,checkedAt:healthHistory[0].checked_at,status:healthHistory[0].status,issues:healthHistory[0].issues||[],metrics:healthHistory[0].metrics||{},source:healthHistory[0].source}:null,
    healthHistory:(healthHistory||[]).map(h=>({id:h.id,checkedAt:h.checked_at,status:h.status,issues:h.issues||[],metrics:h.metrics||{},source:h.source})),
    alerts:(alerts||[]).map(a=>({id:a.id,alertKey:a.alert_key,code:a.code,severity:a.severity,message:a.message,details:a.details||{},status:a.status,firstDetectedAt:a.first_detected_at,lastDetectedAt:a.last_detected_at,occurrenceCount:Number(a.occurrence_count||1),healthCheckId:a.health_check_id||null,acknowledgedAt:a.acknowledged_at||null,acknowledgedByName:a.acknowledged_by_name||null,resolvedAt:a.resolved_at||null})),
    currentUser:profile.display_name,currentRole:profile.role,onDuty:settings?.on_duty_name||'Samuel',securityAal:jwtAal(authState?.access_token),seededDemo:false
  }
}
async function loadRemote({quiet=false}={}){
  const epoch=authEpoch;
  if(!await securityGate())return false;
  if(epoch!==authEpoch||!authState)return false;
  const uid=authState.user?.id;
  if(!uid){storeAuth(null);renderAuth();return false}
  try{
    const own=await rest(`profiles?id=eq.${encodeURIComponent(uid)}&select=id,display_name,email,role,active,security_onboarding_completed_at`);
    const profile=own?.[0];
    if(!profile){renderAccountState('Seu perfil ainda está sendo preparado.','Tente novamente em alguns segundos.');return false}
    if(!profile.active){data=blankData();data.currentUser=profile.display_name;data.currentRole=profile.role;renderPending(profile);return false}
    try{await rpc('sync_uti_charges',{})}catch(e){console.warn('sync daily charges',e)}
    const [patients,admissions,rates,charges,payments,scheduledReceipts,refunds,audits,settingsRows,profiles,closers,healthHistory,alerts]=await Promise.all([
      restAll('patients?select=*&order=created_at.asc,id.asc'),
      restAll('admissions?select=*&order=entry_at.desc,id.asc'),
      restAll('rate_periods?select=*&order=effective_at.asc,id.asc'),
      restAll('charges?cancelled_at=is.null&select=*&order=occurred_at.asc,id.asc'),
      restAll('payments?cancelled_at=is.null&select=*&order=occurred_at.asc,id.asc'),
      restAll('scheduled_receipts?status=eq.pending&select=*&order=expected_at.asc,id.asc'),
      restAll('refunds?cancelled_at=is.null&select=*&order=occurred_at.asc,id.asc'),
      restAll('audits?select=*&order=occurred_at.asc,id.asc'),
      rest('app_settings?id=eq.1&select=*'),
      rest('profiles?select=id,display_name,email,role,active,created_at,security_onboarding_completed_at&order=created_at.asc'),
      rest('commercial_closers?active=eq.true&select=id,code,display_name,commission_amount,active&order=display_name.asc'),
      profile.role==='admin'?rest('system_health_checks?select=id,checked_at,status,issues,metrics,source&order=checked_at.desc&limit=96'):Promise.resolve([]),
      profile.role==='admin'?rest('system_alerts?select=id,alert_key,code,severity,message,details,status,first_detected_at,last_detected_at,occurrence_count,health_check_id,acknowledged_at,acknowledged_by_name,resolved_at&order=last_detected_at.desc&limit=50'):Promise.resolve([])
    ]);
    if(epoch!==authEpoch||!authState)return false;
    data=mapRemote({patients,admissions,rates,charges,payments,scheduledReceipts,refunds,audits,settings:settingsRows?.[0],profiles,closers,profile,healthHistory,alerts});
    if(!quiet)render();
    return true;
  }catch(e){
    if(epoch!==authEpoch)return false;
    const msg=String(e.message||'');
    if(msg.toLowerCase().includes('sessão')){storeAuth(null);renderAuth();return false}
    if(msg.toLowerCase().includes('mfa')||msg.toLowerCase().includes('segundo fator')){await securityGate();return false}
    renderAccountState('Não foi possível carregar os dados.',msg||'Verifique a conexão e tente novamente.');return false
  }
}
function authCard(inner){
  document.getElementById('app').innerHTML=`<main class="auth-shell"><div class="auth-layout"><aside class="auth-intro"><div class="auth-intro-mark">${icon('activity')}</div><span class="eyebrow">IMEC UTI</span><h2>Clareza para<br>cada decisão.</h2><p>Internações, recebimentos e acertos.<br>Uma visão organizada da operação.</p><div class="auth-intro-footer">Particular & Hotelaria ${icon('arrowRight')}</div></aside><section class="auth-card"><div class="auth-logo"><div class="brand-mark">${icon('activity')}</div><div><strong>IMEC UTI</strong><span>Particular & Hotelaria</span></div></div>${inner}</section></div><span class="auth-workspace-foot">IMEC UTI · Gestão de internações</span></main>`;
  polishIcons(document.getElementById('app'));
  bindPasswordVisibility(document.getElementById('app'));
}
function passwordInput(id,autocomplete,placeholder,label='Senha'){
 return `<div class="field"><label class="field-label" for="${id}">${label}</label><div class="password-control"><input id="${id}" type="password" autocomplete="${autocomplete}" required placeholder="${placeholder}"><button type="button" data-password-target="${id}" aria-label="Mostrar senha" aria-pressed="false">Mostrar</button></div></div>`;
}
function bindPasswordVisibility(root){
 if(!root?.querySelectorAll)return;
 root.querySelectorAll('[data-password-target]').forEach(b=>b.onclick=()=>{
   const input=document.getElementById(b.dataset.passwordTarget);if(!input)return;
   const show=input.type==='password';input.type=show?'text':'password';b.textContent=show?'Ocultar':'Mostrar';b.setAttribute('aria-label',show?'Ocultar senha':'Mostrar senha');b.setAttribute('aria-pressed',String(show));
 });
}
function renderAuth(message=''){
  const msg=message?`<div class="auth-message">${esc(message)}</div>`:'';
  authCard(`${msg}<div class="auth-copy"><span class="eyebrow">ACESSO INTERNO</span><h1>Controle financeiro da UTI</h1><p>Entre com seu e-mail e senha.</p></div><form id="loginForm" class="auth-form"><label class="field"><span class="field-label">E-mail</span><input id="loginEmail" type="email" autocomplete="username" autocapitalize="none" spellcheck="false" required placeholder="seu@email.com"></label>${passwordInput('loginPassword','current-password','Sua senha')}<div id="authError" role="alert"></div><button class="btn btn-primary auth-submit" type="submit">Entrar</button><button class="auth-link" id="forgotPasswordBtn" type="button">Esqueci minha senha</button></form><p class="auth-foot">Use seu acesso individual. No primeiro acesso, abra o convite enviado pelo administrador.</p>`);
  document.getElementById('forgotPasswordBtn').onclick=renderForgotPassword;
  document.getElementById('loginForm').addEventListener('input',()=>document.getElementById('authError').innerHTML='');
  document.getElementById('loginForm').onsubmit=async e=>{e.preventDefault();if(remoteBusy)return;const error=document.getElementById('authError');error.innerHTML='';try{setLoading(true,'Entrando…');const s=await authFetch('token?grant_type=password',{email:document.getElementById('loginEmail').value.trim().toLowerCase(),password:document.getElementById('loginPassword').value});storeAuth(s);await loadRemote()}catch(x){const message=/invalid login credentials/i.test(x.message)?'E-mail ou senha incorretos. Confira os dados e tente novamente.':x.message;error.innerHTML=`<div class="form-error">${esc(message)}</div>`}finally{setLoading(false)}};
}
function renderForgotPassword(){
  authCard(`<div class="auth-copy"><span class="eyebrow">RECUPERAÇÃO SEGURA</span><h1>Recuperar senha</h1><p>Informe seu e-mail. Se ele estiver cadastrado, você receberá um link de recuperação.</p></div><form id="recoverForm" class="auth-form"><label class="field"><span class="field-label">E-mail</span><input id="recoverEmail" type="email" autocomplete="email" required></label><div id="recoverMessage"></div><button type="submit" class="btn btn-primary auth-submit">Enviar link</button><button id="recoverBack" type="button" class="btn btn-secondary auth-submit">Voltar</button></form>`);
  document.getElementById('recoverBack').onclick=()=>renderAuth();
  document.getElementById('recoverForm').onsubmit=async e=>{
    e.preventDefault();const box=document.getElementById('recoverMessage');
    if(remoteBusy)return;
    try{setLoading(true,'Enviando recuperação…');await authFetch(`recover?redirect_to=${encodeURIComponent(APP_URL)}`,{email:document.getElementById('recoverEmail').value.trim().toLowerCase()});box.innerHTML='<div class="auth-message">Se o e-mail estiver cadastrado, você receberá um link de recuperação. Confira também o spam.</div>'}
    catch{box.innerHTML='<div class="form-error" role="alert">Não foi possível solicitar a recuperação agora. Tente novamente; se persistir, fale com o administrador.</div>'}
    finally{setLoading(false)}
  };
}
function renderPending(profile){
  authCard(`<div class="pending-icon">⌛</div><div class="auth-copy center"><span class="eyebrow">ACESSO PENDENTE</span><h1>Olá, ${esc(profile.display_name)}</h1><p>Seu acesso está protegido, mas ainda precisa ser liberado por um administrador da UTI.</p></div><div class="pending-email">${esc(profile.email||'')}</div><button id="retryPending" class="btn btn-primary auth-submit">Verificar liberação</button><button id="logoutPending" class="btn btn-secondary auth-submit">Sair</button>`);
  document.getElementById('retryPending').onclick=()=>withRemote(()=>loadRemote(),null);
  document.getElementById('logoutPending').onclick=logoutRemote;
}
function renderAccountState(title,detail){authCard(`<div class="pending-icon">!</div><div class="auth-copy center"><h1>${esc(title)}</h1><p>${esc(detail)}</p></div><button id="retryState" class="btn btn-primary auth-submit">Tentar novamente</button><button id="logoutState" class="btn btn-secondary auth-submit">Sair</button>`);document.getElementById('retryState').onclick=()=>loadRemote();document.getElementById('logoutState').onclick=logoutRemote}
async function logoutRemote(){
  const token=authState?.access_token;
  storeAuth(null);data=blankData();renderAuth();
  try{if(token)await fetch(`${SUPABASE_URL}/auth/v1/logout`,{method:'POST',headers:authHeaders(token)})}catch{}
}

async function inviteUserModal(){
  if(data.currentRole!=='admin'){toast('Somente administradores podem convidar usuários.');return}
  const epoch=authEpoch;
  openModal('Adicionar usuário','Libere o acesso uma vez. Depois, a pessoa entra com e-mail e senha.',`<form class="form" id="inviteForm">${field('Nome','<input id="inviteName" autocomplete="off" maxlength="120" required placeholder="Nome do usuário">')}<div class="form-grid two">${field('E-mail','<input id="inviteEmail" type="email" autocomplete="off" maxlength="254" required placeholder="usuario@empresa.com">')}${field('Perfil','<select id="inviteRole"><option value="referral">Indicação e consulta</option><option value="operator">Operacional</option><option value="commercial">Comercial</option><option value="admin">Administrador</option></select>')}</div><p id="invitePermissionHint" class="receipt-timing-note"></p>${field('Primeiro acesso','<select id="inviteDelivery"><option value="link">Gerar link de primeiro acesso</option><option value="email">Enviar convite por e-mail</option></select>')}<p class="receipt-timing-note">A pessoa define a própria senha. Não é necessário liberar a conta novamente.</p><div id="inviteError" role="alert"></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-close2>Cancelar</button><button type="submit" class="btn btn-primary">Criar acesso</button></div></form>`);
  document.querySelector('[data-close2]').onclick=closeModal;
  const role=document.getElementById('inviteRole'),hint=document.getElementById('invitePermissionHint');
  const describe=()=>hint.textContent=role.value==='referral'?'Cadastra indicações, acompanha pacientes e consulta relatórios. Não registra pagamentos nem dá altas.':role.value==='admin'?'Gerencia acessos, recebimentos, correções e altas.':'Acesso operacional conforme o perfil. Altas são exclusivas do administrador.';
  role.onchange=describe;describe();
  document.getElementById('inviteForm').onsubmit=async e=>{
    e.preventDefault();if(remoteBusy)return;
    const er=document.getElementById('inviteError');er.innerHTML='';
    try{
      setLoading(true,'Criando acesso…');
      const result=await edge('invite-uti-user',{display_name:document.getElementById('inviteName').value.trim(),email:document.getElementById('inviteEmail').value.trim(),role:role.value,delivery:document.getElementById('inviteDelivery').value});
      if(epoch!==authEpoch)return;
      if(!result?.ok||result.activated!==true)throw new Error(result?.error||'A liberação não foi confirmada. Confira o usuário na equipe.');
      if(result.delivery==='link'){
        let url;try{url=new URL(result.action_link)}catch{throw new Error('O serviço não retornou um link válido.')}
        if(url.origin!==new URL(SUPABASE_URL).origin||url.pathname!=='/auth/v1/verify'||url.searchParams.get('type')!=='invite')throw new Error('O serviço não retornou um link válido.');
        // Credential stays in this dialog only: no storage, app data or audit payload.
        openModal('Acesso liberado',result.email,`<div class="form"><p>Compartilhe este link somente com a pessoa convidada. Ela define a senha e já pode entrar.</p><label class="field"><span class="field-label">Link de primeiro acesso</span><input id="invitationLink" type="text" readonly autocomplete="off" spellcheck="false" value="${esc(url.href)}"></label><div id="invitationCopyMessage" role="status"></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-invite-done>Fechar</button><button type="button" class="btn btn-primary" id="copyInvitationLink">Copiar link</button></div></div>`);
        document.querySelector('[data-invite-done]').onclick=()=>{closeModal();loadRemote()};
        document.getElementById('copyInvitationLink').onclick=async()=>{
          const msg=document.getElementById('invitationCopyMessage');
          try{await navigator.clipboard.writeText(document.getElementById('invitationLink').value);msg.textContent='Link copiado.'}catch{document.getElementById('invitationLink').select();msg.textContent='Selecione e copie o link acima.'}
        };
      }else{await loadRemote({quiet:true});if(epoch!==authEpoch)return;closeModal();toast('Acesso liberado. Convite enviado para '+result.email+'.');render()}
    }catch(ex){if(epoch===authEpoch)er.innerHTML=`<div class="form-error">${esc(ex.message)}</div>`}finally{setLoading(false)}
  };
}

async function passwordEditor({title='Definir nova senha',subtitle='Use uma senha exclusiva para este sistema.',afterSave,inline=false}={}){
  const epoch=authEpoch;
  const form=`<form class="${inline?'auth-form':'form'}" id="passwordForm">${passwordInput('newPassword','new-password','Mínimo 12 caracteres','Nova senha')}${passwordInput('confirmPassword','new-password','Repita a nova senha','Confirmar senha')}<p class="receipt-timing-note">Use pelo menos 12 caracteres, com maiúsculas, minúsculas, números e símbolos.</p><div id="passwordError" role="alert"></div><div class="${inline?'auth-password-actions':'modal-actions'}"><button type="button" class="btn btn-secondary" data-close2>Cancelar</button><button type="submit" class="btn btn-primary">${inline?'Salvar e entrar':'Salvar senha'}</button></div></form>`;
  if(inline)authCard(`<div class="auth-copy"><span class="eyebrow">SEU ACESSO</span><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>${form}`);
  else openModal(title,subtitle,form);
  bindPasswordVisibility(document.getElementById(inline?'app':'modal'));
  document.querySelector('[data-close2]').onclick=inline?logoutRemote:closeModal;
  document.getElementById('passwordForm').onsubmit=async e=>{
    e.preventDefault();if(remoteBusy)return;const a=document.getElementById('newPassword').value,b=document.getElementById('confirmPassword').value,er=document.getElementById('passwordError');er.innerHTML='';
    if(a!==b){er.innerHTML='<div class="form-error">⚠ As senhas não coincidem.</div>';return}
    try{
      setLoading(true,'Validando senha…');await checkPasswordSafety(a);
      if(epoch!==authEpoch||!authState)return;
      const res=await fetch(`${SUPABASE_URL}/auth/v1/user`,{method:'PUT',headers:authHeaders(authState.access_token),body:JSON.stringify({password:a})});await parseResponse(res);
      if(epoch!==authEpoch)return;
      if(!inline)closeModal();toast('Senha atualizada com segurança.');
      if(afterSave)await afterSave();
    }catch(ex){if(epoch===authEpoch)er.innerHTML=`<div class="form-error">${esc(ex.message)}</div>`}finally{setLoading(false)}
  };
}
async function changePasswordModal(){return passwordEditor({title:'Alterar senha',subtitle:'A senha nova será validada contra vazamentos conhecidos.'})}
async function renderCallbackPassword(type){
  return passwordEditor({title:type==='recovery'?'Crie sua nova senha':'Crie sua senha',subtitle:'Defina sua senha uma vez. Depois, entre com e-mail e senha.',inline:true,afterSave:async()=>{await loadRemote()}});
}
async function boot(){
  startIdleGuard();
  const callback=parseAuthRedirect(window.location.href);
  if(callback.error){storeAuth(null);history.replaceState({},document.title,cleanAuthRedirectUrl(window.location.href));renderAuth(callback.error);return}
  if(callback.session){
    storeAuth(callback.session);
    try{
      const user=await authApi('user');authState={...authState,user};storeAuth(authState);
    }catch{}
    history.replaceState({},document.title,cleanAuthRedirectUrl(window.location.href));
    if(callback.type==='invite'||callback.type==='recovery'){await renderCallbackPassword(callback.type);return}
  }else authState=restoreAuth();
  if(!authState){renderAuth();return}
  setLoading(true);try{await loadRemote()}finally{setLoading(false)}
}

function can(permission){return data?.currentRole==='admin'||!!ROLE_PERMISSIONS[data?.currentRole]?.has(permission)}
function observabilityPanel(){
  if(data.currentRole!=='admin')return '';
  const alerts=data.alerts||[],unresolved=alerts.filter(a=>a.status!=='resolved'),open=unresolved.filter(a=>a.status==='open'),critical=unresolved.filter(a=>a.severity==='critical');
  const summary=healthWindowSummary(data.healthHistory||[]);
  const audit24=(data.audits||[]).filter(a=>Date.now()-new Date(a.occurredAt).getTime()<=86400000);
  const alertRows=[...unresolved,...alerts.filter(a=>a.status==='resolved').slice(0,6)].slice(0,12);
  const alertsMarkup=alertRows.length?alertRows.map(a=>{
    const meta=alertStatusMeta(a.severity,a.status);
    return `<div class="obs-alert-row ${a.severity} ${a.status}">
      <div class="obs-alert-mark">${a.severity==='critical'?'!':'△'}</div>
      <div class="obs-alert-copy"><div><strong>${esc(a.message)}</strong><span class="badge badge-${meta.tone}">${meta.label}</span></div><small>${esc(a.code)} • última detecção ${fmtDT(a.lastDetectedAt)} • ${a.occurrenceCount} ocorrência(s)${a.acknowledgedByName?' • reconhecido por '+esc(a.acknowledgedByName):''}</small></div>
      ${a.status==='open'? `<button class="btn btn-secondary obs-ack" data-ack-alert="${a.id}">Reconhecer</button>` : ''}
    </div>`;
  }).join(''):'<div class="health-empty">✓ Nenhum alerta operacional registrado.</div>';
  const auditRows=[...(data.audits||[])].sort((a,b)=>new Date(b.occurredAt)-new Date(a.occurredAt)).slice(0,8);
  const auditMarkup=auditRows.length?auditRows.map(a=>`<div class="obs-audit-row"><span class="obs-audit-dot"></span><div><strong>${esc(a.action)}</strong><small>${fmtDT(a.occurredAt)} • ${esc(a.user||'Sistema')}</small><p>${esc(a.detail||'')}</p></div></div>`).join(''):'<div class="empty-state">Nenhum evento auditado.</div>';
  return `<section class="panel observability-panel"><div class="panel-head"><div><h2>Central de observabilidade</h2><p>Alertas acionáveis, histórico de saúde e auditoria gerencial.</p></div><span class="badge ${critical.length?'badge-bad':open.length?'badge-warn':'badge-good'}">${unresolved.length?unresolved.length+' ativo(s)':'Sem alertas'}</span></div>
    <div class="obs-kpis">
      <div><span>Alertas ativos</span><strong>${unresolved.length}</strong><small>${open.length} aguardando reconhecimento</small></div>
      <div><span>Críticos</span><strong>${critical.length}</strong><small>${critical.filter(a=>a.status==='open').length} requerem ação</small></div>
      <div><span>Saúde observada</span><strong>${summary.total?summary.healthyPct.toLocaleString('pt-BR',{maximumFractionDigits:1})+'%':'—'}</strong><small>${summary.total} checagens recentes</small></div>
      <div><span>Auditoria 24h</span><strong>${audit24.length}</strong><small>ações e eventos registrados</small></div>
    </div>
    <div class="obs-grid">
      <div><div class="obs-section-head"><strong>Alertas</strong><span>abertos, reconhecidos e recuperados</span></div><div class="obs-alert-list">${alertsMarkup}</div></div>
      <div><div class="obs-section-head"><strong>Trilha gerencial</strong><span>últimos eventos auditados</span></div><div class="obs-audit-list">${auditMarkup}</div></div>
    </div>
  </section>`;
}
function operationalHealthPanel(){
  if(data.currentRole!=='admin')return '';
  const h=data.health,meta=healthStatusMeta(h?.status,h?.checkedAt),metrics=h?.metrics||{},issues=Array.isArray(h?.issues)?h.issues:[];
  const inconsistencyCount=Number(metrics.duplicate_active_beds||0)+Number(metrics.duplicate_charge_cycles||0)+Number(metrics.missing_rates||0)+Number(metrics.state_mismatches||0);
  const issueMarkup=issues.length?issues.map(i=>`<div class="health-issue ${i.severity==='critical'?'critical':'warn'}"><span>${i.severity==='critical'?'!':'△'}</span><div><strong>${esc(i.message||i.code||'Alerta operacional')}</strong><small>${i.count?esc(i.count)+' ocorrência(s)':''}</small></div></div>`).join(''):'<div class="health-empty">✓ Nenhuma inconsistência operacional detectada.</div>';
  return `<section class="panel health-panel"><div class="panel-head"><div><h2>Saúde operacional</h2><p>Monitor automático de integridade, faturamento e controles críticos.</p></div><span class="badge badge-${meta.tone}">${meta.label}</span></div>
    <div class="health-kpis">
      <div><span>Última verificação</span><strong>${h?.checkedAt?fmtDT(h.checkedAt):'Sem registro'}</strong><small>Automática a cada 15 min</small></div>
      <div><span>Faturamento automático</span><strong>${metrics.billing_job_active?'Ativo':'Verificar'}</strong><small>${metrics.billing_last_success?'Último sucesso '+fmtDT(metrics.billing_last_success):'Sem execução registrada'}</small></div>
      <div><span>Admins ativos</span><strong>${Number(metrics.active_admins||0)}</strong><small>MFA server-side: ${metrics.mfa_required?'ativo':'inativo'}</small></div>
      <div><span>Inconsistências</span><strong>${inconsistencyCount}</strong><small>${Number(metrics.active_admissions||0)} conta(s) aberta(s)</small></div>
    </div>
    <div class="health-issues">${issueMarkup}</div>
    ${meta.stale?'<div class="health-stale">O monitor não registra uma checagem recente. Atualize a tela e investigue o cron.</div>':''}
  </section>`;
}
function settingsPage(){
  const members=teamProfiles.map(p=>`<div class="member-row"><div class="member-ident"><div class="avatar small">${esc((p.display_name||'?')[0])}</div><div><strong>${esc(p.display_name)}</strong><span>${esc(p.email||'Sem e-mail')}</span></div></div><div class="member-controls">${data.currentRole==='admin'?`<select data-member-role="${p.id}"><option value="referral" ${p.role==='referral'?'selected':''}>Indicação e consulta</option><option value="operator" ${p.role==='operator'?'selected':''}>Operacional</option><option value="commercial" ${p.role==='commercial'?'selected':''}>Comercial</option><option value="admin" ${p.role==='admin'?'selected':''}>Administrador</option></select><label class="switch-label"><input type="checkbox" data-member-active="${p.id}" ${p.active?'checked':''}> <span>${p.active?'Ativo':'Pendente'}</span></label><button class="btn btn-secondary" data-save-member="${p.id}">Salvar</button>`:`<span class="badge ${p.active?'badge-good':'badge-warn'}">${p.active?'Ativo':'Pendente'}</span><span class="badge badge-neutral">${roleLabel(p.role)}</span>`}</div></div>`).join('');
  return `<section class="page-head"><div><span class="eyebrow">CONFIGURAÇÕES</span><h1>Operação e acessos</h1><p>Banco central da UTI, usuários individuais e auditoria compartilhada.</p></div><button class="btn btn-secondary" id="manualRefresh">↻ Atualizar</button></section><div class="settings-grid"><section class="panel"><div class="panel-head"><div><h2>Operação</h2><p>Escala comercial e identificação do usuário conectado.</p></div></div><div class="settings-fields"><label class="field"><span class="field-label">Usuário conectado</span><div class="read-value">${esc(data.currentUser)} • ${roleLabel(data.currentRole)}</div></label><label class="field"><span class="field-label">Plantão comercial atual</span><select id="onDuty">${['Samuel','Roberto'].map(u=>`<option ${u===data.onDuty?'selected':''}>${u}</option>`).join('')}</select></label></div></section><section class="panel"><div class="panel-head"><div><h2>Acessos da equipe</h2><p>${data.currentRole==='admin'?'Libere usuários e defina o perfil de acesso.':'Consulte quem possui acesso ao sistema.'}</p></div></div><div class="member-list">${members||'<div class="empty-state">Nenhum usuário cadastrado.</div>'}</div></section>${data.currentRole==='admin'?`<details class="settings-diagnostics"><summary>Saúde e histórico do sistema${unresolvedSystemAlerts().length?` · ${unresolvedSystemAlerts().length} alerta(s)`:''}</summary><div class="settings-diagnostics-content">${observabilityPanel()}${operationalHealthPanel()}</div></details>`:''}<section class="panel"><div class="panel-head"><div><h2>Dados e segurança</h2><p>Os dados estão no banco exclusivo IMEC UTI e sincronizam entre aparelhos.</p></div></div><div class="backup-actions">${data.currentRole==='admin'?'<button class="btn btn-secondary" id="inviteUserBtn">＋ Adicionar usuário</button><button class="btn btn-secondary" data-action="export">⇩ Exportar dados</button>':''}<button class="btn btn-secondary" id="changePasswordBtn">⌘ Alterar senha</button><button class="btn btn-secondary" id="logoutBtn">⇥ Sair da conta</button></div><div class="security-status"><div><strong>${passwordOnlyMode?'Acesso por e-mail e senha':'Acesso com segundo fator'}</strong><span>Expiração automática após 20 minutos sem atividade.</span></div><span class="badge badge-good">${passwordOnlyMode?'Sessão ativa':data.securityAal==='aal2'?'Protegido':'Verificar'}</span></div><div class="security-note"><span>◈</span><div><strong>Produção centralizada</strong><span>RLS ativo, auditoria por usuário, senha verificada contra vazamentos, trava de leito duplicado e diárias reconciliadas no servidor.</span></div></div></section></div>`
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

function paymentMethodSelect(id){
  return `<select id="${id}"><option>PIX</option><option value="credit">Cartão de crédito</option><option value="debit">Cartão de débito</option><option>Dinheiro</option><option>Transferência</option><option>Outro</option></select>`;
}
function cardDetailsMarkup(prefix){
  return `<div id="${prefix}Card" class="card-details" hidden>${field('Parcelas',`<select id="${prefix}Count">${Array.from({length:24},(_,i)=>`<option value="${i+1}">${i+1}x${i===0?' (à vista)':''}</option>`).join('')}</select>`)}<p class="field-hint">Informe os vencimentos acordados no cartão.</p><div id="${prefix}Dates" class="form-grid three"></div></div>`;
}
function bindCardDetails(prefix,methodId){
  const method=document.getElementById(methodId),box=document.getElementById(prefix+'Card'),count=document.getElementById(prefix+'Count'),dates=document.getElementById(prefix+'Dates');
  if(!method||!box)return;
  const update=()=>{
    box.hidden=method.value!=='credit';
    const previous=Array.from(dates.querySelectorAll('input')).map(x=>x.value);
    dates.innerHTML=Array.from({length:Number(count.value)},(_,i)=>field(`Vencimento ${i+1}ª`,`<input type="date" data-installment="${prefix}" aria-label="Vencimento da ${i+1}ª parcela" value="${esc(previous[i]||'')}">`)).join('');
  };
  method.addEventListener('change',update);count.addEventListener('change',update);update();
}
function receiptTimingMarkup(prefix){return `<div class="receipt-timing" id="${prefix}Timing" data-mode="received"><div class="segmented" role="group" aria-label="Situação do recebimento"><button type="button" data-receipt-mode="received" class="active" aria-pressed="true">Já recebi</button><button type="button" data-receipt-mode="scheduled" aria-pressed="false">Receber depois</button></div><p id="${prefix}TimingNote" class="receipt-timing-note" role="status"></p></div>`}
function bindReceiptTiming(a,prefix,whenId,submitId){
 const root=document.getElementById(prefix+'Timing'),when=document.getElementById(whenId),submit=document.getElementById(submitId);
 if(!root||!when||!submit)return;
 const update=()=>{
   const future=new Date(parseLocal(when.value)).getTime()>Date.now();
   if(future)root.dataset.mode='scheduled';
   const planned=root.dataset.mode==='scheduled',late=!!a.dischargeAt&&new Date(parseLocal(when.value))>new Date(a.dischargeAt);
   root.querySelectorAll('[data-receipt-mode]').forEach(b=>{const active=b.dataset.receiptMode===root.dataset.mode;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active))});
   const label=when.closest('.field')?.querySelector('.field-label');if(label)label.textContent=planned?'Data e hora previstas':'Data e hora do recebimento';
   document.getElementById(prefix+'TimingNote').textContent=planned?'Previsão: o valor só reduz o saldo após confirmar o recebimento.':late?'Recebimento após a alta. Confirme somente se o dinheiro já foi recebido.':'Confirme somente o valor que já foi recebido.';
   submit.innerHTML=icon(planned?'clock':'check')+(planned?'Salvar previsão':'Confirmar recebimento');
   const footer=document.getElementById('dDone');
   if(footer?.dataset.receiptSubmit==='true')footer.innerHTML=icon(planned?'clock':'check')+(planned?'Salvar previsão':'Confirmar recebimento');
 };
 root.querySelectorAll('[data-receipt-mode]').forEach(b=>b.onclick=()=>{root.dataset.mode=b.dataset.receiptMode;if(b.dataset.receiptMode==='received'&&new Date(parseLocal(when.value)).getTime()>Date.now())when.value=nowLocalInput();update()});
 when.addEventListener('input',update);when.addEventListener('change',update);update();
}
function receiptDates(prefix,method,when){
 const dates=method==='credit'?Array.from(document.querySelectorAll(`[data-installment="${prefix}"]`)).map(x=>x.value):[];
 if(method==='credit'){const error=validateInstallmentDates(dates,docIsoDate(when));if(error)throw new Error(error)}
 return dates;
}
function scheduledReceiptPanel(a=null){
 const items=(data.scheduledReceipts||[]).filter(s=>s.status==='pending'&&(!a||s.admissionId===a.id));
 if(!items.length)return '';
 return `<section class="panel scheduled-panel no-print"><div class="panel-head"><div><h2>Recebimentos previstos</h2><p>Não incluídos no recebido. O saldo permanece em aberto até a confirmação.</p></div><span class="badge badge-neutral">${items.length}</span></div><div class="scheduled-list">${items.map(s=>{
   const account=admission(s.admissionId),person=account?patient(account.patientId):null,overdue=new Date(s.expectedAt)<new Date();
   const methodLabel=paymentMethodLabel({method:['credit','debit'].includes(s.method)?'Cartão':s.method,cardType:['credit','debit'].includes(s.method)?s.method:null,installmentDates:s.installmentDates});
   const confirm=can('add_payment')&&account&&!['cancelled','finalized'].includes(account.status)&&totals(account.id).balance>0.009;
   return `<div class="scheduled-row"><div class="scheduled-copy">${!a?`<button class="scheduled-patient" data-open="${s.admissionId}">${esc(person?.name||'Paciente')}</button>`:''}<strong>${money(s.amount)} <span class="badge ${overdue?'badge-warn':'badge-neutral'}">${overdue?'Data prevista vencida':'Previsto'}</span></strong><span>${fmtDT(s.expectedAt)} · ${esc(methodLabel)}</span>${s.notes?`<small>${esc(s.notes)}</small>`:''}</div>${can('add_payment')?`<div class="scheduled-actions">${confirm?`<button class="btn btn-secondary" data-confirm-receipt="${s.id}">${icon('check')}Confirmar recebimento</button>`:''}<button class="icon-btn" data-cancel-receipt="${s.id}" aria-label="Cancelar previsão de ${money(s.amount)}">${icon('close')}</button></div>`:''}</div>`;
 }).join('')}</div></section>`;
}
function bindScheduledReceipts(){
 document.querySelectorAll('[data-confirm-receipt]').forEach(b=>b.onclick=()=>{const s=data.scheduledReceipts.find(x=>x.id===b.dataset.confirmReceipt);if(s)confirmReceiptModal(s)});
 document.querySelectorAll('[data-cancel-receipt]').forEach(b=>b.onclick=()=>{const s=data.scheduledReceipts.find(x=>x.id===b.dataset.cancelReceipt);if(s)cancelReceiptModal(s)});
}
function confirmReceiptModal(s){
 const a=admission(s.admissionId);if(!a||!can('add_payment'))return;
 openModal('Confirmar recebimento',`Previsão: ${fmtDT(s.expectedAt)}. Informe quando o dinheiro foi realmente recebido.`,
 `<form id="confirmReceiptForm" class="form">${field('Valor previsto',`<div class="read-value">${money(s.amount)}</div>`)}<div class="form-grid two">${field('Data real do recebimento',`<input id="cWhen" type="datetime-local" value="${nowLocalInput()}">`)}${field('Forma recebida',paymentMethodSelect('cMethod'))}</div>${cardDetailsMarkup('c')}${field('Observação',`<textarea id="cNotes" rows="2" maxlength="2000">${esc(s.notes)}</textarea>`)}<div id="confirmReceiptError"></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-close2>Cancelar</button><button class="btn btn-primary">Confirmar recebimento</button></div></form>`);
 document.querySelector('[data-close2]').onclick=closeModal;
 document.getElementById('cMethod').value=s.method;
 document.getElementById('cCount').value=String(s.installmentDates.length||1);
 bindCardDetails('c','cMethod');
 document.querySelectorAll('[data-installment="c"]').forEach((el,i)=>el.value=s.installmentDates[i]||'');
 document.getElementById('confirmReceiptForm').addEventListener('input',()=>document.getElementById('confirmReceiptError').innerHTML='');
 document.getElementById('confirmReceiptForm').onsubmit=async e=>{
   e.preventDefault();if(remoteBusy)return;const er=document.getElementById('confirmReceiptError');er.innerHTML='';
   try{
     const when=parseLocal(document.getElementById('cWhen').value),method=document.getElementById('cMethod').value;
     if(!when||new Date(when).getTime()>Date.now())throw new Error('Informe a data real do recebimento, sem data futura.');
     const dates=receiptDates('c',method,when);
     setLoading(true,'Confirmando recebimento…');
     const status=await rpc('confirm_uti_receipt',{p_schedule_id:s.id,p_occurred_at:when,p_method:method,p_installment_dates:dates,p_notes:document.getElementById('cNotes').value.trim()||null});
     await loadRemote({quiet:true});closeModal();toast(status==='finalized'?'Recebimento confirmado e conta finalizada.':'Recebimento confirmado.');render();
   }catch(ex){er.innerHTML=`<div class="form-error">${esc(ex.message)}</div>`}finally{setLoading(false)}
 };
}
function cancelReceiptModal(s){
 if(!can('add_payment'))return;
 openModal('Cancelar previsão',`${money(s.amount)} previstos para ${fmtDT(s.expectedAt)}.`,`<form id="cancelReceiptForm" class="form">${field('Motivo','<textarea id="cancelReceiptReason" rows="2" minlength="8" maxlength="220" required></textarea>')}<p class="receipt-timing-note">Cancelar uma previsão não altera pagamentos ou o saldo da conta.</p><div id="cancelReceiptError"></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-close2>Voltar</button><button class="btn btn-danger">Cancelar previsão</button></div></form>`);
 document.querySelector('[data-close2]').onclick=closeModal;
 document.getElementById('cancelReceiptForm').onsubmit=async e=>{e.preventDefault();if(remoteBusy)return;
   try{setLoading(true,'Cancelando previsão…');await rpc('cancel_uti_receipt',{p_schedule_id:s.id,p_reason:document.getElementById('cancelReceiptReason').value.trim()});await loadRemote({quiet:true});closeModal();toast('Previsão cancelada com auditoria.');render()}
   catch(ex){document.getElementById('cancelReceiptError').innerHTML=`<div class="form-error">${esc(ex.message)}</div>`}finally{setLoading(false)}
 };
}
async function registerPayment(a,{amount,when,method,notes,clientRef,prefix}){
  const dates=receiptDates(prefix,method,when);
  if(document.getElementById(prefix+'Timing')?.dataset.mode==='scheduled'){
    const id=await rpc('schedule_uti_receipt',{p_admission_id:a.id,p_expected_at:when,p_amount:amount,p_method:method,p_installment_dates:dates,p_notes:notes,p_client_ref:clientRef});
    return {scheduled:true,id};
  }
  if(new Date(when).getTime()>Date.now())throw new Error('Use a data real do recebimento ou escolha “Receber depois”.');
  if(method==='credit'||method==='debit'){
    return rpc('add_uti_card_payment',{p_admission_id:a.id,p_occurred_at:when,p_amount:amount,p_card_type:method,p_installment_dates:dates,p_notes:notes,p_client_ref:clientRef});
  }
  return rpc('add_uti_payment',{p_admission_id:a.id,p_occurred_at:when,p_amount:amount,p_method:method,p_notes:notes,p_client_ref:clientRef});
}
function paymentModal(a){
  const t=totals(a.id),paymentRef=crypto.randomUUID();
  openModal('Registrar recebimento',`Saldo atual: ${money(t.balance)}`,`<form class="form" id="payForm">${receiptTimingMarkup('p')}${field('Valor','<div class="currency-input large"><span>R$</span><input id="pValue" autofocus inputmode="decimal" placeholder="0,00"></div>')}<div class="form-grid two">${field('Data e hora',`<input id="pWhen" type="datetime-local" value="${nowLocalInput()}">`)}${field('Forma de pagamento',paymentMethodSelect('pMethod'))}</div>${cardDetailsMarkup('p')}${field('Observação','<textarea id="pNotes" rows="2" placeholder="Ex.: pagamento parcial da família"></textarea>','Opcional')}<div id="payWarn"></div><div id="payError"></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-close2>Cancelar</button><button id="pSubmit" class="btn btn-primary">Confirmar recebimento</button></div></form>`);
  document.querySelector('[data-close2]').onclick=closeModal;
  bindCardDetails('p','pMethod');
  bindReceiptTiming(a,'p','pWhen','pSubmit');
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
      const status=await registerPayment(a,{amount:v,when:parseLocal(document.getElementById('pWhen').value),method:document.getElementById('pMethod').value,notes:document.getElementById('pNotes').value.trim()||null,clientRef:paymentRef,prefix:'p'});
      await loadRemote({quiet:true});closeModal();
      toast(status?.scheduled?'Previsão salva. O saldo permanece em aberto.':status==='finalized'?'Pagamento registrado e conta finalizada.':'Pagamento registrado.');render();
    }catch(ex){document.getElementById('payError').innerHTML=`<div class="form-error">⚠ ${esc(ex.message)}</div>`}
    finally{setLoading(false)}
  };
}
function editReceiptButton(p){
 const a=admission(p.admissionId);
 return data.currentRole==='admin'&&p.id&&a&&a.status!=='cancelled'?`<button type="button" class="receipt-edit no-print" data-edit-payment="${p.id}" aria-label="Editar recebimento de ${money(p.amount)} em ${fmtDT(p.occurredAt)}">${icon('edit')}Editar</button>`:'';
}
function bindReceiptEdits(returnWhen=null){
 document.querySelectorAll('[data-edit-payment]').forEach(b=>b.onclick=()=>{
   const p=data.payments.find(x=>x.id===b.dataset.editPayment);
   if(p)editPaymentModal(p,typeof returnWhen==='function'?returnWhen():null);
 });
}
function editPaymentModal(p,returnWhen=null){
 const a=admission(p.admissionId);if(!a||data.currentRole!=='admin'||a.status==='cancelled')return;
 const version=a.accountVersion,ref=crypto.randomUUID();
 const back=()=>{closeModal();if(returnWhen&&authState)dischargeModal(admission(a.id),returnWhen)};
 openModal('Editar recebimento',`${patient(a.patientId)?.name||'Paciente'} · ${money(p.amount)}. A correção ficará no histórico.`,
 `<form id="editReceiptForm" class="form"><div class="form-grid two">${field('Valor',`<div class="currency-input"><span>R$</span><input id="editValue" inputmode="decimal" value="${p.amount.toFixed(2).replace('.',',')}" required></div>`)}${field('Data e hora do recebimento',`<input id="editWhen" type="datetime-local" value="${toLocalInput(new Date(p.occurredAt))}" required>`)}${field('Forma de pagamento',paymentMethodSelect('editMethod'))}</div>${cardDetailsMarkup('edit')}${field('Observação',`<textarea id="editNotes" rows="2" maxlength="2000">${esc(p.notes||'')}</textarea>`)}${field('Motivo da correção','<textarea id="editReason" rows="2" minlength="8" maxlength="220" placeholder="Ex.: forma de pagamento registrada incorretamente" required></textarea>')}<p class="receipt-timing-note">Informe um recebimento já realizado. Ao alterar o valor, o saldo será recalculado.</p><div id="editReceiptError" role="alert"></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-edit-cancel>Cancelar</button><button type="submit" class="btn btn-primary">Salvar correção</button></div></form>`);
 document.querySelector('[data-edit-cancel]').onclick=back;
 document.querySelector('#modal [data-close]').onclick=back;
 const method=document.getElementById('editMethod');
 if(p.method==='Cartão'&&!p.cardType)method.insertAdjacentHTML('afterbegin','<option value="" disabled>Selecione crédito ou débito</option>');
 method.value=p.cardType|| (p.method==='Cartão'?'':p.method);
 document.getElementById('editCount').value=String(p.installmentDates?.length||1);
 bindCardDetails('edit','editMethod');
 document.querySelectorAll('[data-installment="edit"]').forEach((el,i)=>el.value=p.installmentDates?.[i]||'');
 const form=document.getElementById('editReceiptForm'),er=document.getElementById('editReceiptError');
 form.addEventListener('input',()=>er.innerHTML='');
 form.onsubmit=async e=>{
   e.preventDefault();if(remoteBusy)return;er.innerHTML='';
   try{
     const amount=Number(document.getElementById('editValue').value.replace(',','.')),when=document.getElementById('editWhen').value===toLocalInput(new Date(p.occurredAt))?p.occurredAt:parseLocal(document.getElementById('editWhen').value),m=method.value,reason=document.getElementById('editReason').value.trim();
     if(!Number.isFinite(amount)||amount<=0||amount>1000000||Math.abs(amount*100-Math.round(amount*100))>0.00001)throw new Error('Informe um valor positivo com até duas casas decimais.');
     if(!when||!Number.isFinite(new Date(when).getTime())||new Date(when).getTime()>Date.now())throw new Error('Informe a data real do recebimento, sem data futura.');
     if(!m)throw new Error('Selecione crédito ou débito.');
     if(reason.length<8)throw new Error('Descreva o motivo da correção em pelo menos 8 caracteres.');
     const dates=receiptDates('edit',m,when),card=['credit','debit'].includes(m)?m:null;
     setLoading(true,'Salvando correção…');
     await rpc('edit_uti_payment',{p_payment_id:p.id,p_expected_version:Number(version),p_amount:amount,p_occurred_at:when,p_method:card?'Cartão':m,p_card_type:card,p_installment_dates:dates,p_notes:document.getElementById('editNotes').value.trim()||null,p_reason:reason,p_client_ref:ref});
     await loadRemote({quiet:true});closeModal();render();toast('Recebimento corrigido. Alteração registrada no histórico.');
     if(returnWhen)dischargeModal(admission(a.id),returnWhen);
   }catch(ex){er.innerHTML=`<div class="form-error">${esc(ex.message)}</div>`}finally{setLoading(false)}
 };
}
function editAdmissionInitialModal(a){
 if(!a||data.currentRole!=='admin'||a.status==='cancelled')return;
 const version=a.accountVersion,ref=crypto.randomUUID(),epoch=authEpoch;
 const initial=a.rateHistory.slice().sort((x,y)=>new Date(x.effectiveAt)-new Date(y.effectiveAt))[0];
 openModal('Editar entrada e primeira diária',patient(a.patientId)?.name||'Paciente',
 `<form id="editAdmissionForm" class="form"><div class="form-grid two">${field('Data e hora da entrada',`<input id="editEntryAt" type="datetime-local" value="${toLocalInput(new Date(a.entryAt))}" required>`)}${field('Primeira diária',`<select id="editInitialDaily"><option value="full" ${!a.halfInitial?'selected':''}>Diária integral</option><option value="half" ${a.halfInitial?'selected':''}>Meia diária</option></select>`)}</div><div class="summary-box"><div><span>Valor da primeira diária</span><strong id="editInitialValue"></strong></div></div><p class="receipt-timing-note">A conta será recalculada conforme a entrada informada. Pagamentos e extras são mantidos; as diárias substituídas ficam no histórico.</p>${field('Motivo da correção','<textarea id="editAdmissionReason" rows="2" minlength="8" maxlength="220" placeholder="Ex.: primeira diária registrada incorretamente" required></textarea>')}<div id="editAdmissionError" role="alert"></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-close2>Cancelar</button><button type="submit" class="btn btn-primary">Salvar correção</button></div></form>`);
 document.querySelector('[data-close2]').onclick=closeModal;
 const form=document.getElementById('editAdmissionForm'),er=document.getElementById('editAdmissionError'),choice=document.getElementById('editInitialDaily');
 const update=()=>{document.getElementById('editInitialValue').textContent=money(Number(initial?.negotiatedRate||0)*(choice.value==='half'?.5:1));er.innerHTML=''};
 choice.onchange=update;form.addEventListener('input',()=>er.innerHTML='');update();
 form.onsubmit=async e=>{
   e.preventDefault();if(remoteBusy)return;er.innerHTML='';
   try{
     const raw=document.getElementById('editEntryAt').value,when=raw===toLocalInput(new Date(a.entryAt))?a.entryAt:parseLocal(raw),reason=document.getElementById('editAdmissionReason').value.trim();
     if(!when||!Number.isFinite(new Date(when).getTime())||new Date(when).getTime()>Date.now())throw new Error('Informe uma entrada válida, sem data futura.');
     if(a.dischargeAt&&new Date(when)>new Date(a.dischargeAt))throw new Error('A entrada não pode ser posterior à alta.');
     if(reason.length<8)throw new Error('Descreva o motivo da correção em pelo menos 8 caracteres.');
     setLoading(true,'Recalculando a conta…');
     await rpc('edit_uti_admission_initial',{p_admission_id:a.id,p_expected_version:Number(version),p_entry_at:when,p_half_initial:choice.value==='half',p_reason:reason,p_client_ref:ref});
     if(epoch!==authEpoch)return;
     await loadRemote({quiet:true});if(epoch!==authEpoch)return;
     closeModal();render();toast('Entrada e primeira diária corrigidas. Conta recalculada e alteração registrada no histórico.');
   }catch(ex){if(epoch===authEpoch)er.innerHTML=`<div class="form-error">${esc(ex.message)}</div>`}finally{setLoading(false)}
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
function discountModal(a){
  if(data.currentRole!=='admin'||a.status!=='discharge_pending'){toast('Desconto indisponível nesta conta.');return}
  const t=totals(a.id);
  if(t.balance<=0.009){toast('Não existe saldo pendente para conceder desconto.');return}
  const clientRef=crypto.randomUUID();
  openModal('Conceder desconto no acerto','Reduz o saldo devedor sem alterar diárias ou pagamentos já registrados.',`<form class="form" id="discountForm">
    ${field('Valor do desconto',`<div class="currency-input large"><span>R$</span><input id="discValue" inputmode="decimal" autofocus value="${t.balance.toFixed(2)}" required></div>`)}
    ${field('Motivo do desconto','<textarea id="discReason" rows="2" required minlength="8" maxlength="220" placeholder="Ex.: desconto comercial autorizado no acerto"></textarea>')}
    <div class="summary-box"><div><span>Saldo antes</span><strong>${money(t.balance)}</strong></div><div><span>Saldo após</span><strong id="discBalance">R$ 0,00</strong></div></div>
    <div class="form-warning">O desconto ficará registrado na conta e na auditoria. Não representa recebimento de dinheiro.</div>
    <div id="discError"></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-close2>Cancelar</button><button type="submit" class="btn btn-primary">Confirmar desconto</button></div>
  </form>`);
  document.querySelector('[data-close2]').onclick=closeModal;
  const amountInput=document.getElementById('discValue');
  const update=()=>{
    const v=Number(amountInput.value.replace(',','.'));
    const remaining=Number.isFinite(v)?t.balance-v:t.balance;
    document.getElementById('discBalance').textContent=money(Math.max(0,remaining));
    document.getElementById('discError').textContent=(!Number.isFinite(v)||v<=0||v>t.balance)?'O desconto precisa ser positivo e não pode ultrapassar o saldo pendente.':'';
  };
  amountInput.oninput=update;update();
  document.getElementById('discountForm').onsubmit=async e=>{
    e.preventDefault();if(remoteBusy)return;
    const value=Number(amountInput.value.replace(',','.'));
    const reason=document.getElementById('discReason').value.trim();
    if(!Number.isFinite(value)||value<=0||Math.abs(Math.round(value*100)-value*100)>0.00001||value>t.balance){
      document.getElementById('discError').textContent='Confira o valor do desconto.';return;
    }
    if(reason.length<8){document.getElementById('discError').textContent='Descreva o motivo do desconto.';return}
    if(!confirm('Confirma o desconto de '+money(value)+'? O saldo após o desconto será '+money(t.balance-value)+'.'))return;
    try{
      setLoading(true,'Registrando desconto…');
      await rpc('grant_uti_settlement_discount',{
        p_admission_id:a.id,p_amount:value,p_reason:reason,p_client_ref:clientRef
      });
      await loadRemote({quiet:true});closeModal();toast('Desconto registrado com auditoria.');render();
    }catch(ex){document.getElementById('discError').textContent=ex.message||'Não foi possível registrar o desconto.'}
    finally{setLoading(false)}
  };
}

function rateModal(a){const r=currentRate(a),isPrivate=a.mode==='private';openModal('Ajustar diária','A nova diária vale a partir da data informada. Ajustes retroativos recalculam a conta e ficam na auditoria.',`<form class="form" id="rateForm">${isPrivate?field('Ventilação mecânica',`<select id="rVent"><option value="0" ${!r.ventilation?'selected':''}>Não</option><option value="1" ${r.ventilation?'selected':''}>Sim</option></select>`):''}<div class="form-grid two">${field('Validade a partir de',`<input id="rWhen" type="datetime-local" value="${nowLocalInput()}">`)}${field('Nova diária',`<div class="currency-input"><span>R$</span><input id="rValue" value="${r.negotiatedRate}" inputmode="decimal"></div>`)}</div><div class="summary-box"><div><span>Valor padrão</span><strong id="rStandard">—</strong></div><div><span>Valor aplicado</span><strong id="rApplied">${money(r.negotiatedRate)}</strong></div></div><div id="rateError"></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-close2>Cancelar</button><button class="btn btn-primary">↻ Salvar condição</button></div></form>`);document.querySelector('[data-close2]').onclick=closeModal;const upd=()=>{const vent=isPrivate&&document.getElementById('rVent').value==='1',std=isPrivate?(vent?PRIVATE_VENT:PRIVATE_NO_VENT):bedRate(a.bed),val=Number(document.getElementById('rValue').value.replace(',','.'))||0;document.getElementById('rStandard').textContent=money(std);document.getElementById('rApplied').textContent=money(val)};if(isPrivate)document.getElementById('rVent').onchange=e=>{const std=e.target.value==='1'?PRIVATE_VENT:PRIVATE_NO_VENT;document.getElementById('rValue').value=std;upd()};document.getElementById('rValue').oninput=upd;upd();document.getElementById('rateForm').onsubmit=async e=>{e.preventDefault();if(remoteBusy)return;const vent=isPrivate&&document.getElementById('rVent').value==='1',v=Number(document.getElementById('rValue').value.replace(',','.'));if(!v||v<=0)return;try{setLoading(true,'Salvando condição…');await rpc('adjust_uti_rate',{p_admission_id:a.id,p_effective_at:parseLocal(document.getElementById('rWhen').value),p_negotiated_rate:v,p_ventilation:isPrivate?vent:null});await loadRemote({quiet:true});closeModal();toast('Nova condição salva para as próximas diárias.');render()}catch(ex){document.getElementById('rateError').innerHTML=`<div class="form-error">⚠ ${esc(ex.message)}</div>`}finally{setLoading(false)}}}
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
    ${pays.length?`<div class="settle-section-title">Pagamentos realizados</div><div class="settle-table-wrap"><table class="settle-table"><thead><tr><th>Data/hora</th><th>Forma</th><th>Registrado por</th><th>Valor</th></tr></thead><tbody>${pays.map(x=>`<tr><td>${fmtDT(x.occurredAt)}</td><td>${esc(paymentMethodLabel(x))}${installmentSummary(x)?`<small class="payment-schedule">${esc(installmentSummary(x))}</small>`:''}</td><td>${esc(x.createdBy||'—')}</td><td>${money(Number(x.amount||0))}${editReceiptButton({...x,admissionId:a.id})}</td></tr>`).join('')}</tbody></table></div>`:''}
    ${refunds.length?`<div class="settle-section-title">Reembolsos realizados</div><div class="settle-table-wrap"><table class="settle-table"><thead><tr><th>Data/hora</th><th>Forma</th><th>Registrado por</th><th>Valor</th></tr></thead><tbody>${refunds.map(x=>`<tr><td>${fmtDT(x.occurredAt)}</td><td>${esc(paymentMethodLabel(x))}${installmentSummary(x)?`<small class="payment-schedule">${esc(installmentSummary(x))}</small>`:''}</td><td>${esc(x.createdBy||'—')}</td><td>- ${money(Number(x.amount||0))}</td></tr>`).join('')}</tbody></table></div>`:''}
    ${scheduledReceiptPanel(a)}${bal>0.009&&can('add_payment')?`<div class="settle-paybox"><h3>Registrar recebimento</h3>${receiptTimingMarkup('settlePay')}<div class="settle-paygrid">
      ${field('Valor',`<div class="currency-input"><span>R$</span><input id="settlePayValue" inputmode="decimal" value="${bal.toFixed(2)}"></div>`)}
      ${field('Forma',paymentMethodSelect('settlePayMethod'))}
      ${field('Data/hora',`<input id="settlePayWhen" type="datetime-local" value="${nowLocalInput()}">`)}
      <button class="btn btn-secondary" id="settlePayBtn">↙ Receber</button>
    </div>${cardDetailsMarkup('settlePay')}<div id="settlePayError"></div></div>`:''}
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
  const movements=[...pays.map(x=>({...x,kind:'receipt'})),...refunds.map(x=>({...x,kind:'refund'}))]
    .sort((x,y)=>new Date(x.occurredAt)-new Date(y.occurredAt))
    .map(x=>({date:docDateOnly(x.occurredAt),method:(x.kind==='refund'?'Reembolso · ':'')+paymentMethodLabel(x),schedule:x.kind==='receipt'?installmentSummary(x):'',total:Number(x.amount||0)*(x.kind==='refund'?-1:1)}));
  const bal=Number(s.balance||0);
  return {patient:p,lines,movements,status:bal<-.009?'CRÉDITO A DEVOLVER':bal>.009?'ACERTO COM PENDÊNCIA':'ACERTO QUITADO',statusClass:Math.abs(bal)<=.009?'ok':'pending',docId:settlementDocumentId(a)};
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
  const m=settlementDocumentModel(a,s),p=m.patient||{},pages=[];let cmd=[];
  const t=(x,y,size,value,bold=false)=>cmd.push('BT /F'+(bold?'2':'1')+' '+size+' Tf '+x+' '+y+' Td ('+pdfEscape(value)+') Tj ET');
  const line=(x1,y1,x2,y2)=>cmd.push(x1+' '+y1+' m '+x2+' '+y2+' l S');
  const rect=(x,y,w,h)=>cmd.push(x+' '+y+' '+w+' '+h+' re S');
  cmd.push('0.04 0.43 0.45 RG','1.4 w');line(40,786,555,786);
  cmd.push('0.04 0.43 0.45 rg');t(40,804,19,'IMEC UTI',true);cmd.push('0 g');
  t(40,790,9,'Folha de Acerto - Particular & Hotelaria');
  t(405,806,8,'Documento '+m.docId,true);t(405,792,8,m.status,true);
  const patientLines=pdfWrap(p.name||'Paciente',56,2);
  t(40,765,16,patientLines[0],true);
  if(patientLines[1])t(40,747,14,patientLines[1],true);
  cmd.push('0.4 g');t(40,patientLines[1]?735:749,8,'CPF '+cpfMask(p.cpf));cmd.push('0 g');
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
  const fin=[['Diárias',s.dailyTotal],['Extras/Desc.',s.extrasTotal],['Total',s.total],['Recebido',s.received],['Reembolsado',s.refunded],[balanceMeta(s.balance).label,s.balance]];
  const fw=515/6;
  fin.forEach((x,i)=>{const xx=40+i*fw;rect(xx,558,fw,38);t(xx+7,583,7,x[0].toUpperCase(),true);t(xx+7,567,9,pdfShort(money(i===5?Math.abs(Number(x[1]||0)):Number(x[1]||0)),18),true)});
  t(40,536,8,'RESUMO DA COMPOSIÇÃO',true);line(40,530,555,530);
  t(42,518,7,'PERÍODO',true);t(145,518,7,'DESCRIÇÃO',true);t(442,518,7,'QTD.',true);t(490,518,7,'VALOR',true);
  let y=502;
  m.lines.forEach(x=>{t(42,y,7,pdfShort(x.period,18));t(145,y,7,pdfShort(x.description,46));t(445,y,7,Number(x.qty).toLocaleString('pt-BR',{maximumFractionDigits:1}));t(486,y,7,pdfShort(money(x.total),15));y-=18});
  const finishPage=()=>{
    cmd.push('0 g','0.82 G');line(40,76,555,76);
    t(40,60,7,'Responsável pelo fechamento: '+pdfShort(a.closer||'—',34),true);
    t(40,47,7,'Emitido por: '+pdfShort(data.currentUser||'—',30)+' - '+fmtDT(new Date().toISOString()));
    t(395,60,7,'Conferência / Visto');line(395,69,555,69);
    t(505,30,7,'Página '+(pages.length+1));
    pages.push(cmd.join('\n'));
  };
  const nextPage=()=>{
    finishPage();cmd=['0 g','0.82 G','0.7 w'];
    t(40,804,14,'IMEC UTI - Folha de Acerto',true);
    t(40,786,9,pdfShort(p.name||'Paciente',72),true);
    t(40,772,8,'CPF '+cpfMask(p.cpf)+' - Documento '+m.docId);line(40,760,555,760);y=738;
  };
  const movementsHeader=()=>{
    t(40,y,8,'RECEBIMENTOS'+((s.refunds||[]).length?' E REEMBOLSOS':''),true);y-=12;
    line(40,y,555,y);y-=13;
    t(42,y,7,'DATA',true);t(145,y,7,'FORMA DE RECEBIMENTO',true);t(486,y,7,'VALOR',true);y-=18;
  };
  y-=12;movementsHeader();
  if(!m.movements.length){t(42,y,8,'Nenhum recebimento registrado.');y-=18;}
  m.movements.forEach(x=>{
    const schedule=x.schedule?pdfWrap(x.schedule,77,12):[];
    const height=33+schedule.length*11;
    if(y-height<100){nextPage();movementsHeader();}
    t(42,y,8,x.date);t(145,y,8,x.method);t(486,y,8,pdfShort(money(x.total),16));y-=13;
    cmd.push('0.4 g');schedule.forEach(text=>{t(145,y,7,text);y-=11});cmd.push('0 g');
    line(40,y-6,555,y-6);y-=20;
  });
  if(y<240)nextPage();
  const proofHeight=Math.min(185,y-105),proofTop=y-10;
  cmd.push('0.65 G');rect(40,proofTop-proofHeight,515,proofHeight);
  t(50,proofTop-20,8,'COMPROVANTES DE MOVIMENTAÇÃO',true);
  t(50,proofTop-35,7,'Anexar os comprovantes originais de recebimentos ou reembolsos.');
  finishPage();
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids ['+pages.map((_,i)=>(5+i*2)+' 0 R').join(' ')+'] /Count '+pages.length+' >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  ];
  pages.forEach((stream,i)=>objects.push(
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents '+(6+i*2)+' 0 R >>',
    '<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream'
  ));
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
async function logDocumentOutput(admissionId,event,documentKind){
  return rpc('log_uti_document_event',{p_admission_id:admissionId,p_event:event,p_document_kind:documentKind});
}
async function downloadSettlementPdf(a,knownSettlement=null){
  let loading=false;
  const isiOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const iosWindow=isiOS?window.open('','_blank'):null;
  try{
    let s=knownSettlement;
    if(!s){loading=true;setLoading(true,'Gerando PDF…');s=await fetchSettlement(a,a.dischargeAt)}
    const blob=buildSettlementPdfBlob(a,s),fileName=settlementPdfFileName(a,s);
    if(!loading){loading=true;setLoading(true,'Registrando saída documental…')}
    await logDocumentOutput(a.id,'pdf_downloaded','settlement_pdf');
    const url=URL.createObjectURL(blob);
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
      await logDocumentOutput(a.id,'print_view_opened','settlement_sheet');
      const model=settlementDocumentModel(a,s),p=model.patient,printItems=model.lines,movements=model.movements,status=model.status,statusClass=model.statusClass;
      win.document.open();
      win.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Folha de Acerto — ${esc(p?.name||'Paciente')}</title><style>
        @page{size:A4 portrait;margin:13mm}
        *{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;color:#172326;background:#eef3f3;padding:12px;font-size:9.5pt}.sheet{width:184mm;min-height:271mm;margin:0 auto;background:#fff;padding:0;display:flex;flex-direction:column}
        .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0b6f72;padding-bottom:10px;margin-bottom:12px}
        .brand{font-size:18pt;font-weight:800;color:#07575a}.brand small{display:block;font-size:9pt;color:#6d7b7e;font-weight:600;margin-top:2px}
        .status{font-size:8.5pt;font-weight:800;padding:6px 9px;border-radius:6px}.status.ok{background:#eaf7f0;color:#16794a}.status.pending{background:#fff7df;color:#8b5a0e}
        .patient{font-size:17pt;font-weight:800;margin:0 0 3px;overflow-wrap:anywhere}.patient-cpf{font-size:8pt;color:#6d7b7e;margin:0 0 12px}.schedule{display:block;color:#5d6d70;font-size:7.5pt;line-height:1.6;margin-top:3px;overflow-wrap:anywhere}.empty-movements{color:#6d7b7e;font-size:8.5pt}.grid{display:grid;grid-template-columns:1.25fr 1fr 1fr;gap:8px;margin-bottom:10px}
        .box{border:1px solid #dfe7e7;border-radius:7px;padding:8px}.box span{display:block;color:#6d7b7e;font-size:7.5pt;text-transform:uppercase;font-weight:700;letter-spacing:.03em}.box strong{display:block;margin-top:3px;font-size:10pt}
        .period{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px}
        .daily{border:1px solid #cfe4e4;background:#f3f9f9;border-radius:7px;padding:9px;margin:10px 0;display:flex;justify-content:space-between;align-items:center}.daily strong{font-size:14pt;color:#07575a}.daily small{display:block;color:#6d7b7e;margin-top:2px}
        .finance{display:grid;grid-template-columns:repeat(6,1fr);border:1px solid #dfe7e7;border-radius:7px;overflow:hidden;margin:10px 0 12px}.finance div{padding:8px;border-right:1px solid #dfe7e7}.finance div:last-child{border-right:0}.finance span{display:block;color:#6d7b7e;font-size:7.5pt}.finance strong{display:block;margin-top:3px;font-size:10.5pt}.finance .saldo strong{font-size:12pt}
        h2{font-size:9pt;text-transform:uppercase;letter-spacing:.05em;color:#5d6d70;margin:12px 0 6px}
        table{width:100%;border-collapse:collapse;font-size:8.5pt}th{background:#f5f8f8;color:#5d6d70;text-align:left;font-size:7.5pt;text-transform:uppercase}th,td{border:0;border-bottom:1px solid #e1e8e8;padding:6px;vertical-align:top}td:first-child{white-space:nowrap}th:last-child,td:last-child{text-align:right}
        .proof{margin-top:12px;border:1px dashed #9caaaa;border-radius:6px;padding:9px;flex:1;min-height:145px}.proof h2{margin-top:0}.proof p{color:#6d7b7e;margin:3px 0 0;font-size:8pt}.proof-space{min-height:105px}
        .footer{display:flex;justify-content:space-between;gap:20px;border-top:1px solid #d7dfdf;padding-top:8px;margin-top:10px;font-size:8pt;color:#6d7b7e}.sign{margin-top:28px;width:210px;border-top:1px solid #7b888a;padding-top:4px;text-align:center;color:#46575a}
        .no-print{width:184mm;margin:0 auto 10px;display:flex;justify-content:flex-end;gap:7px}.no-print button,.no-print a{border:0;background:#0b6f72;color:#fff;padding:9px 13px;border-radius:7px;font-weight:700;cursor:pointer;text-decoration:none;font:inherit}.no-print .ghost{background:#fff;color:#435456;border:1px solid #cfd8d8}.doc-side{text-align:right}.doc-side small{display:block;color:#6d7b7e;font-size:7.5pt;margin-top:5px}
        @media screen{body{background:#f4f6f3;padding:28px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}.sheet{padding:28px;border:1px solid #e0e7de;border-radius:14px;box-shadow:0 8px 32px rgba(24,43,40,.06)}.no-print{align-items:center;margin-bottom:16px}.no-print button{border-radius:9px;background:#12635e;font-size:12px;min-height:42px}.no-print .ghost{background:#fff}.top{border-bottom-width:1px}.brand{font-weight:650}.patient{font-weight:650}.box strong{font-weight:600}}
        @media screen and (max-width:740px){body{padding:16px 12px;font-size:12px}.sheet,.no-print{width:100%;min-height:0}.sheet{padding:18px}.top{gap:12px}.brand{font-size:19px}.brand small{font-size:10px}.status{font-size:10px;padding:5px 7px}.patient{font-size:21px}.grid,.period{grid-template-columns:1fr 1fr}.finance{grid-template-columns:repeat(2,minmax(0,1fr))}.finance div{border-bottom:1px solid #dfe7e7}.daily{gap:12px;align-items:flex-start}.daily strong{font-size:18px}.daily small{font-size:11px}.footer{flex-direction:column;gap:12px}.sign{margin-top:20px;width:100%}table{font-size:11px;table-layout:fixed}th{font-size:9px}th,td{padding:7px 4px;overflow-wrap:anywhere}td:first-child{white-space:normal}.schedule{font-size:10px}.proof{min-height:130px}.no-print{flex-wrap:wrap}}
        @media print{html,body{background:#fff!important;padding:0!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.no-print{display:none}.sheet{width:auto;min-height:271mm;margin:0}.proof{break-inside:avoid}thead{display:table-header-group}tr{break-inside:avoid}h2{break-after:avoid}.top,.grid,.period,.daily,.finance{break-inside:avoid}}
      </style></head><body>
      <div class="no-print"><button id="settlementPrintBtn" type="button">Imprimir / Salvar PDF</button><button id="settlementCloseBtn" type="button" class="ghost">Fechar</button></div>
      <main class="sheet">
      <div class="top"><div><div class="brand">IMEC UTI<small>Folha de Acerto — Particular & Hotelaria</small></div></div><div class="doc-side"><div class="status ${statusClass}">${status}</div><small>Documento ${model.docId}</small></div></div>
      <div class="patient">${esc(p?.name||'Paciente')}</div><div class="patient-cpf">CPF ${esc(cpfMask(p?.cpf))}</div>
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
        <div class="saldo"><span>${balanceMeta(s.balance).label}</span><strong>${money(Math.abs(Number(s.balance||0)))}</strong></div>
      </div>
      <h2>Resumo da composição</h2>
      <table><thead><tr><th>Período</th><th>Descrição</th><th>Qtd.</th><th>Valor</th></tr></thead><tbody>${printItems.map(x=>`<tr><td>${esc(x.period)}</td><td>${esc(x.description)}</td><td>${Number(x.qty).toLocaleString('pt-BR',{maximumFractionDigits:1})}</td><td>${money(x.total)}</td></tr>`).join('')}</tbody></table><div style="font-size:7.5pt;color:#6d7b7e;margin-top:4px">O detalhamento completo permanece disponível no sistema.</div>
      <h2>Recebimentos${(s.refunds||[]).length?' e reembolsos':''}</h2>${movements.length?`<table><thead><tr><th>Data</th><th>Forma de recebimento</th><th>Valor</th></tr></thead><tbody>${movements.map(x=>`<tr><td>${esc(x.date)}</td><td>${esc(x.method)}${x.schedule?`<small class="schedule">${esc(x.schedule)}</small>`:''}</td><td>${money(x.total)}</td></tr>`).join('')}</tbody></table>`:'<p class="empty-movements">Nenhum recebimento registrado.</p>'}
      <div class="proof"><h2>Comprovantes de movimentação financeira</h2><p>Anexar abaixo os comprovantes originais de recebimentos ou reembolsos registrados nesta conta.</p><div class="proof-space"></div></div>
      <div class="footer"><div><strong>Responsável pelo fechamento:</strong> ${esc(a.closer||'—')}<br><strong>Documento emitido por:</strong> ${esc(data.currentUser)} • ${fmtDT(new Date().toISOString())}</div><div class="sign">Conferência / Visto</div></div>
      </main></body></html>`);
      win.document.close();
      const printButton=win.document.getElementById('settlementPrintBtn');
      const closeButton=win.document.getElementById('settlementCloseBtn');
      closeButton?.addEventListener('click',()=>win.close());
      printButton?.addEventListener('click',async()=>{
        printButton.disabled=true;
        const text=printButton.textContent;
        printButton.textContent='Registrando impressão…';
        try {
          await logDocumentOutput(a.id,'print_requested','settlement_sheet');
          if(!win.closed){win.focus();win.print()}
        } catch (err) {
          alert('Não foi possível registrar a impressão: '+(err?.message||'erro desconhecido'));
        } finally {
          if(!win.closed){printButton.disabled=false;printButton.textContent=text}
        }
      });
      try{win.focus()}catch{}
    }catch(e){
      win.document.body.innerHTML='<p style="font-family:Arial;padding:30px;color:#b42318">Não foi possível gerar a folha: '+esc(e.message)+'</p>';
    }
  };
  build();
}

function dischargeModal(a,proposedAt=null){
  if(!can('discharge')){toast('Seu perfil não pode registrar alta.');return}
  const alreadyDischarged=!!a.dischargeAt;
  const def=a.dischargeAt||proposedAt?toLocalInput(new Date(a.dischargeAt||proposedAt)):nowLocalInput();
  let lastPreview=null,lastDis=null,confirmedSnapshot=null,calculationRevision=0,submitSettlementReceipt=null;
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
  const previewHost=document.getElementById('dPreview');
  const getDis=()=>a.dischargeAt||parseLocal(document.getElementById('dWhen').value);
  const snapshot=s=>JSON.stringify([Number(s.accountVersion||0),Number(s.total||0),Number(s.received||0),Number(s.refunded||0),Number(s.balance||0),Number(s.dailyUnits||0)]);

  const bindPreviewActions=()=>{
    submitSettlementReceipt=null;
    bindScheduledReceipts();
    bindReceiptEdits(getDis);
    const payBtn=document.getElementById('settlePayBtn');
    if(payBtn){
      bindCardDetails('settlePay','settlePayMethod');
      bindReceiptTiming(a,'settlePay','settlePayWhen','settlePayBtn');
      payBtn.closest('.settle-paybox')?.addEventListener('input',()=>{document.getElementById('settlePayError').innerHTML=''});
      payBtn.closest('.settle-paybox')?.addEventListener('change',()=>{document.getElementById('settlePayError').innerHTML=''});
      const paymentRef=crypto.randomUUID();
      submitSettlementReceipt=async(closeAfter=false)=>{
        if(remoteBusy)return;
        const er=document.getElementById('settlePayError');
        er.innerHTML='';
        try{
          const val=Number(document.getElementById('settlePayValue').value.replace(',','.')),method=document.getElementById('settlePayMethod').value,when=parseLocal(document.getElementById('settlePayWhen').value);
          if(!Number.isFinite(val)||val<=0)throw new Error('Informe um valor válido.');
          setLoading(true,'Registrando recebimento…');
          const result=await registerPayment(a,{amount:val,when,method,notes:'Recebimento no acerto de alta',clientRef:paymentRef,prefix:'settlePay'});
          await loadRemote({quiet:true});a=admission(a.id);render();
          if(closeAfter)closeModal();else await calculate();
          toast(result?.scheduled?'Previsão salva. O saldo permanece em aberto.':result==='finalized'?'Recebimento confirmado e conta finalizada.':'Recebimento confirmado.');
        }catch(ex){er.innerHTML=`<div class="form-error">⚠ ${esc(ex.message)}</div>`;er.scrollIntoView({block:'nearest',behavior:'smooth'})}finally{setLoading(false)}
      };
      payBtn.onclick=()=>submitSettlementReceipt(false);
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
    const hasReceipt=alreadyDischarged&&!!submitSettlementReceipt&&!!document.getElementById('settlePayBtn');
    const planned=document.getElementById('settlePayTiming')?.dataset.mode==='scheduled';
    box.innerHTML='<button class="btn btn-secondary" data-close2>Cancelar</button>'+
      (alreadyDischarged&&lastPreview?'<button class="btn btn-secondary sheet-trigger" id="dPrint">▤ Visualizar / imprimir</button><button class="btn btn-secondary sheet-trigger" id="dPdf">⇩ Baixar PDF</button>':'')+
      (!alreadyDischarged&&lastPreview?'<button class="btn btn-primary" id="dConfirm">✓ Confirmar alta</button>':'')+
      (alreadyDischarged?`<button type="button" class="btn btn-primary" id="dDone" data-receipt-submit="${hasReceipt}">${hasReceipt?(planned?'Salvar previsão':'Confirmar recebimento'):'Fechar acerto'}</button>`:'');
    box.querySelector('[data-close2]').onclick=closeModal;
    const pr=document.getElementById('dPrint');if(pr)pr.onclick=()=>printSettlementSheet(a,lastPreview);
    const pd=document.getElementById('dPdf');if(pd)pd.onclick=()=>downloadSettlementPdf(a,lastPreview);
    const done=document.getElementById('dDone');if(done)done.onclick=()=>{if(remoteBusy)return;if(hasReceipt)submitSettlementReceipt(true);else closeModal()};
    const cf=document.getElementById('dConfirm');if(cf)cf.onclick=confirmDischarge;
    polishIcons(document.getElementById('modal'));
  };

  const calculate=async()=>{
    const revision=++calculationRevision;
    const dis=getDis(),er=document.getElementById('dError');
    er.innerHTML='';
    if(!dis||new Date(dis)<new Date(a.entryAt)){document.getElementById('dPreview').innerHTML='<div class="form-error">⚠ A saída não pode ser anterior à entrada do paciente.</div>';lastPreview=null;renderActions();return}
    try{
      setLoading(true,'Calculando acerto…');
      const s=await fetchSettlement(a,dis);
      if(revision!==calculationRevision||!previewHost.isConnected||dis!==getDis())return;
      lastPreview=s;lastDis=dis;confirmedSnapshot=snapshot(s);
      document.getElementById('dPreview').innerHTML=settlementPreviewMarkup(a,s);
      bindPreviewActions();renderActions();
    }catch(ex){if(revision===calculationRevision&&previewHost.isConnected&&dis===getDis()){lastPreview=null;previewHost.innerHTML='';er.innerHTML=`<div class="form-error">⚠ ${esc(ex.message)}</div>`;renderActions()}}
    finally{if(revision===calculationRevision)setLoading(false)}
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
  if(data.currentRole==='referral')document.querySelector('.quick-actions')?.remove();
  bindScheduledReceipts();
  bindReceiptEdits();
  document.querySelectorAll('[data-action="back"]').forEach(b=>b.onclick=()=>{state.selectedId=null;if(state.page==='reports')loadMonthlyReport();else render()});
  document.querySelectorAll('[data-action="payment"]').forEach(b=>b.onclick=()=>paymentModal(a));
  document.querySelectorAll('[data-action="refund"]').forEach(b=>b.onclick=()=>refundModal(a));
  document.querySelectorAll('[data-action="extra"]').forEach(b=>b.onclick=()=>extraModal(a));
  document.querySelectorAll('[data-action="discount"]').forEach(b=>b.onclick=()=>discountModal(a));
  document.querySelectorAll('[data-action="rate"]').forEach(b=>b.onclick=()=>rateModal(a));
  document.querySelectorAll('[data-action="discharge"]').forEach(b=>{const sp=b.querySelector('span');if(sp)sp.textContent=a.dischargeAt?'Acerto / saída':'Alta e acerto';b.onclick=()=>dischargeModal(a)});
  document.querySelectorAll('[data-action="print"]').forEach(b=>b.onclick=async()=>{try{setLoading(true,'Registrando impressão…');await logDocumentOutput(a.id,'print_requested','admission_statement');setLoading(false);window.print()}catch(ex){alert('Não foi possível registrar a impressão: '+ex.message)}finally{setLoading(false)}});
  const actions=document.querySelector('.detail-actions');
  if(actions&&data.currentRole==='admin'&&a.status!=='cancelled'){
    const edit=document.createElement('button');edit.className='btn btn-secondary';edit.dataset.action='edit-admission';edit.innerHTML=icon('edit')+'Editar internação';edit.onclick=()=>editAdmissionInitialModal(a);actions.insertBefore(edit,actions.firstChild);
  }
  const hasCorrectable=data.payments.some(x=>x.admissionId===a.id)||data.charges.some(x=>x.admissionId===a.id&&x.kind!=='daily')||(data.refunds||[]).some(x=>x.admissionId===a.id);
  if(actions&&data.currentRole==='admin'&&hasCorrectable&&!actions.querySelector('[data-action="corrections"]')){
    const cb=document.createElement('button');cb.className='btn btn-secondary';cb.dataset.action='corrections';cb.innerHTML='↺ Estornar lançamento';cb.onclick=()=>correctionsModal(a);actions.insertBefore(cb,actions.firstChild);
  }
  if(actions&&a.dischargeAt&&!actions.querySelector('[data-action="settlement-sheet"]')){
    const pdf=document.createElement('button');pdf.className='btn btn-secondary';pdf.dataset.action='settlement-pdf';pdf.innerHTML='⇩ Baixar PDF';pdf.onclick=()=>downloadSettlementPdf(a);actions.insertBefore(pdf,actions.firstChild);
    const b=document.createElement('button');b.className='btn btn-secondary';b.dataset.action='settlement-sheet';b.innerHTML='▤ Imprimir acerto';b.onclick=()=>printSettlementSheet(a);actions.insertBefore(b,actions.firstChild);
  }
}


function bindPage(){
  if(state.page==='reports'&&!state.selectedId){
    document.getElementById('reportMonth').onchange=e=>{if(!e.target.value)return;state.reportMonth=e.target.value;loadMonthlyReport()};
    document.getElementById('reportCommission').onchange=e=>state.reportCommission=e.target.checked;
    document.getElementById('reportRefresh').onclick=()=>loadMonthlyReport();
    document.getElementById('reportPdf').onclick=()=>exportMonthlyReport('pdf');document.getElementById('reportPrint').onclick=()=>exportMonthlyReport('print');document.getElementById('reportCsv').onclick=()=>exportMonthlyReport('csv');
    document.querySelectorAll('[data-report-open]').forEach(b=>b.onclick=async()=>{
      if(remoteBusy)return;const id=b.dataset.reportOpen;
      if(!admission(id)){try{setLoading(true);const ok=await loadRemote({quiet:true});if(!ok)return}finally{setLoading(false)}}
      if(!admission(id)){toast('Esta internação não está mais disponível. Atualize o relatório.');return}
      state.selectedId=id;render();
    });
    if(!monthlyReportState.loading&&!monthlyReportState.error&&monthlyReportState.report?.month!==state.reportMonth)loadMonthlyReport();
  }
  bindScheduledReceipts();
  document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{state.selectedId=b.dataset.open;render()});
  const s=document.getElementById('searchPatients');if(s)s.oninput=e=>{
    const start=e.target.selectionStart,end=e.target.selectionEnd;
    state.search=e.target.value;render();
    const next=document.getElementById('searchPatients');next?.focus();next?.setSelectionRange(start,end);
  };
  document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{state.patientFilter=b.dataset.filter;render()});
  document.querySelectorAll('[data-ftab]').forEach(b=>b.onclick=()=>{state.financeTab=b.dataset.ftab;render()});
  const od=document.getElementById('onDuty');if(od)od.disabled=!can('update_on_duty');if(od)od.onchange=async e=>{const next=e.target.value;try{setLoading(true);await rpc('update_uti_on_duty',{p_name:next});await loadRemote({quiet:true});toast('Plantão comercial atualizado.');render()}catch(ex){alert(ex.message);render()}finally{setLoading(false)}};
  const mr=document.getElementById('manualRefresh');if(mr)mr.onclick=()=>withRemote(async()=>{const ok=await loadRemote({quiet:true});if(!ok)throw new Error('Não foi possível atualizar os dados.');render()},'Dados atualizados.');
  const iu=document.getElementById('inviteUserBtn');if(iu)iu.onclick=inviteUserModal;const cp=document.getElementById('changePasswordBtn');if(cp)cp.onclick=changePasswordModal;const lo=document.getElementById('logoutBtn');if(lo)lo.onclick=logoutRemote;
  document.querySelectorAll('[data-ack-alert]').forEach(btn=>btn.onclick=async()=>{if(remoteBusy)return;try{setLoading(true,'Reconhecendo alerta…');await rpc('acknowledge_uti_alert',{p_alert_id:Number(btn.dataset.ackAlert)});await loadRemote({quiet:true});toast('Alerta reconhecido.');render()}catch(ex){alert(ex.message||'Não foi possível reconhecer o alerta.')}finally{setLoading(false)}});
  document.querySelectorAll('[data-save-member]').forEach(btn=>btn.onclick=async()=>{const id=btn.dataset.saveMember,role=document.querySelector(`[data-member-role="${id}"]`).value,active=document.querySelector(`[data-member-active="${id}"]`).checked;try{setLoading(true,'Atualizando acesso…');await rpc('admin_update_uti_member',{p_user_id:id,p_active:active,p_role:role});await loadRemote({quiet:true});toast('Acesso atualizado.');render()}catch(ex){alert(ex.message)}finally{setLoading(false)}});
}

let backgroundRefreshInFlight=false;
async function backgroundRefresh(){
  if(backgroundRefreshInFlight)return;
  if(!canBackgroundRefresh(
    authState?.access_token,remoteBusy,
    !!document.querySelector('.modal-backdrop'),
    !!data?.currentRole,
    passwordOnlyMode
  ))return;
  backgroundRefreshInFlight=true;
  try{
    const loaded=await loadRemote({quiet:true});
    // AAL1/MFA enrollment, expired auth and failed reload must never re-render the dashboard.
    if(loaded && authState && (jwtAal(authState.access_token)==='aal2' || passwordOnlyMode) &&
      !document.querySelector('.modal-backdrop') && data?.currentRole)render();
  }catch(error){console.warn('IMEC UTI: atualização de fundo indisponível.')}
  finally{backgroundRefreshInFlight=false}
}

function updateNetworkStatus(){
  const el=document.getElementById('networkStatus');if(!el)return;
  const offline=navigator.onLine===false;
  el.textContent=offline?'Sem conexão. O IMEC UTI funciona somente online; os dados exibidos podem estar desatualizados.':'';
  el.classList.toggle('show',offline);
  document.documentElement.dataset.network=offline?'offline':'online';
}
function initPwa(){
  updateNetworkStatus();
  window.addEventListener('offline',updateNetworkStatus);
  window.addEventListener('online',()=>{updateNetworkStatus();toast('Conexão restabelecida.');backgroundRefresh()});
  if('serviceWorker' in navigator){
    window.addEventListener('load',()=>{
      navigator.serviceWorker.register('/imec-uti/sw.js',{scope:'/imec-uti/'}).catch(err=>console.warn('PWA registration',err));
    },{once:true});
  }
}


document.addEventListener('click',async e=>{
  const nav=e.target.closest('[data-nav]');
  if(nav){
    state.page=nav.dataset.nav;
    state.selectedId=null;
    if(state.page==='reports')loadMonthlyReport();else render();
    // The new main node already exists. A deferred focus can steal the cursor
    // from a field the user starts editing immediately after navigation.
    document.getElementById('content')?.focus();
    return;
  }
  const action=e.target.closest('[data-action]');
  if(!action)return;
  const type=action.dataset.action;
  if(type==='new'){newAdmissionModal();return}
  if(type!=='export')return;
  if(data.currentRole!=='admin'){alert('A exportação é restrita aos administradores.');return}
  const approved=window.confirm('Esta exportação pode conter dados pessoais e financeiros de pacientes. Salve o arquivo apenas em local institucional seguro. Deseja continuar?');
  if(!approved)return;
  try{
    setLoading(true,'Auditando exportação…');
    await rpc('log_uti_data_export',{});
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;
    link.download=`imec-uti-dados-visiveis-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    toast('Exportação registrada e arquivo gerado.');
  }catch(err){
    alert('Não foi possível auditar a exportação; o download foi bloqueado. '+(err?.message||''));
  }finally{setLoading(false)}
});
setInterval(backgroundRefresh,45000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')backgroundRefresh()});
initPwa();
boot();
