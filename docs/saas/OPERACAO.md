# Operação — o que você precisa fazer, passo a passo

Tudo aqui é **você** quem roda, porque mexe em conta, segredo ou produção. Nenhuma
credencial passa pelo código nem pelo Claude. Os comandos são para o terminal
do Windows (PowerShell) aberto **na pasta do projeto**
(`C:\Users\caual\Downloads\PESSOAL\zxp-market`).

Ordem recomendada:

| Quando | Parte | Tempo |
|---|---|---|
| Agora | **A** worker de 5 min · **B** publicar regras · **H1–H3** segurança básica | ~30 min |
| Antes de vender pra alguém | **E** plano da Vercel | ~10 min |
| Quando for virar pra várias empresas | **C** migração + chave (tem rollback) | ~30 min |
| Depois de C | **D** segundo cliente por script · **F** cobrança em teste · **G** cadastro aberto | ~1 h |
| Quando pedirem | **I** exportar/apagar dados (LGPD) | ~10 min |

Nada aqui é obrigatório pro app de hoje continuar funcionando: sem C, ele segue
no modo de uma empresa só, igual antes.

---

## A. Ligar o worker que roda a cada 5 minutos (S09)

**Por quê:** sem ele, um push que falhou espera até o cron do dia seguinte, e o
resumo de uma rajada de vendas pode expirar sem ser enviado. O código já está
em produção; falta só o segredo.

1. Descubra o valor atual do `CRON_SECRET`:
   - Abra <https://vercel.com> → projeto **zxp-market** → **Settings** →
     **Environment Variables** → procure `CRON_SECRET` → clique no olho pra ver
     o valor → copie.
2. No terminal, rode (ele vai pedir o valor — cole e aperte Enter; nada aparece
   na tela enquanto você cola, é normal):
   ```
   gh secret set CRON_SECRET -R caua-lima/zxp-market
   ```
   Se disser que você não está logado: `gh auth login` e siga as perguntas
   (GitHub.com → HTTPS → login pelo navegador), depois repita.
3. Dispare uma execução agora pra testar:
   ```
   gh workflow run worker -R caua-lima/zxp-market
   ```
4. Espere 1 minuto e confira:
   ```
   gh run list -R caua-lima/zxp-market --workflow worker --limit 3
   ```
   A última linha tem que estar com **✓ completed success**.
5. Confirmação dentro do app: abra
   `https://briefing-master.vercel.app/api/ml/diagnostico-push` logado como dono.
   Em `worker`, `saudavel` tem que estar `true`.

**Se der errado:** `gh run view -R caua-lima/zxp-market --log-failed` mostra o
erro. "HTTP 401" = o segredo colado não é igual ao da Vercel; repita o passo 2.

---

## B. Publicar as regras de segurança do Firestore

**Por quê:** as regras **não sobem com o deploy da Vercel**. As proteções desta
auditoria que vivem nas regras — auditoria obrigatória das movimentações de
estoque (S20), valores e datas validados (S21), isolamento por empresa
(Etapa 3) — só passam a valer depois deste passo. O código que está no ar já
foi escrito pra funcionar com elas.

1. Entre na conta do Firebase (abre o navegador; use a conta dona do projeto):
   ```
   npx firebase login
   ```
2. Confira que está no projeto certo (tem que aparecer `vazxpress-a2350`):
   ```
   npx firebase use
   ```
3. Publique **só as regras** (não mexe em mais nada):
   ```
   npx firebase deploy --only firestore:rules --project vazxpress-a2350
   ```
   Tem que terminar com **Deploy complete!**
4. Abra o app, **recarregue a página** (Ctrl+F5) e faça um teste simples:
   lance e depois exclua uma movimentação de estoque de teste. Tem que funcionar.

**Se algo que funcionava passar a dar "sem permissão":** no console do Firebase
(<https://console.firebase.google.com> → vazxpress-a2350 → Firestore →
**Regras**) há o histórico de versões: escolha a anterior e clique em
**Publicar**. Isso desfaz na hora. Me mande o que deu erro.

---

## C. Virada para várias empresas (migração + chave)

