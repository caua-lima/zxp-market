# Privacidade — inventário de dados (LGPD, Lei 13.709/2018)

> **Rascunho técnico pra revisão jurídica.** Descreve o que o sistema guarda,
> por quê e por quanto tempo, tirado do código. Não certifica conformidade:
> papéis, bases legais e textos de termos/política precisam de advogado(a).

## Papéis (proposta)

- **Cada empresa cliente** é **controladora** dos dados da operação dela
  (vendas, compradores, estoque, custos, time).
- **ZXP Market** é **operadora** desses dados (trata em nome do cliente) e
  **controladora** dos dados de cadastro e cobrança da própria assinatura.
- **Suboperadores**: Google (Firebase: banco, login, push — região do projeto
  Firestore), Vercel (hospedagem e logs), GitHub (código e agendador do worker;
  nenhum dado de cliente), Mercado Livre (origem dos dados de venda, via API
  autorizada pelo cliente), Stripe (cobrança da assinatura, quando ligada).

## Categorias de dados

| Dado | Titular | Onde | Finalidade | Retenção |
|---|---|---|---|---|
| E-mail, nome, foto do time | Pessoas do time | `tenants/{id}/members`, `memberships`, Firebase Auth | Login e permissão | Enquanto for membro; sai ao remover (tela de Acesso) |
| Preferências | Pessoa | `usuarios/{uid}` | Configuração da tela e dos avisos | Até a pessoa pedir exclusão |
| Aparelhos de push | Pessoa | `pushTokens` | Enviar notificação | Até descadastrar/aparelho inválido |
| Avisos pessoais | Pessoa | `notification_feed/{email}` da empresa | Central de avisos | Até exclusão da pessoa ou da empresa |
| Pedidos do ML | Compradores (pseudônimo) | `ml_orders` | Números da operação | Enquanto a empresa for cliente |
| Comprador | Comprador | só `buyer_id` (número do ML) no pedido — **sem nome, e-mail, telefone ou endereço gravados** | Taxa de recompra | Idem |
| Token do ML | Empresa | `connections/main` | Ler vendas autorizadas | Até desconectar |
| Estoque, custos, metas, tarefas | Empresa | coleções da empresa | Gestão | Enquanto for cliente |
| Trilha de auditoria | Pessoa do time | `auditLog`, `acessos_diagnostico` | Segurança e prova de quem fez o quê | `acessos_diagnostico`: 1 ano (TTL); `auditLog`: enquanto for cliente |
| Notificações do ML recebidas | — | `webhook_log`, `ml_webhook_inbox` | Processar e depurar | 30 dias (poda diária) |
| Entregas de push | Pessoa | `notification_entregas` | Retentar/diagnosticar push | 14 dias |
| Logs de servidor | Pessoa (redigido) | Vercel | Operação | Retenção do plano da Vercel |
| Backups | Todos acima | fora do app (arquivos do dono) | Recuperação | 14 diários, 8 semanais, 12 mensais (`npm run backup:podar`) |

Dado que **não** entra no sistema: CPF/CNPJ, endereço e telefone de comprador
(as rotas de diagnóstico que viam isso na resposta crua do ML agora redigem —
`lib/diagnostico.ts`); dados de cartão (a cobrança, quando ligada, é na página
do Stripe — o app nunca vê o cartão).

## Direitos do titular — procedimento

Pedido chega por e-mail (canal nos termos). Confirmar a identidade (resposta a
partir do próprio e-mail cadastrado). Prazo de referência: 15 dias (art. 19).

| Pedido | Como atender |
|---|---|
| Acesso / portabilidade | `node --env-file=.env.producao scripts/dados-empresa.mjs exportar-pessoa --email <e-mail>` → JSON em `exportacoes/`. Tokens e segredos ficam de fora. |
| Correção | A própria pessoa corrige nome/foto na tela; o resto, o dono da empresa na tela de Acesso. |
| Eliminação (pessoa) | `excluir-pessoa --email <e-mail>` (ensaio) → `--aplicar --confirmar-producao` (+ `--apagar-login`). Recusa se a pessoa for dona de empresa: primeiro transferir. |
| Eliminação (empresa que sai) | `exportar-empresa` (entregar ao cliente) → `excluir-empresa --tenant-id <id>` (ensaio) → `--aplicar --confirmar-producao`. |
| Dado de comprador | O comprador é cliente do vendedor, não nosso: encaminhar ao vendedor (controlador). Só `buyer_id` é guardado. |

**Informar na resposta**: cópias em backup expiram pela retenção acima (não
são editadas uma a uma); a cópia da raiz de antes da migração (o rollback) continua
existindo até ser apagada — o script de pessoa já apaga também o acesso e o feed dela
na raiz (`controleAcesso`, `notification_feed`); logs da Vercel expiram pelo plano.

## Para a revisão jurídica — [você]

- Base legal de cada finalidade (execução de contrato para o time e a
  operação; legítimo interesse para auditoria/segurança).
- Termos de uso e política de privacidade publicados, com canal do
  encarregado (DPO) e contato de segurança.
- Contrato de operação de dados (DPA) com os clientes; conferir os DPAs de
  Google, Vercel e Stripe (transferência internacional, art. 33).
- Confirmar a retenção dos backups e da trilha de auditoria.
