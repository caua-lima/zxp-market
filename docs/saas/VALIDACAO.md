# Validação — como provar que funciona

## O que rodar antes de todo commit

```
npx tsc --noEmit -p .
npx eslint .
npx vitest run
npm run test:emulador
npx next build
```

`npm run test:emulador` sobe o emulador do Firestore, roda e derruba — leva
alguns minutos só pra subir. Pra repetir várias vezes, suba uma vez e aponte:

```
npx firebase emulators:start --only firestore --project zxp-teste-emulador
# em outro terminal:
$env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8199"; npx vitest run --config vitest.emulador.config.ts
```

Na primeira rodada depois de subir o emulador, o primeiro teste com transação
pode levar até ~25 s (emulador frio). Dois testes de concorrência
(`push-registro-store`, `notification-events` com 20 operações simultâneas) já
falharam uma vez sob carga da suíte inteira e passaram isolados e na suíte
repetida — é contenção de transação no emulador, anotado no PROGRESSO.

## O que cada suíte do emulador prova

| Arquivo | Prova |
|---|---|
| `lib/ml/gravar-pedido.emulador.test.ts` | S12: webhook no meio do sync não é revertido; versões concorrentes |
| `lib/ml/webhook-inbox.emulador.test.ts` | S07: responde sem chamar o ML; coalesce; retry; fila de falhas; posse |
| `lib/notification-atomicidade.emulador.test.ts` | S09: evento e push no mesmo lote; varredura entrega sem o produtor |
| `app/api/ml/token.emulador.test.ts` | S05: renovação do token com refresh de uso único |
| `lib/firebase/estoque-recompute.emulador.test.ts` | S13: gravações concorrentes de estoque |
| `lib/test/regras-movimento-auditado.emulador.test.ts` | S20: movimentação sem registro é recusada |
| `lib/firebase/paginas.emulador.test.ts` | S22: páginas sem buraco nem repetição com empates |
| `lib/domain/migracao-dados.emulador.test.ts` | Etapa 5: cópia idempotente, rollback, conferência |
| `lib/test/regras-dados-tenant.emulador.test.ts` | Etapa 3: isolamento entre empresas pelas regras |
| `lib/test/virada-tenant.emulador.test.ts` | Etapa 3: a virada com a chave ligada e desligada |
| `lib/test/regras-*.emulador.test.ts` | as demais regras (auditoria, notificações, números/datas, tenant) |
| `lib/billing/sincronizar.emulador.test.ts` | S25: webhook idempotente, fora de ordem não regride, leitura velha não sobrescreve, carência → bloqueio → pagou → desbloqueio, trial vencido pelo relógio |
| `lib/test/regras-dados-tenant.emulador.test.ts` (fim) | S25: empresa bloqueada só lê; Etapa 6: acesso com prazo vencido não lê nem grava |
| `app/api/empresa/route.emulador.test.ts` | S24: cadastro cria empresa com dona, teste grátis e aceite; duas abas → uma empresa |
| `app/api/acesso/membros/route.emulador.test.ts` | Segundo cliente + S25: time da empresa, limite de pessoas do plano (402) |
| `app/api/acesso/dono/route.emulador.test.ts` | Etapa 6: transferência de propriedade e acesso com prazo |
| `lib/domain/dados-da-empresa.emulador.test.ts` | S27: exportar/apagar empresa e pessoa sem tocar na vizinha |
| `lib/ml/saude-ml.emulador.test.ts` | Etapa 4: contador de 429/5xx do ML por dia |

## Prova inversa

Cada correção desta auditoria foi rodada também contra o código ANTIGO, e os
testes novos falharam (os números estão na linha de cada item em
`PROGRESSO.md`). Um teste que passa nos dois não prova a correção.

## Conferências em produção (só leitura)

- `GET /api/ml/diagnostico-push` (logado como dono): cron, worker, aparelhos,
  entregas recentes.
- Depois da migração: `node --env-file=.env.producao scripts/migrar-dados-tenant.mjs --tenant-id vazxpress --conferir`

## Verificação na tela (emulador, dado sintético)

Feita com o app apontado pro emulador (Firestore + Auth), nunca produção:

- Dashboard: dica "ⓘ" dentro da janela em 375/768/1024/1363 px (antes, 1395 px
  numa janela de 1363); carregamento que não fica preso.
- 12 abas sem a página mais larga que a janela em 320, 375 e 768 px.
- Cadastro de ponta a ponta: conta nova → confirmação de e-mail → empresa
  criada → checklist 0 de 6 → Plano "Teste grátis" → limite de pessoas → convite
  → trial vencido (faixa de somente leitura).
- Tarefas em lista: mover pelo seletor; com a empresa bloqueada, a falha aparece
  explicada e o status volta.
- Cabeçalhos de segurança servidos e relatório de CSP sem dado da query.

Não medido: 360/390/1280/1440 px, zoom 200%, leitor de tela, Safari/iOS
(ver `UX-POR-TELA.md`).

## Contra o Stripe real

Não exercitado (sem chaves de teste). Roteiro em `OPERACAO.md`, parte F.