**Quando:** quando quiser preparar o app pra receber um segundo cliente. Até lá
o app continua funcionando exatamente como hoje — nada disto é obrigatório pro
dia a dia. **Faça B antes.**

**O que acontece:** os dados são **copiados** (nunca apagados) da raiz do banco
para `tenants/vazxpress/…`, e depois uma chave na Vercel manda o app ler de lá.
Desligar a chave volta tudo como era — esse é o rollback.

### C1. Pegar as credenciais de produção (fica só no seu computador)

```
npx vercel login
npx vercel env pull .env.producao --environment=production
```
Isso cria o arquivo `.env.producao` com as variáveis de produção. Ele **nunca**
vai pro GitHub (o `.gitignore` bloqueia `.env*`). Apague-o no fim (C6).

**Se o passo C2 disser "Faltam FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL e
FIREBASE_PRIVATE_KEY"**: a Vercel não entrega variável marcada como *Sensitive*.
Gere uma chave nova: <https://console.firebase.google.com> → vazxpress-a2350 →
⚙ **Configurações do projeto** → **Contas de serviço** → **Gerar nova chave
privada** (baixa um `.json`). Abra o `.json` no Bloco de Notas e crie o arquivo
`.env.producao` na pasta do projeto com três linhas:
```
FIREBASE_PROJECT_ID=vazxpress-a2350
FIREBASE_CLIENT_EMAIL=<o valor de "client_email" do .json>
FIREBASE_PRIVATE_KEY="<o valor de "private_key" do .json, inteiro, com os 
>"
```
No fim (C6), apague o `.env.producao` **e o `.json`**, e no console do Firebase
exclua essa chave (mesma tela, ⋮ → Excluir).

### C2. Migrar os membros (quem entra na empresa)

Primeiro só **veja o plano** (não escreve nada):
```
node --env-file=.env.producao scripts/migrar-tenant-legado.mjs --tenant-id vazxpress --nome "VAZXPRESS" --owner caualima@zxpmarket.com
```
Confira a lista: todo mundo que usa o app tem que aparecer; o outro owner
(`caualimavd@zxpsolutions.com`) aparece como **partner** — é o esperado (a
empresa tem um dono só; ele continua entrando e vendo tudo, só não administra
time/conexão/cobrança). Se concordar, aplique:
```
node --env-file=.env.producao scripts/migrar-tenant-legado.mjs --tenant-id vazxpress --nome "VAZXPRESS" --owner caualima@zxpmarket.com --aplicar --confirmar-producao
```
Ele vai pedir pra você **digitar o nome do projeto** (`vazxpress-a2350`) — é a
trava contra rodar no lugar errado.

### C3. Copiar os dados

Veja quanto vai ser copiado (não escreve nada):
```
node --env-file=.env.producao scripts/migrar-dados-tenant.mjs --tenant-id vazxpress
```
Copie de verdade (pede de novo o nome do projeto):
```
node --env-file=.env.producao scripts/migrar-dados-tenant.mjs --tenant-id vazxpress --aplicar --confirmar-producao
```
No fim tem que aparecer **"Conferência: origem e destino batem, documento a
documento e campo a campo."** Se aparecer diferença, **pare** e me mande a saída.

### C4. Virar a chave

1. Na Vercel → **zxp-market** → **Settings** → **Environment Variables** →
   **Add New**, ambiente **Production**:
   - `NEXT_PUBLIC_ZXP_MODO_DADOS` = `tenant`
   - `NEXT_PUBLIC_ZXP_TENANT_ID` = `vazxpress`
2. **Imediatamente antes** de redeployar, rode a cópia de novo (leva o que a
   operação gravou nesse meio-tempo — é seguro repetir):
   ```
   node --env-file=.env.producao scripts/migrar-dados-tenant.mjs --tenant-id vazxpress --aplicar --confirmar-producao
   ```
3. Vercel → **Deployments** → no último deploy, **⋯ → Redeploy** (variável
   `NEXT_PUBLIC_` só vale depois de um build novo).

### C5. Conferir

- Abra o app: Dashboard, Pedidos, Estoque e Custos têm que mostrar os mesmos
  números de antes.
- Acesso → **Saúde da operação** (painel do dono): nada em vermelho além de
  "Rotina diária ainda não rodou" no primeiro dia.
