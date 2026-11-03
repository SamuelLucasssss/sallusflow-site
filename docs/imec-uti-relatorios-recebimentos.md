# Relatórios por recebimento e modalidade

Em **Relatórios**, escolha **Leito humanizado** ou **Particular** e a competência.
O mês usa `payments.occurred_at` e `refunds.occurred_at`, no fuso de São Paulo,
com o início incluído e o mês seguinte excluído. Entrada e alta são informativas.
Exemplo: entrada em 29/09 e pagamento em 05/10 pertencem ao relatório de outubro.
Pagamentos parciais entram em seus respectivos meses, pelo valor efetivamente recebido.
Crédito parcelado entra integralmente na data do recebimento confirmado; os vencimentos
do cartão não geram novos recebimentos. Previsões e lançamentos cancelados ficam fora.

A tabela agrupa valores por internação e mostra entrada, alta, datas de recebimento,
líquido e tipo de leito. Particular acrescenta o responsável pelo fechamento.
Humanizado calcula os 3% da Aline Glória sobre o recebido menos reembolsos da seleção;
a comissão é opcional nos documentos e não aparece no particular.

## Conferência e seleção

**Conferir e selecionar recebimentos** abre os movimentos individuais do mês,
com paciente, data/hora, forma e valor. Todos começam selecionados; é possível
desmarcar movimentos, selecionar todos ou limpar a seleção. Os totais e a comissão
são recalculados na prévia. Nenhum pagamento, saldo ou cadastro é alterado.
Atualizar, mudar modalidade ou mudar competência reinicia a seleção.

PDF, impressão e CSV identificam uma seleção parcial explicitamente, incluindo
a quantidade selecionada e o total de movimentos da competência. O nome do arquivo
também inclui `Selecao`. Nenhum documento é gerado pela interface quando todos os
movimentos de uma competência não vazia estão desmarcados. Competências realmente
vazias podem gerar documento com zero. PDFs são A4 e repetem o cabeçalho em cada página.

## Consistência e acesso

`get_uti_monthly_receipts_report` retorna uma fotografia da competência e modalidade,
com movimentos e identificador de conferência. `export_uti_monthly_receipts_report`
valida a seleção, recalcula os valores, compara essa fotografia e registra a saída
documental na mesma transação. Uma alteração desde a prévia impede a exportação,
sem registrar uma saída inexistente; a interface atualiza os dados para nova conferência.
O identificador inclui todos os candidatos, mesmo os desmarcados, e os campos exibidos.

Seleções de outro mês/modalidade, chaves repetidas/nulas e comissão no particular
são rejeitadas. Apenas membros com sessão ativa podem consultar/exportar, seguindo
o acesso já existente aos relatórios. Auditoria registra competência, modalidade,
quantidades e total; não copia nomes/CPF. RPCs antigas do humanizado permanecem
disponíveis durante a atualização de clientes abertos.

## Validação

Testes com PostgreSQL isolado verificam competência após alta, modalidades,
limite mensal no fuso de São Paulo, cartão, previsões/cancelamentos, reembolsos,
comissão negativa, seleção, rejeição de dados obsoletos e autorização. O navegador
usa dados sintéticos e o mesmo banco isolado para conferir exportações e layouts
em 1365, 820, 390 e 360 pixels. Nenhum paciente real é alterado nesses testes.
