# Progresso — transformação em SaaS multi-tenant

Rastreia o prompt `02-ZXP-MARKET-PROMPT-CLAUDE-CODE-SAAS.md` (achados `01-ZXP-MARKET-AUDITORIA-SAAS.md`,
auditoria de 21–22/09/2026 sobre o commit `451d49a683ea83802303c56799f181f12ea3e288`).

**Regra deste arquivo**: uma caixa só marca `[x]` depois de eu ter lido o código atual (pode já ter
mudado desde a auditoria), reproduzido o problema quando a auditoria deu um caso concreto, corrigido,
e testado. `[~]` = em andamento. `[ ]` = não iniciado. Cada item leva arquivo(s) tocado(s) e a
evidência (teste, comando, observação).

Descoberta no início desta etapa: o repo já teve três tentativas de SaaS multi-tenant em branches
locais (`saas`, `saas-integration`, `saas-merge`), a mais avançada (`saas-merge`) parada em
2026-08-24, 23 commits atrás / 136 à frente do `main` atual. Decisão do usuário: não reconciliar —
usar só como referência de leitura ocasional, construir do zero sobre o `main` de hoje.

Branch de trabalho: `saas-v2/isolamento-tenant`.

## Etapa 1 — baseline e ambiente

- [x] Confirmar HEAD (`451d49a`, igual ao commit auditado), `git status` limpo.
- [x] Ler `AGENTS.md`, `README.md`, `docs/design-e-uso.md`, `docs/notificacoes.md`, `docs/backup.md`.
- [x] Checar breaking changes do Next.js 16 relevantes (route handlers) — sem novidade que afete o
      código existente.
- [~] Ambiente do emulador (Java, `firebase-tools`) — a verificar quando eu precisar rodar
      `npm run test:emulador`.

## Etapa 2 — bugs existentes (antes de isolar por tenant)

| # | Achado | Status | Arquivo(s) | Evidência |
|---|---|---|---|---|
| S04 | `displayName: decoded.name ?? undefined` rejeitado pelo Admin SDK | [x] | `app/api/acesso/bootstrap/route.ts` | Campo só entra no `set()` quando existe. `tsc`/`test` verdes. Falta um teste de emulador end-to-end (login sem nome cadastrado) — a ser feito junto do harness de emulador da Etapa 3 |
| S05 | Lease de 30s sem dono/fencing no refresh do token ML | [ ] | `app/api/ml/token.ts` | — |
| S06 | `Retry-After` do servidor cortado em 8s e a chamada repetida mesmo assim; `fetch-ml.ts` descartava o `AbortSignal` do chamador | [x] | `lib/domain/retry-http.ts`, `lib/ml/fetch-ml.ts`, testes atualizados | Retry-After que cabe no orçamento (≤15s) é respeitado por inteiro; acima disso a chamada desiste (`espera_excede_orcamento`) em vez de esperar menos e insistir. `AbortSignal` do chamador agora é combinado, não descartado. `npx vitest run lib/domain/retry-http.test.ts` (18/18), `tsc` limpo. Diferenciação por método HTTP (POST não-idempotente) fica pendente, empacotada com o fix de fencing do S05 |
| S07 | Webhook faz trabalho pesado antes de confirmar de forma durável; aceita recurso sem validar vendedor/app | [ ] | `app/api/ml/webhook/route.ts`, `lib/domain/webhook-ml.ts` | — |
| S08 | Cron retorna 400 antes de rodar tarefas/backup/outbox; bug de índice no diagnóstico `allSettled` | [x] | `app/api/ml/cron/route.ts`, `.test.ts` (novo) | Sem token ML, os 6 passos de sync entram como falha (mesmo formato de falha de rede) e o resto do cron roda igual (lembrete, backup, marcos, estoque, devolução, outbox, poda, heartbeat) — não há mais 400 antecipado. `etapasIncompletas` guarda o índice original junto do valor antes de filtrar, não desalinha mais quando a primeira etapa falha. Dois testes novos mockando todas as dependências. `npx vitest run app/api/ml/cron/route.test.ts` (2/2), suite completa 2275/2275, `tsc` e `npm run build` limpos |
| S09 | Retry do outbox depende de tráfego (webhook/cron); publicação pode engolir falha | [ ] | `lib/notification-dispatch.ts`, `lib/domain/entrega-destino.ts` | — |
| S10 | Caches de reputação fragmentados, sem coordenação | [ ] | `/api/ml/account`, `/api/ml/desempenho`, `/api/ml/reputacao-vendas`, `ReputacaoPanel`, `ProximaMedalhaPanel` | — |
| S11 | Projeção de medalha não descontava o que sai da janela móvel | [x] | `lib/domain/projecao-medalha.ts`, `.test.ts` | A causa citada na auditoria (linear, sem descontar) já estava corrigida no `main` atual. Reproduzindo o cenário EXATO da auditoria (01/06–21/09/2026, R$100/dia, meta R$20.000) achei uma SEGUNDA camada do mesmo bug: a subtração só via a série histórica original, nunca os dias futuros que a própria simulação soma — esgotado o histórico, o saldo só crescia e uma meta acima do teto sustentável "chegava" de qualquer jeito. Corrigido registrando cada dia futuro simulado no mesmo mapa. `npx vitest run lib/domain/projecao-medalha.test.ts` (15/15, incl. a reprodução exata e o caso residual), suite completa 2265/2265, `tsc` limpo |
| S12 | `sync.ts` grava com `merge:true` e pode reverter dado mais novo do webhook | [ ] | `lib/ml/sync.ts` | — |
| S13 | `addMovimento`/`recomputeProduto` não são transacionais (corrida de estoque) | [ ] | `lib/firebase/data.ts` | — |
| S14 | `margemHoje` usa base diferente de "Vendas — Hoje" (7,1% vs 7,2% observado) | [ ] | `Dashboard.tsx` | — |
| S15 | Backup automático cobre só 7 coleções; inventário lista 15 não cobertas; exporter manual perde subcoleções órfãs | [ ] | `lib/backup-run.ts`, `lib/domain/backup-inventario.ts`, `scripts/backup-firestore.mjs` | — |
| S16 | `previsaoDe`/`getCoverageStatus` contradizem outros painéis sobre ruptura quando `total <= 0` | [ ] | `components/tabs/estoque/estoque-compartilhado.ts` | — |
| S17 | Banner de somente-leitura usa `!isOwner`, telas usam `canEditTab` (contradição) | [ ] | `app/page.tsx` | — |
| S18 | `scenariosDeProjecao` varia o mês inteiro, não só os dias restantes | [ ] | `lib/domain/calc.ts` | — |
| S19 | `TarefasTab` usa `watchAccessList` (só owner), colaborador não populariza responsável | [ ] | `TarefasTab.tsx` | — |
| S20 | Trilha de auditoria gravada pelo cliente, não pelo servidor | [ ] | `lib/firebase/data.ts` (`logAudit`) | — |
| S21 | Regras aceitam dinheiro em texto tipo `"..."` e data tipo `"2026-99-99"` | [ ] | `firestore.rules` | — |
| S22 | Limites de paginação (`watchMovimentos` 1500, `watchTasks` 500) não são paginação real | [ ] | — | — |
| S29 | Central de Notificações duplica valor (corpo já tem o número + `gross` concatenado) | [ ] | `NotificationCenter.tsx` | Precisa reverificar: este arquivo foi muito mexido na auditoria de UX anterior nesta mesma sessão |
| S30 | Exportação CSV não neutraliza injeção de fórmula (`=`,`+`,`-`,`@`) | [x] | `lib/domain/csv-seguro.ts` (novo) + `AdsTab.tsx`, `DreTab.tsx`, `EstoqueTab.tsx` | Helper único (`celulaCsvSegura`/`linhaCsvSegura`) que prefixa `'` quando o texto começa com `=+-@`/tab/CR e NÃO é número de verdade (preserva negativo formatado). Os três exportadores identificados usam o mesmo helper agora — não havia um quarto. `npx vitest run lib/domain/csv-seguro.test.ts` (5/5), suite completa 2273/2273, `tsc` limpo |

