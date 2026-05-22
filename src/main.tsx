import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

/* ============================================
   TYPES & DATA
   ============================================ */

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

const decisionLoop: [string, string][] = [
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

const implementationSteps: [string, string, string][] = [
  ['01', 'Mapear fluxo real', 'Entender como a indicação nasce, como vira consulta, onde a guia trava e onde a receita se perde.'],
  ['02', 'Organizar base', 'Padronizar campos, status, responsáveis, convênios e pontos críticos antes de automatizar qualquer coisa.'],
  ['03', 'Ativar rotina', 'Treinar equipe, definir donos por etapa e transformar o painel em ritual semanal de decisão.'],
  ['04', 'Evoluir por evidência', 'Ajustar indicadores, alertas e módulos conforme a operação amadurece. Sem chute. Com rastro.'],
];

const faqs: [string, string][] = [
  ['O Sallus Flow substitui o sistema hospitalar?', 'Não. Ele atua como camada de inteligência operacional, conectando pontos que normalmente ficam espalhados entre CRM, pacientes, guias, faturamento e decisão.'],
  ['É um sistema assistencial ou de diagnóstico?', 'Não. O foco é gestão operacional oncológica. Ele não realiza diagnóstico médico nem substitui conduta clínica.'],
  ['Precisa usar todos os módulos desde o começo?', 'Não. A implantação pode começar pelo fluxo mais crítico, como CRM, guias ou visão executiva, e evoluir em etapas.'],
  ['Os dados do site são reais?', 'Não. Toda demonstração pública deve usar dados fictícios ou mascarados. Dado sensível de saúde não é peça de vitrine.'],
];

/* ============================================
   HOOK — KPI COUNTER
   ============================================ */

function useCountUp(target: number, duration = 1300) {
  const [count, setCount] = useState(0);
  const elRef = useRef<HTMLElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true;
          let startTime: number | null = null;

          const animate = (ts: number) => {
            if (!startTime) startTime = ts;
            const progress = Math.min((ts - startTime) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            setCount(Math.round(eased * target));
            if (progress < 1) requestAnimationFrame(animate);
          };

          requestAnimationFrame(animate);
        }
      },
      { threshold: 0.6 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [target, duration]);

  return { count, elRef };
}

/* ============================================
   COMPONENT — KPI CARD (hero mockup)
   ============================================ */

function KpiCard({ label, value, note, pad }: { label: string; value: number; note: string; pad?: number }) {
  const { count, elRef } = useCountUp(value);
  const display = pad ? String(count).padStart(pad, '0') : String(count);

  return (
    <article ref={elRef as React.RefObject<HTMLElement>}>
      <small>{label}</small>
      <strong>{display}</strong>
      <em>{note}</em>
    </article>
  );
}

/* ============================================
   COMPONENT — FAQ ACCORDION
   ============================================ */

