# Relatório mensal de leito humanizado

Abra **Relatórios**, selecione a competência e use **Baixar PDF** ou **Imprimir**. O mês anterior vem selecionado inicialmente. O PDF A4 contém nome do paciente, entrada, alta, valor total e tipo de leito (simples ou suíte), total líquido e a descrição **Leito humanizado ref. competência MM/AAAA**. Cabeçalhos e numeração se repetem em várias páginas; nomes completos são preservados. Pacientes ainda internados aparecem como **Em internação** na alta.

A aba mostra total recebido líquido, quantidade de recebimentos confirmados, quantidade de internações e comissão de **3% para Aline Glória**. A opção **Incluir comissão na exportação** acrescenta o cálculo ao PDF ou à planilha. Por padrão, o documento para apresentação não inclui a comissão. **Planilha CSV** é uma opção secundária compatível com Excel em português, com acentos, cinco colunas e proteção contra fórmulas inseridas em nomes; não é um arquivo XLSX.

## Critério financeiro

- A competência considera a data real de cada recebimento ou reembolso no fuso de São Paulo, não a entrada, alta ou data de digitação.
- Leito humanizado corresponde às internações de hotelaria (`mode=hotel`). Leitos 10 a 16 são simples; 17 a 19 são suítes. Particular fica fora deste relatório.
- Pagamentos confirmados não estornados entram integralmente; crédito parcelado não é distribuído pelas datas de vencimento. Recebimentos previstos não entram.
- Uma linha representa uma internação, somando pagamentos parciais e subtraindo reembolsos daquela competência. Um reembolso de recebimento de outro mês aparece como valor negativo no mês do reembolso.
- Total líquido = recebimentos do mês − reembolsos do mês. Comissão = 3% do total líquido, arredondada em centavos; valores negativos permanecem como ajuste, sem comissão mínima inventada.
- A quantidade de recebimentos conta os registros de pagamento, enquanto a tabela agrupa por internação. Duas internações do mesmo paciente continuam separadas por suas datas.

## Integridade e validação

O banco calcula linhas, total e comissão em um único snapshot. Consultas não alteram o financeiro. A geração de PDF, impressão ou CSV consulta os dados novamente e registra saída documental na auditoria sem copiar dados de pacientes para o texto do evento. Acesso exige sessão válida de membro ativo, seguindo o acesso existente ao financeiro; anônimos e perfis inativos são bloqueados. Troca de sessão limpa os dados locais do relatório; respostas antigas de competência não substituem a seleção atual.

Validação: 103 testes passaram, incluindo fronteira mensal no fuso de São Paulo, pagamentos parciais, reembolsos, crédito parcelado, acesso, arredondamento e documentos. Typecheck, qualidade, segurança de dependências e build passaram. Navegador com Auth simulado e PostgreSQL isolado conferiu 118 telas/estados em quatro larguras, PDF normal/com comissão, impressão, CSV, competência vazia, recuperação de rede e troca rápida de mês. PDFs sintéticos de uma e seis páginas foram renderizados e revisados. Nenhum registro financeiro de produção foi modificado para testar.

A migração `20261012124325_humanized_monthly_reports.sql` foi aplicada em produção; permissões, duas funções públicas e índices mensais foram conferidos. A migração não modifica recebimentos ou reembolsos existentes.
