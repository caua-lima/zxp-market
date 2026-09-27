#!/usr/bin/env node
/**
 * Cria uma empresa nova com o seu dono — o cadastro do segundo cliente.
 * Regra em lib/domain/nova-empresa.ts. Só faz sentido com o app no modo empresa
 * (NEXT_PUBLIC_ZXP_MODO_DADOS=tenant) — ver docs/saas/OPERACAO.md, parte D.
 *
 *   # ver o que seria criado (não escreve)
 *   node --env-file=.env.producao scripts/criar-empresa.mjs --tenant-id loja-joao --nome "Loja do João" --dono joao@loja.com
 *   # criar de verdade (pede pra digitar o nome do projeto)
 *   node --env-file=.env.producao scripts/criar-empresa.mjs --tenant-id loja-joao --nome "Loja do João" --dono joao@loja.com --aplicar --confirmar-producao
 */
import readline from "node:readline";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { avaliarDestino, explicarDestino } from "../lib/domain/backup-inventario.ts";
import { planoDeNovaEmpresa } from "../lib/domain/nova-empresa.ts";

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : ""; };
const flag = (n) => args.includes(`--${n}`);

const pedido = { tenantId: opt("tenant-id"), nome: opt("nome"), dono: opt("dono") };
const emulador = process.env.FIRESTORE_EMULATOR_HOST;
const projeto = process.env.FIREBASE_PROJECT_ID;
if (emulador) initializeApp({ projectId: projeto ?? "zxp-ensaio" });
else {
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY ?? "").replace(/\n/g, "\n");
  if (!clientEmail || !privateKey || !projeto) {
    console.error("Faltam FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL e FIREBASE_PRIVATE_KEY. Veja docs/saas/OPERACAO.md.");
    process.exit(1);
  }
  initializeApp({ credential: cert({ projectId: projeto, clientEmail, privateKey }) });
}
const db = getFirestore();

const dono = pedido.dono.trim().toLowerCase();
const [empresa, ponteiro] = await Promise.all([
  pedido.tenantId ? db.doc(`tenants/${pedido.tenantId.trim()}`).get() : null,
  dono ? db.doc(`memberships/${dono}`).get() : null,
]);
const plano = planoDeNovaEmpresa(pedido, {
  empresaExiste: Boolean(empresa?.exists),
  empresaDoDono: ponteiro?.data()?.tenantId ?? null,
});
if (!plano.ok) {
  console.error("Não dá pra criar:");
  for (const p of plano.problemas) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("Seria criado:");
for (const e of plano.escritas) console.log(`  ${e.caminho}`);
if (!flag("aplicar")) {
  console.log("\nNada foi escrito. Repita com --aplicar --confirmar-producao pra criar.");
  process.exit(0);
}
const decisao = avaliarDestino({ projetoDeOrigem: projeto, projetoDeDestino: projeto, confirmouProducao: flag("confirmar-producao"), emulador: !!emulador });
console.log(`\n${explicarDestino(decisao.motivo)}`);
if (!decisao.permitido) process.exit(1);
if (decisao.motivo === "producao_confirmada") {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const r = await new Promise((ok) => rl.question(`Digite o nome do projeto pra confirmar (${projeto}): `, (a) => { rl.close(); ok(a.trim()); }));
  if (r !== projeto) { console.error("Nome não confere. Nada foi escrito."); process.exit(1); }
}
const lote = db.batch();
for (const e of plano.escritas) lote.set(db.doc(e.caminho), e.dados);
await lote.commit();
console.log(`\nEmpresa ${pedido.tenantId} criada. ${dono} já pode entrar no app, conectar o Mercado Livre (botão Conectar) e convidar o time pela tela de Acesso.`);