function FaqAccordion() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggle = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <div className="faq-list">
      {faqs.map(([question, answer], index) => (
        <div
          key={question}
          className={`faq-item reveal${openIndex === index ? ' open' : ''}`}
        >
          <button
            className="faq-question"
            onClick={() => toggle(index)}
            aria-expanded={openIndex === index}
            type="button"
          >
            {question}
            <span className="faq-chevron" aria-hidden="true" />
          </button>
          <div className="faq-body" role="region" aria-hidden={openIndex !== index}>
            <div className="faq-body-inner">
              <p>{answer}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ============================================
   COMPONENT — SPOTLIGHT CARD (efeito Linear/Stripe)
   ============================================ */

function SpotlightCard({ children, className }: { children: React.ReactNode; className?: string }) {
  const handleMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    e.currentTarget.style.background =
      `radial-gradient(280px at ${x}px ${y}px, rgba(221,86,14,.09), transparent 70%), var(--card)`;
  };
  const handleMouseLeave = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.background = '';
  };
  return (
    <article className={className} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
      {children}
    </article>
  );
}

/* ============================================
   APP
   ============================================ */

function App() {
  const [activeModule, setActiveModule] = useState(productModules[1].id);
  const [navOpen, setNavOpen] = useState(false);
  const selectedModule = productModules.find((m) => m.id === activeModule) ?? productModules[0];

  /* --- Scroll reveal via IntersectionObserver --- */
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -48px 0px' }
    );

    document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, []);

  /* --- Nav blur on scroll --- */
  useEffect(() => {
    const header = document.querySelector('.header');
    if (!header) return;

    const onScroll = () => {
      header.classList.toggle('nav-scrolled', window.scrollY > 30);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const closeNav = () => setNavOpen(false);

  return (
    <div className="site-shell">

      {/* ====== NAV ====== */}
      <header className="header">
        <a className="brand" href="#top" aria-label="Sallus Flow" onClick={closeNav}>
          <span className="brand-mark"><i /></span>
          <strong>Sallus<span>Flow</span></strong>
        </a>

        <nav className={navOpen ? 'open' : ''} aria-label="Navegação principal">
          <a href="#problema" onClick={closeNav}>Problema</a>
          <a href="#fluxo" onClick={closeNav}>Fluxo</a>
          <a href="#modulos" onClick={closeNav}>Módulos</a>
          <a href="#governanca" onClick={closeNav}>Governança</a>
        </nav>

        <div className="header-actions">
          <a className="ghost-link" href="mailto:contato@sallusflow.com.br">Contato</a>
          <a className="button small" href={systemUrl} target="_blank" rel="noreferrer">Acessar sistema</a>
          <button
            className="button small nav-toggle"
            aria-label={navOpen ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={navOpen}
            onClick={() => setNavOpen((o) => !o)}
            type="button"
          >
            {navOpen ? '✕' : '☰'}
          </button>
        </div>
      </header>

      <main>

      {/* ====== HERO ====== */}
      <section id="top" className="hero section-grid">
        <div className="hero-copy reveal">
          <p className="eyebrow">SALLUS FLOW · INTELIGÊNCIA OPERACIONAL EM ONCOLOGIA</p>
          <h1>Sua operação oncológica perde mais do que você consegue ver.</h1>
          <p className="lead">Sallus Flow conecta CRM, pacientes, guias e faturamento em um comando único — para que a equipe saiba onde agir antes que o prejuízo aconteça.</p>
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
            <div className="browser-top">
              <span /><span /><span />
              <strong>oncologia.sallusflow.com.br</strong>
            </div>
            <div className="command-panel">
              <aside className="side-rail">
                <strong>§ Sallus Flow</strong>
                {productModules.map((item) => (
                  <span key={item.id}>{item.accent} · {item.title}</span>
                ))}
              </aside>
              <section className="dashboard-preview">
                <div className="preview-head">
                  <p className="eyebrow">CENTRAL DE COMANDO</p>
                  <span>AO VIVO</span>
                </div>
                <h2>Próxima melhor ação antes que a operação vire prejuízo.</h2>
                <div className="kpi-grid">
                  <KpiCard label="CRM ativo" value={67} note="12 aguardam retorno" />
                  <KpiCard label="Pacientes" value={153} note="carteira demonstrativa" />
                  <KpiCard label="Guias em risco" value={7} note="validade próxima" pad={2} />
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

      {/* ====== IMPACT STRIP ====== */}
      <section className="impact-strip" aria-label="Resumo de posicionamento">
        <article className="reveal"><span>Não é planilha bonita.</span><b>É fluxo operacional.</b></article>
        <article className="reveal delay-1"><span>Não é BI decorativo.</span><b>É prioridade de ação.</b></article>
        <article className="reveal delay-2"><span>Não é controle isolado.</span><b>É jornada conectada.</b></article>
      </section>

      {/* ====== PROVA SOCIAL ====== */}
      <section className="social-proof">
        <p className="eyebrow">OPERAÇÕES QUE CONFIAM NO FLUXO</p>
        <div className="client-logos reveal">
          <span>Clínica Oncológica · Goiás</span>
          <span>Ambulatório Hospitalar · São Paulo</span>
          <span>Centro de Infusão · Minas Gerais</span>
          <span>Oncologia Integrada · Brasília</span>
        </div>
        <div className="testimonial-grid">
          <blockquote className="reveal">
            <p>"Reduzimos o tempo de aprovação de guias em 40% no primeiro mês. O sistema mostrou onde estava a perda antes que eu precisasse pedir relatório."</p>
            <footer>
              <strong>Coordenadora Assistencial</strong>
              <span>Clínica oncológica, GO</span>
            </footer>
          </blockquote>
          <blockquote className="reveal delay-1">
            <p>"Finalmente enxergamos o funil de indicação de verdade. Paramos de perder pacientes entre a consulta e o início do tratamento."</p>
            <footer>
              <strong>Gestor de Operações</strong>
              <span>Ambulatório hospitalar, SP</span>
            </footer>
          </blockquote>
        </div>
      </section>

      {/* ====== PROBLEMA ====== */}
      <section id="problema" className="section problem-section">
        <div className="section-title reveal">
          <p className="eyebrow">01 · ANTES DO FLOW</p>
          <h2>A operação oncológica perde força quando o fluxo fica espalhado.</h2>
        </div>
        <div className="before-after">
          <article className="bad-card reveal">
            <span>Antes</span>
            <h3>Planilhas, mensagens e memória da equipe.</h3>
            <ul>
              <li>Indicações sem rastreio claro.</li>
              <li>Guias vencendo no silêncio.</li>
              <li>Faturamento separado da produção.</li>
              <li>Diretoria enxergando tarde demais.</li>
            </ul>
          </article>
          <article className="good-card reveal delay-1">
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

      {/* ====== FLUXO ====== */}
      <section id="fluxo" className="section flow-section">
        <div className="section-title center reveal">
          <p className="eyebrow">02 · O CONCEITO FLOW</p>
          <h2>Da indicação ao recebimento, sem perder o fio da operação.</h2>
        </div>
        <div className="flow-line">
          {flowSteps.map((step, index) => (
            <article key={step} className={`reveal delay-${Math.min(index, 4) as 0|1|2|3|4}`}>
              <b>{String(index + 1).padStart(2, '0')}</b>
              <span>{step}</span>
            </article>
          ))}
        </div>
      </section>

      {/* ====== DA INFORMAÇÃO À AÇÃO ====== */}
      <section className="section loop-section">
        <div className="section-title reveal">
          <p className="eyebrow">03 · DA INFORMAÇÃO À AÇÃO</p>
          <h2>O sistema precisa dizer onde apertar o parafuso, não apenas mostrar o painel.</h2>
        </div>
        <div className="loop-grid">
          {decisionLoop.map(([title, text], index) => (
            <SpotlightCard key={title} className={`reveal delay-${index as 0|1|2|3}`}>
              <b>{String(index + 1).padStart(2, '0')}</b>
              <h3>{title}</h3>
              <p>{text}</p>
            </SpotlightCard>
          ))}
        </div>
      </section>

      {/* ====== MÓDULOS ====== */}
      <section id="modulos" className="section modules-section">
        <div className="section-title reveal">
          <p className="eyebrow">04 · MÓDULOS CONECTADOS</p>
          <h2>Um sistema que acompanha a rotina real, não uma apresentação bonita.</h2>
        </div>
        <div className="module-lab reveal">
          <div className="module-tabs" role="tablist" aria-label="Módulos do produto">
            {productModules.map((item) => (
              <button
                key={item.id}
                role="tab"
                aria-selected={selectedModule.id === item.id}
                className={selectedModule.id === item.id ? 'active' : ''}
                onClick={() => setActiveModule(item.id)}
                type="button"
              >
                <small>{item.accent}</small>
                {item.title}
              </button>
            ))}
          </div>

          {/* key causes remount → triggers moduleFadeIn CSS animation on switch */}
          <div key={selectedModule.id} className="module-preview" role="tabpanel">
            <p className="eyebrow">{selectedModule.accent} · {selectedModule.title}</p>
            <h3>{selectedModule.headline}</h3>
            <p>{selectedModule.description}</p>
            <div className="module-metrics">
              {selectedModule.metrics.map((metric) => (
                <span key={metric}>{metric}</span>
              ))}
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

      {/* ====== INTELIGÊNCIA ====== */}
      <section className="section intelligence-section">
        <div className="section-title center reveal">
          <p className="eyebrow">05 · INTELIGÊNCIA OPERACIONAL</p>
          <h2>O Sallus Flow não apenas guarda dados. Ele revela prioridade.</h2>
        </div>
        <div className="signal-grid">
          <SpotlightCard className="reveal"><span>Próxima melhor ação</span><strong>Hoje</strong><p>Mostra onde a equipe precisa agir primeiro.</p></SpotlightCard>
          <SpotlightCard className="reveal delay-1"><span>QA cadastral</span><strong>3</strong><p>Campos críticos incompletos antes do erro virar rotina.</p></SpotlightCard>
          <SpotlightCard className="reveal delay-2"><span>Risco de guia</span><strong>7</strong><p>Autorizações em atenção por validade ou saldo.</p></SpotlightCard>
          <SpotlightCard className="reveal delay-3"><span>Perda operacional</span><strong>R$</strong><p>Produção, glosa e recebimento vistos no mesmo fluxo.</p></SpotlightCard>
        </div>
      </section>

      {/* ====== PARA QUEM É ====== */}
      <section className="section audience-section">
        <div className="section-title reveal">
          <p className="eyebrow">06 · PARA QUEM É</p>
          <h2>Feito para equipes que precisam sair do improviso sem perder a realidade da operação.</h2>
        </div>
        <div className="audience-grid">
          {audiences.map((audience, index) => (
            <article key={audience} className={`reveal delay-${Math.min(index, 4) as 0|1|2|3|4}`}>
              {audience}
            </article>
          ))}
        </div>
      </section>

      {/* ====== IMPLANTAÇÃO ====== */}
      <section className="section implementation-section">
        <div className="section-title center reveal">
          <p className="eyebrow">07 · IMPLANTAÇÃO EM ETAPAS</p>
          <h2>Começa pequeno, fica sério e cresce com a operação.</h2>
        </div>
        <div className="implementation-grid">
          {implementationSteps.map(([number, title, text], index) => (
            <article key={number} className={`reveal delay-${index as 0|1|2|3}`}>
              <b>{number}</b>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ====== GOVERNANÇA ====== */}
      <section id="governanca" className="section governance-section">
        <div className="reveal">
          <p className="eyebrow">08 · GOVERNANÇA</p>
          <h2>Saúde exige tecnologia com responsabilidade.</h2>
          <p>Sem prometer milagre jurídico. O foco é construir uma base operacional mais segura, auditável e madura.</p>
        </div>
        <ul className="governance-list reveal delay-1" aria-label="Princípios de governança">
          <li>
            <span className="governance-check" aria-hidden="true">✓</span>
            <div>
              <strong>LGPD — Lei 13.709/2018</strong>
              <p>Dados tratados conforme a Lei Geral de Proteção de Dados. Finalidade, consentimento e segurança como princípios inegociáveis de operação.</p>
            </div>
          </li>
          <li>
            <span className="governance-check" aria-hidden="true">✓</span>
            <div>
              <strong>Infraestrutura nacional</strong>
              <p>Dados hospedados em nuvem com servidores em território brasileiro. Sem transferência internacional de dados sensíveis de saúde.</p>
            </div>
          </li>
          <li>
            <span className="governance-check" aria-hidden="true">✓</span>
            <div>
              <strong>Acesso por perfil com log de auditoria</strong>
              <p>Cada ação registrada com usuário, timestamp e contexto. Trilha de auditoria disponível para gestão e compliance interno.</p>
            </div>
          </li>
          <li>
            <span className="governance-check" aria-hidden="true">✓</span>
            <div>
              <strong>Demonstrações com dados fictícios</strong>
              <p>Nenhuma informação real de paciente em ambientes públicos ou de demonstração. Dado sensível de saúde não é peça de vitrine.</p>
            </div>
          </li>
        </ul>
      </section>

      {/* ====== QUEM SOMOS ====== */}
      <section className="section about-section">
        <div className="section-title reveal">
          <p className="eyebrow">10 · QUEM CONSTRUIU</p>
          <h2>Feito por quem conhece a operação oncológica por dentro.</h2>
        </div>
        <div className="about-grid">
          <div className="about-copy reveal">
            <p>O Sallus Flow nasceu da frustração de quem tentou gerenciar clínica oncológica com planilha, WhatsApp e memória da equipe.</p>
            <p>Construído com profissionais de saúde de alta complexidade, com foco em resolver o problema operacional real antes de escrever uma linha de código.</p>
            <div className="about-tags">
              <span>Operações hospitalares</span>
              <span>Oncologia clínica</span>
              <span>Faturamento e glosa</span>
              <span>Gestão de convênios</span>
            </div>
          </div>
          <div className="about-contact reveal delay-1">
            <p>Quer conhecer quem está por trás do Sallus Flow?</p>
            <a className="button primary" href={whatsappUrl} target="_blank" rel="noreferrer">Falar com o time</a>
            <a className="about-email" href="mailto:contato@sallusflow.com.br">contato@sallusflow.com.br</a>
          </div>
        </div>
      </section>

      {/* ====== FAQ ====== */}
      <section className="section faq-section">
        <div className="section-title reveal">
          <p className="eyebrow">09 · PERGUNTAS IMPORTANTES</p>
          <h2>Sem promessa solta. Sem fumaça de palco.</h2>
        </div>
        <FaqAccordion />
      </section>

      {/* ====== CTA FINAL ====== */}
      <section id="contato" className="final-cta reveal">
        <p className="eyebrow">PRÓXIMO PASSO</p>
        <h2>Pare de administrar oncologia no escuro.</h2>
        <p>Leve a operação para um ambiente onde indicação, paciente, guia, faturamento e decisão conversam entre si.</p>
        <div className="hero-actions center-actions" style={{ marginTop: 32 }}>
          <a className="button primary" href={whatsappUrl} target="_blank" rel="noreferrer">Falar no WhatsApp</a>
          <a className="button dark-button" href="mailto:contato@sallusflow.com.br">contato@sallusflow.com.br</a>
        </div>
        <small>Sistema: oncologia.sallusflow.com.br · WhatsApp: 62 9 9249-9048</small>
      </section>

      </main>

      <footer>© {new Date().getFullYear()} Sallus Flow · www.sallusflow.com.br</footer>

    </div>
  );
}

/* ============================================
   MOUNT
   ============================================ */

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
