#!/usr/bin/env node
/**
 * Lista os providers de login (google.com, password, etc.) de um e-mail no
 * Firebase Auth — diagnóstico pontual pra descobrir por que o e-mail de
 * redefinição de senha não chega: sendPasswordResetEmail só manda algo se
 * existir provider "password" pra aquele e-mail.
 *
 *   node scripts/checar-providers.mjs --email=voce@dominio.com
 */

import admin from "firebase-admin";
import { carregarCredencial } from "./_lib/credencial.mjs";

const arg = (n) => {
  const p = process.argv.find((a) => a.startsWith(`--${n}=`));
  return p ? p.slice(n.length + 3) : "";
};

const EMAIL = arg("email").trim().toLowerCase();
if (!EMAIL) {
  console.error("Faltou --email=<e-mail>.\n\n  node scripts/checar-providers.mjs --email=voce@dominio.com\n");
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
const auth = admin.auth();

try {
  const user = await auth.getUserByEmail(EMAIL);
  console.log(`UID: ${user.uid}`);
  console.log(`E-mail verificado: ${user.emailVerified}`);
  console.log(`Desabilitado: ${user.disabled}`);
  console.log("Providers:");
  for (const p of user.providerData) {
    console.log(`  - ${p.providerId} (${p.email ?? "sem e-mail"})`);
  }
  const temSenha = user.providerData.some((p) => p.providerId === "password");
  console.log(`\nTem provider "password": ${temSenha ? "SIM" : "NÃO"}`);
  if (!temSenha) {
    console.log("→ É por isso que o e-mail de redefinição não chega: sem conta de senha, o Firebase não manda nada (silenciosamente, pra não revelar contas).");
  }
} catch (err) {
  if (err.code === "auth/user-not-found") {
    console.log(`Nenhuma conta no Firebase Auth com o e-mail ${EMAIL}.`);
  } else {
    console.error("Erro:", err.message);
  }
}
