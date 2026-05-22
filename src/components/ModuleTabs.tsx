import { useState } from 'react';

/* ── Previews por módulo (dados 100% fictícios) ─────────────────── */

function PreviewExecutivo() {
  return (
    <div className="mod-preview-inner">
      <div className="mod-kpi-row">
        <div className="mod-kpi-card risk-high">
          <small>RISCO ALTO</small>
          <strong>3</strong>
          <em>áreas críticas</em>
        </div>
        <div className="mod-kpi-card risk-mid">
          <small>EM REVISÃO</small>
          <strong>7</strong>
          <em>pendências ativas</em>
        </div>
        <div className="mod-kpi-card risk-ok">
          <small>META MENSAL</small>
          <strong>87%</strong>
          <em>conversão</em>
        </div>
      </div>
      <div className="mod-table">
        <div className="mod-table-head">
          <span>Área</span><span>Risco</span><span>Ação recomendada</span>
        </div>
        <div className="mod-table-row">
          <span>CRM</span>
          <span className="badge-risk high">Alto</span>
          <span>Seguimento pós-consulta</span>
        </div>
        <div className="mod-table-row">
          <span>Guias</span>
          <span className="badge-risk mid">Médio</span>
          <span>Vencimento em 5 dias</span>
        </div>
        <div className="mod-table-row">
          <span>Financeiro</span>
          <span className="badge-risk ok">Controle</span>
          <span>Faturamento enviado</span>
        </div>
      </div>
    </div>
  );
}

function PreviewCRM() {
  return (
    <div className="mod-preview-inner">
      <div className="mod-funnel">
        <div className="mod-funnel-stage">
          <div className="funnel-bar" style={{ width: '100%' }}>
            <span className="funnel-label">Indicação</span>
            <strong>142</strong>
          </div>
        </div>
        <div className="mod-funnel-stage">
          <div className="funnel-bar" style={{ width: '85%' }}>
            <span className="funnel-label">Consulta</span>
            <strong>121</strong>
          </div>
        </div>
        <div className="mod-funnel-stage">
          <div className="funnel-bar" style={{ width: '62%' }}>
            <span className="funnel-label">Conduta</span>
            <strong>89</strong>
          </div>
        </div>
        <div className="mod-funnel-stage">
          <div className="funnel-bar funnel-active" style={{ width: '38%' }}>
            <span className="funnel-label">Tratamento</span>
            <strong>47</strong>
          </div>
        </div>
      </div>
      <div className="mod-stat-row">
        <span><b>33,1%</b> conversão total</span>
        <span><b>11</b> aguardam contato</span>
        <span><b>9</b> pendências QA</span>
      </div>
    </div>
  );
}

function PreviewPacientes() {
  const rows = [
    { init: 'A', name: 'Ana M.', status: 'Ativo', resp: 'Dr. Silva', pend: 'Guia pendente', color: 'ok' },
    { init: 'J', name: 'João P.', status: 'Atenção', resp: 'Dra. Costa', pend: 'Pós-consulta', color: 'mid' },
    { init: 'M', name: 'Maria L.', status: 'Tratamento', resp: 'Dr. Lima', pend: '—', color: 'ok' },
    { init: 'C', name: 'Carlos R.', status: 'Revisão', resp: 'Dra. Souza', pend: 'Conduta', color: 'high' },
  ];
  return (
    <div className="mod-preview-inner">
      <div className="mod-table">
        <div className="mod-table-head">
          <span>Paciente</span><span>Status</span><span>Responsável</span><span>Pendência</span>
        </div>
        {rows.map((r) => (
          <div className="mod-table-row" key={r.name}>
            <span className="pat-name">
              <span className="pat-avatar">{r.init}</span>{r.name}
            </span>
            <span className={`badge-risk ${r.color}`}>{r.status}</span>
            <span>{r.resp}</span>
            <span className="pat-pend">{r.pend}</span>
          </div>
        ))}
      </div>
      <div className="mod-stat-row">
        <span><b>47</b> carteira ativa</span>
        <span><b>6</b> sinais de atenção</span>
        <span><b>100%</b> com responsável</span>
      </div>
    </div>
  );
}

function PreviewGuias() {
  const rows = [
    { conv: 'Unimed',     val: '3 dias',   saldo: 'R$ 4.200',  risco: 'Crítico',  color: 'high' },
    { conv: 'Bradesco',   val: '18 dias',  saldo: 'R$ 8.750',  risco: 'Atenção',  color: 'mid' },
    { conv: 'Amil',       val: '45 dias',  saldo: 'R$ 12.300', risco: 'OK',       color: 'ok' },
    { conv: 'SulAmérica', val: '60 dias',  saldo: 'R$ 6.100',  risco: 'OK',       color: 'ok' },
  ];
  return (
    <div className="mod-preview-inner">
      <div className="mod-table">
        <div className="mod-table-head">
          <span>Convênio</span><span>Validade</span><span>Saldo</span><span>Risco</span>
        </div>
        {rows.map((r) => (
          <div className="mod-table-row" key={r.conv}>
            <span>{r.conv}</span>
            <span className={r.color === 'high' ? 'txt-orange' : ''}>{r.val}</span>
            <span>{r.saldo}</span>
            <span className={`badge-risk ${r.color}`}>{r.risco}</span>
          </div>
        ))}
      </div>
      <div className="mod-stat-row">
        <span><b>1</b> guia crítica</span>
        <span><b>R$ 31.350</b> em saldo</span>
        <span><b>0</b> glosas evitáveis</span>
      </div>
    </div>
  );
}

