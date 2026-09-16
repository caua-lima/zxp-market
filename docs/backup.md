# Backup e restauração

O inventário do que se perde vive em [`lib/domain/backup-inventario.ts`](../lib/domain/backup-inventario.ts),
não aqui. Um documento envelhece em silêncio; lá um teste compara a lista com
as coleções de `firestore.rules` e **quebra** quando alguém cria coleção nova
sem decidir se ela entra no backup.

Este arquivo é só o que um documento faz melhor: o procedimento e o porquê das
escolhas.

## O que está fora do Firestore e some junto

O dump cobre o banco. **Não cobre** o que mora na Vercel, e sem isto o banco
restaurado não vira um app funcionando:

| Config | Onde | Se perder |
|---|---|---|
| `ML_CLIENT_ID`, `ML_CLIENT_SECRET` | Vercel → Environment Variables | Recriar o app no painel de desenvolvedor do ML. Todos os tokens morrem junto. |
| `ML_REFRESH_TOKEN` | Vercel | Refazer a autorização OAuth. É recuperável, mas exige o administrador da conta. |
| `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL` | Vercel | Gerar chave nova de conta de serviço no console do Firebase. |
| `BOOTSTRAP_OWNER_EMAILS` | Vercel | Define quem pode virar o primeiro owner. Sem ela e sem `controleAcesso`, o app fica sem ninguém dentro. |
| `CRON_SECRET` | Vercel | Gerar outro; o cron para até lá. |
| `firestore.rules` | neste repositório | Já versionado — é o único item desta tabela que o git cobre. |
| Índices do Firestore | console do Firebase | **Não versionados.** Ver a nota abaixo. |

### Índices do Firestore

Não existe `firestore.indexes.json` neste repositório, e hoje isso está
certo: **toda** consulta do app usa um `where` OU um `orderBy` sozinho, e
esses o Firestore indexa automaticamente. Nenhum índice composto foi criado
à mão, então não há o que versionar.

Isso deixa de valer no minuto em que alguém escrever uma consulta que
combina os dois — `where(...).orderBy(...)` em campos diferentes. O
Firestore recusa a consulta com um erro que traz um link pra criar o índice
no console, e é **aí** que o arquivo precisa passar a existir:

```bash
npx firebase firestore:indexes > firestore.indexes.json
```

Índice criado só pelo link do console vive no projeto e em lugar nenhum: se
o projeto for recriado numa restauração, as consultas que dependiam dele
voltam a falhar, e o erro aparece como tela quebrada em produção, não como
aviso no deploy.

Exporte as variáveis com `vercel env pull` e guarde o arquivo **fora do
repositório e criptografado**. Ele contém a chave privada da conta de serviço:
quem tem esse arquivo tem o banco inteiro, ignorando as regras do Firestore.

## Rodar o backup

```bash
node scripts/backup-firestore.mjs --saida ./backups
```

Lê as credenciais do ambiente (as mesmas do app). Grava um diretório por
execução, com um `.jsonl` por coleção e um `resumo.json`. Sai com código ≠ 0 se
qualquer coleção falhar — **um backup parcial que sai com sucesso é a pior
saída possível**, porque alguém confia nele até precisar.

O destino deve ser um disco que não morre com o projeto do Google Cloud. O
export nativo (`gcloud firestore export`) grava num bucket do mesmo projeto e
por isso não substitui este: cobre o data center pegar fogo, não cobre a conta
ser suspensa nem um script apagar a coleção errada.

## Retenção

14 diários, 8 semanais (domingo), 12 mensais (último dia do mês). A regra está
em `manterBackup()`, com testes, e quem a APLICA é:

```bash
npm run backup:podar            # só mostra o que faria
npm run backup:podar -- --aplicar
```

O modo padrão não apaga nada. Uma retenção que ninguém executa não é
política, é comentário: o diretório cresce até acabar o disco, e aí alguém
apaga tudo às pressas — inclusive o mensal de seis meses atrás, que era o
único que cobria a perda silenciosa.

A data sai do `resumo.json`, ou do nome do diretório como plano B — nunca do
mtime, que muda quando alguém copia a pasta. Pelo mtime, copiar o diretório
inteiro faria todos os dumps parecerem de hoje e a poda pararia de funcionar.
Diretório sem data legível nunca é apagado.

O raciocínio: a perda que a retenção precisa cobrir não é a que se descobre no
mesmo dia — essa o backup de ontem resolve. É a silenciosa. Um custo médio
corrompido por importação errada só aparece quando alguém estranha a margem, e
isso leva semanas. Os 12 mensais existem pra poder voltar a um mês fechado
depois de descobrir tarde.

