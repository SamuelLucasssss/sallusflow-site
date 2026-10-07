# IMEC UTI — Resiliência Operacional e Recuperação

## Objetivo

O Pacote 4 cobre falhas silenciosas e capacidade de diagnóstico depois que integridade financeira, arquitetura de produção e segurança já estão estabilizadas.

O sistema deve responder rapidamente a quatro perguntas:

1. O banco e as regras críticas estão coerentes?
2. O faturamento automático continua executando?
3. Algum controle de segurança essencial foi desligado?
4. Um administrador consegue ver o problema antes de operar sobre dados inconsistentes?

## Monitor de saúde

A tabela `public.system_health_checks` registra snapshots operacionais. Somente administradores autenticados com sessão válida e MFA server-side passam pela RLS de leitura.

O job `imec-uti-health-check` executa a cada 15 minutos e chama `private.run_uti_health_check()`.

Cada checagem valida:

- existência de administrador ativo;
- `mfa_required=true`;
- ausência de dois pacientes ativos no mesmo leito;
- ausência de ciclos de diária duplicados;
- existência de condição de diária válida em toda conta aberta;
- coerência entre status da internação e data de alta;
- presença e atividade do job `imec-uti-sync-daily-charges`;
- execução bem-sucedida recente do faturamento automático;
- falhas do faturamento automático nas últimas 6 horas.

O resultado é classificado em `ok`, `warn` ou `critical`. O histórico operacional é mantido por 90 dias.

## Visibilidade no aplicativo

Administradores veem em **Configurações → Saúde operacional**:

- status atual;
- horário da última checagem;
- estado do faturamento automático;
- último sucesso do faturamento;
- quantidade de administradores ativos;
- situação do MFA server-side;
- quantidade de inconsistências;
- lista de alertas detectados.

Se a última checagem tiver mais de 45 minutos, a interface não exibe “Saudável”; mostra **Monitor atrasado**.

## Regras de incidente

### Critical

Tratar antes de lançar novas movimentações quando o alerta envolver:

- leito ativo duplicado;
- ciclo financeiro duplicado;
- internação sem condição de diária;
- faturamento automático inativo/atrasado com conta aberta;
- ausência de administrador ativo;
- MFA server-side desativado.

### Warning

Investigar no mesmo turno:

- falha recente do cron seguida de recuperação;
- inconsistência de status/data de alta;
- monitor sem atualização recente quando não há conta ativa.

## Recuperação

O monitor de saúde **não é backup** e não substitui restauração de banco.

Supabase gerencia backups de banco conforme o plano do projeto. O status/retensão do backup deve ser verificado no Dashboard em **Database → Backups**. Para RPO menor, usar Point-in-Time Recovery quando disponível no plano. Objetos do Storage não fazem parte do backup de banco.

Antes de qualquer restauração:

1. interromper lançamentos no sistema;
2. registrar o horário e o impacto do incidente;
3. preservar logs e evidências;
4. identificar o último ponto consistente;
5. restaurar em ambiente isolado quando possível;
6. validar integridade financeira e health check;
7. só então reabrir operação.

## Release safety

Toda mudança do IMEC UTI deve:

- ser versionada em migration quando alterar banco;
- passar por `npm run check`;
- manter CI verde;
- preservar o monitor de resiliência no quality gate;
- executar advisors do Supabase após DDL;
- validar o health check pós-deploy.

## Estado inicial do Pacote 4

Na implantação inicial:

- monitor: `ok`;
- faturamento automático: ativo;
- MFA server-side: ativo;
- admins ativos: 1;
- leitos ativos duplicados: 0;
- ciclos de cobrança duplicados: 0;
- contas abertas sem diária válida: 0;
- falhas recentes do faturamento: 0.
