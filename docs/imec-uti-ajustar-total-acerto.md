# Ajustar o total do acerto

O administrador pode usar **Ajustar total do acerto**, na conta do paciente após
a alta, inclusive em contas quitadas. A mesma opção aparece dentro de **Acerto / saída**.

1. Informar o **valor total acordado**, por exemplo `3.700,00`.
2. Descrever o motivo do acordo.
3. Conferir a diferença na cobrança e o saldo resultante; clicar em **Salvar total**.

O sistema acrescenta um ajuste positivo ou um desconto, sem modificar as diárias
originais nem os recebimentos e reembolsos. O ajuste aparece na movimentação,
no histórico, na composição do acerto e nos documentos existentes.

Exemplo: R$ 3.600 cobrados e R$ 3.700 recebidos, com total acordado de R$ 3.700,
produzem um complemento de R$ 100 e saldo zero. Nenhum recebimento é duplicado
e nenhum reembolso é criado. Após uma alta já registrada, a conta é finalizada
quando o saldo fica zerado. Aumentar o total acima do recebido líquido reabre
saldo a receber; reduzi-lo abaixo do recebido líquido mantém crédito a devolver,
explicitamente mostrado antes de salvar. Ajustar o total não realiza a alta.

## Integridade e autorização

`set_uti_settlement_total` exige administrador ativo com sessão válida, alta
registrada, valor finito de zero a R$ 1.000.000 com até duas casas decimais,
motivo de 8 a 220 caracteres e a versão da conta conferida na interface.
Uma conta alterada por outra operação exige atualização e nova conferência.

Cada ajuste usa referência idempotente. Repetir o mesmo pedido não duplica a
cobrança nem o histórico. Reutilizar a referência com outro valor, motivo,
usuário ou versão é rejeitado. Uma redução que deixe previsões de recebimento
acima do novo saldo é bloqueada até que essas previsões sejam revisadas.

O registro `settlement_total_edits` guarda valor anterior, valor acordado,
versão, motivo, autor, lançamento e fotografias anterior/posterior. Não há
escrita direta dos usuários nessa tabela. A leitura é restrita a administradores;
a movimentação e a auditoria da conta mantêm o acesso já existente.

O ajuste modifica o cobrado, portanto não altera o recebido líquido dos relatórios
mensais nem a comissão sobre recebimentos confirmados. O recurso está disponível
para humanizado e particular, sem alterar permissões dos demais perfis.
