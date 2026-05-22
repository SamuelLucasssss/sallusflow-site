import { useState } from 'react';

const systemUrl = 'https://oncologia.sallusflow.com.br';

export default function NavIsland() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      <nav className={open ? 'open' : ''} aria-label="Navegação principal">
        <a href="#problema" onClick={close}>Problema</a>
        <a href="#fluxo" onClick={close}>Fluxo</a>
        <a href="#modulos" onClick={close}>Módulos</a>
        <a href="#governanca" onClick={close}>Governança</a>
      </nav>
      <div className="header-actions">
        <a className="ghost-link" href="mailto:contato@sallusflow.com.br">Contato</a>
        <a className="button small" href={systemUrl} target="_blank" rel="noreferrer">
          Acessar sistema
        </a>
        <button
          className="button small nav-toggle"
          aria-label={open ? 'Fechar menu' : 'Abrir menu'}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          type="button"
        >
          {open ? '✕' : '☰'}
        </button>
      </div>
    </>
  );
}