## Etapa 3 — isolamento por tenant/conexão (o núcleo do S01–S03, S23)

- [ ] `TenantContext`/`ConnectionContext` (tipos) + `requireTenantAccess`/`requireConnectionAccess`
- [ ] S01 — dados e autorização hoje são globais (`controleAcesso`, coleções sem `tenantId`)
- [ ] S02 — rota admin reseta senha de QUALQUER usuário por e-mail, sem checar organização
- [ ] S03 — conexão ML única/global (`SELLER_ID` fallback fixo) → modelo `Connection` por tenant
- [ ] S23 — cache/localStorage/IndexedDB sem escopo por tenant/conexão/geração

## Etapa 4 — jobs, inbox, snapshots, observabilidade

- [ ] Inbox durável do webhook (idempotência por versão, não só `resource`)
- [ ] Worker/job independente de tráfego web
- [ ] Snapshot de reputação com `SourceState`
- [ ] Logs estruturados com redação, correlação por tenant/conexão

## Etapa 5 — migração da operação atual

- [ ] `docs/saas/MIGRACAO.md`
- [ ] Script de migração idempotente, dry-run primeiro
- [ ] Ensaio em staging com reconciliação (contagem + hash)
- [ ] Estratégia de corte e rollback

## Etapa 6 — onboarding, time, UX por tela

- [ ] Ver seção 7 do prompt (Dashboard, Estoque, Ads, Custos, DRE, Pedidos, Full, Preço, Metas,
      Desempenho, Tarefas, Acesso, Notificações, Login/onboarding)

## Etapa 7 — billing em sandbox

- [ ] ADR de fornecedor único (Stripe Billing test mode como padrão, se nada foi decidido)
- [ ] `BillingProvider` adapter, catálogo de planos, entitlements no servidor

## Etapa 8 — operação, segurança, QA, piloto

- [ ] `docs/saas/ARQUITETURA.md` + ADRs
- [ ] `docs/saas/OPERACAO.md`
- [ ] `docs/saas/VALIDACAO.md`
- [ ] Relatório final

## O que falta e por quê (atualizado a cada etapa)

_(preenchido conforme avança — nunca declarar "SaaS pronto" com isolamento parcial, worker manual,
billing fake, migração sem ensaio ou teste ignorado)_
