# Arquitetura

Visão de como as peças se encaixam depois da auditoria SaaS. O porquê de cada
decisão está no comentário do próprio código, citado aqui pelo arquivo.

## Peças

- **Next.js 16 na Vercel** (plano Hobby: cron só diário). Rotas em `app/api/**`.
- **Firebase**: Firestore (dados), Auth (login), FCM (push). O servidor usa o
  Admin SDK (ignora regras); o navegador usa o SDK cliente (passa pelas regras
  de `firestore.rules`).
- **Mercado Livre**: OAuth (token com renovação coordenada, S05), API de
  pedidos/envios, e notificações por webhook.
- **GitHub Actions**: o worker a cada 5 min (`.github/workflows/worker.yml`).

## Fluxo de um pedido

```
ML ──notificação──▶ /api/ml/webhook ──valida (S07)──▶ ml_webhook_inbox ──200 em <500ms
                                                        │
                        after() / worker 5min / cron ◀──┘ processarItem (concessão, retry, fila de falhas)
                                                        │
                                  GET /orders/{id} ─────┤ posse: seller.id é o nosso
                                                        ▼
                                          gravarPedidos (S12: só grava retrato ≥ versão gravada)
                                                        ▼
                                  criarEventoEPublicar (S09: evento + push no MESMO lote)
                                                        ▼
                                  outbox → entregas por aparelho → FCM (worker retenta)
```

O sync (cron diário, sync manual) passa pelo mesmo `gravarPedidos`: a versão é
o `last_updated` do ML, então um retrato velho nunca cobre um novo, venha de
onde vier.

- Inbox: `lib/domain/webhook-inbox.ts`, `lib/ml/webhook-inbox.ts`
- Versão do pedido: `lib/domain/estado-do-pedido.ts`, `lib/ml/gravar-pedido.ts`
- Outbox de push: `lib/notification-outbox.ts`, `lib/notification-dispatch.ts`

## Empresas (tenants)

- Modelo: `tenants/{id}` com `members/{email}` (papel owner/partner/member) e
  `connections/{id}` (token do ML). `memberships/{email}` aponta a pessoa pra
  empresa.
- **A chave** `NEXT_PUBLIC_ZXP_MODO_DADOS` decide onde o dado da empresa mora:
  `raiz` (padrão, como sempre foi) ou `tenant` (`tenants/{NEXT_PUBLIC_ZXP_TENANT_ID}/…`).
  Servidor e navegador leem a mesma chave (`lib/firebase/caminhos.ts`).
  - Servidor: `getAdminDb()` já devolve o Firestore com os caminhos traduzidos
    (`lib/firebase/db-de-dados.ts`).
  - Navegador: `sCol`/`sDoc` e os módulos em `lib/firebase/` traduzem pelo mesmo
    `traduzirCaminho`.
- Qual coleção é da empresa, da pessoa ou do sistema: `lib/domain/migracao-dados.ts`
  (um teste varre o código e quebra se aparecer coleção sem decisão).
- Regras do dado da empresa: geradas das regras da raiz (`npm run regras:gerar`,
  `lib/domain/regras-tenant.ts`); um teste quebra se ficarem desatualizadas.
- Membros: `controleAcesso` (tela de Acesso) é espelhado nos membros da empresa
  por `lib/tenant-membros.ts` — na hora (rota `/api/acesso/sincronizar`) e a
  cada 5 min (worker).
- Limite atual: a empresa é UMA, escolhida pela chave. Resolver a empresa por
  requisição (`requireTenantAccess` em cada rota) e o cron por empresa são o
  passo seguinte, antes do segundo cliente.

## Integridade

- Estoque: custo médio reconstruído do livro com concorrência otimista (S13).
- Auditoria: movimentação de estoque só grava com o registro de auditoria no
  mesmo lote, conferido pela regra (S20, `lib/firebase/movimento-auditado.ts`).
- Listas longas: paginação por cursor (campo, id) (S22, `lib/firebase/paginas.ts`).
- Desempenho/reputação: uma busca pros dois painéis, cache por geração da
  conexão, janela oficial do ML (S10, `lib/domain/fonte-desempenho.ts`).

## Onde está o resto

- Progresso item a item: `docs/saas/PROGRESSO.md`
- Migração: `docs/saas/MIGRACAO.md`
- O que você precisa rodar: `docs/saas/OPERACAO.md`
- Como validar: `docs/saas/VALIDACAO.md`
