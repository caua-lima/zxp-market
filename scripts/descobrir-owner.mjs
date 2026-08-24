#!/usr/bin/env node
/**
 * Descobre o `--owner` (uid do Firebase Auth) da migração, e já monta o
 * comando pronto pra copiar.
 *
 * ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────
 *
 * A migração exige o uid do Firebase Auth, e a instrução era "pegue no
 * Console → Authentication → coluna Identificador do usuário". Passo manual,
 * fora do terminal, e com um jeito silencioso de dar errado: colar o e-mail
 * no lugar do uid, ou o uid de outra conta. O `--owner` decide de quem é a
 * operação inteira — errar ali cria o tenant no dono errado.
 *
 * Usa a mesma credencial do app (.env.local) — dá pra perguntar direto ao
 * Firebase quem existe, sem depender de arquivo solto na raiz.
 *
 * SOMENTE LEITURA. Não escreve nada, em lugar nenhum.
 *
 * ─── USO ────────────────────────────────────────────────────────────────
 *
 *   node scripts/descobrir-owner.mjs
 *   node scripts/descobrir-owner.mjs --tenant=vazxpress
 */

import admin from "firebase-admin";
import { carregarCredencial } from "./_lib/credencial.mjs";

function arg(nome) {
  const p = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return p ? p.slice(nome.length + 3) : "";
}

const TENANT = arg("tenant") || "vazxpress";

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

/**
 * Quem tem acesso hoje. `controleAcesso` é a fonte do app single-tenant: o
 * dono está lá, e é dele que o tenant precisa nascer.
 */
async function acessosAtuais() {
  try {
    const snap = await db.collection("controleAcesso").get();
    return snap.docs.map((d) => ({ email: d.id, papel: String(d.data()?.papel ?? d.data()?.role ?? "") }));
  } catch {
    return [];
  }
}

const [usuarios, acessos] = await Promise.all([
  auth.listUsers(200).then((r) => r.users),
  acessosAtuais(),
]);

if (usuarios.length === 0) {
  console.error("Nenhum usuário no Firebase Auth deste projeto. A chave aponta pro projeto certo?");
  process.exit(1);
}

const papelDe = (email) => acessos.find((a) => a.email?.toLowerCase() === String(email).toLowerCase())?.papel ?? "";

console.log(`\nProjeto Firebase: ${credencial.projectId}  (via ${credencial.origem})`);
console.log(`Usuários no Authentication: ${usuarios.length}\n`);

const linhas = usuarios.map((u) => ({
  uid: u.uid,
  email: u.email ?? "(sem e-mail)",
  papel: papelDe(u.email),
  ultimoLogin: u.metadata?.lastSignInTime ? new Date(u.metadata.lastSignInTime).toLocaleString("pt-BR") : "nunca",
}));

// Owner primeiro: é ele que a migração quer.
linhas.sort((a, b) => (b.papel === "owner" ? 1 : 0) - (a.papel === "owner" ? 1 : 0));

for (const l of linhas) {
  const marca = l.papel === "owner" ? " ← OWNER" : l.papel ? ` (${l.papel})` : "";
  console.log(`  ${l.email}${marca}`);
  console.log(`    uid: ${l.uid}`);
  console.log(`    último login: ${l.ultimoLogin}\n`);
}

const dono = linhas.find((l) => l.papel === "owner") ?? linhas[0];

console.log("─".repeat(72));
if (!linhas.some((l) => l.papel === "owner")) {
  console.log(
    "\nNenhum usuário marcado como 'owner' em controleAcesso — usei o primeiro\n" +
    "da lista. CONFIRA se o e-mail abaixo é mesmo o seu antes de rodar.\n",
  );
}
console.log("\n1) Simulação (não escreve nada, só mostra o que faria):\n");
console.log(`node scripts/migrar-para-tenant.mjs --tenant=${TENANT} --owner=${dono.uid} --email=${dono.email}`);
console.log("\n2) Só depois de conferir a simulação, para valer:\n");
console.log(`node scripts/migrar-para-tenant.mjs --tenant=${TENANT} --owner=${dono.uid} --email=${dono.email} --apply`);
console.log("\n" + "─".repeat(72));
console.log(
  "\nA migração NÃO apaga as coleções de hoje — elas continuam intactas.\n" +
  "É o plano de rollback: a main segue lendo o banco de sempre.\n",
);

process.exit(0);
