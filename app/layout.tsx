import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

const siteUrl = 'https://samuellucas.com.br';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Samuel Lucas | Sallus Intelligence',
    template: '%s | Samuel Lucas'
  },
  description: 'Gestão em Saúde, Dados e Inteligência Artificial aplicada à eficiência operacional, compras estratégicas e jornada do paciente oncológico.',
  openGraph: {
    title: 'Samuel Lucas | Sallus Intelligence',
    description: 'Gestão em Saúde, Dados e Inteligência Artificial aplicada à operação de clínicas e oncologia.',
    url: siteUrl,
    siteName: 'Samuel Lucas | Sallus Intelligence',
    locale: 'pt_BR',
    type: 'website',
    images: ['/cover.svg']
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Samuel Lucas | Sallus Intelligence',
    description: 'Gestão em Saúde, Dados e IA aplicada à eficiência operacional.',
    images: ['/cover.svg']
  },
  icons: { icon: '/favicon.svg' }
};

const nav = [
  ['/', 'Início'],
  ['/artigos/ia-reduzir-desperdicios-clinicas-oncologicas', 'Artigo'],
  ['/#projetos', 'Projetos'],
  ['/#contato', 'Contato']
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <header className="topbar">
          <Link className="brand" href="/" aria-label="Página inicial Samuel Lucas">
            <span className="logo" aria-hidden="true"><i /></span>
            <span><strong>Samuel Lucas</strong><small>Sallus Intelligence</small></span>
          </Link>
          <nav aria-label="Menu principal">
            {nav.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
          </nav>
        </header>
        <main>{children}</main>
        <footer className="footer">
          <div><strong>Samuel Lucas</strong><p>Gestão em Saúde • Dados • Inteligência Artificial • Oncologia</p></div>
          <Link href="/artigos/ia-reduzir-desperdicios-clinicas-oncologicas">Ler artigo principal</Link>
        </footer>
      </body>
    </html>
  );
}
