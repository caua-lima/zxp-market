# Financeiro e Etiquetas — progresso

Prompt de origem: `ZXP-MARKET-PROMPT-FINANCEIRO-ETIQUETAS-2026-11-13.md` (do dono, 13/11/2026).
Entrega direto na `main` em commits pequenos (pedido do dono em 13/11: "Jogue tudo na main").
Nada pela metade aparece na tela: a aba só entra na navegação quando o fluxo dela funciona de ponta a ponta.

## Plano

| # | Etapa | Estado |
|---|---|---|
| 1 | Baseline, papéis, prova do motor ZPL com o arquivo real | feito — 19/19 etiquetas renderizadas (Zebrash v1.38.0) |
| 2 | Permissões: `ver_financeiro_privado` (só owner) e `usar_etiquetas` (owner + Colaborador; Sócio se liberado) | feito |
| 3 | Etiquetas: ler o lote (ZIP/TXT), achar o envio, preview, PDF/impressão do original | feito — aba Etiquetas e /etiquetas |
| 4 | Resolução envio → produtos, siglas/kits, marcação segura, lista de separação PDF | feito |
| 5 | Financeiro manual: contas, movimentos, obrigações, vínculo com Custos | feito (aba no ar; vínculo com Custos pendente) |
| 6 | Conexão MP, cobertura, recebíveis, relatórios, sincronização, conciliação | a fazer |
| 7 | Testes de isolamento, revisão de UI, documentação final | a fazer |

## Feito

- `lib/etiquetas/lote-zpl.ts` — separa as etiquetas (`^XA…^XZ`), acha o envio pelo Code 128 principal e confere com o `id` do QR. O segundo `^BC` (tracking da transportadora, presente na 9ª etiqueta da amostra) não vira envio. Duplicadas e texto fora das etiquetas são reportados, nunca descartados. Amostra real: 19/19 envios, nenhum conflito (conferido localmente; a amostra não entra no repositório).
- `lib/etiquetas/siglas.ts` — `TT`, `2TT`, kits por composição (1 kit de 2 → `2TT`; 2 kits → `4TT`; misto → componentes), Full + Agências somam na mesma sigla, pendência explícita (kit sem composição, produto sem sigla).
- `lib/etiquetas/marcacao.ts` — calcula as áreas ocupadas de cada etiqueta e só marca em região livre. Origem: em 13/11 a marcação manual cobriu o ícone de avião (envio aéreo) em 4 das 19 etiquetas. Sem região livre → etiqueta auxiliar de separação. Texto filtrado (nada vira comando ZPL); remarcar troca, não empilha.
- `lib/domain/capacidades.ts` — as duas capacidades novas, com teste (Sócio com tudo liberado continua sem o financeiro privado; Colaborador com etiquetas continua sem operação/financeiro).
- `app/api/etiquetas/resolver` — envio → pedidos/itens/sigla. Pedidos sincronizados primeiro; o resto do ML só depois de conferir `sender_id` = vendedor conectado. Resposta mínima, `private, no-store`.
- `Product.siglaSeparacao` e `Product.kitComponentes` — o cadastro das siglas mora no produto do Estoque.

## Financeiro (feito)

- `lib/financeiro/dinheiro.ts` e `modelo.ts` — centavos inteiros; transferência fora do resultado; saldo só com abertura comprovada; baixa parcial; recorrência sem duplicar; dedupe por referência; CSV sem fórmula.
- Coleções `fin_contas`, `fin_movimentos`, `fin_obrigacoes`, `fin_recorrencias` — só o owner (regras provadas no emulador: 10 testes). Entram no roteamento por empresa e no backup. As regras novas valem em produção depois do `firebase deploy --only firestore:rules` (do dono); até lá, o SDK do navegador já é negado por padrão nessas coleções e a tela usa só o servidor.
- `/api/financeiro` — tudo pelo servidor (`private, no-store`), pra extrato não ficar no IndexedDB do navegador.
- Aba **Financeiro** (grupo Financeiro) — só aparece pro owner; Sócio/Partner/Colaborador não veem nem pelo "Ver como".

## Motor ZPL (feito)

- `zpl-renderer-js@5.0.0` (MIT; Zebrash v1.38.0 em WASM), `pdf-lib@1.17.1`, `fflate@0.8.2` — versões exatas.
- O WASM (7 MB) é copiado de `node_modules` pra `public/motor/zebrash-<versão>.wasm` no `predev`/`prebuild` (`scripts/copiar-motor-zpl.mjs`); não vai pro git e não depende de CDN.
- Render num Web Worker (`lib/etiquetas/render.worker.ts`), uma etiqueta por vez. Antes do render, `normalizarParaRender` tira os espaços dos dados do `^GFA` — o avião do ML vem com `: : :` e o motor recusava 4 das 19 etiquetas. O arquivo impresso continua o original.
- Tela: abre ZIP/TXT/ZPL (ou cola), consulta os envios, mostra a prévia, marca a sigla (ou etiqueta auxiliar), imprime, baixa PDF 4×6, baixa ZPL pra Zebra e gera a lista de separação A4. O conteúdo das etiquetas nunca sai do navegador; só os números de envio vão pro `/api/etiquetas/resolver`.

## Pendências conhecidas

- Siglas cadastradas em 21 produtos (confirmadas pelo dono em 17/11).
- Colaborador: usa `/etiquetas` (atalho no cabeçalho do `/tarefas`).
