#!/usr/bin/env node
/**
 * Migra `controleAcesso` — a operação atual, single-tenant — pro primeiro
 * tenant do modelo novo (S01/Etapa 5). Só MEMBERSHIP: cria `tenants/{id}`,
 * `tenants/{id}/members/{email}` por linha de `controleAcesso`, e o ponteiro
 * `memberships/{email}`. NÃO toca em `estoque`, `custos`, `metas` nem
 * nenhuma outra coleção de dado de negócio — essa migração vem depois,
 * DEPOIS que esta primeira etapa estiver rodada e conferida (mesma lição de
 * `ORDEM_DE_RESTAURACAO`: sem tenant e membro migrados, não há autorização
 * pra proteger o resto).
 *
 * ─── DRY-RUN POR PADRÃO ──────────────────────────────────────────────────
 *
 * Sem `--aplicar`, só MOSTRA o plano — nenhuma escrita acontece. É o modo
 * pra rodar contra produção sem medo: lê `controleAcesso` de verdade, mostra
 * exatamente o que seria criado, e para aí.
 *
 * ─── IDEMPOTENTE ─────────────────────────────────────────────────────────
 *
 * Toda escrita é `set()` com o e-mail como parte do caminho — rodar duas
 * vezes com o mesmo `controleAcesso` produz o mesmo resultado, não duplica
 * nem corrompe. Corrigir e rodar de novo é seguro.
 *
 * ─── USO ─────────────────────────────────────────────────────────────────
 *
 *   # ensaio no emulador (o caminho normal — nada sai da máquina)
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8199 node scripts/migrar-tenant-legado.mjs --tenant-id vazxpress --nome "VAZXPRESS" --aplicar
 *
 *   # só mostrar o plano, sem escrever nada (funciona contra produção também)
 *   node scripts/migrar-tenant-legado.mjs --tenant-id vazxpress --nome "VAZXPRESS"
 *
 *   # aplicar de verdade em produção — exige --confirmar-producao E digitar o projeto
 *   node scripts/migrar-tenant-legado.mjs --tenant-id vazxpress --nome "VAZXPRESS" --aplicar --confirmar-producao
 *
 *   # controleAcesso com mais de um owner (o caso da produção): escolha qual
 *   node scripts/migrar-tenant-legado.mjs --tenant-id vazxpress --nome "VAZXPRESS" --owner dono@exemplo.com
 */
import fs from "node:fs";
import readline from "node:readline";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { avaliarDestino, explicarDestino } from "../lib/domain/backup-inventario.ts";
import { planoDeMigracaoDeMembros, validarPlano } from "../lib/domain/migracao-tenant.ts";
import { caminhoConexao, caminhoMembership, caminhoMembro, caminhoTenant } from "../lib/domain/tenant.ts";

const args = process.argv.slice(2);
const opt = (n, p) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : p; };
const flag = (n) => args.includes(`--${n}`);

const tenantId = opt("tenant-id");
const nomeDoTenant = opt("nome", tenantId);
const owner = opt("owner", null);
const aplicar = flag("aplicar");

if (!tenantId) {
  console.error("Informe --tenant-id <id> (ex.: vazxpress) e --nome \"Nome da empresa\".");
  process.exit(1);
}

const emulador = process.env.FIRESTORE_EMULATOR_HOST;
const projeto = process.env.FIREBASE_PROJECT_ID;

if (emulador) {
  console.log(`EMULADOR: ${emulador} — nada sai desta máquina.`);
  initializeApp({ projectId: projeto });
} else {
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");
  if (!clientEmail || !privateKey || !projeto) {
    console.error("Faltam FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL e FIREBASE_PRIVATE_KEY. Pra ensaiar sem credencial, suba o emulador e defina FIRESTORE_EMULATOR_HOST.");
    process.exit(1);
  }
  initializeApp({ credential: cert({ projectId: projeto, clientEmail, privateKey }) });
}
const db = getFirestore();

/**
 * O projeto que as credenciais apontam NÃO é necessariamente a produção.
 * Em 23/09/2026 o .env.local deste repositório apontava pra
 * `controleml-saas`, e a produção é o default do .firebaserc
 * (`vazxpress-a2350`). Uma simulação contra o projeto errado mostra um
 * plano de 1 membro que parece "dado faltando" — o aviso existe pra isso
 * nunca ser lido como a operação real.
 */
