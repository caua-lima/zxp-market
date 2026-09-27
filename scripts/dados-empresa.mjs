#!/usr/bin/env node
/**
 * S27 (LGPD) — exportar ou apagar os dados de uma EMPRESA ou de uma PESSOA.
 * A lógica mora em lib/domain/dados-da-empresa.ts (testada no emulador).
 *
 * ─── USO ─────────────────────────────────────────────────────────────────
 *
 *   # exportar (só lê; grava um JSON em ./exportacoes, que o git ignora)
 *   node --env-file=.env.producao scripts/dados-empresa.mjs exportar-empresa --tenant-id cliente-x
 *   node --env-file=.env.producao scripts/dados-empresa.mjs exportar-pessoa --email pessoa@exemplo.com
 *
 *   # apagar — sem --aplicar é ENSAIO: mostra o que sairia e não escreve nada
 *   node --env-file=.env.producao scripts/dados-empresa.mjs excluir-empresa --tenant-id cliente-x
 *   node --env-file=.env.producao scripts/dados-empresa.mjs excluir-pessoa --email pessoa@exemplo.com
 *
 *   # apagar de verdade em produção: --aplicar --confirmar-producao, e digitar o id/e-mail de novo
 *   node --env-file=.env.producao scripts/dados-empresa.mjs excluir-empresa --tenant-id cliente-x --aplicar --confirmar-producao
 *   # pessoa: --apagar-login também remove o login dela no Firebase Auth
 *
 * NÃO apaga a raiz legada (rollback da migração) nem os backups semanais —
 * isso vai na resposta ao titular (docs/saas/PRIVACIDADE.md).
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { excluirEmpresa, excluirPessoa, exportarEmpresa, exportarPessoa } from "../lib/domain/dados-da-empresa.ts";

const [comando, ...args] = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : undefined; };
const flag = (n) => args.includes(`--${n}`);

const COMANDOS = ["exportar-empresa", "excluir-empresa", "exportar-pessoa", "excluir-pessoa"];
if (!COMANDOS.includes(comando)) {
  console.error(`Comando: ${COMANDOS.join(" | ")}. Veja o cabeçalho deste arquivo.`);
  process.exit(1);
}
const tenantId = opt("tenant-id");
const email = opt("email")?.trim().toLowerCase();
if (comando.endsWith("empresa") && !/^[a-z0-9-]{2,60}$/.test(tenantId ?? "")) {
  console.error("Informe --tenant-id <id> (minúsculas, números e hífen).");
  process.exit(1);
}
if (comando.endsWith("pessoa") && !email?.includes("@")) {
  console.error("Informe --email <e-mail da pessoa>.");
  process.exit(1);
}

const emulador = process.env.FIRESTORE_EMULATOR_HOST;
const projeto = process.env.FIREBASE_PROJECT_ID;
if (emulador) {
  console.log(`EMULADOR: ${emulador} — nada sai desta máquina.`);
  initializeApp({ projectId: projeto ?? "zxp-ensaio" });
} else {
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY ?? "").replace(/\n/g, "\n");
  if (!clientEmail || !privateKey || !projeto) {
    console.error("Faltam FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL e FIREBASE_PRIVATE_KEY. Veja docs/saas/OPERACAO.md (C1).");
    process.exit(1);
  }
  initializeApp({ credential: cert({ projectId: projeto, clientEmail, privateKey }) });
}
const db = getFirestore();
console.log(`Projeto: ${projeto ?? "(emulador)"}`);

async function uidDe(e) {
  try { return (await getAuth().getUserByEmail(e)).uid; } catch { return undefined; }
}

function salvar(nome, docs) {
  fs.mkdirSync("exportacoes", { recursive: true });
  const arquivo = path.join("exportacoes", `${nome}-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(arquivo, JSON.stringify({ geradoEm: new Date().toISOString(), documentos: docs }, null, 2));
  console.log(`${docs.length} documento(s) → ${arquivo}`);
  console.log("Esse arquivo tem dado pessoal: entregue por canal seguro e apague a cópia local depois.");
}

async function confirmar(alvo) {
  if (emulador) return;
  if (!flag("confirmar-producao")) {
    console.error("Em produção, apagar exige --confirmar-producao. Nada foi apagado.");
    process.exit(1);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const r = await new Promise((ok) => rl.question(`Isto APAGA de vez em ${projeto}. Digite "${alvo}" pra confirmar: `, (a) => { rl.close(); ok(a.trim()); }));
  if (r !== alvo) {
    console.error("Não confere. Nada foi apagado.");
    process.exit(1);
  }
}

const aplicar = flag("aplicar");

if (comando === "exportar-empresa") {
  salvar(`empresa-${tenantId}`, await exportarEmpresa(db, tenantId));
} else if (comando === "exportar-pessoa") {
  salvar(`pessoa-${email.replace(/[^a-z0-9]/g, "_")}`, await exportarPessoa(db, email, await uidDe(email)));
} else if (comando === "excluir-empresa") {
  const ensaio = await excluirEmpresa(db, tenantId, { aplicar: false });
  console.log(`\nEmpresa ${tenantId}: ${ensaio.documentosDaEmpresa} documento(s); ${ensaio.vinculosDePessoas.length} pessoa(s) perdem o acesso; vendedor(es) do ML: ${ensaio.vendedoresIndexados.join(", ") || "nenhum"}.`);
  if (!aplicar) { console.log("ENSAIO — nada foi apagado. Exporte antes (exportar-empresa) e repita com --aplicar."); process.exit(0); }
  await confirmar(tenantId);
  await excluirEmpresa(db, tenantId, { aplicar: true });
  console.log("Apagado. Os logins das pessoas continuam existindo (sem empresa); apague com excluir-pessoa se pedirem.");
} else {
  const uid = await uidDe(email);
  const ensaio = await excluirPessoa(db, email, { uid, aplicar: false });
  if (ensaio.recusado) {
    console.error(`Recusado: ${email} é dono(a) de ${ensaio.empresas.join(", ")}. Passe a empresa pra outra pessoa na tela de Acesso (ou apague a empresa) antes.`);
    process.exit(1);
  }
  console.log(`\n${email}:${ensaio.documentos.map((d) => `\n  ${d}`).join("") || " nenhum documento"}${uid ? `\n  login (Auth) uid ${uid}${flag("apagar-login") ? " — será apagado" : " — mantido (use --apagar-login)"}` : ""}`);
  if (!aplicar) { console.log("\nENSAIO — nada foi apagado. Repita com --aplicar."); process.exit(0); }
  await confirmar(email);
  await excluirPessoa(db, email, { uid, aplicar: true });
  if (uid && flag("apagar-login")) await getAuth().deleteUser(uid);
  console.log("Apagado.");
}
process.exit(0);
