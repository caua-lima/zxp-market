# Operação — o que você precisa fazer, passo a passo

Tudo aqui é **você** quem roda, porque mexe em conta, segredo ou produção. Nenhuma
credencial passa pelo código nem pelo Claude. Os comandos são para o terminal
do Windows (PowerShell) aberto **na pasta do projeto**
(`C:\Users\caual\Downloads\PESSOAL\zxp-market`).

Ordem recomendada: **A → B** agora (5 a 10 min cada). **C** só quando decidir
virar o app para o modelo de várias empresas (leva ~30 min e tem rollback).

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
   npx -y firebase-tools@latest login
   ```
2. Confira que está no projeto certo (tem que aparecer `vazxpress-a2350`):
   ```
   npx -y firebase-tools@latest use
   ```
3. Publique **só as regras** (não mexe em mais nada):
   ```
   npx -y firebase-tools@latest deploy --only firestore:rules --project vazxpress-a2350
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
documento."** Se aparecer diferença, **pare** e me mande a saída.

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
- `https://briefing-master.vercel.app/api/ml/diagnostico-push` → em
  `worker.ultimoResumo.membros`, `ativo: true`.
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
- não há cobrança (Etapa 6): combine o pagamento por fora;
- uma pessoa pertence a UMA empresa (o mesmo e-mail não entra em duas);
- uma conta do Mercado Livre pertence a UMA empresa;
- o cron e o worker percorrem as empresas em sequência dentro de 60 s: com
  muitas empresas (dezenas), vai precisar de fila — me avise antes de passar de ~5.

## Rotina — o que olhar de vez em quando

| Onde | O que tem que estar | Se não estiver |
|---|---|---|
| `/api/ml/diagnostico-push` → `cron.saudavel` | `true` (rodou nas últimas 36 h) | `CRON_SECRET` sumiu da Vercel |
| `/api/ml/diagnostico-push` → `worker.saudavel` | `true` (rodou nos últimos 30 min) | parte A; ou o GitHub desligou o agendamento por 60 dias sem commit — `gh workflow enable worker -R caua-lima/zxp-market` |
| Firestore → `webhook_topicos` → motivo `campo_ausente` | zero | o Mercado Livre mudou o formato das notificações — me avise |
| Firestore → `ml_webhook_inbox` com `estado: falhou` | nenhum | notificação que esgotou as tentativas; `ultimoErro` diz por quê |
