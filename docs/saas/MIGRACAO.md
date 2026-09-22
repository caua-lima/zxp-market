# Migração pro modelo multi-tenant

O que existe até aqui é a **primeira fatia**: migrar `controleAcesso` (quem
entra, com que papel) pro modelo novo (`tenants/{id}`, `tenants/{id}/members`,
`memberships`). **Não migra dado de negócio** (estoque, custos, metas, tarefas,
pedidos) — essa é uma etapa separada, ainda não escrita, que só faz sentido
depois desta primeira estar rodada e conferida em produção.

## Por que membership primeiro, sozinho

Mesma lição de `ORDEM_DE_RESTAURACAO` em `lib/domain/backup-inventario.ts`
(`controleAcesso` volta primeiro num restore, senão ninguém entra pra conferir
o resto): sem tenant e membro migrados e **verificados**, não há autorização
pra proteger nenhum dado de negócio. Migrar tudo de uma vez multiplicaria o
raio de um erro pelo tamanho do banco inteiro.

## O script

`scripts/migrar-tenant-legado.mjs` — lê `controleAcesso`, monta o plano (via
`lib/domain/migracao-tenant.ts`, puro e testado: `npx vitest run
lib/domain/migracao-tenant.test.ts`), e só escreve com `--aplicar`.

```bash
# 1. Ver o plano, sem escrever nada — funciona até contra produção, é só leitura
node scripts/migrar-tenant-legado.mjs --tenant-id vazxpress --nome "VAZXPRESS"

# 2. Ensaiar no emulador (o caminho normal)
npx -y firebase-tools@latest emulators:start --only firestore --project zxp-ensaio-tenant
# noutro terminal:
FIRESTORE_EMULATOR_HOST=127.0.0.1:8199 FIREBASE_PROJECT_ID=zxp-ensaio-tenant \
  node scripts/migrar-tenant-legado.mjs --tenant-id vazxpress --nome "VAZXPRESS" --aplicar

# 3. Aplicar em produção — só depois do ensaio, e só com confirmação explícita
node scripts/migrar-tenant-legado.mjs --tenant-id vazxpress --nome "VAZXPRESS" --aplicar --confirmar-producao
```

O que a etapa 3 pede antes de escrever: `--confirmar-producao` **e** digitar o
nome do projeto quando o script perguntar — mesmo padrão de
`scripts/restore-firestore.mjs`, pela mesma razão (uma flag pode estar no
histórico do shell; digitar o nome é um ato deliberado do momento).

## O que o script garante

- **Idempotente.** Toda escrita é `set()` com o e-mail no caminho do
  documento — rodar de novo com o mesmo `controleAcesso` produz o mesmo
  resultado, nunca duplica. Corrigir e repetir é seguro.
- **Não toca em `controleAcesso`.** O app legado continua funcionando
  exatamente como antes até o corte de verdade (trocar a fonte de
  autorização) acontecer — que é um passo futuro, separado.
- **Não cria conexão ML.** `tenants/{id}/connections/*` fica pra depois de
  confirmar que login/autorização funcionam com o tenant migrado.
- **Recusa aplicar um plano ruim.** `validarPlano` (mesmo módulo) barra: zero
  membro, zero owner, mais de um owner, e-mail duplicado — antes de qualquer
  escrita.

## Ensaio executado nesta sessão

Contra o emulador Firestore (`zxp-teste-migracao`, projeto isolado, nenhum
dado real), com `controleAcesso` sintético (3 registros: 1 owner, 1
colaborador com `permissoesEdicao`, 1 member):

1. **Dry-run** — mostrou o plano certo (papel mapeado corretamente: `owner`→
   `owner`, `colaborador` legado → `partner` com as permissões preservadas,
   `member` → `member`) e confirmou que nada foi escrito.
2. **Aplicado** — 7 documentos gravados (1 `tenants/vazxpress` + 3
   `tenants/vazxpress/members/*` + 3 `memberships/*`).
3. **Reaplicado** — mesmo resultado, mesma contagem, sem duplicata.
4. **Conferido** lendo direto do Firestore: os 3 membros e os 3 ponteiros
   batem exatamente com o plano do passo 1.

## O que isto NÃO prova (pendente)

- **Que `requireTenantAccess` resolve um USUÁRIO DE VERDADE** contra este
  dado — a função tem 7 casos de teste unitário (mock do Admin SDK) e a
  *forma* do dado que o script grava bate exatamente com o que ela lê, mas
  não houve um login de verdade (Auth emulator + ID token real) contra este
  tenant migrado nesta sessão.
- **Rodar contra produção.** Nada nesta sessão escreveu no projeto Firebase
  real (`vazxpress-a2350`) — só no emulador. Rodar de verdade exige decisão
  explícita separada (ver `docs/saas/PROGRESSO.md`).
- **A migração de dado de negócio** (estoque, custos, metas, pedidos,
  tarefas) — ainda nem desenhada.
- **O corte** (trocar `requireAccess`/`controleAcesso` por
  `requireTenantAccess`/o modelo novo nas rotas que já existem) — isso é
  reescrever a autorização de toda rota do app, um projeto à parte.

## Rollback

Nada nesta etapa precisa de rollback de dado: o script só ADICIONA
(`tenants/*`, `members`, `memberships`), nunca apaga nem modifica
`controleAcesso` ou qualquer coleção existente. Desfazer é apagar
manualmente o documento do tenant e suas subcoleções — o app legado nunca
percebe, porque nada nele lê esses caminhos ainda.
