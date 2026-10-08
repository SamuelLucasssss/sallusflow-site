# IMEC UTI — Observabilidade, Alertas e Auditoria Gerencial

## Objetivo

O Pacote 5 transforma o monitor de saúde do Pacote 4 em um fluxo operacional acionável. O sistema não apenas detecta falhas: ele registra alertas persistentes, evita duplicações, exige reconhecimento administrativo quando necessário, resolve automaticamente condições recuperadas e mantém histórico gerencial.

## Ciclo de vida do alerta

A tabela `public.system_alerts` mantém o histórico de alertas por até 180 dias após resolução.

Estados:

- `open`: detectado e ainda não reconhecido;
- `acknowledged`: um administrador confirmou ciência do problema;
- `resolved`: a condição deixou de existir e foi encerrada automaticamente.

Cada alerta possui uma `alert_key` única enquanto estiver ativo. Isso impede que um health check executado a cada 15 minutos produza centenas de alertas iguais.

Enquanto o problema persiste:

- `last_detected_at` é atualizado;
- `occurrence_count` é incrementado;
- detalhes e severidade são atualizados.

Se um alerta já reconhecido sobe de `warn` para `critical`, o reconhecimento anterior é invalidado e o alerta volta a `open`. Assim uma escalada nunca fica escondida atrás de um reconhecimento antigo.

## Origem dos alertas

### Health check

Cada novo registro de `system_health_checks` dispara `system_health_alert_reconcile`.

Os códigos produzidos pelo health check passam a ter ciclo de vida persistente. Quando o código deixa de aparecer na checagem seguinte, o alerta correspondente é resolvido automaticamente.

### Watchdog

O job `imec-uti-observability-watchdog` executa aos minutos 07, 22, 37 e 52 de cada hora, deslocado do health check principal.

Ele monitora especificamente o próprio mecanismo de observabilidade:

- job de health check ausente/inativo;
- health check sem execução há mais de 35 minutos;
- falhas do job de health check na última hora.

Isso evita que a ausência do monitor seja interpretada como ausência de problemas.

Limitação arquitetural inevitável: se o próprio serviço `pg_cron` parar completamente, jobs internos não conseguem alertar sobre a própria indisponibilidade. A interface continua classificando health check com mais de 45 minutos como **Monitor atrasado** quando algum administrador acessa o sistema. Um alerta verdadeiramente externo exige um monitor fora do Supabase.

## Segurança e autorização

- `system_alerts` possui RLS;
- somente administradores com sessão segura passam pela política de leitura;
- `anon` não possui SELECT;
- usuários autenticados não possuem INSERT/UPDATE/DELETE direto;
- funções privadas de criação/resolução/watchdog não podem ser executadas pelo app;
- reconhecimento ocorre somente por `public.acknowledge_uti_alert()`;
- a implementação privada revalida `private.is_admin()`, portanto exige sessão ativa, perfil admin e MFA/AAL2 conforme os controles existentes.

## Auditoria

A abertura, escalada, reconhecimento e resolução de alertas geram registros em `public.audits`.

A trilha diferencia eventos do sistema (`Sistema`) de ações humanas, incluindo quem reconheceu cada alerta.

Eventos principais:

- Alerta operacional aberto
- Alerta operacional escalado
- Alerta operacional reconhecido
- Alerta operacional resolvido

As operações financeiras e administrativas já auditadas pelos RPCs existentes continuam preservadas na mesma trilha, permitindo uma visão gerencial única.

## Central de observabilidade

Administradores veem em **Configurações → Central de observabilidade**:

- alertas ativos;
- críticos ativos;
- quantidade aguardando reconhecimento;
- percentual de checagens saudáveis na janela recente;
- até 96 health checks recentes, aproximadamente 24 horas;
- eventos auditados nas últimas 24 horas;
- alertas abertos, reconhecidos e resolvidos recentemente;
- quem reconheceu o alerta;
- número de ocorrências do mesmo problema;
- trilha gerencial recente.

Além disso, quando existir qualquer alerta ativo, um banner persistente aparece em qualquer página do sistema.

## Atualização

O aplicativo já possuía atualização de fundo a cada 45 segundos e atualização ao voltar para a aba. O Pacote 5 reutiliza esse mecanismo para alertas, evitando um WebSocket adicional e mantendo menor superfície operacional no projeto Free.

## Critérios de validação

O pacote somente é considerado concluído quando:

- migration aplicada e versionada;
- RLS e privilégios mínimos validados;
- deduplicação testada;
- incremento de ocorrência testado;
- escalada `warn → critical` testada;
- resolução testada;
- watchdog ativo;
- trigger de reconciliação ativo;
- CI verde;
- Vercel verde;
- advisors executados após DDL;
- health check e watchdog validados depois do deploy.
