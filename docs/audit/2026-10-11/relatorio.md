# IMEC UTI — Auditoria forense e checkup geral
Data operacional: 11/10/2026, America/Sao_Paulo. Algumas coletas ocorreram em 12/10 UTC.

**Atualização após autorização de publicação:** ver [aplicação das correções](publicacao.md). Este relatório preserva o diagnóstico e o estado anterior ao release; o registro de publicação documenta a migration aplicada, a Edge Function e a validação adicional de concorrência nativa.

Referência inicial de produção: `main@8d4b1fb2e4c176b99af0a005887e960e3990a409`. Branch das correções: `codex/auditoria-forense-imec-uti`. Repositório: `SamuelLucasssss/sallusflow-site`. Deploy inicial verificado: Vercel READY, `dpl_7AD4uXUDyZyXc5RqDuVnzLxqWMZo`.

Na conferência final, main avançou para `9907be20cbbd57b418e45f5927628e014dfcfb28`, incluindo desconto auditado. A branch foi integrada sobre essa revisão e todos os testes foram repetidos. A RPC de desconto já estava implantada, com versão remota `20261012001555`; o nome local também foi alinhado. O escopo de cada coleta anterior continua vinculado à referência inicial, sem presumir que todas foram repetidas no novo deploy.

Este relatório separa o estado implantado das correções propostas. As correções deste pacote, sua migration e sua Edge Function **não foram publicadas em produção durante a auditoria**. O login por e-mail e senha foi preservado; a política consultada permanece `mfa_required=false`.

## Método e evidências
- Leitura de código, documentação, histórico, migrations, CI, headers e catálogo implantado; leitura de issues abertas e logs agregados.
- Produção: somente consultas de leitura e sondagens públicas sem sessão, sem cadastro sintético e sem alteração de pacientes, pagamentos, tarifas ou auditorias.
- Ambiente isolado: PostgreSQL 17.5 via PGlite, roles/RLS reais e funções SQL do projeto, com usuários e contas sintéticos. Produção: PostgreSQL 17.11. As extensões e todo o histórico de implantação Supabase não foram reproduzidos integralmente.
- Navegador: build Astro real, Chrome/Playwright, API HTTP interceptada e conectada ao PostgreSQL isolado. Auth é simulado. Isso valida interface → RPC SQL → resultado no banco, mas não homologa Hosted Auth, SMTP ou PostgREST hospedado.
- Testes de corrida do frontend controlam a ordem de respostas. O PGlite usa uma conexão; chamadas serializadas não comprovam concorrência entre conexões PostgreSQL.
- Evidências publicáveis: [resumo técnico](evidencias.json), [navegador isolado](navegador.json), [sondagem pública](producao-publica.json). Não contêm prontuários, nomes reais, CPF, tokens, credenciais ou corpos de requisições.
- Reprodução: Node 22; `npm ci`; `npm run check`; `npx playwright install chromium`; `npm run test:browser`. Os artefatos sintéticos são gerados em `tmp/imec-audit`, ignorado pelo Git.

## A. Diagnóstico executivo
O núcleo financeiro tem controles úteis e os testes matemáticos disponíveis conferem. Não encontrei, nas consultas de integridade executadas em produção, leito ativo duplicado, paciente com duas internações abertas, ciclo de diária ativo duplicado, alta anterior à entrada, ausência de tarifa efetiva ou conta finalizada com saldo diferente de zero. Isso é uma fotografia dos controles consultados em uma base pequena, e não garantia de ausência de qualquer erro.

A produção ainda não deve receber uma aprovação irrestrita. Foram reproduzidos problemas de sessão, busca, idempotência e valores não finitos. O carregamento sem paginação também permite saldos incompletos quando o histórico ultrapassa o limite REST. A cadeia de convite tem uma falha de encaminhamento do JWT. As correções estão implementadas e testadas na branch.

Riscos prioritários remanescentes: branch principal sem proteção; proteção nativa contra senhas vazadas desativada; convite/recuperação e step-up administrativo sem homologação com contas reais; recuperação de backup não demonstrada; concorrência entre sessões PostgreSQL e dispositivos físicos não homologados. O repositório é público: relatórios e evidências publicados devem continuar estritamente sanitizados.

## B. Auditoria forense
Severidade considera a consequência possível, não uma alegação de incidente já ocorrido.

