import Link from 'next/link';

const pilares = [
  ['01', 'Eficiência operacional', 'Processos claros, indicadores úteis e decisões menos dependentes de achismo.'],
  ['02', 'Dados aplicados à saúde', 'Transformação de informações soltas em leitura executiva, prioridade e ação.'],
  ['03', 'Jornada oncológica', 'Visão integrada do paciente, com foco em previsibilidade, cuidado e continuidade.']
];

const projetos = [
  ['Jornada do paciente oncológico', 'Modelo para acompanhar etapas críticas: consulta, exame, autorização, infusão, retorno e seguimento.'],
  ['Compras estratégicas em saúde', 'Análise de custo-benefício, prazos, estoque, fornecedor, compatibilidade e impacto no fluxo de caixa.'],
  ['IA aplicada à operação', 'Uso prático de IA para relatórios, alertas, priorização e melhoria contínua em clínicas.']
];

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">Sallus Intelligence</p>
          <h1>Saúde mais <span>inteligente</span>, operação mais eficiente.</h1>
          <p className="lead">Conteúdos, análises e projetos sobre gestão em saúde, dados, inteligência artificial, compras estratégicas e jornada do paciente oncológico.</p>
          <div className="actions">
            <Link className="btn primary" href="/artigos/ia-reduzir-desperdicios-clinicas-oncologicas">Ler artigo principal</Link>
            <Link className="btn" href="#projetos">Conhecer projetos</Link>
          </div>
        </div>
        <aside className="heroCard">
          <p>Gestão • Dados • IA</p>
          <h2>Inteligência operacional para clínicas, hospitais e oncologia.</h2>
          <div className="metrics">
            <span><b>IA</b> processo real</span>
            <span><b>Dados</b> decisão executiva</span>
            <span><b>Custos</b> visão estratégica</span>
            <span><b>Cuidado</b> jornada organizada</span>
          </div>
        </aside>
      </section>

      <section className="section">
        <p className="eyebrow">Posicionamento</p>
        <h2>Uma marca pessoal com método, não só opinião.</h2>
        <p className="sectionText">A proposta é transformar experiência de operação em saúde em conteúdo aplicável, com linguagem executiva e identidade premium inspirada no ecossistema Sallus.</p>
        <div className="grid3">
          {pilares.map(([n, t, d]) => <article className="card" key={n}><span>{n}</span><h3>{t}</h3><p>{d}</p></article>)}
        </div>
      </section>

      <section className="featureArticle">
        <div>
          <p className="eyebrow">Artigo em destaque</p>
          <h2>Como a IA pode reduzir desperdícios na operação de clínicas oncológicas</h2>
          <p>Uma visão prática sobre agenda, estoque, glosas, compras, indicadores e jornada do paciente oncológico.</p>
          <Link className="textLink" href="/artigos/ia-reduzir-desperdicios-clinicas-oncologicas">Ler artigo completo →</Link>
        </div>
        <img src="/cover.svg" alt="Capa do artigo sobre IA e desperdícios em clínicas oncológicas" />
      </section>

      <section id="projetos" className="section">
        <p className="eyebrow">Projetos</p>
        <h2>O que essa marca deve sustentar.</h2>
        <div className="grid3">
          {projetos.map(([t, d]) => <article className="card" key={t}><h3>{t}</h3><p>{d}</p></article>)}
        </div>
      </section>

      <section id="contato" className="cta">
        <h2>Gestão em saúde precisa de inteligência prática.</h2>
        <p>Conteúdo para quem quer reduzir desperdícios, organizar processos e tomar decisões melhores sem perder o olhar humano.</p>
        <a className="btn primary" href="https://www.linkedin.com/" target="_blank" rel="noreferrer">Conectar no LinkedIn</a>
      </section>
    </>
  );
}