function PreviewFinanceiro() {
  const rows = [
    { comp: 'Jan/25', prod: 'R$ 142k', glosa: 'R$ 8k',  rec: 'R$ 3k', recv: 'R$ 137k', open: false },
    { comp: 'Fev/25', prod: 'R$ 158k', glosa: 'R$ 5k',  rec: 'R$ 5k', recv: 'R$ 158k', open: false },
    { comp: 'Mar/25', prod: 'R$ 163k', glosa: 'R$ 11k', rec: '—',     recv: 'R$ 152k', open: true  },
  ];
  return (
    <div className="mod-preview-inner">
      <div className="mod-table">
        <div className="mod-table-head">
          <span>Competência</span><span>Produção</span><span>Glosa</span><span>Recurso</span><span>Recebido</span>
        </div>
        {rows.map((r) => (
          <div className="mod-table-row" key={r.comp}>
            <span>{r.comp}</span>
            <span className="txt-bold">{r.prod}</span>
            <span className={r.glosa !== 'R$ 5k' ? 'txt-orange' : ''}>{r.glosa}</span>
            <span>{r.rec}</span>
            <span>
              {r.recv}
              {r.open && <span className="badge-open">em aberto</span>}
            </span>
          </div>
        ))}
      </div>
      <div className="mod-stat-row">
        <span><b>R$ 463k</b> produção trim.</span>
        <span><b>5,2%</b> taxa de glosa</span>
        <span><b>R$ 8k</b> em recurso</span>
      </div>
    </div>
  );
}

/* ── Dados dos módulos ────────────────────────────────────────────── */

type Module = {
  id: string;
  accent: string;
  title: string;
  headline: string;
  description: string;
  metrics: [string, string, string];
  Preview: () => React.ReactElement;
};

const modules: Module[] = [
  {
    id: 'executivo',
    accent: 'M0',
    title: 'Executivo',
    headline: 'Visão de comando para diretoria e coordenação.',
    description: 'Indicadores, riscos, gargalos e próxima melhor ação em uma leitura objetiva para decisão rápida.',
    metrics: ['Mapa de risco', 'Ação recomendada', 'Leitura mensal'],
    Preview: PreviewExecutivo,
  },
  {
    id: 'crm',
    accent: 'M1',
    title: 'CRM Oncológico',
    headline: 'Indicação acompanhada até virar tratamento.',
    description: 'Controle de origem, médicos indicadores, pós-consulta, pendências e conversão sem depender de memória ou WhatsApp solto.',
    metrics: ['Funil ativo', 'Pós-consulta', 'Médicos indicadores'],
    Preview: PreviewCRM,
  },
  {
    id: 'pacientes',
    accent: 'M2',
    title: 'Pacientes',
    headline: 'Carteira organizada por status e prioridade.',
    description: 'Linha operacional do paciente com status, pendências, responsável e sinais de atenção para reduzir perda de acompanhamento.',
    metrics: ['Carteira ativa', 'Responsável', 'Pendências'],
    Preview: PreviewPacientes,
  },
  {
    id: 'guias',
    accent: 'M3',
    title: 'Guias',
    headline: 'Autorização, validade e saldo no radar.',
    description: 'Controle de guias para proteger produção, reduzir glosas evitáveis e antecipar vencimentos críticos.',
    metrics: ['Validade', 'Saldo', 'Risco de glosa'],
    Preview: PreviewGuias,
  },
  {
    id: 'financeiro',
    accent: 'M4',
    title: 'Financeiro',
    headline: 'Da produção ao recebimento, com rastro.',
    description: 'Faturamento, glosa, recurso e recebimento conectados ao fluxo operacional para revelar perda e previsibilidade.',
    metrics: ['Produção', 'Glosa', 'Recebimento'],
    Preview: PreviewFinanceiro,
  },
];

/* ── Componente principal ─────────────────────────────────────────── */

export default function ModuleTabs() {
  const [activeId, setActiveId] = useState(modules[1].id);
  const active = modules.find((m) => m.id === activeId) ?? modules[0];

  return (
    <div className="module-lab">
      <div className="module-tabs" role="tablist" aria-label="Módulos do produto">
        {modules.map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={active.id === m.id}
            className={active.id === m.id ? 'active' : ''}
            onClick={() => setActiveId(m.id)}
            type="button"
          >
            <small>{m.accent}</small>
            {m.title}
          </button>
        ))}
      </div>

      <div key={active.id} className="module-preview" role="tabpanel">
        <p className="eyebrow">{active.accent} · {active.title}</p>
        <h3>{active.headline}</h3>
        <p>{active.description}</p>
        <div className="module-metrics">
          {active.metrics.map((metric) => (
            <span key={metric}>{metric}</span>
          ))}
        </div>
        <div className="module-screen-v2">
          <div className="module-screen-topbar">
            <span className="ms-breadcrumb">{active.accent} · {active.title}</span>
            <span className="ms-live"><i></i>AO VIVO</span>
          </div>
          <active.Preview />
        </div>
      </div>
    </div>
  );
}
