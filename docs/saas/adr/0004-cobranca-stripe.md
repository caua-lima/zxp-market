# ADR 0004 — Cobrança da assinatura: Stripe Billing, em modo de teste

- **Estado**: aceito para o sandbox (27/09/2026). Cobrar de verdade é outra decisão (ver "O que falta").
- **Achado**: S25 da auditoria SaaS.

## Contexto

O SaaS precisa cobrar a EMPRESA (não a pessoa) por um plano, com teste grátis,
checkout e portal hospedados, webhook verificado e idempotente, reconciliação,
carência, cancelamento no fim do período e troca de plano. A cobrança do SaaS é
separada do dinheiro das vendas da loja (Mercado Pago/`net_received` não
confirmam nada aqui).

## Decisão

1. **Um fornecedor: Stripe Billing**, atrás da interface `ProvedorDeCobranca`
   (`lib/billing/provedor.ts`). Não há segundo provedor implementado — a
   interface existe pra teste (provedor falso) e pra troca futura.
2. **Sem SDK**: chamadas REST com `fetch`, versão da API fixada
   (`Stripe-Version: 2024-06-20`) e leitura tolerante aos dois formatos que
   mudaram depois (período no item; assinatura da fatura em `parent`).
3. **O estado vem da BUSCA, não do evento.** O Stripe não garante ordem nem
   entrega única. O webhook só diz qual assinatura mudou; o app busca a
   assinatura (`GET /v1/subscriptions/{id}`) e grava se a leitura for mais nova
   que a gravada. Eventos são deduplicados em `billing_eventos/{id}`.
4. **A volta do checkout não libera nada** — só o webhook (e a reconciliação
   diária no cron) mudam o plano.
5. **Preço mora no Stripe.** `config/planos.ts` (versionado) tem limites e o
   NOME da variável com o ID do preço (`STRIPE_PRICE_*`). O app nunca tem valor.
6. **Direitos no servidor**: limite de pessoas na rota de membros, limite de
   contas no início do OAuth do ML, bloqueio de escrita nas regras do Firestore
   (geradas: `escritaLiberadaT()`), rotinas agendadas pulam empresa bloqueada.
7. **Bloqueio é somente leitura, nunca apagar.** Trial encerrado, inadimplência
   depois de 7 dias de carência e cancelamento travam a ESCRITA; ler e exportar
   continuam. Pagar desbloqueia com tudo no lugar. Plano rebaixado com gente
   acima do limite não remove ninguém — só barra entrada nova.
8. **Chave de produção trancada**: `sk_live_` só liga com
   `ZXP_COBRANCA_LIVE=autorizado`.
9. **Trial local**, sem cartão (14 dias, `trialNovo`), criado no cadastro
   self-service da empresa. Empresa sem assinatura gravada (a operação atual,
   empresas criadas por script) é **interna**: sem limite, sem cobrança.

## Estados

`interna`, `trial` → (`trial_encerrado` ⛔), `incompleta`, `ativa`,
`carencia` → (`inadimplente` ⛔), `cancelada` ⛔. Mapeamento de todos os status
do Stripe em `lib/domain/assinatura.ts` (`deStatusDoProvedor`), com teste.

## Consequências

- Upgrade/downgrade e cancelamento acontecem no **portal do Stripe** (configurado
  no painel), com rateio do próprio Stripe — o app só reflete.
- Cada escrita do dado da empresa faz uma leitura a mais nas regras (o documento
  da empresa; em cache dentro da mesma requisição).
- A reconciliação roda uma vez por dia por empresa (cron). Um webhook perdido
  atrasa o estado em até 24 h, nunca pra sempre.

## O que depende de sandbox real (não testado contra o Stripe de verdade)

Testado com fixtures sintéticas no formato documentado e provedor falso:
assinatura HMAC, leitura dos dois formatos, idempotência, fora de ordem, carência,
bloqueio nas regras (emulador). **Não** exercitado contra a API real por falta
de chaves de teste: criação real de Checkout Session e Portal Session, entrega
real de webhook (`stripe listen`/endpoint), e a configuração do portal (troca de
plano). Roteiro de teste em `OPERACAO.md`, parte E.

## O que falta pra cobrar de verdade (decisões suas)

Preço e limites de cada plano; termos de uso e política de cancelamento/reembolso
(revisão jurídica); nota fiscal de serviço (fora do Stripe); trocar pra chave
`sk_live_` com `ZXP_COBRANCA_LIVE=autorizado`.
