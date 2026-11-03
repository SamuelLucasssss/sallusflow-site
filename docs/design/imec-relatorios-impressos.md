# Relatórios impressos — apresentação

Os PDFs baixados e a janela de impressão de humanizado/particular usam a mesma
hierarquia: identidade IMEC discreta, competência, título da modalidade, resumo
líquido e tabela de pacientes. Tipografia escura, linhas finas, fundos quase brancos
e pequenos detalhes no verde institucional mantêm a leitura e o consumo de tinta.

O valor líquido recebe destaque, seguido das quantidades de recebimentos e
internações. A tabela prioriza nome, datas completas e valores alinhados à direita;
particular acrescenta o responsável. Não há mudança na definição de competência,
cálculos, comissão ou seleção de movimentos. CSV e a tabela de conferência do
sistema preservam suas colunas e regras anteriores.

O PDF A4 usa Helvetica com métricas AFM padrão para medir texto e alinhar valores.
Linhas normais ficam juntas; linhas excepcionalmente longas continuam em outra
página com contexto do paciente. Páginas seguintes têm cabeçalho compacto e todas
recebem numeração. A impressão HTML repete cabeçalhos da tabela e inclui modalidade,
competência e páginas nas margens dos navegadores que suportam caixas de margem CSS.

Seleções manuais continuam identificadas no cabeçalho/rodapé. Comissão da Aline
continua opcional e exclusiva do humanizado. Nomes são escapados no HTML; nenhum
recurso externo ou biblioteca de fontes é necessário para gerar os documentos.

Validação: renderização dos dois formatos em modelos com movimentos, seleção,
reembolso, competência vazia e 90 pacientes sintéticos. Conferência de margens,
datas, nomes, numeração e transições entre páginas, além dos testes de regressão.
