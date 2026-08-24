#!/usr/bin/env node
/**
 * Completa a migração de `controleAcesso` (legado, global) pra `tenant_membros`
 * (novo, por tenant) — pra quem ficou de fora da migração original.
 *
 * ─── POR QUE ISTO É NECESSÁRIO ───────────────────────────────────────────
 *
 * A migração multi-tenant trouxe o OWNER (caualm4@gmail.com) pra
 * `tenant_membros`, mas não os colaboradores adicionados depois — eles
 * continuam só em `controleAcesso`. Isso não bloqueava a UI (que até agora só
 * lia controleAcesso), mas bloqueia TODA rota `/api/ml/*`: ela resolve o
 * tenant exclusivamente por `tenant_membros` (ver lib/tenant.ts,
 * resolverTenantDaRequisicao). Sem essa migração, um colaborador legado loga
 * normalmente e vê a tela, mas nenhum dado do Mercado Livre carrega — 403
 * silencioso em cada chamada.
 *
 * Todo e-mail em `controleAcesso` pertence à operação original (era a única
 * que existia antes do modelo multi-tenant) — por isso o tenant de destino é
 * sempre "vazxpress", sem precisar perguntar.
 *
 * ─── USO ────────────────────────────────────────────────────────────────
 *
 *   node scripts/migrar-colaboradores-legado.mjs
 *   node scripts/migrar-colaboradores-legado.mjs --apply
 */

import admin from "firebase-admin";
import { carregarCredencial } from "./_lib/credencial.mjs";

const TENANT_LEGADO = "vazxpress";

const APLICAR = process.argv.includes("--apply");

let credencial;
try {
  credencial = carregarCredencial();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

console.log(`projeto : ${credencial.projectId}  (via ${credencial.origem})\n`);
admin.initializeApp({ credential: admin.credential.cert(credencial) });
const db = admin.firestore();
const auth = admin.auth();

const papelDoRole = (role) => (role === "owner" ? "owner" : "colaborador");

const acesso = await db.collection("controleAcesso").get();
const pendentes = [];

for (const doc of acesso.docs) {
  const d = doc.data();
  const email = String(d.email ?? doc.id).toLowerCase();

  let usuario;
  try {
    usuario = await auth.getUserByEmail(email);
  } catch {
    console.log(`  ⚠ ${email}: sem conta no Firebase Auth, pulando.`);
    continue;
  }

  const membro = await db.collection("tenant_membros").doc(usuario.uid).get();
  if (membro.exists) continue; // já migrado

  pendentes.push({
    uid: usuario.uid,
    email,
    papel: papelDoRole(d.role),
    permissoesEdicao: Array.isArray(d.permissoesEdicao) ? d.permissoesEdicao : undefined,
  });
}

if (pendentes.length === 0) {
  console.log("Nada pendente — todo mundo em controleAcesso já está em tenant_membros.");
  process.exit(0);
}

console.log(`${APLICAR ? "Aplicando" : "[dry-run] Migraria"} ${pendentes.length} colaborador(es) para tenant_membros/{uid}, tenant "${TENANT_LEGADO}":\n`);
for (const p of pendentes) {
  console.log(`  ${p.email} → papel=${p.papel}${p.permissoesEdicao ? `, permissoesEdicao=${JSON.stringify(p.permissoesEdicao)}` : ""} (uid ${p.uid})`);
}

if (!APLICAR) {
  console.log("\nRode com --apply para gravar de verdade.");
  process.exit(0);
}

for (const p of pendentes) {
  await db.collection("tenant_membros").doc(p.uid).set({
    tenantId: TENANT_LEGADO,
    email: p.email,
    papel: p.papel,
    ...(p.permissoesEdicao ? { permissoesEdicao: p.permissoesEdicao } : {}),
    adicionadoEm: Date.now(),
    adicionadoPor: "migracao-colaboradores-legado",
  });
  console.log(`  ✓ ${p.email} migrado.`);
}

console.log("\nPronto.");
