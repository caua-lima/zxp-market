# Conferência da aba Ads × painel do Mercado Ads

Registro da conferência campanha por campanha feita em **19/11/2026 (≈06:45)**,
com o app publicado e o painel do Mercado Ads abertos lado a lado, logados na
conta da loja. Serve de ponto de partida (o "antes") para as correções que vêm
nos commits seguintes desta branch.

## Como os números foram coletados

| Lado | Fonte | Observação |
|---|---|---|
| Mercado Ads | `pa.mercadolivre.com.br/pa/api/admin-pads/ajax/campaigns/search?dateFrom&dateTo` — a mesma chamada que a tela "Campanhas de vendas" faz | é o número que aparece na tela, centavo por centavo |
| App | resposta crua de `/api/ml/ads?from&to` + tabela "Performance por campanha" | |

"Últimos 7 dias" no painel do ML = **13/11 a 19/11, incluindo hoje**. O app
usa o mesmo intervalo no atalho "Últimos 7 dias".

## Diagnóstico

### 1. O ML ainda não tinha consolidado ONTEM na API pública

Investimento do painel somado dia a dia (13→19/11):

| 13 | 14 | 15 | 16 | 17 | **18** | 19 | total |
|---|---|---|---|---|---|---|---|
| 37,76 | 24,53 | 45,00 | 78,16 | 82,83 | **132,01** | 6,55 | **406,84** |

- `/campaigns/search` (API pública, por campanha) devolveu **R$ 274,83** no
  período — exatamente 406,84 − 132,01. Ou seja: **o dia 18 (ontem) inteiro
  faltava** no recurso de campanha. Hoje (19) já vinha.
- `/ads/search` (API pública, por anúncio) já tinha o **custo/cliques/impressões**
  de ontem (bate com o painel), mas **não a receita atribuída** de ontem
  (R$ 1.240,02 contra R$ 2.476,80 do painel; os dias 13–15 + 19 somam
  R$ 1.212,12).
- Em período fechado (06–12/11) o recurso de campanha bate **centavo por
  centavo** com o painel em todas as 15 campanhas. Em "hoje" (19/11) também.

Consequência no app: ele usava o recurso de campanha (sem ontem) para
investimento/cliques e comparava com a soma dos anúncios (com ontem). A
diferença passava de 2% em quase toda campanha e acendia **"⚠ rateado"** — que
diz "anúncio em duas campanhas", o que não era o caso. E o ROAS "no ML" saía
de uma receita sem ontem.

### 2. Anúncio que mudou de campanha dentro do período

No período 06–12/11 vários anúncios rodaram em campanhas antigas (excluídas) e
depois foram para as campanhas "- Agências" criadas em 12/11. O `/ads/search`
carimba a linha inteira com a campanha ATUAL do anúncio, então a receita
direta por campanha no modo "Publicidade direta" ia para a campanha errada.
O recurso de campanha não tem esse problema.

### 3. Contagem de anúncios

"MS, LC, TT - Agências": app 2, ML 3. O app contava só anúncios **com gasto**
no período; o terceiro teve 248 impressões e R$ 0. A contagem por campanha que
o servidor já fazia (`/ads/search?filters[campaign_id]`) também estava errada
(0 para MS, LC, TT e para Menta Stronger; 2 para quatro campanhas que têm 1).

### 4. Campanha sem gasto sumia

"Menta & Cereja - Full" (754 impressões, R$ 0) aparece no ML e não aparecia
no app (14 × 15).

### 5. "Vendas atribuídas"

O painel conta `unitsQuantity` (direta + assistida, em unidades). O app usava
`direct_items_quantity + indirect_items_quantity` (itens distintos), que é
menor quando o comprador leva mais de uma unidade.

## Tabela "antes"

A tabela campanha por campanha (investido, cliques, receita, ROAS de cada lado)
não fica versionada: o repositório é público e ela expõe o faturamento da loja.
Resumo do que ela mostrou em 13–19/11:

- 13 das 14 campanhas exibidas com **"⚠ rateado"**, todas com 1 anúncio só
  (fora MS, LC, TT) — efeito do item 1, não de anúncio compartilhado;
- investimento por campanha **abaixo** do painel em todas (faltava ontem);
- "no ML" divergente em todas que venderam ontem (ex.: Menta Limão - Full com
  receita 0 no app; Limão Caipira 4,60x × 4,51x);
- MS, LC, TT com 2 anúncios × 3 no ML; Menta & Cereja - Full ausente;
- orçamento diário e ROAS objetivo **batiam** nas 14.

## "Hoje" (19/11, 06:45)

O recurso de campanha bateu 100% com o painel nas 8 campanhas com gasto
(cliques, impressões, investido, receita). Única diferença: "MS, LC, TT"
mostrava 1 anúncio (só o que gastou) contra 3 no ML, e as impressões do
anúncio sem gasto (248) ficavam fora quando o app caía na soma dos anúncios.

## O que NÃO dá para fazer bater

A receita atribuída de **ontem** não existe na API pública enquanto o ML não
consolida o dia (medido às 06:45; o painel usa uma API interna, com dado ao
vivo). Nesse intervalo o app não tem de onde tirar esse número. Nesse caso o
app avisa e mostra o ROAS dos dias já consolidados, sem esconder a diferença.
