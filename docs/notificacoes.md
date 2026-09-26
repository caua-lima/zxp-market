# Notificações: como o aviso chega (e como diagnosticar quando não chega)

Este documento é o mapa operacional. O **porquê** de cada regra está nos
comentários dos módulos citados — um documento envelhece, o comentário mora
junto do código.

## O caminho de um aviso

```
produtor (webhook, sync, cron, tarefa…)
   │  criarEventoEPublicar()                lib/notification-dispatch.ts
   │    MESMO LOTE: notification_events (+ espelho) e notification_outbox/{pushId}
   ▼                                        (evento sem push não existe mais — S09)
publicarEEntregar()
   │  fan-out                               → notification_entregas/{push}__{aparelho}  (PRA QUEM)
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
worker a cada 5 min (`/api/worker`), o webhook de outro pedido (de carona, depois
de responder ao ML), o cron diário e a rota `/api/push/processar` fazem a mesma
coisa, e a concessão garante que cada destino sai por um worker só. Se o processo
morrer logo depois de criar o evento, o push já está no outbox com
`fanoutPendente: true` e a próxima varredura completa.

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

1. **o worker** (`/api/worker`), chamado a cada 5 min pelo GitHub Actions
   (`.github/workflows/worker.yml`), varre o inbox do webhook e o outbox. Precisa
   do segredo `CRON_SECRET` cadastrado no GitHub (Settings → Secrets and
   variables → Actions), com o mesmo valor da Vercel. Sem ele o workflow só avisa
   e sai. `/api/ml/diagnostico-push` mostra a última execução (`worker`). O GitHub
   atrasa agendamentos sob carga (5 a ~15 min na prática) e desliga agendamento de
   repositório sem commit há 60 dias;
2. cada webhook do Mercado Livre varre o outbox depois de responder;
3. o cron diário (`/api/ml/cron`) varre e apaga o que passou de 14 dias;
4. `GET|POST /api/push/processar` faz a varredura do outbox sob demanda. Aceita o
   `CRON_SECRET` (`Authorization: Bearer …`) ou o dono da conta.

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
5. Avisos direcionados que estavam nas coleções do time (tarefa atribuída, prazo
   de tarefa e teste). O aviso antigo não guardou pra quem era, então **não dá
   pra movê-lo pro feed pessoal — ele é apagado** das duas coleções
   compartilhadas (a tarefa em si continua em `tarefas`). Simular primeiro; até
   200 por tipo por chamada, repita até `restantes` vir `false`:

   ```bash
   curl -s -H "Authorization: Bearer $CRON_SECRET" "https://briefing-master.vercel.app/api/notificacoes/migrar-direcionados"
   curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" "https://briefing-master.vercel.app/api/notificacoes/migrar-direcionados?aplicar=1"
   ```

Ninguém precisa reativar o push: quem já o tinha ligado é migrada sozinha na
próxima abertura do app (o servidor prova que a pessoa registrou aquela
instalação antes de o navegador herdar o estado antigo).

## Central, avisos pessoais e o clique

**Dois lugares, duas audiências.** Venda e alertas do time ficam em
`notification_events_publico` (lido por todos com acesso, campos permitidos por
allowlist). O que é *de uma pessoa* — tarefa atribuída, prazo, teste — nasce em
`notification_feed/{email}/itens`, cujo caminho já é a proteção: a regra só deixa
a própria pessoa ler, marcar como lido (`lidoEm`) e dispensar. Por isso não há
índice composto; a Central junta as duas fontes por data no cliente, com leitura
paginada ("Carregar avisos mais antigos") e sem prometer "tudo em dia" enquanto
houver página por ler.

**Teste é da própria pessoa.** `POST /api/push/test` envia só aos aparelhos de
quem clicou (`apenasRegistros`), grava o aviso no feed dela, tem limite de taxa e
ignora as preferências de propósito (o teste existe pra provar o caminho). Testes
com mais de 7 dias são apagados na varredura diária.

**Clique não é leitura.** Ao tocar na notificação, o Service Worker valida o
destino (mesma origem, caminho `/`, parâmetros permitidos), escolhe a janela em
foco (ou a visível), e **manda uma mensagem** — nunca `navigate()`, que recarrega
a página e destrói um formulário em edição. O app decide: com modal ou rascunho
aberto, mostra uma faixa "Ir para o aviso" em vez de arrancar a pessoa da tela. Com o
app fechado, abre já no destino com `?ev=<eventId>`. O clique grava `clicadoEm` no
recibo da entrega (`POST /api/push/clique`) — separado de "aceito pelo FCM" e de
"lido na Central".

**Diagnóstico em camadas (🩺 no ⋯ da Central).** Aparelho (permissão, Service
Worker e versão, token), vínculo (instalação ↔ pessoa), conta (registros e
preferências), outros aparelhos, servidor/Firebase (`/api/push/diagnostico`) e o
que o aparelho de fato recebeu e exibiu (registro de 10 itens no Cache API do
Service Worker). Cada camada diz o que **não** consegue saber. Quando o texto do
Service Worker muda, suba `SW_VERSAO` em `lib/push-sw-versao.ts`: o diagnóstico
compara a versão que o aparelho roda com a publicada e avisa se está defasada.

**iOS.** Push web só funciona com o app instalado na Tela de Início e a
permissão pedida por um toque; o fluxo de ativação respeita isso e explica o
motivo em vez de falhar em silêncio.

**Fila de avisos na tela.** Uma rajada de vendas com o app aberto não empilha
toasts sem fim: `lib/domain/toast-fila.ts` (puro, seguro no Strict Mode) mostra
até 3 por vez (1 no celular, com um contador pro resto), deixa esperar até 12 e
só por 30 s, dá prioridade ao alerta de prejuízo, congela o prazo com o mouse ou
o foco em cima e troca o toast de mesma `tag` em vez de duplicar. O que a fila
descarta **não some**: continua na Central. (Quem agrupa uma rajada em resumo é
o servidor — janela de 90 s —, não o toast.)

**Regras — ordem.** As regras novas (feed pessoal, formato de preferências,
`deny` das coleções internas do outbox) dependem do app novo já publicado: o
app antigo lê os avisos direcionados da coleção do time, que o passo 5 esvazia.

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
