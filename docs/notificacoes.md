# Notificações: como o aviso chega (e como diagnosticar quando não chega)

Este documento é o mapa operacional. O **porquê** de cada regra está nos
comentários dos módulos citados — um documento envelhece, o comentário mora
junto do código.

## O caminho de um aviso

```
produtor (webhook, sync, cron, tarefa…)
   │  createNotificationEventIdempotent()   → notification_events (+ espelho público)
   ▼
enviarEPersistirEntrega()                   lib/notification-dispatch.ts
   │  publicarPush()                        → notification_outbox/{pushId}        (o QUE enviar)
   │                                        → notification_entregas/{push}__{aparelho}  (PRA QUEM)
   ▼
processarEntregas()                         lib/notification-outbox.ts
   │  1. reivindica o destino (transação, ANTES de chamar o FCM)
   │  2. reavalia acesso + preferência com o que vale AGORA
   │  3. projeta o payload pelo nível efetivo (acesso ∩ preferência)
   │  4. ajusta ao orçamento de bytes, quebra em lotes de 500, envia com TTL
   │  5. grava o resultado POR DESTINO (só se a concessão ainda é sua)
   ▼
FCM → Service Worker → notificação na barra   (a partir daqui o servidor não enxerga)
```

Quem chama `processarEntregas` não importa: o produtor (entrega imediata), o
webhook de outro pedido (de carona, depois de responder ao ML), o cron diário e a
rota `/api/push/processar` fazem a mesma coisa, e a concessão garante que cada
destino sai por um worker só.

## Os estados de cada destino

| Estado | Significado |
|---|---|
| `pending` | criado, ninguém tentou |
| `leased` | um worker tem a concessão (vence em 60 s) |
| `retry_scheduled` | falha transitória; volta em `proximaTentativaEm` (backoff exponencial com jitter) |
| `accepted` | **o FCM aceitou** a mensagem. Não é "exibido" |
| `suppressed` | não enviado de propósito: `sem_acesso`, `preferencia`, `destino_removido` |
| `expired` | passou da validade (6 h) antes de conseguir enviar |
| `permanent_failure` | `token_invalido`, `tentativas_esgotadas` (6) ou `recusado_pelo_provedor` |

O evento em `notification_events` mostra o resumo em `delivery.resumo`
(`total / aceitos / pendentes / suprimidos / expirados / falhas`).

### O que **não** se promete

- **Exatamente uma vez.** Se o FCM aceita e o worker morre antes de gravar o
  resultado, a concessão vence e o destino é reenviado: o aparelho pode receber
  duas vezes. A `tag` do payload faz o aparelho *substituir* a notificação
  anterior, então na tela costuma aparecer uma só.
- **Exibição.** `accepted` é o que o servidor sabe. Permissão revogada no
  sistema, Service Worker antigo ou economia de bateria fazem o aparelho
  descartar sem o servidor saber.

## Políticas que o usuário controla (e o que cada uma faz de verdade)

| Controle | O que muda | Onde vale |
|---|---|---|
| Mostrar valores financeiros no push | Desligado: o push traz só "Nova venda confirmada" e o produto | envio (acesso ∩ preferência); dentro do app o dono continua vendo tudo |
| Venda de alto valor a partir de R$ X | O **mesmo evento** vira "alto valor" ou "venda comum" conforme X **da pessoa** (e segue o toggle do tipo que ela vê) | só no push; a Central guarda a classificação da operação (R$ 250) |
| Agrupar vendas rápidas | Ligado: da 4ª venda de uma janela de 90 s o aviso avulso é suprimido e a pessoa recebe o resumo; desligado: cada venda chega sozinha | por pessoa, no momento do envio |
| Horário silencioso | Avisos comuns **não viram push** dentro da janela (não há fila nem reenvio às 7h); os críticos atravessam se a opção estiver ligada | por pessoa, no fuso escolhido |

**Rajada de vendas.** As 3 primeiras vendas da janela saem uma a uma. A partir da 4ª,
quem agrupa recebe um resumo de abertura ("4 vendas confirmadas em 2 min") e, se a
rajada continuou, um de fechamento no fim da janela com o número final — mesma
`tag`, então o aparelho substitui em vez de empilhar. A posição de cada venda na
janela é gravada (`notification_janelas`) e reusada no retry: dez vendas com retry
continuam sendo dez, e uma venda suprimida por agrupamento não reaparece como avulsa.
Suprimir por agrupamento **não é falha de entrega** (`suppressed / agrupada_em_resumo`).

**Horário silencioso.** Início inclusivo, fim exclusivo. Uma janela que cruza a
meia-noite pertence ao dia em que **começa** ("seg" com 22:30–07:30 cobre a
madrugada de terça). Início = fim não silencia nada. Críticos: prejuízo,
cancelamento e devolução concluída — sempre sujeitos ao toggle do próprio tipo.

