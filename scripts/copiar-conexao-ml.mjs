#!/usr/bin/env node
/**
 * Copia a conexão do Mercado Livre de `ml_tokens/main` (single-tenant) para
 * `ml_conexoes/{tenantId}` (multi-tenant).
 *
 * ─── POR QUE COPIAR EM VEZ DE RECONECTAR PELO APP ───────────────────────
 *
 * A migração deixa este passo de fora de propósito: o doc carrega o
 * `refresh_token`, e mexer nele merece cuidado próprio. O caminho óbvio seria
 * "entra no app e conecta o Mercado Livre de novo" — e é justamente o que NÃO
 * se deve fazer aqui.
 *
 * Autorizar de novo emite um par de tokens novo, e o Mercado Livre pode
 * invalidar o `refresh_token` anterior nesse momento. Esse token anterior é o
 * que a `main` usa em produção: perdê-lo derruba o dashboard que está no ar,
 * que é exatamente o risco que a migração inteira foi desenhada pra não
 * correr.
 *
 * Copiar não emite nada e não fala com o Mercado Livre. Os dois lados passam a
 * apontar pro MESMO refresh_token, e o que continuar rodando o renova
 * normalmente.
 *
 * ─── AS MESMAS GARANTIAS DA MIGRAÇÃO ────────────────────────────────────
 *
 * 1. DRY-RUN POR PADRÃO. Sem `--apply` não escreve nada.
 * 2. NUNCA APAGA A ORIGEM. `ml_tokens/main` fica intacto — é o rollback.
 * 3. NUNCA IMPRIME TOKEN. Só diz se cada campo existe e o tamanho dele.
 *
 * ─── USO ────────────────────────────────────────────────────────────────
 *
 *   node scripts/copiar-conexao-ml.mjs --tenant=vazxpress
 *   node scripts/copiar-conexao-ml.mjs --tenant=vazxpress --apply
 */

import admin from "firebase-admin";
import { carregarCredencial } from "./_lib/credencial.mjs";

function arg(nome) {
  const p = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return p ? p.slice(nome.length + 3) : "";
}

const TENANT = arg("tenant");
const APLICAR = process.argv.includes("--apply");

if (!TENANT) {
  console.error("Faltou --tenant=<id>.\n\n  node scripts/copiar-conexao-ml.mjs --tenant=vazxpress [--apply]\n");
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

/** Descreve um campo sensível SEM revelar o valor. */
const descrever = (v) =>
  v == null || v === "" ? "AUSENTE" : `presente (${String(v).length} caracteres)`;

const linha = "─".repeat(66);
console.log(`\n${"═".repeat(66)}`);
console.log(`  CONEXÃO DO MERCADO LIVRE — ${APLICAR ? "GRAVANDO DE VERDADE (--apply)" : "SIMULAÇÃO (dry-run)"}`);
console.log("═".repeat(66));
console.log(`  projeto : ${credencial.projectId}  (via ${credencial.origem})`);
console.log(`  origem  : ml_tokens/main`);
console.log(`  destino : ml_conexoes/${TENANT}\n`);

const origem = await db.collection("ml_tokens").doc("main").get();
if (!origem.exists) {
  console.error("  ml_tokens/main não existe. Nada a copiar — conecte o Mercado Livre pelo app.\n");
  process.exit(1);
}

const d = origem.data() ?? {};
const sellerId = d.seller_id ?? d.user_id ?? null;

console.log("  O que a origem tem:");
console.log(`    access_token  : ${descrever(d.access_token)}`);
console.log(`    refresh_token : ${descrever(d.refresh_token)}`);
console.log(`    expires_in    : ${d.expires_in ?? "AUSENTE"}`);
console.log(`    updated_at    : ${d.updated_at ?? "AUSENTE"}`);
console.log(`    seller_id     : ${sellerId ?? "AUSENTE"}  (vem de user_id no formato antigo)\n`);

if (!d.refresh_token) {
  console.error("  Sem refresh_token na origem — copiar não adiantaria: o token de acesso\n  expira em horas e não há como renovar. Reconecte o ML pelo app.\n");
  process.exit(1);
}
if (!sellerId) {
  console.error("  Sem seller_id/user_id na origem. O tenant não saberia de qual conta do\n  Mercado Livre os pedidos vêm, e o webhook não conseguiria se achar.\n");
  process.exit(1);
}

const destino = await db.collection("ml_conexoes").doc(TENANT).get();
if (destino.exists) {
  console.log(`  ⚠ ml_conexoes/${TENANT} já existe e será sobrescrito.\n`);
}

const doc = {
  access_token: d.access_token ?? null,
  refresh_token: d.refresh_token,
  expires_in: d.expires_in ?? null,
  updated_at: d.updated_at ?? new Date().toISOString(),
  seller_id: String(sellerId),
  copiadoDe: "ml_tokens/main",
  copiadoEm: Date.now(),
};

console.log(linha);
if (!APLICAR) {
  console.log(`\n  NADA FOI GRAVADO. Confira os campos acima e rode de novo com --apply.\n`);
  console.log(`  node scripts/copiar-conexao-ml.mjs --tenant=${TENANT} --apply\n`);
} else {
  await db.collection("ml_conexoes").doc(TENANT).set(doc, { merge: true });
  console.log(`\n  ✓ ml_conexoes/${TENANT} gravado.\n`);
  console.log("  ml_tokens/main NÃO foi tocado — a main segue conectada normalmente.");
  console.log("  Os dois apontam pro mesmo refresh_token; quem rodar o renova.\n");
}
console.log(linha + "\n");
process.exit(0);
