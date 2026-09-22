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
| S13 | `addMovimento`/`recomputeProduto` não são transacionais (corrida de estoque) | [x] | `lib/firebase/estoque-recompute.ts` (novo), `lib/firebase/data.ts`, `lib/domain/types.ts` (`estoqueVersao`), `.emulador.test.ts` (novo) | `Transaction.get()` do SDK cliente só aceita referência de documento, não query (verificado no `.d.ts` instalado) — não dá pra colocar a varredura do livro dentro de uma transação, como o comentário antigo já dizia. Fix: `estoqueVersao` no produto; lê a versão antes de varrer, grava só dentro de uma transação que confere que ela não mudou; mudou = refaz a varredura e tenta de novo (até 20x). Extraído pra módulo próprio, injetável com `db`, pra poder ser testado contra o emulador (o SDK cliente completo exige `window`, que não existe no `vitest` em Node). **Testado contra o emulador REAL** (não mock): 2 gravações concorrentes no mesmo produto, e 10 concorrentes — nenhuma unidade se perde em nenhum dos dois, rodado duas vezes pra afastar instabilidade. `npm run test:emulador` (141/141, suite inteira), suite unitária 2290/2290, lint/tsc/build limpos. Risco residual ANOTADO, não resolvido aqui: `upsertProduct` grava o produto por `setDoc` sem merge (substitui o documento inteiro) — uma edição de metadado (nome, imposto, vincular SKU) concorrente com um recálculo de estoque só fica segura se o chamador sempre espalhar o objeto atual (`{...prod, campo: novo}`), o que os três usos atuais fazem, mas não é garantido pelo tipo |
| S14 | `margemHoje` usa base diferente de "Vendas — Hoje" (7,1% vs 7,2% observado) | [x] | `components/dashboard/Dashboard.tsx` | `HojeVsOntem` calculava a própria margem local (`lucroLiquido / faturamentoBruto`, bruto INCLUI cancelado/devolvido); `VendasDoDiaHero` já usava a função `margemReal` (testada), cuja base é `retorno` (bruto menos cancelado/devolvido/item sem produto). Extraí a conversão `HojeBreakdown → EntradaDia` (antes só existia dentro de `VendasDoDiaHero`) pro escopo do módulo e as duas telas passam a chamar a MESMA `margemReal`. `tsc`, suite completa (2290/2290) e `npm run build` limpos — sem teste de componente novo porque a correção é "parar de duplicar a fórmula", e `margemReal` já tem cobertura em `lib/domain/resumo-dia.test.ts` |
| S15 | Backup automático cobre só 7 coleções; inventário lista 15 não cobertas; exporter manual perde subcoleções órfãs | [ ] | `lib/backup-run.ts`, `lib/domain/backup-inventario.ts`, `scripts/backup-firestore.mjs` | — |
| S16 | `previsaoDe`/`getCoverageStatus` contradizem outros painéis sobre ruptura quando `total <= 0` | [x] | `lib/domain/estoque.ts` (`getCoverageStatus`), `.test.ts` | A causa raiz mora em `getCoverageStatus` (compartilhada por EstoqueTab, `lib/domain/alerts.ts` e `lib/domain/risk.ts`), não em `previsaoDe`: zerado com giro confirmado agora é `critico` antes de cair no ramo `coberturaDias == null`. Demais faixas (sem-giro, encalhado, cobertura calculável) intocadas. `npx vitest run lib/domain/estoque.test.ts` (26/26), suite completa 2288/2288, `tsc` limpo |
| S17 | Banner de somente-leitura usa `!isOwner`, telas usam `canEditTab` (contradição) | [x] | `lib/domain/types.ts` (`abaEhEditavel`, novo), `app/page.tsx` | Banner agora pergunta a MESMA coisa que a aba pergunta pra mostrar os próprios botões — por aba, não `!isOwner` global. `npx vitest run lib/domain/acesso-abas.test.ts` (5/5), suite completa 2280/2280, `tsc` limpo. Verificação visual por papel (owner vs. partner com permissão parcial) ainda pendente — precisa de conta de teste com `permissoesEdicao` parcial |
| S18 | `scenariosDeProjecao` varia o mês inteiro, não só os dias restantes | [ ] | `lib/domain/calc.ts` | — |
| S19 | `TarefasTab` usa `watchAccessList` (só owner), colaborador não populariza responsável | [x] | `app/api/acesso/diretorio/route.ts` (novo), `.test.ts`, `TarefasTab.tsx` | `controleAcesso` continua `list`-só-owner nas regras (papel/permissão são sensíveis) — nova rota via Admin SDK devolve só `{email, displayName}`, o que a tela realmente usa. `npx vitest run app/api/acesso/diretorio/route.test.ts` (2/2, incl. confirmação de que role/permissoesEdicao não vazam), suite completa 2290/2290, `tsc` e `npm run build` limpos. Verificação visual com conta de colaborador de verdade ainda pendente (mesma limitação do S17: precisa de conta de teste) |
| S20 | Trilha de auditoria gravada pelo cliente, não pelo servidor | [~] | `firestore.rules` (`auditEventValido`), `lib/test/regras-auditlog.emulador.test.ts` (novo) | Melhoria parcial, honesta sobre o que falta: `em` só exigia `is number` (cliente podia datar um evento pro passado ou futuro à vontade). Agora precisa estar a ±5min de `request.time` (relógio do SERVIDOR) — testado contra o emulador (6/6: aceita relógio de verdade e pequena diferença, recusa passado/futuro, `por` continua preso ao token, `update`/`delete` continuam `false`). **O que isto NÃO resolve**: `acao`/`entidade`/`detalhe` continuam vindo do cliente sem checkpoint no servidor, e nada GARANTE que `logAudit` é chamado depois de toda mutação — a maioria das escritas deste app vai direto cliente→Firestore, sem um servidor no meio que pudesse gerar o log sozinho. Resolver isso de vez pede Cloud Functions (`onWrite`) ou mover as escritas pra rotas de servidor — infraestrutura nova, não uma regra; fica para a Etapa 3/4 (é o mesmo tipo de checkpoint servidor que o isolamento por tenant vai precisar de qualquer forma) |
| S21 | Regras aceitam dinheiro em texto tipo `"..."` e data tipo `"2026-99-99"` | [x] | `firestore.rules`, `lib/test/regras-numeros-datas.emulador.test.ts` (novo) | `valorAceitavel` exigia só dígito/ponto/vírgula em qualquer ordem; `dataAceitavel` aceitava qualquer par de dígitos no mês/dia. Reescritas pra exigir a FORMA que `parseBRNumber` sabe interpretar (um dígito antes de cada separador, no máximo uma vírgula com até 2 casas) e mês 01-12/dia 01-31 (não valida limite por mês — ex. fevereiro com 30 — que exigiria condicional entre grupos, fora do alcance de regex). Testado contra o emulador REAL, owner escrevendo em `custos`: formatos legítimos (BR com/sem milhar, plano, inteiro; datas ISO e BR) continuam aceitos, lixo com a forma certa (`"..."`, `",,,"`, `"1.2.3.4,5,6"`, `"2026-99-99"`, `"2026-13-01"`) agora é recusado. `npm run test:emulador` roda limpo pros arquivos tocados nesta sessão (7/7 rodados juntos); a suíte completa do emulador tem uma instabilidade PRÉ-EXISTENTE e independente desta mudança (confirmada rodando só os dois arquivos antigos: um teste de 20 vínculos concorrentes de `push-registro-store.emulador.test.ts` estoura o timeout de 30s sob carga — vale investigar depois, não é regressão desta sessão). Suite unitária 2290/2290, lint/tsc/build limpos |
| S22 | Limites de paginação (`watchMovimentos` 1500, `watchTasks` 500) não são paginação real | [~] | `lib/firebase/data.ts`, `EstoqueTab.tsx`, `FullTab.tsx`, `HistoricoMovimentos.tsx`, `TarefasTab.tsx` | Melhoria parcial, honesta sobre o alcance: não implementei paginação real (cursor + "carregar mais") — isso pede repensar `assinarComCache`, que hoje assume uma busca única por chave. O que mudou: bater o teto agora é VISÍVEL (`truncado: boolean` no callback), com aviso na tela nos três lugares que mostram a lista crua (Estoque, Full, Tarefas) — antes o corte era silencioso, indistinguível de "isto é tudo". Aviso deixa explícito que custo médio/quantidade em estoque NÃO são afetados (recomputeProdutoComVersao lê o livro por produto, sem teto). Dashboard (`watchTasks(setTasks)`, só conta atrasadas) ficou sem o aviso — mudança de menor valor numa tela já densa de KPI; a função ainda expõe `truncado`, é só ignorado ali. `tsc`, lint, suite completa (2290/2290) e `npm run build` limpos. Sem teste automatizado dedicado (a lógica é uma comparação de tamanho de array — verificada por leitura, não por um teste; testar de verdade exigiria repetir a extração pro-emulador que o S13 fez, custo desproporcional ao risco aqui) |
| S29 | Central de Notificações duplica valor (corpo já tem o número + `gross` concatenado) | [x] | `lib/domain/notifications.ts` (`corpoComValor`, novo), `NotificationCenter.tsx` | Ainda vivo (a auditoria de UX anterior não tinha mexido nesta lógica). A maioria dos `body` (sale_high_value, sale_paid com lucro calculado, sem-cadastro, frete-desconhecido, rajada) já embute o valor formatado — a Central reanexava incondicionalmente. `corpoComValor` só anexa quando o texto ainda NÃO contém o valor (ex.: sale_low_margin, que só mostra a margem %). `SaleNotificationToast.tsx` verificado à parte — não tem o bug, mostra valor e corpo em elementos visuais separados, nunca concatenados. `npx vitest run lib/domain/notifications.test.ts` (10/10), suite completa 2284/2284, `tsc` limpo |
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