**Tarefas.** `POST /api/notify/task-assigned` recebe só o `taskId`. O responsável, o
texto e a prioridade saem da tarefa gravada, e o aviso só existe se o rastro da
tarefa registra que **quem pediu** atribuiu há menos de 15 min. A identidade é
`task_assigned:{tarefa}:{instante da atribuição}`: retry não duplica, reatribuição
avisa de novo. Limite de 20 avisos por pessoa a cada 10 min.

**Pagamento tardio.** "Venda nova" mede a **aprovação do pagamento**
(`payments[].date_approved`), não a criação do pedido: pedido criado ontem e pago
agora avisa uma vez. Uma importação de pedidos antigos já pagos continua sem
disparar nada (a aprovação deles também é antiga), e um sync avisa no máximo 25
pedidos por execução.

## Retry sem cron frequente

O plano gratuito da Vercel só aceita cron **diário** — e um cron mais frequente
faz o *deploy inteiro* falhar. Por isso o retry não depende dele:

1. cada webhook do Mercado Livre varre o outbox depois de responder;
2. o cron diário (`/api/ml/cron`) varre e apaga o que passou de 14 dias;
3. `GET|POST /api/push/processar` faz a mesma varredura sob demanda. Aceita o
   `CRON_SECRET` (`Authorization: Bearer …`) ou o dono da conta. Um agendador
   externo chamando isto a cada minuto dá retry rápido sem mexer no
   `vercel.json`.

## Migração: como aplicar em produção

Nada abaixo é destrutivo sem simulação antes, e nada depende de ordem entre si,
**exceto**: publique o app *antes* de publicar as regras (a regra nova de
`pushTokens` recusa a escrita direta do navegador, que o app antigo ainda faz).

1. Deploy do app (Vercel).
2. Regras: `firebase deploy --only firestore:rules`.
3. Espelho dos avisos antigos — simular primeiro, depois aplicar, repetindo com
   `?cursor=` até `proximo` vir `null`:

   ```bash
   curl -s -H "Authorization: Bearer $CRON_SECRET" "https://briefing-master.vercel.app/api/notificacoes/espelhar?simular=1"
   curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" "https://briefing-master.vercel.app/api/notificacoes/espelhar"
   ```

   Os espelhos antigos foram gravados por uma lista negra e ainda trazem `type` e
   `severity` que revelam a classificação da venda: é isto que a reprojeção
   corrige. A marca de lido de cada pessoa é preservada.
4. Registros de push antigos — simular, e só então aplicar:

   ```bash
   curl -s -H "Authorization: Bearer $CRON_SECRET" "https://briefing-master.vercel.app/api/push/higienizar"
   curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" "https://briefing-master.vercel.app/api/push/higienizar?aplicar=1"
   ```

   Só apaga o que se **prova** sobra: documentos com o mesmo token de outro, e
   registros antigos cujo token o FCM diz estar morto. Registro antigo vivo
   nunca é apagado — o e-mail não prova que é o mesmo aparelho.

Ninguém precisa reativar o push: quem já o tinha ligado é migrada sozinha na
próxima abertura do app (o servidor prova que a pessoa registrou aquela
instalação antes de o navegador herdar o estado antigo).

## Quando "não chega notificação"

Em ordem — cada linha tem uma causa e uma correção diferentes:

1. **O Mercado Livre não chama o webhook** → configuração no painel do ML.
2. **Evento criado, nenhum destino** → `delivery.resumo.total = 0`: nenhum aparelho
   registrado. Ativar em 📱 no aparelho.
3. **Destinos `suppressed`** → preferência, acesso ou aparelho removido. O motivo
   está em `notification_entregas`.
4. **Destinos `retry_scheduled`/`permanent_failure`** → FCM instável ou token
   morto. `ultimoErro.codigo` diz qual.
5. **`accepted` mas nada na tela** → é o aparelho: permissão, Service Worker
   antigo, economia de bateria, PWA sem gesto de ativação (iOS). O botão 🩺
   verifica o que só o aparelho sabe.

## Testes

- `npm test` — unidade (domínio puro), roda em qualquer máquina.
- `npm run test:emulador` — regras do Firestore, transações, concessão sob 20
  workers e o outbox, contra o **emulador** (nunca produção). Exige Java. O FCM é
  simulado: falha parcial, lote de 501 e resposta incompleta não se obtêm sob
  demanda do FCM real.
- **Não coberto por automação:** exibição real no aparelho (Android, iOS PWA,
  navegadores), clique na notificação e comportamento em primeiro/segundo plano.
  Ver o roteiro de validação em aparelho, ao final da entrega.