- Acesso → **Plano**: aparece "Sem cobrança pelo app" (a VAZXPRESS é a empresa
  interna — sem limite, sem cobrança).
- Lance e exclua uma movimentação de teste no Estoque.

**Rollback (se algo estiver errado):** apague as duas variáveis do passo C4 na
Vercel e faça **Redeploy**. O app volta a ler da raiz, que ficou intacta. O que
foi gravado enquanto a chave esteve ligada fica em `tenants/vazxpress` (me
avise que eu trago de volta).

### Depois da virada: o time da empresa

Com a chave ligada, a tela **Acesso** passa a administrar o time **da empresa**
(convidar, mudar papel, remover) — `controleAcesso` deixa de valer. Quem já
usava o app foi levado pelo passo C2. Pra alguém novo: tela Acesso → adicionar,
como sempre.

### C6. Limpeza
```
Remove-Item .env.producao
```

---

## D. Cadastrar o segundo cliente (depois de C)

**Pré-requisito:** a parte C feita (app no modo empresa). Cada cliente é uma
empresa separada: dado, time e conta do Mercado Livre isolados.

1. Escolha um id pra empresa: minúsculas, números e hífen (ex.: `loja-joao`).
2. Com o `.env.producao` na pasta (passo C1), veja o que seria criado:
   ```
   node --env-file=.env.producao scripts/criar-empresa.mjs --tenant-id loja-joao --nome "Loja do João" --dono joao@email.com
   ```
3. Crie de verdade (pede pra digitar `vazxpress-a2350`):
   ```
   node --env-file=.env.producao scripts/criar-empresa.mjs --tenant-id loja-joao --nome "Loja do João" --dono joao@email.com --aplicar --confirmar-producao
   ```
