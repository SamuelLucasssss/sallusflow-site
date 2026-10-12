# Recebimentos posteriores e previstos

Recebimentos reais podem ocorrer antes, no momento ou dias após a alta. A data real do recebimento é preservada; a alta não gera diárias adicionais nem muda de data por causa do atraso no pagamento.

## Uso

- **Já recebi:** registra o pagamento na data informada. Após a alta, a ação indica **Confirmar recebimento posterior**.
- **Receber depois:** salva uma previsão de valor, data, forma e observação. Uma data futura seleciona essa opção automaticamente.
- **Confirmar recebimento:** na conta do paciente ou em Financeiro → Previstos, informa a data real e a forma efetivamente recebida. Pode confirmar agora, mesmo antes da data prevista.
- Voltar de uma data futura para **Já recebi** ajusta o campo para a data atual; uma data futura não é registrada como dinheiro recebido.
- **Cancelar previsão:** exige motivo e preserva o registro de auditoria. Não estorna um pagamento nem altera o saldo.

## Integridade

As previsões ficam em `scheduled_receipts`, separadas de `payments`. Portanto, não entram no recebido, no caixa, na quitação nem nos documentos como pagamentos realizados. O saldo continua pendente até a confirmação.

O valor previsto pode cobrir uma parte da conta. Previsões pendentes reservam o saldo disponível para impedir que duas promessas cubram o mesmo valor. Se um pagamento ou desconto alterar o saldo antes da confirmação, o servidor rejeita um recebimento acima do saldo; a previsão pode ser cancelada e registrada novamente com o valor correto.

A confirmação cria um pagamento real usando as mesmas regras e permissões financeiras existentes, incluindo crédito/débito e vencimentos. A referência do pagamento deriva da previsão e a operação trava a internação antes da previsão. Repetir o clique não duplica pagamento ou auditoria, mesmo quando a primeira confirmação finaliza a conta.

Somente administradores e comerciais podem criar, confirmar ou cancelar previsões. Membros ativos mantêm a leitura; anônimos e perfis inativos não acessam registros. Escritas diretas pelo frontend são negadas. A opção de MFA existente permanece inalterada.

## Validação e banco

- 80 testes aprovados, incluindo nove cenários específicos de previsão, atraso, confirmação, retry, cancelamento, parcelas e autorização.
- Navegador com Auth simulado e PostgreSQL isolado: 107 verificações de superfície, quatro larguras, previsão no recebimento e no acerto, cancelamento, bloqueio de confirmação futura e confirmação real pelo celular.
- PostgreSQL nativo 17.11, duas conexões independentes: reservas concorrentes não comprometem o mesmo saldo duas vezes; confirmações concorrentes produzem um único pagamento e uma única auditoria. Servidor local encerrado após a prova.
- Migration `20261012105802_scheduled_receipts.sql` aplicada em produção. Tabela inicialmente vazia, RLS ativo, SELECT anônimo e INSERT/UPDATE diretos de authenticated negados; RPCs sem execução anônima; monitor de saúde ok.
- Advisories: nenhum problema de segurança relacionado à tabela; índices novos aparecem como não utilizados porque a tabela ainda não recebeu registros. O aviso anterior de proteção nativa contra senhas vazadas permanece registrado na auditoria geral.

Nenhum pagamento ou internação real foi alterado ou criado para testar esta funcionalidade. As evidências locais ficam em `tmp/imec-scheduled-final/` e `tmp/imec-audit/scheduled-native-concurrency.json`. A publicação do frontend segue PR e CI da main, com verificação dos arquivos públicos após o deploy.
