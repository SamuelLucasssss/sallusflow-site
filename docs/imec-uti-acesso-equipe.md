# Acesso da equipe

O acesso diário usa e-mail e senha, com botão para mostrar/ocultar a senha e recuperação de acesso. A sessão e as permissões são individuais. A política de MFA configurada no banco continua sendo respeitada; o convite não exige um segundo fator separado quando essa política permite acesso por senha.

## Primeiro acesso

O administrador abre **Configurações → Adicionar usuário**, informa nome e e-mail e escolhe o perfil. **Indicação e consulta** é a opção inicial. A criação e a liberação acontecem na mesma ação, com auditoria do administrador que a realizou.

O padrão **Gerar link de primeiro acesso** não envia e-mail: o administrador copia e compartilha o link exclusivamente com a pessoa convidada. O link permite criar a própria senha; depois, o acesso usa e-mail e senha. O link não é salvo no armazenamento do navegador, no conjunto de dados da aplicação ou no texto da auditoria. Fechar a janela remove o link da tela. Não publique o link nem o inclua em documentos ou logs.

**Enviar convite por e-mail** depende da configuração de entrega do Supabase. Sem SMTP próprio, o serviço padrão restringe os destinatários à equipe da organização. A opção por link evita essa dependência no primeiro acesso. A recuperação automática por e-mail também depende dessa configuração e não deve ser anunciada como entregue quando a solicitação falhar.

## Perfil da Aline Glória

**Indicação e consulta** pode cadastrar novas indicações/internações, acompanhar pacientes e consultar/exportar relatórios. Não pode registrar recebimentos, alterar diárias, lançar extras, conceder descontos, editar contas ou gerenciar usuários. A navegação destaca o cadastro, os pacientes e os relatórios.

**Alta e encerramento são exclusivos de administradores**, também no banco. Os perfis operacional e comercial deixam de ter permissão de alta. Os recebimentos já realizados e demais dados existentes não são alterados pela migration.

## Publicação e validação

Aplicar a migration `simple_team_access_roles`, publicar a Edge Function `invite-uti-user` e só então publicar o frontend. Não anunciar o novo perfil nem distribuir convites antes dessas três etapas. O Supabase precisa estar autenticado na organização que contém o projeto IMEC UTI.

Os testes usam contas e pacientes sintéticos em PostgreSQL isolado. A auditoria de navegador executa o código real da Edge Function e os RPCs reais, simulando apenas o provedor Auth. A entrega real de e-mail e a criação da conta da Aline exigem a conta de produção autenticada e o e-mail dela; senhas e tokens nunca devem ser enviados pelo chat.
