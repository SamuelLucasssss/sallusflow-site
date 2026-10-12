# Revisão visual e funcional — IMEC UTI

## Resultado

Renovação aplicada ao acesso, navegação, visão geral, pacientes, conta individual, financeiro, configurações e modais. O plano está em `imec-premium.md`; a apresentação está isolada em `src/imec-uti/premium.css` e carregada somente na aplicação IMEC UTI.

## Verificação por página

| Página / estado | Revisão |
| --- | --- |
| Acesso e recuperação | Composição, legibilidade, campos e ações em quatro larguras |
| Início vazio e preenchido | Indicadores, pendências, resumo mensal e cartão com nome longo |
| Pacientes | Busca por nome sem acento, resultado vazio, filtros, saldo móvel e abertura da conta |
| Conta ativa | Identidade, metadados, números, ações, diárias e histórico |
| Conta com alta pendente | Desconto e acerto com pagamento pendente |
| Conta com crédito | Crédito separado da dívida, reembolso e acerto |
| Conta finalizada | Histórico, estorno, impressão e download |
| Financeiro | Pendências, movimentações e finalizados, com dados sintéticos |
| Configurações | Operação, equipe, ações de segurança e diagnósticos abertos |
| Cadastro | Campos e ações móveis; criação de internação sintética |
| Pagamento | PIX, crédito com duas parcelas e vencimentos; confirmação financeira |
| Extras e diária | Formulários, valores e ações; extra integrado à conta |
| Desconto e reembolso | Formulários, motivo, resumo e ações sem envio durante a inspeção visual |
| Estorno | Tabela, aviso e saída do diálogo sem estornar dados reais |
| Convite e senha | Formulários e foco; nenhum e-mail enviado e nenhuma senha real alterada |
| Alta e acerto | Cálculo, recebimento, confirmação e versão da conta |
| Folha de acerto | Visualização no celular sem transbordamento; impressão A4 revisada visualmente |

## Achados corrigidos durante a revisão

1. Cartões e painéis com nomes longos podiam ampliar o painel móvel. Foram aplicados limites de largura e colunas que permitem encolhimento, preservando os valores.
2. A folha de acerto mantinha largura fixa de impressão na tela móvel. O layout de tela agora reorganiza identificação, períodos e valores; as regras de impressão continuam independentes.
3. Quatro indicadores financeiros eram distribuídos em três colunas. Agora usam quatro colunas no desktop e duas em telas menores.
4. Símbolos Unicode e glifos variavam entre plataformas. A navegação e as ações principais usam SVG local com traço uniforme e nomes visíveis.
5. Fontes pequenas e pesos excessivos enfraqueciam a hierarquia. Rótulos, descrição e valores receberam escala e espaçamento consistentes.
6. Controles de perfil e salvamento da equipe receberam nomes acessíveis que identificam o usuário correspondente.

## Evidências

- `npm run check`: 71 testes aprovados, TypeScript, quality gate, auditoria de dependências e build aprovados.
- `npm run test:browser`: 98 verificações de superfície aprovadas, 147 cliques, 36 preenchimentos, zero erros JavaScript.
- Larguras: 1365, 820, 390 e 360 CSS px; revisão adicional das quatro páginas a 683 CSS px, largura equivalente ao refluxo de uma janela de 1366 px com zoom de 200%.
- Todos os modais inspecionados verificam Tab, Shift+Tab, Escape, retorno de foco, campos dentro da tela e alcance das ações inferiores.
- Jornada financeira com Auth simulado e PostgreSQL isolado: cadastro → extra → crédito parcelado → PIX → alta → impressão/PDF → exportação → logout.
- Impressão do caso sintético: uma página A4, renderizada com Poppler e inspecionada; CPF, formas, valores e vencimentos preservados.
- Contraste calculado da paleta central: texto secundário/fundo 4,62:1; texto secundário/branco 4,97:1; botão primário 5,82:1; marca suave 6,18:1; aviso 4,60:1; sucesso 4,93:1; erro 5,93:1. Isso verifica esses pares específicos, sem afirmar certificação de toda a aplicação.

As capturas e os PDFs sintéticos são gerados em `tmp/imec-premium-final/`. O resumo sem dados reais está em `imec-premium-audit.json`.

## Limites e publicação

Inspeção realizada no Chromium em ambiente isolado. Safari/iOS e aparelhos físicos não foram homologados nesta revisão. Nenhuma migration ou alteração de dados de produção é necessária para esta atualização visual. A publicação segue PR e checks obrigatórios da main; após o deploy, comparar os arquivos públicos com o build validado.
