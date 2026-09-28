# UX por tela — seção 7 do prompt, critério a critério

Como ler: **✓** atende (onde está); **✓ novo** feito nesta auditoria SaaS;
**◐** parcial (o que falta); **✗** não feito (por quê). Boa parte vem da
auditoria de design anterior (achados U01–U20), que já estava na `main`; aqui
só se afirma o que foi conferido no código atual.

## Estrutura geral

| Critério | Estado | Onde / o que falta |
|---|---|---|
| Empresa e loja identificadas | ✓ novo | Nome da empresa na barra lateral, no título e na capa do DRE (`lib/marca.ts`, S24) |
| Período consistente | ✓ | Seletor de período único do Dashboard (`DateRangePicker`) |
| Empresa/equipe/integrações/cobrança separadas do perfil pessoal | ✓ novo | Acesso → Plano, Saúde da operação, time; perfil pessoal em "Meu perfil" |
| Permissões explicadas na área afetada | ✓ | Faixa "somente leitura" por aba (S17); somente leitura por assinatura com motivo (S25) |
| Reconexão do ML não ocupa o topo pra quem não pode | ✓ novo | `MlAccountStatus`: não-dono vê só o estado |

## Por tela

| Tela | Critério | Estado | Onde / o que falta |
|---|---|---|---|
| Dashboard | Primeira dobra com resultado, qualidade e próximas ações | ✓ | Resumo executivo (`ExecutiveKpis`), selo de estado (`TelaHeader`), checklist de ativação (S24) |
| | Sem números contraditórios / tooltip de fórmula antiga | ✓ | Margem única (S14); dica que não estoura a tela (S28) |
| | Carregamento que termina | ✓ novo | "Carregando dados…" preso pra sempre, corrigido (S28) |
| | Menos KPIs repetidos, velocímetros mais baixos | ◐ | Velocímetro compacto existe (`pg-compact`); revisão de quais KPIs repetem não foi feita |
| Estoque | "Resolver agora", filtros por problema | ✓ | `lib/domain/estoque-situacao.ts`, `EstoqueTab` |
| | Disponível por local; não somar anúncio próprio ao galpão | ✓ | `estoqueForaDoFull`, `consolidarEstoqueAnuncios` |
| | Cobertura única | ✓ | `getCoverageStatus` compartilhado (S16) |
| | Lead time, dias de segurança e lote mínimo configuráveis | ✓ novo | Prazo do fornecedor e lote mínimo no plano de reposição (`lib/domain/reposicao.ts`), aviso "acaba antes de a compra chegar" |
| Ads | Receita atribuída/total, lucro após Ads, ROAS/ACOS/TACOS com base | ✓ | `components/tabs/ads/*` (`ads-explicacoes.ts`) |
| | Recomendação não executa mudanças | ✓ | O app não tem nenhuma escrita na API de Ads do ML (só leitura); alterações são registro manual |
| Custos | Competência, centro de custo, vigência, arquivamento | ✓ | `CustosTab`, `custos-lista.ts`, `custo-form.ts` |
| | Histórico financeiro preservado em edição/reativação | ✓ | Auditoria de alterações (`auditLog`), vigência por versão |
| DRE | Pendências de informação, estimado × recebido | ✓ | Pendências coletadas e mostradas (`DreTab`); repasse estimado × recebido |
| | Fechamento com versão | ✗ | Não existe "fechar mês" com versão congelada — decisão de produto |
| | Exportação preserva período, empresa e fórmula | ✓ novo | Apresentação com o nome da empresa e o período (S24); CSV seguro (S30) |
| Pedidos | Paginação real | ✓ | Cursor por (campo, id) (S22) |
| | Status traduzido, fonte e horário | ◐ | Marcos do pedido em português; fonte/horário por pedido não exibidos em todos os casos |
| Full | Enviado, recebido, divergência, custo de coleta | ✓ | `components/tabs/full/*`, `CustosColetaFull` |
| | Baixas idempotentes, transferência/retenção separadas | ✓ | Movimento auditado (S20), retenção no plano de reposição |
| Preço | Busca por produto/MLB, CEP | ✓ | `PrecoTab` (anúncio + CEP do frete); simulação não publica preço |
| | Origem/horário das taxas | ◐ | Taxas vêm da API do ML na hora; horário da consulta não é exibido |
| Metas | Cenários só no futuro; diário e histórico coerentes | ✓ | S18; histórico meta × realizado (`MetasTab`) |
| Desempenho | Snapshot único, atualizar tudo, período oficial | ✓ | S10 (`fonte-desempenho.ts`, `periodoOficialDaReputacao`) |
| Tarefas | Diretório de equipe | ✓ | `/api/acesso/diretorio` (S19) |
| | Kanban e alternativa em lista; concluídas recolhidas | ✓ novo | Visão Lista (status por seletor, concluídas recolhidas, cartões no celular) |
| | Teclado e falha no arrastar | ✓ novo | Botões ←/→ no cartão; erro explicado quando mover/excluir falha |
| Acesso | Convites por empresa, papel, revogação, último owner | ✓ novo | `/api/acesso/membros`, "Enviar convite" (S24) |
| | Transferência de propriedade | ✓ novo | `/api/acesso/dono` (transação + histórico) |
| | Suporte temporário auditado | ✓ novo | Acesso com prazo (1/7/30 dias) vencendo em servidor, tela e regras; rotas de diagnóstico auditadas (S27) |
| | Plano não concede permissão administrativa | ✓ | Direitos do plano são limites (pessoas, contas); capacidade vem só do papel |
| Notificações | Valor uma vez; "marcar carregadas"; privacidade | ✓ | S29 (`corpoComValor`); versão sem financeiro pra quem não vê custo |
| | Preferências | ✓ | `NotificationSettings` |
| | Empresa/loja na mensagem | ◐ | Cada pessoa é de uma empresa só, então não há ambiguidade hoje; o nome não vai no texto do push |
| Login/onboarding | Recuperação, verificação, convite, empresa vazia, sincronização incompleta | ✓ novo | S24 |
| | Sem textos fixos da VAZXPRESS fora do tenant legado | ✓ novo | `lib/marca.ts` |

## Validação visual

| Critério do prompt | Estado |
|---|---|
| Sem estouro horizontal da página | ✓ medido nas 12 abas em 320, 375 e 768 px e no Dashboard em 1024 e 1363 px (emulador, dado sintético) |
| Tabelas com rolagem local ou cartões no celular | ✓ padrão `tbl-cards` (a lista de Tarefas passou a usar) |
| Foco visível, nomes acessíveis, redução de movimento | ✓ `:focus-visible`, `aria-*` nos controles novos, `prefers-reduced-motion` |
| 360/390/1280/1440 px, zoom 200%, reflow 400%, leitor de tela, teclado virtual | ✗ não medido nesta rodada — a janela de teste não desenha (sem captura de tela) |
| Safari/iOS | ✗ não testado — não declarar |
