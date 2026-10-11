# IMEC UTI — acesso temporário de testes (e-mail e senha)

## Decisão de produto

Enquanto o IMEC UTI está em testes internos, o login poderá usar somente e-mail e senha, **sem o cadastro de autenticador TOTP**, se `public.app_settings.mfa_required=false`. A flag já existia no Supabase; não foi removida a implementação MFA.

## Segurança e mecanismo

- O backend mantém autenticação real pelo Supabase Auth e validação de sessão em `auth.sessions`, usuário ativo e permissões em `public.profiles`.
- Sem `mfa_required=false` no banco, o frontend **não** concede acesso AAL1: continua exigindo cadastro/desafio MFA.
- Frontend consulta `app_settings?select=mfa_required` na própria sessão autenticada; esta tabela está protegida por RLS `private.is_active_member()`, então apenas sessão permitida pelo backend consegue ler a flag.
- Nenhum registro público, cadastro anônimo, senha embutida, acesso universal ou rota sem autenticação foi criado.
- Banner permanente na área interna informa `AMBIENTE DE TESTES` quando o login sem autenticador está em uso.
- O tempo de inatividade de 20 minutos e a auditoria de movimentações permanecem.
- **A Edge Function `invite-uti-user` exige AAL2 independentemente dessa flag.** Convites administrativos continuam indisponíveis em sessão AAL1; não enfraquecer essa função para testar.
- O monitor externo não autentica usuários nem testa pagamentos; o login real deve ser homologado manualmente.

## Como habilitar, rollback e conclusão da fase de testes

Habilitar somente com autorização do administrador e confirmação dos demais controles:

```sql
update public.app_settings set mfa_required = false where id = 1;
```

**Voltar ao modo protegido antes da operação definitiva:**

```sql
update public.app_settings set mfa_required = true where id = 1;
```

Após reativar o MFA, sessões AAL1 deixam de passar no RLS imediatamente; usuários terão de cadastrar o autenticador para operar. O controle reduz a proteção para todos os usuários ativos (não apenas um perfil). Não registrar dados clínicos sensíveis reais durante testes com MFA desativado, conforme política institucional.

## Homologação

1. Com flag `false`: login correto com e-mail/senha abre o dashboard sem QR, com banner de testes.
2. Login errado e sessão expirada: acesso negado.
3. Sessão inválida, perfil inativo e chamada `anon`: todos negados.
4. Sessão válida após 20 min sem atividade: logout automático.
5. A página mantém permissões de comercial/operacional e restrições de edição; nenhum `GRANT` alterado.
6. Com flag `true`: AAL1 perde acesso ao banco e a interface volta ao fluxo TOTP, inclusive após refresh.
7. Confirmar CI, produção Vercel e health checks.
