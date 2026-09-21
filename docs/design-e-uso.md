# Design, leitura, usabilidade e responsividade

O que a revisão de design consolidou, **onde mora cada coisa** e como não voltar atrás.
O porquê de cada regra está no comentário do módulo citado — este arquivo é o mapa.

## Primitivas (use estas, não escreva outra)

| Precisa de… | Use | Notas |
|---|---|---|
| Diálogo com formulário | `components/Modal.tsx` | Título acessível vem do `.modal-title` (ou `titulo`). Passe `confirmarDescarte={sujo && !salvando}` |
| Painel lateral | `components/Drawer.tsx` | Portal no `<body>`, exige `titulo` |
| O que faz um diálogo ser modal | `components/useDialogo.ts` | Pilha (só o topo responde a Escape/Tab), foco preso e **devolvido**, fundo `inert`, rolagem travada, `data-modal-aberto` no `<body>` |
| "Há alteração não salva?" | `components/useFormularioSujo.ts` | Passe só os campos que a pessoa edita |
| Salvar sem perder o digitado | `lib/domain/salvar-formulario.ts` | Quem grava **lança**; o formulário mostra o erro dentro dele e o botão vira "Tentar salvar de novo" |
| Deep link que abre um item | `components/useDeepLinkConsumido.ts` | Abre **uma vez por navegação**; dado novo não é intenção nova |
| Fonte com erro / desatualizada | `components/AvisoDaFonte.tsx` | "Não consegui carregar" ≠ "não há". Vazio e filtro-sem-resultado são de cada tela |
| Períodos e "hoje" | `lib/domain/periodos.ts` | Dia de Brasília, atalhos recalculados na virada |
| Cor com transparência | `lib/ui-cor.ts` (`tom`) | **Nunca** `${cor}44`: com `var(--x)` vira CSS inválido |
| Cabeçalho de tela | `components/TelaHeader.tsx` | Todas as abas com título usam (Ads, Desempenho e DRE migraram). Uma ação principal; o resto em `extra`/menu |
| Indicador (KPI) | `components/MetricCard.tsx` | Rótulo com a unidade, valor, base/ressalva em `sub`, `acao` opcional que leva ao filtro. Valor de texto vermelho é `--red-text` |
| Selo de estado | `components/StatusBadge.tsx` | Texto sempre; cor só reforça |
| Lista vazia | `components/EstadoVazio.tsx` | Só apresentação — a causa vem do domínio da tela |
| Filtro de faixa mín/máx | `components/CampoFaixa.tsx` | `<fieldset>` com nome, unidade e aviso de faixa invertida (Ads e Pedidos) |
| Lista longa | `components/usePaginacaoProgressiva.ts` + `RodapeDePagina.tsx` | 60 por vez; o limite volta ao começo quando a chave da lista muda |
| Teclado virtual | `components/ViewportVisivel.tsx` + `lib/domain/viewport-teclado.ts` | Publica `--vv-*`/`--teclado`; o CSS tem fallback, sem elas nada muda |

Ordem dos efeitos em `useDialogo` importa (comentário no arquivo): o `inert` sai **antes** de o
foco voltar, e o elemento anterior é gravado **antes** do `inert` (aplicá-lo desfoca o botão).

## Tokens de leitura

- Texto vermelho é `--red-text` (5,09:1 sobre `--surface2`). `--red` é só preenchimento e borda.
- `--text-muted` foi para `#9C9A8D` (4,96:1). Botão roxo usa `#7E4FB5` (5,15:1 com marfim).
- Rótulos de formulário: 13px, quebram de linha, sem reticências. Metadado: 12px no mínimo.
- Cor nunca é o único sinal: estado sempre tem texto ou ícone.

`lib/test/leitura-css.test.ts` falha se alguém reintroduzir rótulo < 13px, `nowrap` com
reticências em rótulo, `minmax(N>=200px, 1fr)` sem `min(N, 100%)`, sufixo hexadecimal sobre cor,
texto em `--red` ou contraste < 4,5:1 nos tokens de texto.

