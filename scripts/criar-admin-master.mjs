#!/usr/bin/env node
/**
 * Marca um e-mail como ADMIN MASTER do SaaS (`saas_admins/{email}`).
 *
 * ─── POR QUE ISTO SÓ EXISTE COMO SCRIPT ─────────────────────────────────
 *
 * `saas_admins` tem `allow write: if false` no firestore.rules.saas — nem o
 * próprio master consegue escrever ali pelo app. É de propósito: este é o
 * documento que define quem manda no SaaS inteiro, e uma tela que o edita é
 * uma tela que, comprometida, entrega o negócio.
 *
 * Master NÃO é o mesmo que "owner" de um tenant. Owner é dono de UMA loja;
 * master é dono do negócio, vê todas as licenças e cria contas. A confusão
 * entre os dois é justamente o que o modelo novo desfez (ver
 * lib/domain/tenant.ts) — por isso coleção separada, e não um campo `role`.
 *
 * ─── USO ────────────────────────────────────────────────────────────────
 *
 *   node scripts/criar-admin-master.mjs --email=voce@dominio.com
 *   node scripts/criar-admin-master.mjs --email=voce@dominio.com --apply
 */

import admin from "firebase-admin";
import { carregarCredencial } from "./_lib/credencial.mjs";

const arg = (n) => {
  const p = process.argv.find((a) => a.startsWith(`--${n}=`));
  return p ? p.slice(n.length + 3) : "";
};

const EMAIL = arg("email").trim().toLowerCase();
const APLICAR = process.argv.includes("--apply");

if (!EMAIL) {
  console.error("Faltou --email=<seu e-mail>.\n\n  node scripts/criar-admin-master.mjs --email=voce@dominio.com [--apply]\n");
  process.exit(1);
}

let credencial;
try {
  credencial = carregarCredencial();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(credencial) });
const db = admin.firestore();
const auth = admin.auth();

console.log(`\n${"═".repeat(66)}`);
console.log(`  ADMIN MASTER — ${APLICAR ? "GRAVANDO (--apply)" : "SIMULAÇÃO (dry-run)"}`);
console.log("═".repeat(66));
console.log(`  projeto : ${credencial.projectId}  (via ${credencial.origem})`);
console.log(`  e-mail  : ${EMAIL}\n`);

/**
 * A regra do Firestore compara com o e-mail do Auth. Um master gravado num
 * e-mail que não existe no Authentication nunca satisfaz a regra — falha
 * silenciosa e difícil de ligar à causa. Melhor recusar aqui.
 */
let usuario;
try {
  usuario = await auth.getUserByEmail(EMAIL);
} catch {
  console.error(
    `  Não existe usuário no Firebase Auth com o e-mail "${EMAIL}".\n\n` +
    "  A regra do Firestore compara com o e-mail autenticado, então um master\n" +
    "  gravado num e-mail sem conta nunca teria efeito. Confira em\n" +
    "  scripts/descobrir-owner.mjs quais e-mails existem.\n",
  );
  process.exit(1);
}

console.log(`  usuário encontrado: uid ${usuario.uid}`);

const ja = await db.collection("saas_admins").doc(EMAIL).get();
if (ja.exists) console.log("  ⚠ já é admin master — o comando só atualiza o registro.\n");
else console.log("  ainda NÃO é admin master.\n");

console.log("─".repeat(66));
if (!APLICAR) {
  console.log(`\n  NADA FOI GRAVADO.\n\n  node scripts/criar-admin-master.mjs --email=${EMAIL} --apply\n`);
} else {
  await db.collection("saas_admins").doc(EMAIL).set(
    { email: EMAIL, uid: usuario.uid, criadoEm: Date.now() },
    { merge: true },
  );
  console.log(`\n  ✓ ${EMAIL} agora é admin master do SaaS.\n`);
  console.log("  Isso NÃO mexe no acesso dele a nenhuma loja — master e owner são");
  console.log("  papéis separados, de propósito.\n");
}
console.log("─".repeat(66) + "\n");
process.exit(0);
