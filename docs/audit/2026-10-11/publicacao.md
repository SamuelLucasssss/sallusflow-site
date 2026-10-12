# IMEC UTI — Aplicação das correções da auditoria

Autorização: pedido do usuário para aplicar todas as correções e melhorias. Release iniciado em 11/10/2026, America/Sao_Paulo; timestamps do servidor em 12/10 UTC.

## Banco e Edge Function

- Projeto confirmado: IMEC UTI, `nxaxkczyeythvzdxqwyu`, ACTIVE_HEALTHY, PostgreSQL 17.11.
- Preflight: zero valores NaN/Infinity nas colunas abrangidas; nenhuma constraint nova já presente; nenhum alerta não resolvido; `mfa_required=false`.
- Migration `audit_integrity_hardening` aplicada com sucesso. O servidor gerou a versão **20261012004235**; o arquivo local e o fixture foram alinhados a essa versão, sem modificar o SQL revisado ou reparar o histórico remoto.
- Pós-migration: seis constraints validadas; comparação do conteúdo em retry de pagamento instalada; locks de sincronização e administração presentes; implementação privada obsoleta de alta sem EXECUTE para authenticated.
- Pós-migration: 12 tabelas com RLS; predicados executáveis por authenticated; SELECT financeiro anônimo e UPDATE direto de pagamentos negados; zero leitos abertos duplicados, ciclos ativos duplicados e contas finalizadas com saldo diferente de zero nas consultas executadas.
- `invite-uti-user` publicada como **versão 4, ACTIVE, verify_jwt=true**. JWT do usuário é enviado ao RPC autorizador; checagem AAL2 e sessão administrativa continuam obrigatórias para convite.
- MFA continua **false**. Login operacional por e-mail/senha preservado. Nenhum paciente, recebimento ou tarifa real foi alterado por uma operação de teste deste release.

## Validação adicional antes do release

Os 71 testes, typecheck, quality gate, auditoria de dependências e build passaram novamente. A jornada de navegador usa build real e PostgreSQL isolado, com Auth simulado.

O CI também revelou uma disputa de foco ao começar a digitar imediatamente depois de navegar: o callback adiado de navegação focava o conteúdo depois que o usuário já estava na busca. O foco de navegação foi aplicado no mesmo evento, preservando acessibilidade e evitando retirar o cursor do campo. A jornada agora digita sem intervalo artificial e verifica texto completo e foco.

Também foi instalado um servidor PostgreSQL **17.11 nativo isolado**, ligado somente em `127.0.0.1`, a partir dos binários distribuídos pela EDB e referenciados pelo [site oficial PostgreSQL](https://www.postgresql.org/download/windows/). Nenhum serviço Windows permanente ou conexão com o banco de produção foi usado nessa prova. O driver pg ficou no diretório de ferramentas temporárias, sem nova dependência de produção.

Foram usadas conexões independentes A/B e uma conexão observadora. A operação B foi iniciada enquanto A ainda mantinha a transação; a observadora confirmou `wait_event_type='Lock'` antes do commit de A. O banco foi consultado depois da conclusão de ambas as operações.

| Cenário | Resultado |
|---|---|
| Duas aberturas concorrentes no mesmo leito | Uma abertura aceita; a segunda rejeitada; uma internação no leito. |
| Duas tentativas simultâneas do mesmo PIX após quitação | Um recebimento, uma auditoria de pagamento, saldo zero; retry bem-sucedido. |
| Ajuste de tarifa e sincronização concorrente de diárias | Sincronização aguarda; tarifa de R$ 500 respeitada no ciclo conferido; nenhum ciclo ativo duplicado. |
| Dois administradores tentam remover seu próprio papel ao mesmo tempo | Uma alteração aceita, a outra rejeitada; um administrador ativo preservado. |

[Evidência sanitizada de concorrência](concorrencia-nativa.json). Essa prova resolve os quatro cenários especificados; não representa teste de carga, cobertura de todos os deadlocks ou Hosted Auth real.

## Frontend e integração

Pacote entregue pelo [PR #24](https://github.com/SamuelLucasssss/sallusflow-site/pull/24), sobre a main que já contém desconto auditado. Inclui busca/cursor, sessão/renovação, paginação de históricos, validação de senha, cartão do paciente com desconto, saldo mobile, diagnósticos recolhíveis e mensagens de recebimento/estorno/tarifa.

Publicação pela integração GitHub → main → Vercel. URL: [IMEC UTI](https://www.sallusflow.com.br/imec-uti/). Conferir CI e status Vercel no commit publicado; o frontend e a migration são componentes separados do release.

## Pendências externas que não podem ser dadas como aplicadas

- Proteção de main: conector não oferece alteração de branch protection; navegador disponível não está autenticado no GitHub. Precisa de sessão administrativa no repositório.
- Leaked Password Protection nativa e política/signup/SMTP: conector não oferece atualização da configuração Hosted Auth; painel Supabase exige login. A proteção HIBP da interface e da Edge permanece em funcionamento, mas não substitui configuração do provedor.
- Backup externo e restore da produção: não há credencial/canal autorizado disponível para pg_dump, download do backup ou definição de destino externo. Nenhuma cópia de dados de pacientes foi colocada no repositório público.
- Auth, convite/recuperação com mailbox real, step-up administrativo, iPhone/Android/PWA e impressora física ainda exigem homologação específica. Nenhum e-mail foi disparado como teste.
- Acesso ao painel/logs Vercel retornava 403 durante a auditoria; estado do deploy pode ser conferido pelo status do commit GitHub e pela resposta pública. Logs privados não devem ser considerados verificados por isso.

Melhorias arquiteturais futuras e decisões comerciais da seção G do relatório continuam recomendações com escopo próprio: snapshot transacional, carregamento incremental, extração gradual de app.ts e confirmação de regra de adiantamento/meia diária/mesmo dia. Não foram transformadas em mudanças comerciais presumidas durante este release.
