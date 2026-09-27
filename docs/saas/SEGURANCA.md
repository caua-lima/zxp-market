# Segurança — operação por cliente (S27)

O que o código já garante, e o que é política/configuração fora do código.
Os passos que dependem de você estão marcados **[você]** e repetidos em
`OPERACAO.md`.

## O que o código garante

| Tema | Onde | O que faz |
|---|---|---|
| Isolamento por empresa | `lib/api-auth.ts`, `lib/firebase/contexto-tenant.ts`, regras geradas | Cada requisição entra na empresa do membro; o dado de outra empresa não é alcançável nem pelo servidor (caminho traduzido por requisição) nem pelo navegador (regras). |
| Token do ML | `tenants/{id}/connections/main` | Regra trancada: nem o dono lê pelo navegador. Só o servidor. Refresh coordenado (S05). |
| Logs | `lib/log.ts` | Uma linha JSON por evento, com `tenantId` e `requisicao` (x-vercel-id). Redige pelo nome do campo (token, senha, e-mail, telefone, endereço, documento, nome…) e pelo formato do valor (Bearer, JWT, chave PEM, `APP_USR-…`, `whsec_…`, e-mail no meio de mensagem). |
| Diagnóstico | `lib/diagnostico.ts` + `app/api/ml/debug*` | Só quem administra; cada acesso fica registrado em `acessos_diagnostico` da empresa ANTES de rodar (sem registro, 503); a resposta sai sem dado pessoal. `/api/ml/debug` devolvia o `/users/me` inteiro e o começo do token — agora só id/apelido/site/nível. |
| Cabeçalhos | `lib/config/cabecalhos.ts` → `next.config.ts` | nosniff, `X-Frame-Options: DENY`, referrer, permissões (câmera/microfone/localização/pagamento desligados), COOP que mantém o popup do Google, HSTS (2 anos). |
| CSP | idem, `Content-Security-Policy-Report-Only` | Modo relatório: não bloqueia nada, avisa em `/api/csp-report` (vai pro log como `csp.violacao`, só diretiva, origem bloqueada e caminho da página). |
| Configuração | `lib/config/ambiente.ts` + `instrumentation.ts` | Na subida: variável ausente, projetos Firebase diferentes entre servidor e navegador, chave malformada, CRON_SECRET curto, emulador em produção. Só nomes no log. |
| Segredos | `.env.example` | Inventário sem valores, conferido por teste. Nenhum segredo no repositório nem no CI. |

## Ligar a CSP pra valer (depois de ver os relatórios)

1. **[você]** Depois do deploy, deixe o app rodando alguns dias com uso normal
   (login com Google, push, instalação como app no celular).
2. Na Vercel → projeto → **Logs**, filtre por `csp.violacao`. Cada linha diz a
   diretiva e a origem que seria bloqueada.
3. Se aparecer uma origem legítima (ex.: um domínio do Google que faltou), ela
   entra em `lib/config/cabecalhos.ts` — é uma linha.
4. Sem violações legítimas por uma semana: trocar a chave
   `Content-Security-Policy-Report-Only` por `Content-Security-Policy` no mesmo
   arquivo. Isso é mudança de código (commit), não de painel.

Tirar o `'unsafe-inline'` de `script-src` exige nonce por requisição
(middleware do Next). Fica pra depois da CSP bloqueando sem quebrar nada.

## Menor privilégio (IAM) — [você]

A chave do servidor (`FIREBASE_CLIENT_EMAIL`) hoje é a conta de serviço padrão
do Firebase Admin, que pode TUDO no projeto. O app precisa só de:

- **Cloud Datastore User** (`roles/datastore.user`) — ler e gravar o Firestore;
- **Firebase Authentication Admin** (`roles/firebaseauth.admin`) — criar login do time, verificar token;
- **Firebase Cloud Messaging API Admin** (`roles/firebasecloudmessaging.admin`) — enviar push.

Passo a passo: Google Cloud Console → IAM → **Contas de serviço** → Criar
(`zxp-servidor`) → dar só os três papéis acima → Chaves → Adicionar chave
JSON → trocar `FIREBASE_CLIENT_EMAIL` e `FIREBASE_PRIVATE_KEY` na Vercel →
Redeploy → conferir o app → **apagar a chave antiga** da conta padrão.

Os scripts de migração/exportação rodam da SUA máquina com uma chave à parte
(`OPERACAO.md` C1), que você apaga no fim.

## Segredos, rotação e revogação

| Segredo | Onde | Rotação | Revogação imediata |
|---|---|---|---|
| Token do ML (por empresa) | Firestore, `connections/main` | Automática (refresh) | Desconectar na tela, ou revogar o app em Mercado Livre → Segurança → Aplicativos |
| `ML_SECRET` | Vercel | Painel de Developers do ML → regenerar → Vercel → Redeploy | Idem (todos os tokens morrem junto) |
| `FIREBASE_PRIVATE_KEY` | Vercel | Nova chave na conta de serviço → Vercel → Redeploy → apagar a antiga | Apagar a chave no Cloud Console |
| `CRON_SECRET` | Vercel + GitHub | Gerar outro, cadastrar nos dois | Idem |
| Chaves do Stripe (S25) | Vercel | Dashboard do Stripe → Developers → API keys → Roll | Idem |

**Criptografia do token do ML na aplicação**: avaliado e **não** feito agora.
O Firestore já criptografa em repouso; o risco real é alguém com a chave do
servidor, e essa pessoa também teria a chave de decifrar (ela estaria na mesma
Vercel). Passa a valer quando houver um KMS separado (Cloud KMS) com papel
próprio — registrar como decisão se o modelo de ameaça mudar (ex.: suporte com
acesso de leitura ao banco).

## Acesso de suporte — política

Hoje não existe "entrar como o cliente". O suporte a uma empresa segue isto:

1. Pedido por escrito do **dono** da empresa (e-mail ou chamado), com o motivo.
2. O dono adiciona o e-mail de suporte como **membro** (tela de Acesso), com
   só as abas necessárias. Nunca como dono.
3. Cada rota de diagnóstico aberta fica registrada em `acessos_diagnostico`
   (quem, qual rota, quando) — é a trilha.
4. Terminado o atendimento, o dono (ou o suporte) remove o membro. Prazo
   máximo: 7 dias; passou disso, remover e pedir de novo.
5. O suporte nunca pede senha, token do ML nem código de verificação.

Registro que expira: `acessos_diagnostico.apagarEm` (1 ano). **[você]** Ligar
a política de TTL uma vez (Console do Firestore → **TTL** → Criar política →
grupo de coleções `acessos_diagnostico`, campo `apagarEm`).

## Incidente — o que fazer

1. **Conter**: revogar o segredo exposto (tabela acima). Suspeita de acesso
   indevido a uma empresa: remover o membro e desconectar o ML dela.
2. **Medir**: logs da Vercel filtrados por `tenantId`; `acessos_diagnostico`;
   `auditLog` da empresa.
3. **Comunicar**: LGPD art. 48 — incidente com risco relevante aos titulares
   é comunicado à ANPD e aos titulares em prazo razoável (a ANPD orienta 3 dias
   úteis). O texto e a decisão passam pela revisão jurídica.
4. **Registrar**: o que aconteceu, quando, quem foi afetado e o que mudou.

Canal: e-mail de contato de segurança publicado nos termos (a definir — [você]).
