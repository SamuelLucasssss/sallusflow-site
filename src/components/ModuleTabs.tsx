import { useState } from 'react';

type Module = {
  id: string;
  accent: string;
  title: string;
  headline: string;
  description: string;
  metrics: [string, string, string];
};

const modules: Module[] = [
  {
    id: 'executivo',
    accent: 'M0',
    title: 'Executivo',
    headline: 'Visão de comando para diretoria e coordenação.',
    description: 'Indicadores, riscos, gargalos e próxima melhor ação em uma leitura objetiva para decisão rápida.',
    metrics: ['Mapa de risco', 'Ação recomendada', 'Leitura mensal'],
  },
  {
    id: 'crm',
    accent: 'M1',
    title: 'CRM Oncológico',
    headline: 'Indicação acompanhada até virar tratamento.',
    description: 'Controle de origem, médicos indicadores, pós-consulta, pendências e conversão sem depender de memória ou WhatsApp solto.',
    metrics: ['Funil ativo', 'Pós-consulta', 'Médicos indicadores'],
  },
  {
    id: 'pacientes',
    accent: 'M2',
    title: 'Pacientes',
    headline: 'Carteira organizada por status e prioridade.',
    description: 'Linha operacional do paciente com status, pendências, responsável e sinais de atenção para reduzir perda de acompanhamento.',
    metrics: ['Carteira ativa', 'Responsável', 'Pendências'],
  },
  {
    id: 'guias',
    accent: 'M3',
    title: 'Guias',
    headline: 'Autorização, validade e saldo no radar.',
    description: 'Controle de guias para proteger produção, reduzir glosas evitáveis e antecipar vencimentos críticos.',
    metrics: ['Validade', 'Saldo', 'Risco de glosa'],
  },
  {
    id: 'financeiro',
    accent: 'M4',
    title: 'Financeiro',
    headline: 'Da produção ao recebimento, com rastro.',
    description: 'Faturamento, glosa, recurso e recebimento conectados ao fluxo operacional para revelar perda e previsibilidade.',
    metrics: ['Produção', 'Glosa', 'Recebimento'],
  },
];

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
        <div className="module-screen">
          <div><b>Prioridade</b><b>Indicador</b><b>Ação</b></div>
          <div><span>Alta</span><span>{active.metrics[0]}</span><mark>Executar</mark></div>
          <div><span>Média</span><span>{active.metrics[1]}</span><mark>Revisar</mark></div>
          <div><span>Controle</span><span>{active.metrics[2]}</span><mark>Monitorar</mark></div>
        </div>
      </div>
    </div>
  );
}