4. Mande pro cliente:
   - o endereço do app (`https://briefing-master.vercel.app`);
   - que ele entre com o e-mail `joao@email.com` (Google ou e-mail/senha — se
     for senha, crie pela tela Acesso dele depois, ou peça pra ele usar "Entrar com
     Google");
   - que clique em **Conectar Mercado Livre** e autorize com a conta DELE;
   - que convide o time dele pela tela **Acesso**.
5. No dia seguinte, confira em `/api/ml/diagnostico-push` (logado como dono
   da VAZXPRESS) que o cron rodou — ele agora roda uma vez por empresa.

**Limites de hoje (pra você saber o que prometer):**
- empresa criada por este script é **interna** (sem limite e sem cobrança pelo
  app) — combine o pagamento por fora, ou use o cadastro aberto (G) com a
  cobrança (F), que já nasce em teste grátis;
- uma pessoa pertence a UMA empresa (o mesmo e-mail não entra em duas);
- uma conta do Mercado Livre pertence a UMA empresa;
- o cron e o worker percorrem as empresas em sequência dentro de 60 s: com
  muitas empresas (dezenas), vai precisar de fila — me avise antes de passar de ~5.

## E. Plano da Vercel (antes de cobrar de alguém)

**Por quê:** o plano **Hobby** da Vercel é só pra uso pessoal, **não comercial**.
Vender o app (mesmo pra um cliente só) exige o plano **Pro**. De quebra, o Pro
permite cron mais frequente.

1. <https://vercel.com> → seu time → **Settings** → **Billing** → confira o
   plano. Se for Hobby: **Upgrade to Pro** (pago; o valor aparece na tela).
2. Ambientes separados (pra testar sem mexer na produção): **Settings** →
   **Environment Variables** → confira que `FIREBASE_*` e `NEXT_PUBLIC_FIREBASE_*`
   de **produção** estão marcadas **só em Production**. Em **Preview**, use as do
   projeto de teste (`controleml-saas`, as mesmas do seu `.env.local`). Assim um
   deploy de teste nunca grava no banco da operação.
3. Nada muda no código.

---

## F. Cobrança em modo de TESTE (Stripe) — depois de C

**Por quê:** a cobrança (S25) está pronta no código, mas desligada: sem as
chaves do Stripe ela não aparece. Em **modo de teste** nenhum cartão de verdade
é cobrado. Só faz sentido no modo empresa (parte C).

1. Crie a conta em <https://dashboard.stripe.com/register> e deixe ligado o
   botão **Test mode** (canto superior direito) em todos os passos abaixo.
2. **Produtos e preços** (você decide o valor): Product catalog → **Add
   product** → nome "ZXP Market Essencial" → **Recurring**, **Monthly**, o valor
   → **Save**. Abra o produto e copie o **Price ID** (começa com `price_`).
   Repita pra "ZXP Market Profissional". Os limites de cada plano (pessoas e
   contas do ML) estão em `config/planos.ts`: Essencial 3 pessoas, Profissional
   10 — me diga se quiser outros números.
3. **Chave secreta**: Developers → **API keys** → **Secret key** → Reveal →
   copie (começa com `sk_test_`).
4. **Webhook**: Developers → **Webhooks** → **Add endpoint**:
   - URL: `https://briefing-master.vercel.app/api/billing/webhook`
   - versão da API: `2024-06-20` se a tela deixar escolher (o código lê as
     versões novas também);
   - eventos: `checkout.session.completed`, `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`,
     `customer.subscription.paused`, `customer.subscription.resumed`,
     `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`.

   Salve e copie o **Signing secret** (começa com `whsec_`).
5. **Portal do cliente**: Settings → **Billing** → **Customer portal** → ative:
   atualizar forma de pagamento, ver faturas, **cancelar no fim do período** e
   **trocar de plano** entre os dois produtos do passo 2 → Save.
6. **Vercel** → Settings → Environment Variables → **Production**:

   | Variável | Valor |
   |---|---|
   | `STRIPE_SECRET_KEY` | a do passo 3 |
   | `STRIPE_WEBHOOK_SECRET` | a do passo 4 |
   | `STRIPE_PRICE_ESSENCIAL` | Price ID do Essencial |
   | `STRIPE_PRICE_PROFISSIONAL` | Price ID do Profissional |
   | `APP_URL` | `https://briefing-master.vercel.app` |

   Depois: Deployments → último → **⋯ → Redeploy**.
7. **Teste** com uma empresa de teste (criada pela parte G ou D, nunca a
   VAZXPRESS): entre como dono → **Acesso → Plano → Assinar** → no checkout use
   o cartão `4242 4242 4242 4242`, validade futura qualquer, CVC qualquer →
   volta pro app → em alguns segundos o Plano mostra **Ativa**.
   - Falha de pagamento: no Stripe (test mode) → Customers → o cliente → troque
     o cartão por `4000 0000 0000 0341` e avance a renovação com um *test clock*
     (ou espere): o app mostra "Pagamento pendente" e, depois de 7 dias,
     "somente leitura".
   - Cancelar: Plano → **Gerenciar assinatura** → cancelar → o app mostra
     "Termina em …".
8. Se algo não bater: Stripe → Webhooks → o endpoint → **Event deliveries**
   (tem que estar 200). 400 = `STRIPE_WEBHOOK_SECRET` errado.

**Cobrar de verdade** é outro passo, só depois de termos e preços revisados:
chave `sk_live_`, webhook criado em modo live e a variável
`ZXP_COBRANCA_LIVE=autorizado`. Sem essa última, o app se recusa a usar chave de
produção (trava de segurança).

---

## G. Cadastro aberto de empresas — depois de C (e de F, se for cobrar)

**Por quê:** hoje empresa nova só nasce pelo script (D). Com o cadastro aberto,
o cliente cria a conta, confirma o e-mail, cria a empresa (em teste grátis de
14 dias) e segue o checklist de primeiros passos sozinho.

1. **Termos**: leia `/termos` e `/privacidade` no app (versão preliminar) e
   passe por um advogado. Mudou o texto? Me diga — a versão sobe e o aceite
   registra a nova.
2. **Firebase** → Authentication → **Sign-in method**: **Email/Password** e
   **Google** ligados. Em **Settings → Authorized domains**, confira o domínio do
   app. Em **Templates**, troque o idioma pra **Português (Brasil)** (e-mails de
   confirmação e de nova senha).
3. **Vercel** → Environment Variables → Production: `ZXP_CADASTRO_ABERTO` = `1`
   e `NEXT_PUBLIC_ZXP_CADASTRO_ABERTO` = `1` (as duas iguais; o app avisa no log
   se divergirem) → **Redeploy**.
4. Teste numa janela anônima: **Criar conta** → confirme o e-mail → crie uma
   empresa "Teste" → o Dashboard mostra **Primeiros passos · 0 de 6**.
5. Sem a cobrança (F), o teste grátis acaba em somente leitura sem como assinar
   — ligue F antes, ou combine por fora.

Fechar de novo: apague as duas variáveis e Redeploy.

---

## H. Segurança (S27) — detalhes em `SEGURANCA.md`

**H1. CI:** nada a fazer — roda sozinho a cada push (GitHub → Actions → **ci**).
Se ficar vermelho, me avise antes de publicar regras ou mexer na Vercel.

**H2. Validade do registro de diagnóstico (1 ano):**
<https://console.firebase.google.com> → vazxpress-a2350 → **Firestore** → aba
**TTL** → **Create policy** → Collection group: `acessos_diagnostico` →
Timestamp field: `apagarEm` → Save.

**H3. Conferir a configuração no ar:** Vercel → projeto → **Logs** → filtre por
`[config]`. Pode aparecer o aviso de push ou de `ML_SELLER_ID`; qualquer linha
com "ausente" em variável obrigatória, "diferentes" ou "curto" é pra corrigir
na hora (a própria linha diz qual variável).

**H4. Menor privilégio (quando tiver 20 min):** siga "Menor privilégio (IAM)" em
`SEGURANCA.md` — conta de serviço só com o necessário, troca a chave da Vercel.

**H5. CSP (uma semana depois do deploy):** Vercel → Logs → filtre
`csp.violacao`. Me mande o que aparecer (ou "nada") que eu ligo o bloqueio.

**H6. Canal de contato de segurança/privacidade:** defina um e-mail (ex.:
`privacidade@…`) e me passe — ele entra nos termos e na política.

---

## I. Pedido de exportação ou exclusão de dados (LGPD)

Com o `.env.producao` (C1) na pasta. **Sem `--aplicar` nada é apagado.**

- Exportar os dados de uma pessoa (vai pra pasta `exportacoes`, que o git ignora):
  ```
  node --env-file=.env.producao scripts/dados-empresa.mjs exportar-pessoa --email pessoa@exemplo.com
  ```
- Apagar uma pessoa (primeiro o ensaio, depois de verdade):
  ```
  node --env-file=.env.producao scripts/dados-empresa.mjs excluir-pessoa --email pessoa@exemplo.com
  node --env-file=.env.producao scripts/dados-empresa.mjs excluir-pessoa --email pessoa@exemplo.com --aplicar --confirmar-producao --apagar-login
  ```
- Empresa que saiu: `exportar-empresa --tenant-id <id>` (entregue o arquivo ao
  cliente), depois `excluir-empresa --tenant-id <id>` e, conferido, repita com
  `--aplicar --confirmar-producao`.

Entregue o arquivo por canal seguro e apague a cópia local. O que dizer ao
titular está em `PRIVACIDADE.md`.

---

## Rotina — o que olhar de vez em quando

| Onde | O que tem que estar | Se não estiver |
|---|---|---|
| App → Acesso → **Saúde da operação** | tudo ✓ | o próprio item diz o que fazer |
| `node --env-file=.env.producao scripts/saude-das-empresas.mjs` (depois de C) | nenhuma empresa com ✕ | idem, por empresa |
| `/api/ml/diagnostico-push` → `cron.saudavel` | `true` (rodou nas últimas 36 h) | `CRON_SECRET` sumiu da Vercel |
| `/api/ml/diagnostico-push` → `worker.saudavel` | `true` (rodou nos últimos 30 min) | parte A; ou o GitHub desligou o agendamento por 60 dias sem commit — `gh workflow enable worker -R caua-lima/zxp-market` |
| Firestore → `webhook_topicos` → motivo `campo_ausente` | zero | o Mercado Livre mudou o formato das notificações — me avise |
| Firestore → `ml_webhook_inbox` com `estado: falhou` | nenhum | notificação que esgotou as tentativas; `ultimoErro` diz por quê |
