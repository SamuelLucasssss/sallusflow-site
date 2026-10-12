# Confirmação de recebimento no acerto

O antigo botão **Concluir** apenas fechava a janela, mesmo com um recebimento preenchido. Em contas com alta registrada e saldo pendente, o rodapé agora mostra **Confirmar recebimento**, usando a mesma operação do botão junto aos campos. Ao confirmar com sucesso, registra o pagamento, atualiza a conta e fecha o acerto. O motivo de um recebimento ser posterior à alta continua explicado junto à data.

Ao escolher **Receber depois** ou uma data futura, ambos os botões mostram **Salvar previsão**: o valor permanece pendente até confirmação real. Quando não há formulário de recebimento, o rodapé mostra **Fechar acerto**. Cancelar ou fechar pelo X não registra dinheiro. Campos inválidos mantêm o formulário aberto e mostram o erro; a mensagem é limpa quando o usuário corrige os campos. Recebimentos reais usam o rótulo **Confirmar recebimento**, e a data posterior à alta é explicada no texto do formulário.

A operação mantém o identificador idempotente, a autorização e as validações financeiras existentes. Um pagamento completo já registrado deixa a conta sem saldo para um segundo lançamento. Nenhuma migração é necessária e nenhum recebimento real é gravado durante os testes.

O roteiro de navegador usa uma conta sintética particular com uma diária de R$ 7.000,00 e recebimento após a alta. Confere rejeição de valor vazio, confirmação pelo rodapé, criação de exatamente um PIX, saldo quitado e rejeição de uma nova tentativa de R$ 7.000,00 em conta finalizada. Os testes de previsão e de confirmação posterior continuam no mesmo roteiro.