## Ensaio de restauração — no emulador, sem projeto nenhum

**Este é o caminho normal.** Roda na sua máquina, não cria projeto na conta,
não custa nada e não tem como escrever no lugar errado.

```bash
npx -y firebase-tools@latest emulators:start --only firestore --project zxp-ensaio-restauracao
```

Com o emulador no ar, em outro terminal:

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8199 node scripts/restore-firestore.mjs --dump ./backups/<dump> --projeto zxp-ensaio-restauracao
```

Com `FIRESTORE_EMULATOR_HOST` definida, o script NÃO pede credencial — o
emulador não usa nenhuma, e pedir uma chave privada pra não usar seria pedir
um segredo à toa. A porta 8199 está em `firebase.json`.

`firebase-tools` não é dependência do projeto de propósito: ele traz cinco
advisories moderadas que poluiriam o `npm audit` por uma ferramenta usada
uma vez a cada poucos meses. O `npx -y` baixa na hora.

### O app em cima do restaurado

Com o Firestore E o Auth no emulador, da pra abrir o app apontado pra la e
conferir na tela — sem projeto novo, sem credencial de producao:

```bash
npx -y firebase-tools@latest emulators:start --only firestore,auth --project vazxpress-a2350
```

Restaure o dump, crie um usuario no emulador de Auth com um e-mail que exista
em `controleAcesso` e acrescente ao `.env.local`:

```
NEXT_PUBLIC_FIREBASE_EMULADOR=127.0.0.1:8199,127.0.0.1:9299
NEXT_PUBLIC_FIREBASE_PROJECT_ID=vazxpress-a2350
```

Uma barra dourada no topo avisa que a tela e emulador. **Tire as duas linhas
do `.env.local` quando terminar** — uma sessao apontada pro emulador que
parece producao e como alguem conclui que os dados sumiram.

O que o ensaio NAO devolve: a conexao com o Mercado Livre. Estoque no Full,
vendas e Ads ficam zerados ate a autorizacao OAuth ser refeita. Numa
restauracao de verdade, esse e o passo seguinte — e o app diz `unauthorized`
no topo enquanto isso.

### Executado em 16/09/2026

Dump de produção (230 documentos, 15 coleções) restaurado no emulador e
conferido CAMPO A CAMPO contra o dump: **230 idênticos, 0 divergentes**. O
custo médio do primeiro produto voltou 46,7765 — o mesmo valor lido da
produção antes do dump.

O que isso prova: o dump é gravável, os tipos voltam, os caminhos existem, os
lotes passam. O que **não** prova: que o app funciona em cima do resultado.
Pra isso ainda falta o ensaio num projeto de verdade, abaixo.

## Ensaio num projeto de verdade

**Backup que nunca foi restaurado não é backup, é arquivo.** Faça o ensaio num
projeto Firebase separado e descartável — nunca sobre a produção.

```bash
node scripts/restore-firestore.mjs --dump ./backups/<dump> --conferir
```

Lista o conteúdo sem escrever nada. Depois, com as credenciais do projeto de
destino no ambiente:

```bash
node scripts/restore-firestore.mjs --dump ./backups/<dump> --projeto zxp-restore-teste
```

A ordem de restauração começa por `controleAcesso` e `controleAcessoMeta`. Não
é preferência: sem elas ninguém entra no app pra conferir se a restauração deu
certo, e uma restauração que termina com o dono do lado de fora não terminou.

`ml_oauth_transacoes` nunca volta — restaurar state de OAuth já usado é pior
que perdê-lo.

### O ensaio só termina quando

Contagem de documentos certa **não** prova que o conteúdo voltou certo. Abra o
app apontando pro projeto restaurado e confira à mão:

1. Você consegue entrar (prova que `controleAcesso` voltou).
2. O custo médio de um produto que você sabe de cor está certo (prova que
   número e faixa de vigência sobreviveram ao round-trip).
3. Uma data aparece como data, não como `{_seconds: …}` (prova que os
   `Timestamp` foram reconstruídos).
4. A DRE de um mês fechado dá o mesmo número de antes.

Anote a data do último ensaio bem-sucedido. Um ensaio com mais de seis meses
vale quase o mesmo que nenhum.

## Restaurar sobre a produção

Só em perda real, e o script não facilita: exige `--confirmar-producao` **e**
digitar o nome do projeto na hora. Uma flag pode estar no histórico do shell;
digitar o nome é um ato deliberado do momento.

Antes de fazer isso, rode um backup do estado atual — mesmo corrompido. O
estado ruim de agora pode conter o que foi cadastrado depois do dump, e essa é
a única cópia dele.
