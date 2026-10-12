# Editar recebimento

Administradores encontram **Editar** junto a cada pagamento na movimentação da conta e em **Pagamentos realizados** no acerto. O formulário abre com os dados atuais e permite corrigir valor, data/hora, forma, crédito/débito, parcelas, vencimentos e observação. O motivo da correção é obrigatório. É possível corrigir contas já finalizadas; alterar o valor recalcula o saldo e, quando necessário, reabre a pendência financeira. A data proposta de alta é preservada ao salvar uma edição pelo acerto.

O recebimento mantém seu identificador, autor e data de criação originais. A tabela `payment_edits` guarda cada versão anterior e posterior, responsável, momento e motivo; a auditoria da conta exibe a correção. O valor corrigido conta uma única vez nos totais, no financeiro e nos documentos gerados novamente. PDFs já baixados devem ser gerados novamente.

O servidor exige sessão válida de administrador e bloqueia estornados, internações canceladas, datas futuras ou anteriores à entrada, valores inválidos, parcelas incoerentes, aumento acima do saldo disponível reservado e redução abaixo de reembolsos existentes. Dados anteriores à última atualização não podem sobrescrever uma alteração concorrente. Repetir a mesma operação após perda da resposta não cria outra revisão. Previsões confirmadas mantêm o vínculo ao pagamento corrigido.

A migração é aditiva e não altera recebimentos existentes. Os testes usam dados sintéticos em PostgreSQL isolado; nenhuma edição real é executada para testar a funcionalidade. O roteiro de navegador verifica edição pelo acerto, preservação da saída proposta, edição em conta finalizada, cinco vencimentos, rejeição de data futura, quatro larguras e navegação por teclado. Auth hospedado e dispositivos físicos não são simulados como homologação de produção.

Referência: [funções de banco e permissões no Supabase](https://supabase.com/docs/guides/database/functions).

Validação da entrega em 12/10/2026: 92 testes passaram, typecheck, qualidade, auditoria de dependências e build concluídos. O navegador conferiu 112 telas/estados em quatro larguras, sem erros JavaScript ou transbordamento horizontal. PostgreSQL 17.11 com conexões independentes confirmou bloqueio de edição concorrente desatualizada e repetição idempotente, com uma única revisão/auditoria. A migração foi aplicada em produção e a conferência de permissões confirmou RLS, acesso administrativo e ausência de gravação direta para clientes. Nenhum recebimento existente foi alterado pela migração.

A conferência do acerto também descarta respostas de cálculo anteriores quando o usuário troca a saída ou fecha o formulário. Uma resposta atrasada não pode substituir a prévia da data atual.
