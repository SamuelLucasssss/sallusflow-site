# IMEC UTI — Pacote 6: UX, acessibilidade, PWA e auditoria documental

## Objetivo

Aprimorar uso diário em desktop e smartphones sem enfraquecer autenticação, integridade financeira e proteção de dados sensíveis.

## Acessibilidade e mobilidade

- Navegação principal e navegação móvel com rótulos e `aria-current`.
- Link “Pular para o conteúdo principal” e foco no conteúdo após troca de área.
- Modais com `role=dialog`, `aria-modal`, título/descritivo identificados, `inert` no app em segundo plano, foco inicial, ciclo Tab/Shift+Tab, Escape e restauração do foco original.
- Avisos de status com `aria-live=polite`.
- Áreas seguras iOS nos quatro lados, controles móveis de no mínimo 44 px, inputs de 16 px para evitar zoom automático do Safari.
- Fonte de sistema, foco visível, tipografia secundária ampliada e preferência `prefers-reduced-motion`.
- Impressão A4 com quebras de conteúdo controladas e exclusão de menus, avisos e overlays do documento.

## PWA online-only

- Manifest em `/imec-uti/manifest.webmanifest`, escopo e identidade limitados a `/imec-uti/`.
- Ícones SVG, PNG 192×192, PNG 512×512, maskable 512×512 e Apple Touch PNG 180×180.
- PNGs gerados no `prebuild` com recursos nativos do Node, sem novas dependências e conferidos em `postbuild`.
- Service worker em `/imec-uti/sw.js`: responde a GET fazendo `fetch(event.request,{cache:'no-store'})`; **não executa cache.put, cache.addAll ou IndexedDB**.
- Sem rede, apenas página genérica 503 para navegações; não serializa nem coloca contas ou dados de pacientes em cache persistente.
- Aviso de conectividade online/offline na interface. O conteúdo já aberto pode permanecer na memória da aba; não se deve tratá-lo como dado recém-validado quando offline.
- A sessão de Auth existente conserva as próprias políticas de autenticação; PWA não substitui MFA/AAL2.

## Auditoria de documentos e exportações

Migration: `20261008124228_package6_document_output_audit.sql`.

RPC: `public.log_uti_document_event(p_admission_id, p_event, p_document_kind)`.

- Exige `private.is_active_member()` (perfil ativo, sessão presente em `auth.sessions` e MFA/AAL2 obrigatório).
- Confere internação e valores permitidos; grava `public.audits` com usuário, tipo de ação e data.
- Eventos do app: ficha (`print_requested`), folha aberta (`print_view_opened`), impressão solicitada da folha (`print_requested`), PDF (`pdf_downloaded`).
- O popup da folha usa event listeners instalados após abertura; não depende de `onclick` inline, incompatível com CSP restrita.
- Falha ao registrar o evento bloqueia a ação do botão e não disponibiliza conteúdo documental no fluxo normal.
- O registro atesta solicitação/abertura/geração pelo app, **não** prova que a impressora física concluiu a impressão. Impressão pela interface nativa do navegador, captura de tela ou desenvolvedor não são eventos auditáveis por um app web.

Migration: `20261008125711_package6_secure_admin_json_export.sql`.

RPC: `public.log_uti_data_export()`.

- Exige `private.is_admin()` (administrador ativo, sessão válida, MFA/AAL2).
- Confirmação prévia sobre dados pessoais/financeiros.
- Download JSON só é liberado depois do evento auditado.
- O arquivo baixado é responsabilidade institucional: protegê-lo, restringir acesso e evitar envio a serviços pessoais.

## Verificações automáticas

- `npm run check`: TypeScript, testes, quality gate, auditoria de dependências e build.
- Testes do Pacote 6: manifest, PWA sem cache de PHI, regiões acessíveis, modais/foco, auditoria de impressão, exportação segura e safe-area.
- `npm run build`: gera PNGs e valida PNG signature, dimensões e manifest no diretório de publicação.
- Supabase: validar privilégio de execução, teste AAL2 autorizado, testes AAL1 e sessão inexistente bloqueados; transação com `ROLLBACK` não produz auditorias permanentes.
- Deploy: verificar commit correspondente na `main`, CI `quality` e Vercel `success`.

## Homologação em aparelhos reais

Para conformidade operacional 10/10, complementar CI com conferência por pessoa autorizada:

1. Chrome Android: instalar, abrir no ícone, autenticar com MFA; verificar ícone adaptativo.
2. Safari iOS: Compartilhar → Adicionar à Tela de Início; conferir ícone 180×180 e margens do notch/home indicator.
3. Alternar rede: verificar banner e página estática de indisponibilidade; reconectar e atualizar.
4. Navegar no teclado: skip link, Tab/Shift+Tab, Escape e retorno de foco em todos os modais.
5. Emitir ficha, folha e PDF para **paciente de teste autorizado** e verificar auditoria das solicitações.
6. Testar exportação JSON com administrador e verificar bloqueio para usuário não administrador.
7. Conferir folha A4 (inclusive conta com movimentos longos) e PDF em Chrome desktop e impressão do Safari.
8. Validar no DevTools que Cache Storage não tem respostas clínicas/financeiras.

Não utilizar dados reais de pacientes em capturas de tela, tickets ou testes externos.
