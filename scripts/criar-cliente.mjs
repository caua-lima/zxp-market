#!/usr/bin/env node
/**
 * Cria a conta de um cliente do SaaS.
 *
 * ─── O QUE ELE FAZ, E O QUE DEIXA PRO CLIENTE ───────────────────────────
 *
 * Cria: o usuário no Firebase Auth (com senha inicial descartável), o tenant,
 * o vínculo de owner e a licença.
 *
 * NÃO cria: a conexão com o Mercado Livre. Essa é do cliente e só ele pode
 * autorizar — ele entra no app e conecta a conta dele. É o único passo que
 * não dá pra fazer por ele, e é o desenho certo: o refresh_token do ML dá
 * acesso à conta inteira dele.
 *
 * ─── AS MESMAS GARANTIAS DOS OUTROS SCRIPTS ─────────────────────────────
 *
 * 1. DRY-RUN POR PADRÃO. Sem `--apply` não cria nada.
 * 2. RECUSA SOBRESCREVER. Tenant que já existe aborta — criar por cima da
 *    operação de um cliente é o pior erro possível aqui.
 * 3. A VALIDAÇÃO É TESTADA à parte (lib/domain/onboarding.ts), porque o
 *    tenantId vira parte do caminho de todos os dados e de todas as regras.
 *
 * ─── USO ────────────────────────────────────────────────────────────────
 *
 *   node scripts/criar-cliente.mjs --nome="Loja do João" --email=joao@loja.com
 *   node scripts/criar-cliente.mjs --nome="Loja do João" --email=joao@loja.com --dias=30 --apply
 *
 *   --tenant=  opcional; sem ele o id sai do nome ("Loja do João" → loja-do-joao)
 *   --dias=    validade da licença. Sem ele, sem prazo.
 */

import admin from "firebase-admin";
import { montarDocsCliente, normalizarTenantId, senhaInicial, validarNovoCliente } from "../lib/domain/onboarding.ts";
import { carregarCredencial } from "./_lib/credencial.mjs";

const arg = (n) => {
  const p = process.argv.find((a) => a.startsWith(`--${n}=`));
  return p ? p.slice(n.length + 3) : "";
};

const NOME = arg("nome").trim();
const EMAIL = arg("email").trim().toLowerCase();
const DIAS = Number(arg("dias") || 0);
const TENANT = (arg("tenant") || normalizarTenantId(NOME)).trim();
const CRIADO_POR = arg("por").trim().toLowerCase() || "script";
const APLICAR = process.argv.includes("--apply");

const entrada = { tenantId: TENANT, nome: NOME, email: EMAIL, diasLicenca: DIAS };
const v = validarNovoCliente(entrada);
if (!v.ok) {
  console.error("\n  Não dá pra criar a conta:\n");
  for (const e of v.erros) console.error(`    · ${e}`);
  console.error("\n  node scripts/criar-cliente.mjs --nome=\"Loja do João\" --email=joao@loja.com [--dias=30] [--tenant=id] [--apply]\n");
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
console.log(`  NOVO CLIENTE — ${APLICAR ? "CRIANDO DE VERDADE (--apply)" : "SIMULAÇÃO (dry-run)"}`);
console.log("═".repeat(66));
console.log(`  projeto : ${credencial.projectId}  (via ${credencial.origem})`);
console.log(`  operação: ${NOME}`);
console.log(`  tenant  : tenants/${TENANT}`);
console.log(`  dono    : ${EMAIL}`);
console.log(`  licença : ${DIAS > 0 ? `${DIAS} dia(s)` : "sem prazo"}\n`);

// Tenant existente aborta: criar por cima da operação de alguém é irreversível.
const jaTenant = await db.collection("tenants").doc(TENANT).get();
if (jaTenant.exists) {
  console.error(`  tenants/${TENANT} JÁ EXISTE. Recusando — criar por cima apagaria a\n  configuração de uma operação em uso. Escolha outro --tenant.\n`);
  process.exit(1);
}

let usuario = null;
try { usuario = await auth.getUserByEmail(EMAIL); } catch { /* não existe ainda */ }

if (usuario) {
  console.log(`  usuário do Auth: JÁ EXISTE (uid ${usuario.uid}) — será reaproveitado,`);
  console.log("                   e a senha atual dele NÃO é alterada.\n");
} else {
  console.log("  usuário do Auth: será criado, com senha inicial descartável\n");
}

const docs = montarDocsCliente(entrada, CRIADO_POR);

console.log("  Vai gravar:");
console.log(`    tenants/${TENANT}`);
console.log(`    licencas/${docs.licenca.email}          (ativo, ${docs.licenca.expiresAt ? new Date(docs.licenca.expiresAt).toLocaleDateString("pt-BR") : "sem prazo"})`);
console.log(`    tenant_membros/{uid}                    (papel owner)\n`);

console.log("─".repeat(66));
if (!APLICAR) {
  console.log("\n  NADA FOI CRIADO. Confira acima e rode de novo com --apply.\n");
  const t = TENANT !== normalizarTenantId(NOME) ? ` --tenant=${TENANT}` : "";
  const d = DIAS > 0 ? ` --dias=${DIAS}` : "";
  console.log(`  node scripts/criar-cliente.mjs --nome="${NOME}" --email=${EMAIL}${d}${t} --apply\n`);
  process.exit(0);
}

let senha = null;
if (!usuario) {
  senha = senhaInicial();
  usuario = await auth.createUser({ email: EMAIL, password: senha, emailVerified: false, displayName: NOME });
}

await db.collection("tenants").doc(TENANT).set(docs.tenant, { merge: true });
await db.collection("licencas").doc(docs.licenca.email).set(docs.licenca, { merge: true });
await db.collection("tenant_membros").doc(usuario.uid).set(docs.membro, { merge: true });

console.log(`\n  ✓ Conta criada. uid ${usuario.uid}\n`);
if (senha) {
  console.log("  ENTREGUE AO CLIENTE (aparece só agora, não fica salvo):");
  console.log(`    e-mail : ${EMAIL}`);
  console.log(`    senha  : ${senha}\n`);
  console.log("  Peça pra ele trocar a senha no primeiro acesso.\n");
} else {
  console.log("  O usuário já existia — ele entra com a senha que já usa.\n");
}
console.log("  Falta o cliente conectar o Mercado Livre dele pelo app. Só ele pode:");
console.log("  o token do ML dá acesso à conta inteira, e por isso não se cria por fora.\n");
console.log("─".repeat(66) + "\n");
process.exit(0);
