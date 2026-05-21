import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

type ProductModule = {
  id: string;
  title: string;
  headline: string;
  description: string;
  metrics: string[];
  accent: string;
};

const whatsappMessage = encodeURIComponent('Olá! Quero conhecer o Sallus Flow e entender como aplicar na gestão oncológica.');
const whatsappUrl = `https://wa.me/5562992499048?text=${whatsappMessage}`;
const systemUrl = 'https://oncologia.sallusflow.com.br';

const productModules: ProductModule[] = [
  {
    id: 'executivo',
    title: 'Executivo',
    headline: 'Visão de comando para diretoria e coordenação.',
    description: 'Indicadores, riscos, gargalos e próxima melhor ação em uma leitura objetiva para decisão rápida.',
    metrics: ['Mapa de risco', 'Ação recomendada', 'Leitura mensal'],
    accent: 'M0',
  },
  {
    id: 'crm',
    title: 'CRM Oncológico',
    headline: 'Indicação acompanhada até virar tratamento.',
    description: 'Controle de origem, médicos indicadores, pós-consulta, pendências e conversão sem depender de memória ou WhatsApp solto.',
    metrics: ['Funil ativo', 'Pós-consulta', 'Médicos indicadores'],
    accent: 'M1',
  },
  {
    id: 'pacientes',
    title: 'Pacientes',
    headline: 'Carteira organizada por status e prioridade.',
    description: 'Linha operacional do paciente com status, pendências, responsável e sinais de atenção para reduzir perda de acompanhamento.',
    metrics: ['Carteira ativa', 'Responsável', 'Pendências'],
    accent: 'M2',
  },
  {
    id: 'guias',
    title: 'Guias',
    headline: 'Autorização, validade e saldo no radar.',
    description: 'Controle de guias para proteger produção, reduzir glosas evitáveis e antecipar vencimentos críticos.',
    metrics: ['Validade', 'Saldo', 'Risco de glosa'],
    accent: 'M3',
  },
  {
    id: 'financeiro',
    title: 'Financeiro',
    headline: 'Da produção ao recebimento, com rastro.',
    description: 'Faturamento, glosa, recurso e recebimento conectados ao fluxo operacional para revelar perda e previsibilidade.',
    metrics: ['Produção', 'Glosa', 'Recebimento'],
    accent: 'M4',
  },
];

const flowSteps = ['Indicação', 'Consulta', 'Paciente', 'Guia', 'Produção', 'Faturamento', 'Glosa/Recurso', 'Recebimento'];

const decisionLoop = [
  ['Sinal', 'O sistema identifica pendência, atraso, guia em risco ou gargalo operacional.'],
  ['Diagnóstico', 'A gestão entende o motivo: origem, etapa, responsável e impacto provável.'],
  ['Ação', 'A equipe sabe o que precisa ser feito primeiro, sem caçar informação em cinco lugares.'],
  ['Evidência', 'O histórico fica organizado para auditoria, aprendizado e melhoria contínua.'],
];

const audiences = [
  'Clínicas oncológicas',
  'Ambulatórios hospitalares',
  'Gestores de saúde',
  'Faturamento e auditoria',
  'Coordenação assistencial',
  'Diretoria executiva',
];

const implementationSteps = [
  ['01', 'Mapear fluxo real', 'Entender como a indicação nasce, como vira consulta, onde a guia trava e onde a receita se perde.'],
  ['02', 'Organizar base', 'Padronizar campos, status, responsáveis, convênios e pontos críticos antes de automatizar qualquer coisa.'],
  ['03', 'Ativar rotina', 'Treinar equipe, definir donos por etapa e transformar o painel em ritual semanal de decisão.'],
  ['04', 'Evoluir por evidência', 'Ajustar indicadores, alertas e módulos conforme a operação amadurece. Sem chute. Com rastro.'],
];

const faqs = [
  ['O Sallus Flow substitui o sistema hospitalar?', 'Não. Ele atua como camada de inteligência operacional, conectando pontos que normalmente ficam espalhados entre CRM, pacientes, guias, faturamento e decisão.'],
  ['É um sistema assistencial ou de diagnóstico?', 'Não. O foco é gestão operacional oncológica. Ele não realiza diagnóstico médico nem substitui conduta clínica.'],
  ['Precisa usar todos os módulos desde o começo?', 'Não. A implantação pode começar pelo fluxo mais crítico, como CRM, guias ou visão executiva, e evoluir em etapas.'],
  ['Os dados do site são reais?', 'Não. Toda demonstração pública deve usar dados fictícios ou mascarados. Dado sensível de saúde não é peça de vitrine.'],
];