## Padrões

- **Estados de dado** (cinco): carregando · vazio real · sem resultado no filtro · erro sem dado ·
  dado anterior desatualizado. "Precisa de ação: nenhum" é boa notícia, não "sem cadastro"
  (`lib/domain/estoque-vazio.ts`, `lib/domain/custos-lista.ts › vistaDaLista`).
- **Ordenar em cartão**: a tabela vira cartões no celular e o `<thead>` some. A ordem vive no
  estado da tela (`lib/domain/ads-ordenacao.ts`) e há um "Ordenar por" fora da tabela.
- **Explicação de número**: uma função (`ads-explicacoes.ts`) alimenta o `title` da tabela **e** o
  texto visível do drawer. `title` sozinho não existe no toque.
- **Toast × formulário**: com diálogo aberto os toasts congelam e saem da frente
  (`toast-fila › suspender`); o que a fila descarta segue na Central.
- **Alvos de toque**: 44px onde o ponteiro é o dedo (`@media (pointer: coarse)`); o ícone continua
  pequeno, a área clicável cresce. 24px é o piso da WCAG 2.5.8, 44px é a meta de conforto.
- **Botão dentro de botão / link dentro de botão não existe.** Dois irmãos.

## Teclado virtual e orientação

- **Android/Chrome:** `interactive-widget=resizes-content` no viewport (app/layout.tsx): o teclado encolhe o layout e `dvh`/`fixed` seguem a área visível.
- **iOS/Safari** ignora essa chave: o teclado sobrepõe sem encolher. `ViewportVisivel` lê a `visualViewport` e, só quando o teclado cobre ≥ 120px e não há zoom por pinça, publica a área visível; modal, drawer, busca rápida e chat passam a segui-la. O rodapé Salvar/Cancelar do modal é `sticky`.
- **Orientação:** o manifest deixou de travar em retrato (`"any"`). Tabelas largas são mais legíveis em paisagem, e o retrato com teclado aberto é o pior caso. Medido em 844×390: sem elemento fora da tela e rodapé do formulário visível. Instalações antigas do PWA só pegam o valor novo ao reinstalar.
- Nada disto foi visto num iPhone: a função de decisão tem teste unitário, o comportamento em aparelho é **pendente**.

## Auditoria por tela

Um script de navegador percorre cada aba e conta: campo ou botão sem nome acessível, alvo < 24px, texto < 12px, controle aninhado, id duplicado e elemento fora da tela. Ele só vê o que está ABERTO — modais e painéis recolhidos precisam ser abertos e auditados à parte, e `lib/test/leitura-css.test.ts` cobre estaticamente o rótulo sem `htmlFor` e o botão dentro de botão.

## Medido, e o que não foi

- Estoque com 500 produtos, build de **desenvolvimento**: ~21,3 mil nós de DOM antes de paginar;
  depois de paginar a lista principal, ~9,9 mil; depois de paginar também Reposição (3 abas) e
  Previsão, **~2,9 a 3,2 mil** (60 linhas por vez + "Mostrar mais"). A conta dos painéis ainda
  roda sobre todos os produtos (é ela que dá os totais); só o desenho é paginado.
- **Latência não foi medida com confiança**: a janela de teste ficou oculta e o navegador
  estrangula temporizadores nesse estado. Meça em aparelho, com o app em produção.

## Armadilha de desenvolvimento

O Turbopack em `next dev` pode **parar de recompilar `app/globals.css`** depois de algumas edições
(a folha servida fica velha e o navegador mostra o estilo antigo). Se um CSS novo "não pega": pare o
servidor, apague `.next/dev` e suba de novo. Confira no navegador com
`getComputedStyle`, não pelo arquivo.

## Validação que só um aparelho faz (PENDENTE)

Teclado virtual (iOS e Android), safe areas em aparelho, PWA instalado com a orientação nova,
leitor de tela (VoiceOver, TalkBack, NVDA), zoom de 200% e contraste sobre o fundo renderizado final.
