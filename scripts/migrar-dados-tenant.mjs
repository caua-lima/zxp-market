#!/usr/bin/env node
/**
 * Etapa 5 — copia o DADO DE NEGÓCIO da raiz pro tenant (estoque, custos,
 * metas, pedidos, tarefas, notificações...) e confere. A regra de cada coleção
 * mora em lib/domain/migracao-dados.ts, com teste.
 *
 * ─── O QUE ELE NÃO FAZ ───────────────────────────────────────────────────
 *
 *  - Não apaga nada na raiz. A raiz é o rollback, e é de onde o app lê até a
 *    chave ZXP_MODO_DADOS virar "tenant".
 *  - Não roda antes da primeira fatia: exige tenants/{id} criado por
 *    scripts/migrar-tenant-legado.mjs.
 *
 * ─── USO ─────────────────────────────────────────────────────────────────
 *
 *   # ensaio no emulador (nada sai da máquina)
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8199 FIREBASE_PROJECT_ID=zxp-ensaio node scripts/migrar-dados-tenant.mjs --tenant-id vazxpress --aplicar
 *
 *   # só contar o que seria copiado, sem escrever (serve contra produção)
 *   node --env-file=.env.producao scripts/migrar-dados-tenant.mjs --tenant-id vazxpress
 *
 *   # copiar de verdade em produção — pede --confirmar-producao E digitar o projeto
 *   node --env-file=.env.producao scripts/migrar-dados-tenant.mjs --tenant-id vazxpress --aplicar --confirmar-producao
 *
 *   # só conferir origem × destino (não escreve)
 *   node --env-file=.env.producao scripts/migrar-dados-tenant.mjs --tenant-id vazxpress --conferir
 */
import fs from "node:fs";
import readline from "node:readline";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { avaliarDestino, explicarDestino } from "../lib/domain/backup-inventario.ts";
import { conferirMigracao, migrarDados } from "../lib/domain/migracao-dados.ts";

const args = process.argv.slice(2);
const opt = (n, p) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : p; };
const flag = (n) => args.includes(`--${n}`);

const tenantId = opt("tenant-id");
const aplicar = flag("aplicar");
const soConferir = flag("conferir");
if (!tenantId) {
  console.error("Informe --tenant-id <id> (ex.: vazxpress).");
  process.exit(1);
}

const emulador = process.env.FIRESTORE_EMULATOR_HOST;
const projeto = process.env.FIREBASE_PROJECT_ID;
if (emulador) {
  console.log(`EMULADOR: ${emulador} — nada sai desta máquina.`);
  initializeApp({ projectId: projeto ?? "zxp-ensaio" });
} else {
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");
  if (!clientEmail || !privateKey || !projeto) {
    console.error("Faltam FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL e FIREBASE_PRIVATE_KEY (as credenciais do projeto de PRODUÇÃO). Veja docs/saas/MIGRACAO.md.");
    process.exit(1);
  }
  initializeApp({ credential: cert({ projectId: projeto, clientEmail, privateKey }) });
  let padrao = null;
  try { padrao = JSON.parse(fs.readFileSync(".firebaserc", "utf8"))?.projects?.default ?? null; } catch { /* sem .firebaserc */ }
  if (padrao && projeto !== padrao) {
    console.log(`\n⚠ ATENÇÃO: o projeto é "${projeto}", mas a produção (.firebaserc) é "${padrao}". Este NÃO é o dado da operação real.`);
  }
}
const db = getFirestore();

if (soConferir) {
  const d = await conferirMigracao(db, tenantId);
  if (d.length === 0) {
    console.log("\nConferência: origem e destino batem, documento a documento.");
    process.exit(0);
  }
  for (const x of d) {
    console.log(`\n${x.colecao}: ${x.soNaOrigem.length} só na origem, ${x.soNoDestino.length} só no destino`);
    for (const c of x.soNaOrigem.slice(0, 10)) console.log(`  falta copiar: ${c}`);
  }
  process.exit(1);
}

if (aplicar) {
  const decisao = avaliarDestino({
    projetoDeOrigem: projeto,
    projetoDeDestino: projeto, // copia dentro do MESMO projeto (raiz → tenants/...)
    confirmouProducao: flag("confirmar-producao"),
    emulador: !!emulador,
  });
  console.log(`\n${explicarDestino(decisao.motivo)}`);
  if (!decisao.permitido) process.exit(1);
  if (decisao.motivo === "producao_confirmada") {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const resposta = await new Promise((r) =>
      rl.question(`Digite o nome do projeto pra confirmar a cópia em produção (${projeto}): `, (a) => { rl.close(); r(a.trim()); }));
    if (resposta !== projeto) {
      console.error("Nome não confere. Nada foi escrito.");
      process.exit(1);
    }
  }
}

console.log(`\n${aplicar ? "Copiando" : "Contando (ensaio, nada é escrito)"} — tenant "${tenantId}":`);
const resultado = await migrarDados(db, { tenantId, aplicar, log: (l) => console.log(`  ${l}`) });
const total = resultado.reduce((s, r) => s + r.lidos, 0);
console.log(`\n${total} documento(s) ${aplicar ? "copiados" : "seriam copiados"}.`);

if (!aplicar) {
  console.log("Nada foi escrito. Repita com --aplicar pra copiar.");
  process.exit(0);
}

const divergencias = await conferirMigracao(db, tenantId);
if (divergencias.length > 0) {
  console.error("\nA conferência encontrou diferença — NÃO vire a chave ainda:");
  for (const x of divergencias) console.error(`  ${x.colecao}: ${x.soNaOrigem.length} só na origem`);
  process.exit(1);
}
console.log("\nConferência: origem e destino batem, documento a documento. A raiz continua intacta (é o rollback).");