| ID | Falha e causa raiz | Evidência e impacto | Correção / estado |
|---|---|---|---|
| F01 · alta | Renovação de sessão disparada por consultas paralelas; cada chamada renovava e atualizava a atividade. | Teste reproduziu três renovações para uma sessão; tráfego automático podia prolongar a sessão inativa. | Uma promessa compartilhada por geração de sessão; renovação não marca atividade. Regressão aprovada. |
| F02 · alta | Respostas tardias não distinguiam a sessão que iniciou a operação. Logout esperava a rede. | Renovação tardia restaurava sessão; carregamento tardio repunha dados protegidos; 401 antigo encerrava login novo. | Geração de sessão, descarte de respostas antigas e limpeza local imediata. Regressões aprovadas. |
| F03 · alta | Listas financeiras eram consultadas sem percorrer todas as páginas. | O REST tem limite padrão de linhas. Teste com 1.001 registros e teto de 100 por resposta confirmou leitura completa na versão corrigida. Antes, os totais poderiam omitir lançamentos. | Paginação por offset real, contagem e ordenação estável. Snapshot entre páginas ainda não é transacional. |
| F04 · alta | Retry de pagamento era conferido após bloqueio por conta finalizada; identificador repetido podia ignorar diferença no conteúdo. | PIX quitado rejeitava repetição legítima. Mesma referência com valor diferente retornava o registro antigo silenciosamente. | Conferência sob lock antes das validações de saldo, comparando conteúdo; rejeição de referência conflitante/cancelada. SQL isolado aprovado. |
| F05 · alta | CHECK positivo não exclui NaN do PostgreSQL; tarifa negociada aceita NaN. | NaN entrou em teste isolado e contaminou cálculo. Não foram encontrados valores não finitos nas colunas consultadas em produção. | Validação de tarifa e seis constraints cobrindo valores financeiros, tarifas e comissões. Migration pendente de release. |
| F06 · alta | Edge valida `getUser(token)`, mas o cliente RPC não recebia o Authorization do usuário. | Código implantado v3 contém o mesmo problema; reprodução com SDK simulado mostrou rejeição da sessão administrativa válida. | JWT explícito no cliente usado pelo RPC, antes de criar cliente privilegiado. Teste passa; envio real NÃO HOMOLOGADO. |
| F07 · média | Implementação privada antiga de alta ainda tinha EXECUTE para authenticated. | Catálogo confirma grant legado; wrapper público antigo já rejeita versão desatualizada. Não foi comprovada exposição dessa função pela API hospedada. | Revogação preventiva do helper privado obsoleto; nenhum grant financeiro ampliado. |
| F08 · alta, preventiva | Sincronização de diárias não iniciava com o mesmo lock da internação; administração de usuários conferia último administrador sem serialização global. | Inspeção demonstra janelas de disputa entre sincronização/tarifa/alta e entre duas alterações de administradores. Corrida entre conexões não foi reproduzida. | Lock ordenado das internações e advisory lock administrativo. Último administrador testado sequencialmente; concorrência PENDENTE. |
| F09 · média | Busca textual normalizada como CPF vira string vazia; `includes('')` aceita qualquer paciente. Render a cada tecla perde foco. | Busca inexistente devolvia todos os pacientes. Digitação contínua interrompida. | Nome sem acentos e CPF numérico não vazio; preservação de foco/cursor. Unitário e navegador aprovados. |
| F10 · média | Resposta vazia da consulta de senhas vazadas era interpretada como zero ocorrências. | Serviço indisponível com corpo vazio podia aprovar senha sem verificação. | Falha explícita e opção de tentar novamente. Não substitui proteção nativa do Auth. |
| F11 · média | MFA aparecia como obrigatório na configuração, mesmo com política desativada; erro de política podia iniciar onboarding. | Texto contradizia o modo autorizado; perfil inativo/erro de rede tratados inadequadamente. | Texto conforme modo, perfil inativo pendente e falha de rede com tentativa posterior. Flag mantida false. |
| F12 · média | Tabela mobile exige largura de 980px. | Saldo ficava fora da área visível, ainda que o documento não transbordasse. | Cartões compactos abaixo de 600px com nome, modalidade, leito, status e saldo. 360/390px aprovados. |
| F13 · média | “Caixa” somava autorização integral do crédito; “Corrigir” cancelava lançamento; aviso de tarifa prometia preservar passado. | Termos induziam interpretação bancária, edição em lugar de estorno e surpresa em recálculo retroativo. | “Recebido líquido”, “Estornar” e aviso fiel ao recálculo existente. Nenhuma fórmula comercial modificada. |
| F14 · média | Dois nomes locais de migration divergiam das versões já aplicadas pelo servidor. Documentos descreviam MFA obrigatório. | Dificulta conferência de histórico e pode gerar orientação operacional errada. | Arquivos renomeados para versões implantadas e documentação alinhada. Histórico remoto não alterado. |
| F15 · alta | Commit 9907be2 usa discountTotal em patientCard sem definição local. | Teste runtime reproduziu ReferenceError; cartão de paciente e dashboard com internação podem falhar. | Total calculado a partir dos ajustes daquela conta; regressão passa. Desconto também exercitado no PostgreSQL isolado. |

