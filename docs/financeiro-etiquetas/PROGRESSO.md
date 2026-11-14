# Financeiro e Etiquetas — progresso

Prompt de origem: `ZXP-MARKET-PROMPT-FINANCEIRO-ETIQUETAS-2026-11-13.md` (do dono, 13/11/2026).
Entrega direto na `main` em commits pequenos (pedido do dono em 13/11: "Jogue tudo na main").
Nada pela metade aparece na tela: a aba só entra na navegação quando o fluxo dela funciona de ponta a ponta.

## Plano

| # | Etapa | Estado |
|---|---|---|
| 1 | Baseline, papéis, prova do motor ZPL com o arquivo real | **bloqueado** — ver "Bloqueio" |
| 2 | Permissões: `ver_financeiro_privado` (só owner) e `usar_etiquetas` (owner + Colaborador; Sócio se liberado) | feito |
| 3 | Etiquetas: ler o lote (ZIP/TXT), achar o envio, preview, PDF/impressão do original | parcial — leitor feito; preview/PDF dependem do motor |
| 4 | Resolução envio → produtos, siglas/kits, marcação segura, lista de separação PDF | parcial — domínio + rota feitos; tela e PDF pendentes |
| 5 | Financeiro manual: contas, movimentos, obrigações, vínculo com Custos | a fazer |
| 6 | Conexão MP, cobertura, recebíveis, relatórios, sincronização, conciliação | a fazer |
| 7 | Testes de isolamento, revisão de UI, documentação final | a fazer |

## Feito

- `lib/etiquetas/lote-zpl.ts` — separa as etiquetas (`^XA…^XZ`), acha o envio pelo Code 128 principal e confere com o `id` do QR. O segundo `^BC` (tracking da transportadora, presente na 9ª etiqueta da amostra) não vira envio. Duplicadas e texto fora das etiquetas são reportados, nunca descartados. Amostra real: 19/19 envios, nenhum conflito (conferido localmente; a amostra não entra no repositório).
- `lib/etiquetas/siglas.ts` — `TT`, `2TT`, kits por composição (1 kit de 2 → `2TT`; 2 kits → `4TT`; misto → componentes), Full + Agências somam na mesma sigla, pendência explícita (kit sem composição, produto sem sigla).
- `lib/etiquetas/marcacao.ts` — calcula as áreas ocupadas de cada etiqueta e só marca em região livre. Origem: em 13/11 a marcação manual cobriu o ícone de avião (envio aéreo) em 4 das 19 etiquetas. Sem região livre → etiqueta auxiliar de separação. Texto filtrado (nada vira comando ZPL); remarcar troca, não empilha.
- `lib/domain/capacidades.ts` — as duas capacidades novas, com teste (Sócio com tudo liberado continua sem o financeiro privado; Colaborador com etiquetas continua sem operação/financeiro).
- `app/api/etiquetas/resolver` — envio → pedidos/itens/sigla. Pedidos sincronizados primeiro; o resto do ML só depois de conferir `sender_id` = vendedor conectado. Resposta mínima, `private, no-store`.
- `Product.siglaSeparacao` e `Product.kitComponentes` — o cadastro das siglas mora no produto do Estoque.

## Bloqueio

A instalação de dependências novas (`zpl-renderer-js@5.0.0` — motor ZPL/WASM, MIT; e as de PDF/ZIP) foi barrada pelo controle de segurança do ambiente do assistente. Sem um motor, não há preview, PDF das etiquetas nem impressão dentro do app. Caminhos:

1. O dono instala (`npm install --save-exact zpl-renderer-js@5.0.0 pdf-lib@1.17.1 fflate@0.8.2`) ou libera a instalação; o assistente audita licenças/ativos e segue a prova técnica.
2. Motor próprio sem dependência: GFA (já decodificado em teste local), Code 128 e QR implementados no projeto, texto em canvas, PDF e ZIP com as APIs do navegador (`CompressionStream`/`DecompressionStream`). Mais código para manter e fidelidade de fonte aproximada.

## Pendências conhecidas

- Siglas ainda não cadastradas nos produtos (só `TT` = Trot's Tradicional foi confirmada pelo dono; as demais usadas em 13/11 — MS, BM, LC, ML, MC, PF, TL, S, AH, AC, CH — precisam de confirmação antes de entrar no cadastro).
- Colaborador: hoje é redirecionado para `/tarefas`; o acesso às Etiquetas por lá entra junto com a tela.
