# IMEC UTI — modo normal de autenticação

O nome deste arquivo é histórico. O modo operacional vigente utiliza **e-mail e senha**, sem TOTP obrigatório, quando `public.app_settings.mfa_required=false`.

- Não é um ambiente de demonstração: não deve aparecer banner de testes.
- Auth real, sessão existente em `auth.sessions`, perfil ativo, RLS e autorização por função continuam obrigatórios.
- A inatividade encerra o acesso no navegador após 20 minutos; renovar tokens automaticamente não conta como atividade humana.
- A implementação MFA continua disponível. Só alterar a flag com autorização explícita; uma auditoria não autoriza reativá-la.
- Convites administrativos mantêm a exigência específica de AAL2 e sessão administrativa válida. O fluxo de elevação voluntária precisa de homologação; não contornar esse requisito.
- Não usar credenciais compartilhadas, armazenar senhas no código ou registrar pacientes fictícios em produção.

Riscos residuais: senha comprometida permite autenticação de primeiro fator; tokens persistem em localStorage; o bloqueio por inatividade é do cliente. RLS e validação de sessão continuam sendo o limite efetivo no banco.

Ver [arquitetura de segurança](imec-uti-security.md) e [auditoria de 11/10/2026](audit/2026-10-11/relatorio.md).
