# Relatórios por recebimento e modalidade

Em **Relatórios**, escolha **Leito humanizado** ou **Particular** e a competência.
O mês usa `payments.occurred_at` e `refunds.occurred_at`, no fuso de São Paulo,
com o início incluído e o mês seguinte excluído. Entrada e alta são informativas.
Exemplo: entrada em 29/09 e pagamento em 05/10 pertencem ao relatório de outubro.
Pagamentos parciais entram em seus respectivos meses, pelo valor efetivamente recebido.
Crédito parcelado entra integralmente na data do recebimento confirmado; os vencimentos
do cartão não geram novos recebimentos. Previsões e lançamentos cancelados ficam fora.

**Ordenar por** permite escolher nome do paciente, recebimento mais antigo ou
recebimento mais recente. A ordem escolhida vale para a tabela, a conferência
individual, PDF, impressão e CSV, preservando os movimentos selecionados e os totais.
Como a tabela agrupa valores por internação, a ordem usa o primeiro recebimento
selecionado de cada internação; uma linha apenas com reembolso usa a data do reembolso.
Horários completos desempatarão datas iguais; quando o instante é o mesmo, o nome
e a identificação da internação mantêm a ordem estável. Datas desconhecidas ficam
ao final. Os documentos identificam o critério e os arquivos cronológicos incluem
a indicação crescente/decrescente no nome. A ordenação não exige recarregar o banco.

A tabela agrupa valores por internação e mostra entrada, alta, datas de recebimento,
líquido e tipo de leito. Particular acrescenta o responsável pelo fechamento.
Na nova internação particular, o responsável deve ser escolhido explicitamente
entre Samuel e Roberto. A comissão é de R$ 80 para o responsável escolhido por
internação, não por pagamento. Na conta particular, o administrador pode usar
**Responsável** para corrigir a atribuição, informando um motivo; a alteração
fica auditada e preserva cobranças, recebimentos, reembolsos e a situação da conta.
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

O **Repasse particular** é separado do total recebido: R$ 80 por internação para
Samuel ou Roberto, somente quando a conta estiver encerrada e totalmente quitada.
A competência do repasse é a do pagamento confirmado que completou o valor final
cobrado, considerando reembolsos e excluindo pagamentos cancelados. Pagamentos
parciais de meses anteriores continuam no caixa de seus próprios meses, sem gerar
novos repasses. A seleção manual deve incluir o recebimento que quitou a conta.
O resumo por responsável aparece na tela e pode ser incluído no PDF, impressão e
CSV pela opção **Incluir repasse na exportação**. Alterações posteriores na conta,
no responsável ou na quitação exigem nova conferência antes da exportação.