function App() {
  const [activeModule, setActiveModule] = useState(productModules[1].id);
  const selectedModule = productModules.find((item) => item.id === activeModule) ?? productModules[0];

  return (
    <main className="site-shell">
      <header className="header">
        <a className="brand" href="#top" aria-label="Sallus Flow">
          <span className="brand-mark"><i /></span>
          <strong>Sallus<span>Flow</span></strong>
        </a>
        <nav aria-label="Navegação principal">
          <a href="#problema">Problema</a>
          <a href="#fluxo">Fluxo</a>
          <a href="#modulos">Módulos</a>
          <a href="#governanca">Governança</a>
        </nav>
        <div className="header-actions">
          <a className="ghost-link" href="mailto:contato@sallusflow.com.br">Contato</a>
          <a className="button small" href={systemUrl} target="_blank" rel="noreferrer">Acessar sistema</a>
        </div>
      </header>

      <section id="top" className="hero section-grid">
        <div className="hero-copy reveal">
          <p className="eyebrow">SALLUS FLOW · INTELIGÊNCIA OPERACIONAL EM ONCOLOGIA</p>
          <h1>O fluxo inteligente entre indicação, tratamento, guia e receita.</h1>
          <p className="lead">Sallus Flow conecta CRM, pacientes, autorizações, faturamento e indicadores para transformar a operação oncológica em comando executivo.</p>
          <div className="hero-actions">
            <a className="button primary" href={whatsappUrl} target="_blank" rel="noreferrer">Solicitar demonstração</a>
            <a className="button secondary" href={systemUrl} target="_blank" rel="noreferrer">Entrar no sistema</a>
          </div>
          <div className="trust-row" aria-label="Diferenciais principais">
            <span><b>01</b> fluxo único</span>
            <span><b>05</b> módulos conectados</span>
            <span><b>100%</b> foco operacional</span>
          </div>
        </div>

        <div className="product-stage reveal delay-1" aria-label="Prévia visual do painel Sallus Flow">
          <div className="screen-glow" />
          <div className="browser-frame">
            <div className="browser-top"><span /><span /><span /><strong>oncologia.sallusflow.com.br</strong></div>
            <div className="command-panel">
              <aside className="side-rail">
                <strong>§ Sallus Flow</strong>
                {productModules.map((item) => <span key={item.id}>{item.accent} · {item.title}</span>)}
              </aside>
              <section className="dashboard-preview">
                <div className="preview-head">
                  <p className="eyebrow">CENTRAL DE COMANDO</p>
                  <span>AO VIVO</span>
                </div>
                <h2>Próxima melhor ação antes que a operação vire prejuízo.</h2>
                <div className="kpi-grid">
                  <article><small>CRM ativo</small><strong>67</strong><em>12 aguardam retorno</em></article>
                  <article><small>Pacientes</small><strong>153</strong><em>carteira demonstrativa</em></article>
                  <article><small>Guias em risco</small><strong>07</strong><em>validade próxima</em></article>
                </div>
                <div className="ops-table">
                  <div><b>Prioridade</b><b>Módulo</b><b>Status</b></div>
                  <div><span>Alta</span><span>Guia vencendo</span><mark>Agir hoje</mark></div>
                  <div><span>Média</span><span>Pós-consulta sem retorno</span><mark>Revisar</mark></div>
                  <div><span>Baixa</span><span>Cadastro incompleto</span><mark>QA</mark></div>
                </div>
                <div className="preview-footer">
                  <span>Produção → Faturamento → Glosa → Recurso → Recebimento</span>
                  <b>Rastro operacional</b>
                </div>
              </section>
            </div>
          </div>
        </div>
      </section>

      <section className="impact-strip" aria-label="Resumo de posicionamento">
        <article><span>Não é planilha bonita.</span><b>É fluxo operacional.</b></article>
        <article><span>Não é BI decorativo.</span><b>É prioridade de ação.</b></article>
        <article><span>Não é controle isolado.</span><b>É jornada conectada.</b></article>
      </section>

      <section id="problema" className="section problem-section">
        <div className="section-title">
          <p className="eyebrow">01 · ANTES DO FLOW</p>
          <h2>A operação oncológica perde força quando o fluxo fica espalhado.</h2>
        </div>
        <div className="before-after">
          <article className="bad-card">
            <span>Antes</span>
            <h3>Planilhas, mensagens e memória da equipe.</h3>
            <ul>
              <li>Indicações sem rastreio claro.</li>
              <li>Guias vencendo no silêncio.</li>
              <li>Faturamento separado da produção.</li>
              <li>Diretoria enxergando tarde demais.</li>
            </ul>
          </article>
          <article className="good-card">
            <span>Depois</span>
            <h3>Fluxo único, alerta e comando executivo.</h3>
            <ul>
              <li>CRM conectado ao paciente.</li>
              <li>Risco operacional em evidência.</li>
              <li>Guia, glosa e receita no mesmo mapa.</li>
              <li>Decisão com prioridade, não achismo.</li>
            </ul>
          </article>
        </div>
      </section>

      <section id="fluxo" className="section flow-section">
        <div className="section-title center">
          <p className="eyebrow">02 · O CONCEITO FLOW</p>
          <h2>Da indicação ao recebimento, sem perder o fio da operação.</h2>
        </div>
        <div className="flow-line">
          {flowSteps.map((step, index) => (
            <article key={step}>
              <b>{String(index + 1).padStart(2, '0')}</b>
              <span>{step}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="section loop-section">
        <div className="section-title">
          <p className="eyebrow">03 · DA INFORMAÇÃO À AÇÃO</p>
          <h2>O sistema precisa dizer onde apertar o parafuso, não apenas mostrar o painel.</h2>
        </div>
        <div className="loop-grid">
          {decisionLoop.map(([title, text], index) => (
            <article key={title}>
              <b>{String(index + 1).padStart(2, '0')}</b>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="modulos" className="section modules-section">
        <div className="section-title">
          <p className="eyebrow">04 · MÓDULOS CONECTADOS</p>
          <h2>Um sistema que acompanha a rotina real, não uma apresentação bonita.</h2>
        </div>
        <div className="module-lab">
          <div className="module-tabs" role="tablist" aria-label="Módulos do produto">
            {productModules.map((item) => (
              <button key={item.id} className={selectedModule.id === item.id ? 'active' : ''} onClick={() => setActiveModule(item.id)} type="button">
                <small>{item.accent}</small>
                {item.title}
              </button>
            ))}
          </div>
          <div className="module-preview">
            <p className="eyebrow">{selectedModule.accent} · {selectedModule.title}</p>
            <h3>{selectedModule.headline}</h3>
            <p>{selectedModule.description}</p>
            <div className="module-metrics">
              {selectedModule.metrics.map((metric) => <span key={metric}>{metric}</span>)}
            </div>
            <div className="module-screen">
              <div><b>Prioridade</b><b>Indicador</b><b>Ação</b></div>
              <div><span>Alta</span><span>{selectedModule.metrics[0]}</span><mark>Executar</mark></div>
              <div><span>Média</span><span>{selectedModule.metrics[1]}</span><mark>Revisar</mark></div>
              <div><span>Controle</span><span>{selectedModule.metrics[2]}</span><mark>Monitorar</mark></div>
            </div>
          </div>
        </div>
      </section>

      <section className="section intelligence-section">
        <div className="section-title center">
          <p className="eyebrow">05 · INTELIGÊNCIA OPERACIONAL</p>
          <h2>O Sallus Flow não apenas guarda dados. Ele revela prioridade.</h2>
        </div>
        <div className="signal-grid">
          <article><span>Próxima melhor ação</span><strong>Hoje</strong><p>Mostra onde a equipe precisa agir primeiro.</p></article>
          <article><span>QA cadastral</span><strong>3</strong><p>Campos críticos incompletos antes do erro virar rotina.</p></article>
          <article><span>Risco de guia</span><strong>7</strong><p>Autorizações em atenção por validade ou saldo.</p></article>
          <article><span>Perda operacional</span><strong>R$</strong><p>Produção, glosa e recebimento vistos no mesmo fluxo.</p></article>
        </div>
      </section>

      <section className="section audience-section">
        <div className="section-title">
          <p className="eyebrow">06 · PARA QUEM É</p>
          <h2>Feito para equipes que precisam sair do improviso sem perder a realidade da operação.</h2>
        </div>
        <div className="audience-grid">
          {audiences.map((audience) => <article key={audience}>{audience}</article>)}
        </div>
      </section>

      <section className="section implementation-section">
        <div className="section-title center">
          <p className="eyebrow">07 · IMPLANTAÇÃO EM ETAPAS</p>
          <h2>Começa pequeno, fica sério e cresce com a operação.</h2>
        </div>
        <div className="implementation-grid">
          {implementationSteps.map(([number, title, text]) => (
            <article key={number}>
              <b>{number}</b>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="governanca" className="section governance-section">
        <div>
          <p className="eyebrow">08 · GOVERNANÇA</p>
          <h2>Saúde exige tecnologia com responsabilidade.</h2>
        </div>
        <p>O Sallus Flow é desenhado com princípios de rastreabilidade, organização e cuidado com dados sensíveis. Sem prometer milagre jurídico: o foco é construir uma base operacional mais segura, auditável e madura.</p>
      </section>

      <section className="section faq-section">
        <div className="section-title">
          <p className="eyebrow">09 · PERGUNTAS IMPORTANTES</p>
          <h2>Sem promessa solta. Sem fumaça de palco.</h2>
        </div>
        <div className="faq-list">
          {faqs.map(([question, answer]) => (
            <details key={question}>
              <summary>{question}</summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section id="contato" className="final-cta">
        <p className="eyebrow">PRÓXIMO PASSO</p>
        <h2>Pare de administrar oncologia no escuro.</h2>
        <p>Leve a operação para um ambiente onde indicação, paciente, guia, faturamento e decisão conversam entre si.</p>
        <div className="hero-actions center-actions">
          <a className="button primary" href={whatsappUrl} target="_blank" rel="noreferrer">Falar no WhatsApp</a>
          <a className="button secondary dark-button" href="mailto:contato@sallusflow.com.br">contato@sallusflow.com.br</a>
        </div>
        <small>Sistema: oncologia.sallusflow.com.br · WhatsApp: 62 9 9249-9048</small>
      </section>

      <footer>© {new Date().getFullYear()} Sallus Flow · www.sallusflow.com.br</footer>
    </main>
  );
}

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