A documentação oficial informa o [limite padrão de seleção de 1.000 linhas](https://supabase.com/docs/reference/javascript/select). A distinção entre verificar um token e configurar o cliente que fará RPC é sustentada pela [API getUser](https://supabase.com/docs/reference/javascript/auth-getuser) e pela inspeção do cliente e da função implantada.

## C. Auditoria financeira
A relação usada é: **saldo = cobranças ativas − recebimentos ativos + reembolsos ativos**. Registros cancelados permanecem no histórico e são excluídos dos totais ativos. Recebimento em cartão registra a obrigação liquidada pelo paciente; não comprova dinheiro creditado pela adquirente.

| Cenário isolado | Resultado conferido no PostgreSQL |
|---|---|
| Duas diárias de R$ 400 + extra de R$ 100 | Cobrado R$ 900; pagamentos R$ 400 + R$ 500; saldo zero; status finalized. |
| Entrada 28/02/2024 23:59, meia inicial; saída 01/03 00:01 | Meia inicial R$ 200 + 29/02 R$ 400 = R$ 600, 1,5 diária. |
| Entrada e saída no mesmo dia | Mantém cobrança inicial de R$ 200 no cenário com meia inicial, conforme regra atual. |
| Mudança da tarifa de R$ 400 para R$ 500 antes do próximo ciclo | Total R$ 900; lançamentos substituídos preservados como cancelados. |
| Pagamento repetido com a mesma referência | Uma linha ativa e uma auditoria de pagamento; retry retorna resultado existente. |
| Referência repetida com conteúdo diferente | Erro, sem novo recebimento. |
| Reembolso limitado ao crédito | R$ 600 permitido no caso testado; R$ 601 rejeitado. |
| Alta calculada antes de alteração da conta | Versão antiga rejeitada; precisa recalcular. |
| Leito já ocupado / perfil sem permissão | Operação rejeitada no banco. |
| Cartão de crédito em 2x + PIX, fluxo pelo navegador | Crédito R$ 200, PIX R$ 700, cobranças R$ 900 e encerramento confirmado no banco; vencimentos constam na folha. |
| Desconto auditado incorporado da nova main | Conta R$ 800, recebido R$ 500, ajuste negativo R$ 300: total R$ 500, saldo zero e finalized; um pagamento, um desconto, uma auditoria; retry sem duplicação e excesso rejeitado. |

Os testes existentes da folha continuam passando, inclusive CPF discreto, formas de recebimento, parcelas/vencimentos, arredondamento e documento longo com 45 recebimentos. O PDF sintético de uma página foi renderizado e inspecionado; impressão física não foi homologada.

As consultas de produção verificaram anomalias de datas, ocupação, ciclos, tarifas efetivas, saldos de contas finalizadas e NaN/Infinity nas colunas da nova constraint. Resultados agregados: zero anomalias nos controles executados. Não foi feita conciliação de cada lançamento com comprovantes externos.

**Regras que precisam de confirmação operacional, sem mudança automática:**
1. Recebimento anterior ao horário de entrada é bloqueado hoje. Eventual sinal/adiantamento prévio precisa de regra explícita; não ajustar horários reais para contornar a trava.
2. “O dia da saída não gera diária” tem a exceção da cobrança inicial quando entrada e saída coincidem. Formalizar essa comunicação com a regra vigente.
3. Parcelas do cartão são vencimentos informados; não constituem conciliação de adquirente, taxas ou repasses bancários.
4. Meia inicial é condição registrada. Não converter automaticamente uma entrada tardia em desconto sem confirmar a política.
5. Estorno é cancelamento auditado do lançamento, não edição de data/valor. Correção de data exige procedimento específico e auditado.

## D. Auditoria UX/UI
A estrutura principal já é enxuta: visão geral, pacientes, financeiro e configurações. A revisão preserva tipografia, cores institucionais, hierarquia e identidade.

| Tela / fluxo | Avaliação e alteração |
|---|---|
| Visão geral | Ocupação, saldo e pendências são adequados ao plantão. “Recebido líquido” elimina ambiguidade do cartão. Cartões de pacientes priorizam contas abertas. |
| Nova internação | Sequência paciente → leito/modalidade → condição comercial → entrada é compreensível. Estimativa ajuda conferência. Negociação continua explícita; nenhuma tarifa fixada à força. |
| Pacientes | Busca corrigida; filtro e saldo próximos do nome. No celular, os números essenciais aparecem sem rolagem horizontal; demais detalhes ficam acessíveis ao abrir a conta. |
| Conta / alta | Composição, recebimentos e saldo permitem revisão antes de confirmar. Versionamento protege prévia desatualizada. Documentos oferecem imprimir e PDF. |
| Financeiro | Recebimento, reembolso e crédito a devolver são separados. Mudança de rótulo não modifica matemática. |
| Estorno / tarifa | Linguagem passa a descrever o efeito real. Motivo e trilha de auditoria continuam obrigatórios. Evitar uma ação chamada “corrigir” que parece apenas editar. |
| Configurações | Diagnósticos técnicos em seção recolhível para administrador, com contagem de alertas visível. Modo de login refletido corretamente. |
| Mobile | Formulários, menus e conta exercitados em 360, 390, 820 e 1365px; sem overflow do documento; saldo visível nos dois menores tamanhos. |
| Acessibilidade | Escape fecha o modal no teste; campos importantes têm rótulos. Leitor de tela, teclado completo, contraste medido e uso com uma mão em hardware real não foram homologados. |

**Medição do roteiro automatizado:** 32 cliques e 23 preenchimentos/seleções, 7.118 ms no ambiente isolado. O número inclui login incorreto/correto, buscas positivas/negativas, quatro ciclos de viewport/modal, exportação e logout; não representa o mínimo de cliques de um funcionário nem tempo humano. O resultado financeiro veio do SQL, não da mensagem de sucesso da tela.

O próximo avanço de UX deve ser uma sessão curta com um profissional de plantão em dispositivo real. Não há evidência para justificar redesenho total ou adicionar novos painéis.

## E. Auditoria técnica, segurança e infraestrutura
### Frontend e performance
- Astro estático com módulos de domínio, segurança, pagamentos e documento. `app.ts` concentra renderização, eventos, rede e estado, com `@ts-nocheck`: dívida de manutenção relevante. Os testes isolam funções existentes; não houve reescrita arquitetural.
- Renovação compartilhada elimina requisições duplicadas. Paginação corrige completude; pode aumentar tráfego ao carregar históricos grandes.
- O carregamento ainda busca um conjunto amplo de dados, e o ciclo periódico de aproximadamente 45 segundos repete consultas. Contagens exatas e paginação por offset não formam um snapshot atômico entre tabelas/páginas.
- Sondagem pública: TTFB 22 ms, DOM 575 ms, CSS 10.022 bytes, JS 33.748 bytes, ícone 665 bytes. Uma amostra local aquecida; não é p95, SLA ou teste de rede móvel.
- Benchmark sintético de renderização: 500 internações, 5.000 cobranças, 500 pagamentos; mediana 101 ms em cinco execuções, HTML 196.804 bytes. Não mede memória de longo prazo, rede real nem banco hospedado.
- Navegador isolado: 124 chamadas API no roteiro ampliado; zero erros de página. Tráfego inclui atualizações após operações e mudanças de tela.
- Há aviso offline; recuperação visual foi exercitada. Não há validação de transação perdida durante desconexão prolongada. Não existem timeouts/AbortController uniformes em todos os fetches.
- Assets PWA, manifest e PNGs passam verificação de build e seis sondagens públicas. Worker é bloqueado no teste interceptado: instalação, atualização e cache em iPhone/Android continuam NÃO HOMOLOGADOS.

### PostgreSQL, RLS e RPC
- 12 tabelas públicas examinadas, todas com RLS. SELECT anônimo negado; escrita direta authenticated revogada nas tabelas consultadas. Mutação financeira passa por RPC autorizada/auditada.
- Predicados privados `is_active_member` e `is_admin` têm EXECUTE para authenticated e não para anon. O problema histórico de permissão dos predicados está corrigido na produção consultada.
- Wrappers públicos invoker encaminham a implementações privadas definer com search_path fixo e validação de sessão/perfil. Avaliados grants, policies, triggers, constraints e índices pelo catálogo. O schema privado não deve ser acrescentado à lista de schemas expostos; essa configuração hospedada não foi comprovada.
- Sessão exige registro válido em `auth.sessions`; usuário inativo/revogado é bloqueado nas provas SQL. MFA false aceita AAL1; true exige AAL2, testado isoladamente sem alterar produção.
- Advisory/row locks propostos reduzem janelas de corrida. Não equivalem a homologação de múltiplas conexões, deadlocks ou carga real.
- Advisor: 14 índices classificados como não usados, principalmente suporte a FKs. Base pequena e janela estatística limitada: nenhum removido. O [advisor oficial](https://supabase.com/docs/guides/observability/advisors?lint=0005_unused_index) é indício para investigação, não prova de desperdício.
- 36 migrations na referência inicial; após o novo desconto, 37 implantadas e 38 na branch com hardening. Três nomes locais alinhados ao servidor. A nova migration foi versionada depois da última versão remota. Não houve reparo do histórico remoto.

### Auth, Edge Functions e navegador
- Login operacional continua e-mail/senha; MFA opcional e configurável. Escolha sem MFA traz risco residual de comprometimento por senha, sem ser tratada como defeito.
- Convite administrativo mantém AAL2 explícito na Edge, independentemente da política operacional. Administrador em AAL1 não consegue enviar convite hoje; experiência de elevação/recuperação requer homologação e melhoria específica sem exigir TOTP de toda a equipe.
- Proteção HIBP da interface não cobre chamada direta ao Hosted Auth. Advisor confirma Leaked Password Protection nativa desativada. Conferir política, signup e SMTP no dashboard administrativo antes de afirmar cobertura completa. Ver [proteção oficial de senhas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- Access/refresh tokens persistem em localStorage. CSP, escape de conteúdo e limpeza de sessão mitigam riscos, mas um XSS no mesmo origin poderia acessá-los. Não há prova de exploração; não recomendar migração de arquitetura sem avaliar fluxo e hospedagem.
- CSP restringe script-src a self; headers configuram HSTS, no-store, nosniff, frame-ancestors, referrer e permissions-policy. Configuração não substitui pentest.
- A chave publicável do frontend é parte esperada da arquitetura; segredo service-role fica na Edge. Auditoria automatizada de segredos/dependências passou. Nenhuma credencial foi adicionada ao pacote.

### CI, observabilidade e recuperação
- `main` está sem proteção e repo é público. CI existe, ações estão fixadas por SHA e dependências por lockfile. Branch propõe incluir percurso de navegador com SQL isolado.
- Três jobs ativos: diárias `5 * * * *`, saúde `*/15 * * * *`, watchdog `7,22,37,52 * * * *`. Consulta de 24h: zero runs de cron falhados, execuções recentes presentes, nenhum alerta não resolvido; health recente ok. Isso não comprova notificação externa ou histórico sem interrupção.
- Logs PostgreSQL de 24h: 11 eventos de erro, sete SQLSTATE 42501 e quatro P0001. Parte corresponde a sondagens negativas/validações, mas não há atribuição conclusiva de todos. Não foram apagados, ocultados ou tratados como zero. Consulta agregada de Auth não encontrou level de erro na janela utilizada.
- Logs runtime Vercel e a tentativa final de listar o novo deploy retornaram 403. CLI autenticada indisponível. **NÃO VERIFICADOS**; deploy READY sozinho não prova ausência de erro.
- Issues #4 (proteção GitHub), #7 (Hosted Auth/SMTP), #10 (backup/restore), #14 (dispositivos/PWA/impressão) continuam pendentes. Texto histórico de #7 sobre MFA obrigatório não sobrepõe a política atual. #1 trata marketing, fora deste escopo.
- Exportação JSON auditada funciona no cenário sintético, mas não é restauração demonstrada nem backup completo de Auth/configuração/infra. Plano atual, retenção, backup externo, RPO/RTO e restore drill não comprovados. Conferir [backups Supabase](https://supabase.com/docs/guides/platform/backups) e executar ensaio fora da produção.

## F. Melhorias implementadas e validação
| Arquivos | Mudança | Validação |
|---|---|---|
| `src/imec-uti/app.ts`, `domain.ts` | Busca/cursor, geração e refresh de sessão, limpeza imediata, paginação, segurança da senha, mensagens/configuração e cartão com desconto. | 11 testes runtime novos; busca e fluxo também no navegador. |
| `src/imec-uti/styles.css` | Pacientes compactos no mobile e diagnóstico administrativo recolhível. | Quatro viewports; saldo visível 360/390px; inspeção de capturas sintéticas. |
| `supabase/functions/invite-uti-user/index.ts` | Encaminhamento do JWT para RPC autorizadora. | Dois testes Edge com SDK/Auth/env simulados; sem disparo de e-mail. |
| `20261012004235_audit_integrity_hardening.sql` | Idempotência, números finitos, revogação legado, locks de diárias e administração. | 14 testes PostgreSQL novos, incluindo desconto integrado; constraints e financeiro real isolado. Concorrência nativa pendente. |
| Três migrations renomeadas + `scripts/quality-gate.mjs` | Correspondência com versão implantada; 38 arquivos esperados na branch. | Gate passou; nenhuma reaplicação/reescrita no servidor. |
| `tests/fixtures/*`, três suites novas | Runtime controlado, SQL/RLS isolado e mocks Edge. | Mais 27 testes de auditoria; quatro testes de desconto incorporados da main; total 71. |
| `scripts/imec-uti-browser-audit.mjs`, CI, package/lock | Jornada repetível conectando UI e SQL isolado; ferramentas somente dev. | Playwright passou localmente; execução remota acompanha o PR. |
| Cinco documentos técnicos e este relatório | Login normal, MFA configurável, release e limites reais da prova. | Revisão de consistência e diff. |

**Comparação:** referência inicial tinha 40 testes aprovados; nova main acrescentou quatro testes de desconto. Branch tem **71 aprovados, zero falhas/skips**, 110 funções únicas verificadas, 38 migrations versionadas, build Astro/PWA aprovado e `npm audit` sem vulnerabilidades conhecidas no momento da execução. Zero achados do npm não significa inexistência de vulnerabilidade de lógica, configuração ou vulnerabilidade ainda não catalogada.

### Procedimento de release proposto
1. Revisar PR, CI e SQL; homologar em staging PostgreSQL/Supabase equivalente. Conferir plano/backups e listar zero valores não finitos antes das constraints.
2. Validar alta com versão, pagamento/retry, cartão, tarifa, último administrador e duas conexões independentes concorrentes. Sem isso, locks continuam homologação pendente.
3. Conferir histórico remoto antes de `db push`; aplicar somente a nova migration revisada, sem repetir as três migrations cujos nomes foram alinhados.
4. Publicar a Edge Function separadamente e homologar convite com administrador autorizado, mailbox de teste e callback.
5. Publicar frontend e verificar login e-mail/senha, flag false, role/RLS, recibo, mobile e monitoramento.
6. Se houver regressão, interromper release e retornar frontend/Edge à versão anterior. Rollback de SQL exige script próprio revisado; retornar frontend não desfaz migration. Não apagar pagamentos nem grants de segurança para “voltar a funcionar”.

## G. Melhorias recomendadas
| Prioridade | Ação | Impacto | Urgência | Complexidade | Risco da execução |
|---|---|---|---|---|---|
| 1 | Revisar e homologar pacote em staging, incluindo duas conexões reais | Alto: sessão e integridade | Antes do release | Média | Médio: SQL/locks |
| 2 | Proteger main com review e check obrigatório; avaliar privacidade do repo | Alto: cadeia de publicação | Alta | Baixa | Baixo |
| 3 | Homologar Auth/SMTP/convite/recuperação e step-up administrativo | Alto: acesso da equipe | Alta | Média | Médio: evitar bloqueio de contas |
| 4 | Configurar proteção nativa de senha vazada e conferir signup/política | Alto: contas | Alta | Baixa/média | Médio: conferir disponibilidade do plano |
| 5 | Backup externo com restore drill e RPO/RTO definidos | Alto: continuidade | Alta | Média | Médio: somente restore isolado |
| 6 | iPhone/Android/PWA/impressora real com profissional do plantão | Alto: uso cotidiano | Antes de homologação mobile | Baixa/média | Baixo |
| 7 | Timeout/recuperação de requisições e UX de falha de rede | Médio: estabilidade | Próximo ciclo | Média | Médio: não repetir mutação com nova referência |
| 8 | Snapshot financeiro consistente e carregamento incremental/visões agregadas | Alto com crescimento | Conforme volume | Alta | Alto: conferir saldo contra SQL |
| 9 | Extrair rede/sessão e tipos de app.ts gradualmente | Médio: manutenção | Após release seguro | Média | Médio: uma responsabilidade por mudança |
| 10 | Formalizar sinal prévio, meia inicial, alta no mesmo dia e repasse de cartão | Alto: interpretação | Alta | Baixa para decisão | Alto se fórmula alterada sem política |
| 11 | Garantir acesso aos logs Vercel e testar entrega de alertas | Médio: diagnóstico | Próximo ciclo | Baixa/média | Baixo |

Não remover índices “não usados” ou acrescentar bibliotecas de produção sem evidência. Playwright e PGlite são ferramentas de desenvolvimento para provas que não existiam; não entram no bundle clínico.

## H. Matriz de homologação
**APROVADA** significa o teste especificado passou naquele ambiente; não significa aprovação automática de produção. **REPROVADA** identifica reprodução na referência. **PENDENTE** aguarda execução humana/ambiente adequado. **NÃO VERIFICADA** indica prova insuficiente. Itens reais dependentes de credenciais são também **NÃO HOMOLOGADOS**.

| Funcionalidade | Referência / produção | Branch e escopo da evidência |
|---|---|---|
| Página pública / assets / monitor | APROVADA na sondagem | APROVADA no build |
| Login e-mail/senha e logout Hosted Auth | NÃO VERIFICADA — NÃO HOMOLOGADA com credenciais reais | APROVADA com Auth simulado; limpeza/races runtime aprovadas |
| Sessão inativa, refresh, resposta após logout | REPROVADA por reprodução no código de referência | APROVADA runtime controlado; relógio real de 20 min PENDENTE |
| Perfil ativo/inativo, sessão revogada e roles | APROVADA por catálogo/grants; fluxo humano PENDENTE | APROVADA em SQL/RLS isolado |
| MFA false / true | Flag false confirmada; TOTP real NÃO HOMOLOGADO | APROVADA na autorização SQL; enrollment/challenge Hosted PENDENTE |
| Convite e recuperação de senha | Convite REPROVADO no mock da implementação implantada; entrega NÃO HOMOLOGADA | JWT APROVADO no teste Edge; SMTP/callback/recuperação PENDENTES |
| Cadastro de paciente e abertura de internação | Inspeção e integridade lida; uso real não executado | APROVADA pelo navegador + SQL sintético |
| Edição de paciente / datas de internação | NÃO VERIFICADA como fluxo completo | PENDENTE; não supor recursos de edição inexistentes |
| Leitos e duplicação | APROVADA nos controles agregados | APROVADA colisão SQL sequencial; concorrência PENDENTE |
| Modalidade, tarifas e negociação | APROVADA quanto à tarifa efetiva nos dados consultados | APROVADA engine/testes e tarifa SQL; todas combinações comerciais PENDENTES |
| Diárias, meia inicial, mês/bissexto | APROVADA nos controles de ciclo | APROVADA cenários matemáticos; política da exceção mesma data PENDENTE |
| Adicionais e pagamentos parciais | Sem anomalia nos controles consultados | APROVADA SQL + navegador |
| PIX / retry / referência conflitante | REPROVADA por reprodução isolada da referência | APROVADA SQL com migration proposta |
| Cartão crédito/débito, parcelas/vencimentos | Estrutura implantada conferida | APROVADA suites de pagamento/documento e crédito 2x no navegador |
| NaN/Infinity financeiros | Zero ocorrências consultadas, mas guard de NaN REPROVADO | APROVADA proteção proposta; migration não implantada |
| Desconto no acerto / cartão com desconto | RPC implantada; cartão REPROVADO por ReferenceError na nova main | APROVADA no SQL e runtime; concessão pelo navegador Hosted PENDENTE |
| Reembolso / estorno / auditoria | Inspeção, sem mutação real | APROVADA SQL e trilha; todas ações visuais PENDENTES |
| Alta, prévia e finalização | Zero contas finalizadas divergentes no controle lido | APROVADA SQL/navegador e versão antiga rejeitada |
| Cancelamento de internação / transferência de leito | NÃO VERIFICADA como recurso operacional completo | PENDENTE de definição e teste; não acrescentado por inferência |
| Totais financeiro/dashboard e histórico longo | Carregamento sem páginas REPROVADO estruturalmente | APROVADA paginação 1.001 linhas; snapshot simultâneo PENDENTE |
| Folha, PDF e exportação | Código e emissão anterior disponíveis | APROVADA navegador/testes; impressora física NÃO HOMOLOGADA |
| Busca / foco | REPROVADA | APROVADA runtime/navegador |
| Autoatualização / offline / reconexão | Inspeção, sem longa interrupção real | APROVADA limpeza e aviso; falha de mutação/rede lenta prolongada PENDENTE |
| Desktop / tablet / mobile | Layout mobile com saldo fora da área útil | APROVADA Chrome em quatro larguras; iPhone/Android físicos NÃO HOMOLOGADOS |
| PWA / service worker | APROVADA disponibilidade/static checks | Instalação/atualização/cache nativos PENDENTES |
| Último administrador | Guard presente; corrida independente NÃO VERIFICADA | APROVADA sequencial; lock preventivo, concorrência PENDENTE |
| Cron / saúde / alertas | APROVADA janela consultada e estado recente | Notificação externa e indisponibilidade prolongada PENDENTES |
| Logs Vercel / backups / disaster recovery | NÃO VERIFICADA | PENDENTE de acesso e restore isolado |
| Segurança/CI/revisão de release | Main desprotegida confirmada | Gate local APROVADO; CI remoto consultável no PR, proteção PENDENTE |

## I. Avaliação por categoria
Notas de engenharia para a **referência em produção**, usando apenas as evidências disponíveis. Não são certificação, medida estatística nem nota da branch como se estivesse publicada.

| Categoria | Nota / 10 | Fundamentação |
|---|---:|---|
| Segurança | 6,0 | RLS, sessão server-side, roles e CSP fortes; main desprotegida, Hosted Auth pendente e proteção nativa de senha vazada ausente. |
| Confiabilidade | 6,0 | Jobs/health bons na janela, mas races de sessão reproduzidas, logs parcialmente indisponíveis e restore não demonstrado. |
| Integridade financeira | 7,0 | Engine, versionamento e trilha conferem cenários; paginação/idempotência/NaN exigem correções e concorrência nativa permanece aberta. |
| Desempenho | 7,5 | Bundle e amostra pública leves; snapshot amplo, render linear por histórico e ausência de p95/carga móvel limitam a nota. |
| UX/UI | 6,5 | Navegação simples e conta legível; busca, termos financeiros e informação mobile prejudicavam clareza. |
| Simplicidade operacional | 7,0 | Quatro áreas principais e prévia de acerto; diagnóstico técnico, step-up e estorno precisam comunicação/homologação. |
| Responsividade | 6,5 | Formulários adaptáveis; tabela escondia saldo; hardware Safari/Android não comprovado. |
| Manutenibilidade | 5,0 | Módulos de domínio úteis, mas app monolítico com ts-nocheck e documentação historicamente divergente. |
| Cobertura de testes | 6,0 | 40 testes iniciais e quatro incorporados depois; faltavam SQL/RLS e percurso com banco. Novos 27 e navegador ampliam cobertura sem resolver Hosted Auth/concorrência. |

## J. Conclusão
O IMEC UTI tem uma base operacional clara e controles financeiros relevantes. O pacote entregue corrige falhas comprovadas e melhora tarefas frequentes sem redesenhar o produto, alterar tarifas vigentes ou impor MFA.

Para alcançar um padrão elevado, o próximo passo é revisar e homologar esta branch, executar concorrência em PostgreSQL real, fechar Auth/SMTP e restauração de backup, proteger a publicação e validar celular/impressora com a equipe. A ausência de anomalias nas consultas atuais é positiva; a aprovação final depende dessas provas restantes e de um release acompanhado.