if (!emulador) {
  let padrao = null;
  try { padrao = JSON.parse(fs.readFileSync(".firebaserc", "utf8"))?.projects?.default ?? null; } catch { /* sem .firebaserc */ }
  if (padrao && projeto !== padrao) {
    console.log(
      `\n⚠ ATENÇÃO: lendo o projeto "${projeto}", mas a produção (.firebaserc) é "${padrao}".` +
      "\n  Este plano NÃO é o da operação real. Confira FIREBASE_PROJECT_ID e as credenciais antes de concluir qualquer coisa.",
    );
  }
}

console.log(`\nLendo controleAcesso de ${projeto ?? "(projeto do emulador)"}...`);
const snap = await db.collection("controleAcesso").get();
const acessos = snap.docs.map((d) => d.data());

const plano = planoDeMigracaoDeMembros(acessos, { tenantId, nomeDoTenant, owner });
const problemas = validarPlano(plano);

console.log(`\nPlano — tenant "${plano.tenantId}" (${plano.tenant.name}):`);
for (const m of plano.membros) {
  const nota = plano.rebaixados.includes(m.email) ? "   ← era owner em controleAcesso, vira partner" : "";
  console.log(`  ${m.email} → ${m.role}${m.permissoesEdicao ? ` (permissoesEdicao: ${m.permissoesEdicao.join(",")})` : ""}${nota}`);
}
console.log(`\n${plano.membros.length} membro(s) seriam migrados.`);
if (plano.rebaixados.length > 0) {
  console.log(`${plano.rebaixados.length} owner(s) de controleAcesso viram partner no tenant (entram, mas não administram time, conexão nem cobrança).`);
}

if (problemas.length > 0) {
  console.error("\nO plano tem problema(s) e NÃO deve ser aplicado:");
  for (const p of problemas) console.error(`  - ${p}`);
  process.exit(1);
}

if (!aplicar) {
  console.log("\nNada foi escrito (modo padrão é só mostrar o plano). Repita com --aplicar pra gravar.");
  process.exit(0);
}

const decisao = avaliarDestino({
  projetoDeOrigem: projeto,
  projetoDeDestino: projeto, // esta migração sempre escreve no MESMO projeto de onde leu — não é um restore pra outro lugar.
  confirmouProducao: flag("confirmar-producao"),
  emulador: !!emulador,
});
console.log(`\n${explicarDestino(decisao.motivo)}`);
if (!decisao.permitido) process.exit(1);

if (decisao.motivo === "producao_confirmada") {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const resposta = await new Promise((r) =>
    rl.question(`Digite o nome do projeto pra confirmar a escrita em produção (${projeto}): `, (a) => { rl.close(); r(a.trim()); }));
  if (resposta !== projeto) {
    console.error("Nome não confere. Nada foi escrito.");
    process.exit(1);
  }
}

const lote = db.batch();
lote.set(db.doc(caminhoTenant(plano.tenantId)), plano.tenant);
for (const m of plano.membros) {
  lote.set(db.doc(caminhoMembro(plano.tenantId, m.email)), m);
}
for (const p of plano.memberships) {
  lote.set(db.doc(caminhoMembership(p.email)), p);
}
await lote.commit();

console.log(`\n${1 + plano.membros.length + plano.memberships.length} documento(s) gravados em ${projeto ?? "(emulador)"}.`);
console.log(
  [
    "",
    "O que este passo NÃO fez, de propósito:",
    `  - Não criou nenhuma conexão ML (${caminhoConexao(plano.tenantId, "<id>")}) — isso é a próxima etapa, depois de confirmar que login/autorização funcionam com o tenant.`,
    "  - Não tocou em estoque, custos, metas nem nenhuma outra coleção de dado de negócio.",
    "  - Não mudou nada em controleAcesso — o app legado continua funcionando exatamente como antes até o corte de verdade acontecer.",
    "",
    "Confira: rode este mesmo comando de novo (sem --aplicar) e confirme que o plano bate com o que foi gravado.",
  ].join("\n"),
);