**Não declarar "SaaS pronto"** — nada abaixo chegou perto disso ainda. O que existe até aqui é a
Etapa 2 (bugs do main atual) majoritariamente fechada, com teste de verdade em cada item — a maior
parte contra o emulador real, não mock. As Etapas 3-8 (o núcleo do pedido: isolamento por tenant,
billing, migração, UX por tela, operação) **não começaram**.

### Etapa 2 — o que ficou

14 de 21 achados corrigidos e testados: S04, S06, S08, S11, S13, S14, S16, S17, S18, S19, S21, S29,
S30 completos; S20 e S22 parciais (documentado em cada item — S20 falta o checkpoint de servidor pra
`acao`/`entidade` do log; S22 falta paginação real, só ficou visível quando trunca).

Pendentes, e por quê ainda não:

- **S05** (lease de 30s sem dono/fencing no refresh do token ML) — precisa do mesmo padrão de
  versão/CAS que o S13 usou pro estoque, mas aplicado a um recurso mais crítico (o token vale pra
  TODA leitura do ML); e entrelaça com o ponto de S06 sobre não repetir POST às cegas.
- **S07** (webhook faz trabalho pesado antes de confirmar; aceita recurso sem validar vendedor/app) —
  é o desenho do inbox durável que a Etapa 4 do prompt pede de qualquer forma. Fazer uma vez certo.
