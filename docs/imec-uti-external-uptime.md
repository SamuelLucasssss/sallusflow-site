# IMEC UTI — Pacote 7: monitoramento externo e incidentes

## Objetivo

Ter um observador fora do Supabase e Vercel capaz de indicar quando o endereço público ou proteções de segurança deixam de funcionar. Os Pacotes 4 e 5 monitoram o banco; este monitor executa nos runners GitHub Actions.

## Escopo e proteção de dados

- URL: https://www.sallusflow.com.br/imec-uti/
- Recursos públicos: HTML de entrada, manifest, service worker e três ícones PNG.
- **Nunca consulta** Supabase Auth, pacientes, pagamentos, banco, nem endpoints protegidos.
- Não registra segredos de projeto, tokens de produção nem dados pessoais.
- Requisições no-store, sem redirects automáticos e com timeout/retries.
- Verifica HTTP 200; montagem do app; CSP/frame protections, no-store/nosniff; escopo/ícones do manifest; service worker sem cache; PNGs válidos.
- Não verifica login/MFA nem disponibilidade interna do Supabase.

## Agendamento e incidentes

Workflow: .github/workflows/imec-uti-uptime.yml

- Agenda: aproximadamente a cada 15 minutos; também admite execução manual (workflow_dispatch).
- Runs agendados GitHub não têm SLA de pontualidade e podem atrasar.
- Sem falha: não abre issue. Falha persistente após três tentativas: job falha e abre **uma única issue**.
- Nova falha enquanto há incidente aberto: nenhuma issue duplicada.
- Recuperação confirmada: comentário de resolução e issue fechada automaticamente.
- Issue e resumo apresentam somente caminho público, código padronizado de falha e hora UTC.
- Notificações e e-mail dependem de Watch/Notifications de cada responsável no GitHub.
- Requer Actions ativo e política de GITHUB_TOKEN com issues: write. Sem esse direito, o job falha e exige ajuste administrativo.
- Não executa rollback nem reinicia serviços automaticamente.

## Resposta a incidente

1. Validar o endereço público em outra rede, separando falha local de indisponibilidade real.
2. Conferir último deploy Vercel e DNS/TLS.
3. Conferir saúde Supabase e monitor interno antes de concluir a causa.
4. Se for regressão do release, planejar rollback Vercel segundo o runbook. Não alterar banco sem diagnóstico.
5. Verificar recuperação de todos os recursos públicos e documentar conclusão.

## Limitações

- GitHub Actions não substitui monitor com SLA, múltiplas regiões ou SMS/WhatsApp.
- Issues podem ser públicas enquanto o repositório for público; nunca adicionar dados de pacientes.
- O cron começa apenas após merge do workflow na main.
- Não resolve backup/restauração off-site (Issue #10) nem homologação física em iOS/Android/impressoras (Issue #14).
