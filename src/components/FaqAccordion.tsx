import { useState } from 'react';

const faqs: [string, string][] = [
  [
    'O Sallus Flow substitui o sistema hospitalar?',
    'Não. Ele atua como camada de inteligência operacional, conectando pontos que normalmente ficam espalhados entre CRM, pacientes, guias, faturamento e decisão.',
  ],
  [
    'É um sistema assistencial ou de diagnóstico?',
    'Não. O foco é gestão operacional oncológica. Ele não realiza diagnóstico médico nem substitui conduta clínica.',
  ],
  [
    'Precisa usar todos os módulos desde o começo?',
    'Não. A implantação pode começar pelo fluxo mais crítico, como CRM, guias ou visão executiva, e evoluir em etapas.',
  ],
  [
    'Os dados do site são reais?',
    'Não. Toda demonstração pública deve usar dados fictícios ou mascarados. Dado sensível de saúde não é peça de vitrine.',
  ],
];

export default function FaqAccordion() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const toggle = (i: number) => setOpenIndex(openIndex === i ? null : i);

  return (
    <div className="faq-list">
      {faqs.map(([question, answer], index) => (
        <div
          key={question}
          className={`faq-item${openIndex === index ? ' open' : ''}`}
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
          <div className="faq-body" role="region">
            <div className="faq-body-inner">
              <p>{answer}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