- **S09** (outbox depende de tráfego web pra retry) — mesmo histórico: um worker independente de
  tráfego é infraestrutura nova (fila, agendador), não um fix pontual.
- **S10** (caches de reputação fragmentados) — precisa do tipo `SourceState` que o prompt define pra
  Etapa 4; fazer isolado agora seria refazer depois.
- **S12** (`sync.ts` grava com `merge:true`, pode reverter dado mais novo do webhook) — é a mesma
  classe de corrida do S13 (duas gravações concorrentes), mas em `ml_orders`/`ml_returns` em vez de
  `estoque`; o padrão de versão já provado no S13 deveria se aplicar aqui, mas isolado do resto do
  fluxo de sync pra não regredir sincronização em produção sem ensaio antes.
- **S15** (backup cobre 7 de 22 coleções; exporter manual perde subcoleção órfã) — é uma auditoria +
  mudança de `lib/backup-run.ts` + `scripts/backup-firestore.mjs`, e qualquer mudança em backup exige
  o ensaio de restauração (`docs/backup.md`) antes de confiar nela — não é código que se testa só com
  `vitest`.

### Etapas 3-8 — não iniciadas

O núcleo do pedido (S01 dados/autorização globais, S02 rota admin que reseta senha de qualquer
usuário, S03 conexão ML única) e tudo que depende disso (migração, billing, UX por tela, operação)
segue como está no `main`: um app single-tenant. `docs/saas/ARQUITETURA.md`, `MIGRACAO.md`,
`OPERACAO.md`, `VALIDACAO.md` ainda não existem.

### Verificação ainda pendente (fora do alcance de `vitest`/emulador)

- S17/S19: confirmação visual com conta de colaborador de verdade (permissão parcial).
- S15: ensaio de restauração depois de qualquer mudança no backup.
- Ambiente: `test:emulador` tem uma instabilidade pré-existente sob carga prolongada (ver nota no
  S21) — não afeta os testes tocados nesta sessão rodados isoladamente, mas vale investigar antes de
  depender dela em CI.
