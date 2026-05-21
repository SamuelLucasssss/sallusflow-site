import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

const whatsappMessage = encodeURIComponent('Olá! Quero conhecer o Sallus Flow e entender como aplicar na gestão oncológica.');
const whatsappUrl = `https://wa.me/5562992499048?text=${whatsappMessage}`;

const modules = [
  ['M0', 'Executivo', 'Indicadores, alertas e leitura rápida para decisão da diretoria.'],
  ['M1', 'CRM', 'Indicações, médicos, pós-consulta e conversão em tratamento.'],
  ['M2', 'Pacientes', 'Carteira oncológica organizada por jornada, status e prioridade.'],
  ['M3', 'Financeiro', 'Produção, faturamento, glosa, recurso e recebimento conectados.'],
  ['M4', 'Guias', 'Autorizações, validade, saldo e risco de glosa sob controle.'],
];

function App() {
  return (
    <main>
      <header className="header">
        <a className="brand" href="#top"><span className="mark"><i /></span><strong>Sallus<span>Flow</span></strong></a>
        <nav><a href="#solucao">Solução</a><a href="#modulos">Módulos</a><a href="#seguranca">Governança</a><a href="#contato">Contato</a></nav>
        <a className="btn" href="https://oncologia.sallusflow.com.br" target="_blank">Acessar sistema</a>
      </header>

      <section id="top" className="hero">
        <div className="copy">
          <p className="eyebrow">SALLUS FLOW · ONCOLOGIA · PRODUÇÃO</p>
          <h1>O sistema operacional inteligente para gestão oncológica.</h1>
          <p className="lead">CRM, pacientes, guias, financeiro e indicadores em um único ambiente para quem precisa enxergar, decidir e agir com segurança.</p>
          <div className="actions"><a className="btn primary" href={whatsappUrl} target="_blank">Solicitar demonstração</a><a className="btn" href="https://oncologia.sallusflow.com.br" target="_blank">Acessar sistema</a></div>
          <div className="proof"><span><b>5</b> módulos</span><span><b>1</b> fluxo único</span><span><b>100%</b> foco operacional</span></div>
        </div>
        <div className="panel">
          <div className="panelTop"><span>§ 02.02 · Mesa operacional</span><b>AO VIVO</b></div>
          <div className="dash">
            <aside>{modules.map(m => <span key={m[0]}><b>{m[0]}</b> · {m[1]}</span>)}</aside>
            <section>
              <p className="eyebrow">CENTRAL DE COMANDO</p>
              <h2>Da indicação ao recebimento, sem perder o fio da operação.</h2>
              <div className="kpis"><article><small>Total CRM</small><strong>67</strong><em>base demonstrativa</em></article><article><small>Pacientes</small><strong>153</strong><em>carteira ativa</em></article><article><small>Guias em risco</small><strong>07</strong><em>validade próxima</em></article></div>
              <div className="table"><div><b>Módulo</b><b>Controle</b><b>Status</b></div><div><span>CRM</span><span>Pós-consulta</span><span>OK</span></div><div><span>Guias</span><span>Validade</span><span>RISCO</span></div><div><span>Financeiro</span><span>Glosa</span><span>QA</span></div></div>
            </section>
          </div>
        </div>
      </section>

      <section className="section problem"><p className="eyebrow">01 · O PROBLEMA</p><h2>A oncologia não pode depender de planilhas soltas, memória da equipe e mensagens perdidas.</h2><div className="cards"><article>Indicações esquecidas em mensagens soltas</article><article>Guias vencendo sem alerta operacional</article><article>Faturamento desconectado da produção real</article><article>Gestão sem visão clara de risco e prioridade</article></div></section>

      <section id="solucao" className="section"><p className="eyebrow">02 · FLUXO INTELIGENTE</p><h2>Um fluxo único: indicação, consulta, tratamento, guia e receita.</h2><div className="flow"><article><b>01</b><h3>Indicação</h3><p>Entrada estruturada no CRM.</p></article><article><b>02</b><h3>Consulta</h3><p>Acompanhamento até pós-consulta.</p></article><article><b>03</b><h3>Tratamento</h3><p>Carteira ativa e responsável.</p></article><article><b>04</b><h3>Guia</h3><p>Validade e saldo em controle.</p></article><article><b>05</b><h3>Receita</h3><p>Produção, glosa e recebimento.</p></article></div></section>

      <section id="modulos" className="section dark"><p className="eyebrow">03 · MÓDULOS</p><h2>Um produto com cara de operação real. Não de apresentação bonita.</h2><div className="modules">{modules.map(m => <article key={m[0]}><span>{m[0]}</span><h3>{m[1]}</h3><p>{m[2]}</p></article>)}</div></section>

      <section className="section"><p className="eyebrow">04 · INTELIGÊNCIA OPERACIONAL</p><h2>Mais que registrar dados. O sistema aponta onde mexer.</h2><div className="signals"><article><span>Atrasados</span><strong>12</strong><p>Prioridade operacional</p></article><article><span>Sem responsável</span><strong>07</strong><p>Risco de abandono</p></article><article><span>Sem telefone</span><strong>03</strong><p>QA cadastral</p></article><article><span>Guias em risco</span><strong>07</strong><p>Validade próxima</p></article></div></section>

      <section id="seguranca" className="section security"><p className="eyebrow">05 · SEGURANÇA E GOVERNANÇA</p><h2>Dados de saúde pedem tecnologia, mas também juízo.</h2><p>O Sallus Flow é desenhado com foco em rastreabilidade, organização e responsabilidade sobre dados sensíveis. No site público, somente dados demonstrativos devem ser usados.</p></section>

      <section id="contato" className="contact"><h2>Sua operação já tem dados. Falta transformar isso em comando.</h2><p>Fale com a equipe para avaliar o fluxo, os módulos e a implantação do Sallus Flow na rotina oncológica.</p><div className="actions"><a className="btn primary" href={whatsappUrl} target="_blank">Chamar no WhatsApp</a><a className="btn" href="mailto:contato@sallusflow.com.br">contato@sallusflow.com.br</a></div><small>Sistema: oncologia.sallusflow.com.br · WhatsApp: 62 9 9249-9048</small></section>
      <footer>© {new Date().getFullYear()} Sallus Flow · www.sallusflow.com.br</footer>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
