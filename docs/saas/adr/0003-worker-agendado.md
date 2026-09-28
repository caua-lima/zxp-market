# ADR 0003 — Worker a cada 5 minutos pelo GitHub Actions

- **Estado**: aceito (setembro/2026). Achado S09; Etapa 4.

## Contexto

No plano Hobby da Vercel o cron roda uma vez por dia. Retentar push que falhou,
enviar o resumo de uma rajada de vendas e processar a fila de notificações do ML
precisam de varredura frequente mesmo sem tráfego no site.

## Decisão

`.github/workflows/worker.yml` chama `/api/worker` a cada 5 minutos com o
`CRON_SECRET`. A rota varre o inbox do webhook e o outbox de push, uma vez por
empresa, e carimba `cron_estado/worker`. O repositório é público: o log do
Actions imprime só o status HTTP (a resposta diria o volume de vendas).

## Alternativas

- **Vercel Pro** (cron por minuto): resolve sem GitHub e é o caminho natural
  junto com o uso comercial (o Hobby é só pra uso não comercial) — ver OPERACAO,
  parte E. Trocar é mudar o agendador; a rota é a mesma.
- **Várias rotinas diárias**: não contornar limite de plano multiplicando cron.

## Consequências

- O GitHub pode atrasar agendamentos sob carga e desliga os de repositório sem
  commit há 60 dias (`gh workflow enable worker`).
- A saúde aparece no painel do dono (Acesso → Saúde da operação) e em
  `scripts/saude-das-empresas.mjs`.
