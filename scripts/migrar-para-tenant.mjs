#!/usr/bin/env node
/**
 * Migração single-tenant → multi-tenant.
 *
 * Copia as coleções globais de hoje (estoque/, custos/, ml_orders/…) para
 * dentro de `tenants/{tenantId}/`, e cria o vínculo (`tenant_membros/{uid}`)
 * e a licença (`licencas/{email}`) do dono.
 *
 * ─── AS TRÊS GARANTIAS ──────────────────────────────────────────────────
 *
 * 1. DRY-RUN POR PADRÃO. Sem `--apply`, não escreve NADA — só conta e mostra
 *    o que faria. Migração de dado é irreversível na prática; ver antes é
 *    barato, descobrir depois não é.
 *
 * 2. NUNCA APAGA A ORIGEM. As coleções globais continuam exatamente onde
 *    estão, intactas. Isso é o plano de rollback: se algo der errado, a
 *    `main` continua lendo o banco de sempre, sem nada pra restaurar.
 *
 * 3. IDEMPOTENTE. O id de cada documento é preservado, então rodar de novo
 *    reescreve por cima do mesmo doc em vez de duplicar. Interrompeu no
 *    meio? Roda de novo e completa.
 *
 * ─── USO ────────────────────────────────────────────────────────────────
 *
 *   node scripts/migrar-para-tenant.mjs --tenant=vazxpress --owner=SEU_UID --email=voce@dominio.com
 *   node scripts/migrar-para-tenant.mjs --tenant=vazxpress --owner=SEU_UID --email=voce@dominio.com --apply
 *
 * O `--owner` é o uid do Firebase Auth (Console → Authentication → coluna
 * "Identificador do usuário"), NÃO o e-mail. É ele que o app usa pra
 * descobrir o tenant no login.
 *
 * Usa a mesma credencial do app (.env.local), com serviceAccountKey.json
 * como fallback — ver scripts/_lib/credencial.mjs.
 */

import admin from "firebase-admin";
import { carregarCredencial } from "./_lib/credencial.mjs";

/**
 * Coleções que são DADO DA OPERAÇÃO e vão para dentro do tenant.
 * Espelha os sCol/sDoc de lib/firebase/data.ts + o que o Admin SDK escreve
 * (ml_orders, ml_returns, snapshots_diarios, notification_events).
 */
const COLECOES = [
  "estoque",
  "estoque_movimentos",
  "custos",
  "metas",
  "metasHistorico",
  "tarefas",
  "full_remessas",
  "ads_alteracoes",
  "alertasDispensados",
  "auditLog",
  "rascunho",
  "dias",
  "financeiro_manual",
  "notification_events",
  "snapshots_diarios",
  "pushTokens",
  "ml_orders",
  "ml_returns",
];

/**
 * NÃO migram, e cada uma por um motivo diferente:
 *
 *   controleAcesso      vira tenant_membros (formato novo) — este script cria
 *   controleAcessoMeta  bootstrap do modelo antigo, sem uso no novo
 *   ml_tokens           vira ml_conexoes/{tenantId} — feito à parte, porque
 *                       carrega refresh_token e merece passo próprio
 *   usuarios/{uid}/…    preferência é da PESSOA, não da operação: segue o
 *                       usuário entre tenants, então continua fora
 *   backups_semanais    backup do estado antigo; copiar seria backup de backup
 */
const NAO_MIGRAM = ["controleAcesso", "controleAcessoMeta", "ml_tokens", "usuarios", "backups_semanais"];

function arg(nome) {
  const p = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return p ? p.slice(nome.length + 3) : null;
}

const tenantId = arg("tenant");
const ownerUid = arg("owner");
const ownerEmail = (arg("email") || "").toLowerCase();
const APLICAR = process.argv.includes("--apply");

if (!tenantId || !ownerUid || !ownerEmail) {
  console.error(`
Faltou argumento.

  node scripts/migrar-para-tenant.mjs --tenant=<id> --owner=<uid> --email=<email> [--apply]

  --tenant  id do tenant a criar (ex.: vazxpress). Vira tenants/<id>/…
  --owner   uid do Firebase Auth do dono (Console → Authentication)
  --email   e-mail do dono, para a licença
  --apply   grava de verdade. SEM ele, só mostra o que faria.
`);
  process.exit(1);
}

if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(tenantId)) {
  console.error(`tenantId inválido: "${tenantId}". Use minúsculas, números e hífen (2-49 chars).`);
  process.exit(1);
}

/**
 * Placeholder não substituído é o erro mais fácil de cometer aqui — copiar o
 * comando do README e trocar só o e-mail, esquecendo o uid. E é dos piores:
 * cria o vínculo num uid que não existe, o login real não resolve tenant
 * nenhum, e o app falha em TODA leitura sem dizer por quê. A primeira versão
 * deste script aceitava `SEU_UID` calado.
 */
const PLACEHOLDERS = ["seu_uid", "seu-uid", "uid", "<uid>", "meu_uid", "xxx", "todo", "changeme"];
if (PLACEHOLDERS.includes(ownerUid.toLowerCase())) {
  console.error(`
--owner ainda está com o texto de exemplo: "${ownerUid}"

Troque pelo SEU uid do Firebase Auth:
  Firebase Console → Authentication → coluna "Identificador do usuário"

É o uid, não o e-mail — é por ele que o app descobre o tenant no login.
`);
  process.exit(1);
}

// uid do Firebase tem 28 caracteres alfanuméricos. Não travo no 28 exato
// (contas federadas variam), mas algo com espaço ou 6 caracteres não é uid.
if (!/^[A-Za-z0-9_-]{16,128}$/.test(ownerUid)) {
  console.error(`--owner não parece um uid do Firebase: "${ownerUid}"`);
  console.error(`Esperado: 16+ caracteres alfanuméricos, sem espaço. Veja em Authentication → "Identificador do usuário".`);
  process.exit(1);
}

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
  console.error(`--email inválido: "${ownerEmail}"`);
  process.exit(1);
}

let credencial;
try {
  credencial = carregarCredencial();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
console.log(`projeto : ${credencial.projectId}  (via ${credencial.origem})\n`);
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(credencial) });
}
const db = admin.firestore();

const fmt = (n) => String(n).padStart(6, " ");

async function main() {
  console.log("");
  console.log("═".repeat(66));
  console.log(APLICAR ? "  MIGRAÇÃO — GRAVANDO DE VERDADE (--apply)" : "  MIGRAÇÃO — SIMULAÇÃO (dry-run, nada será gravado)");
  console.log("═".repeat(66));
  console.log(`  projeto : ${serviceAccount.project_id}`);
  console.log(`  tenant  : tenants/${tenantId}`);
  console.log(`  dono    : ${ownerEmail}  (uid ${ownerUid})`);
  console.log("");

  // Já migrado? Avisa mas não impede — o script é idempotente de propósito.
  const jaExiste = (await db.collection("tenants").doc(tenantId).get()).exists;
  if (jaExiste) {
    console.log(`  ⚠ tenants/${tenantId} já existe. Rodar de novo reescreve por cima`);
    console.log(`    dos mesmos ids (não duplica). Útil pra completar migração interrompida.`);
    console.log("");
  }

  let totalDocs = 0;
  let totalColecoes = 0;
  const vazias = [];

  for (const nome of COLECOES) {
    /**
     * No dry-run, CONTA em vez de ler.
     *
     * `.get()` traria todo documento das 18 coleções — ml_orders sozinha tem
     * milhares — e cada um é uma leitura cobrada. Este app já esgotou a cota
     * de leitura duas vezes (ver lib/firebase/cache.ts); uma simulação que
     * derruba o dashboard do dia seria um jeito bem ruim de "não mexer em
     * nada". A agregação count() cobra ~1 leitura por 1000 documentos.
     */
    if (!APLICAR) {
      const { count } = (await db.collection(nome).count().get()).data();
      if (count === 0) { vazias.push(nome); continue; }
      totalColecoes++;
      totalDocs += count;
      console.log(`  ${fmt(count)} docs  ${nome}  →  tenants/${tenantId}/${nome}`);
      continue;
    }

    const snap = await db.collection(nome).get();
    if (snap.empty) { vazias.push(nome); continue; }

    totalColecoes++;
    totalDocs += snap.size;
    console.log(`  ${fmt(snap.size)} docs  ${nome}  →  tenants/${tenantId}/${nome}`);

    // Lotes de 450: writeBatch aceita 500, a folga cobre o commit final.
    let batch = db.batch();
    let pendentes = 0;
    for (const doc of snap.docs) {
      batch.set(db.collection("tenants").doc(tenantId).collection(nome).doc(doc.id), doc.data());
      if (++pendentes >= 450) { await batch.commit(); batch = db.batch(); pendentes = 0; }
    }
    if (pendentes > 0) await batch.commit();
  }

  if (vazias.length) {
    console.log("");
    console.log(`  (vazias, nada a copiar: ${vazias.join(", ")})`);
  }

  // ── Vínculo e licença do dono ──────────────────────────────────
  console.log("");
  console.log("  Além das coleções:");
  console.log(`         1 doc   tenants/${tenantId}                (o tenant)`);
  console.log(`         1 doc   tenant_membros/${ownerUid}  (vínculo, papel owner)`);
  console.log(`         1 doc   licencas/${ownerEmail}      (ativa, sem prazo)`);

  if (APLICAR) {
    await db.collection("tenants").doc(tenantId).set({
      id: tenantId, nome: tenantId, criadoPor: ownerUid, criadoEm: Date.now(),
    }, { merge: true });

    await db.collection("tenant_membros").doc(ownerUid).set({
      tenantId, email: ownerEmail, papel: "owner", adicionadoEm: Date.now(), adicionadoPor: "migracao",
    }, { merge: true });

    // Sem prazo: é o dono. Cliente pagante recebe expiresAt no onboarding.
    await db.collection("licencas").doc(ownerEmail).set({
      email: ownerEmail, status: "ativo", expiresAt: null, nota: "dono — criada pela migração",
    }, { merge: true });
  }

  console.log("");
  console.log("─".repeat(66));
  console.log(`  ${totalDocs} documentos em ${totalColecoes} coleções${APLICAR ? " copiados" : " seriam copiados"}.`);
  console.log("");
  console.log(`  As coleções ORIGINAIS não são tocadas — continuam onde estão.`);
  console.log(`  É o plano de rollback: a main segue lendo o banco de sempre.`);
  console.log("");
  console.log(`  Não migram (cada uma por um motivo, ver o topo do script):`);
  console.log(`    ${NAO_MIGRAM.join(", ")}`);

  if (!APLICAR) {
    console.log("");
    console.log("  ⚠ NADA FOI GRAVADO. Confira os números acima e, se estiver certo,");
    console.log("    rode de novo com --apply no fim.");
  } else {
    console.log("");
    console.log("  ✓ Migração aplicada.");
    console.log("");
    console.log("  Falta ainda, à parte: conectar o Mercado Livre pelo app pra criar");
    console.log(`  ml_conexoes/${tenantId} (ml_tokens/main não é copiado de propósito —`);
    console.log("  carrega refresh_token e merece passo próprio).");
  }
  console.log("─".repeat(66));
  console.log("");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("");
  console.error("Falhou:", e.message);
  console.error("");
  console.error("Nada além do que já foi commitado em lote antes do erro foi gravado.");
  console.error("As coleções originais seguem intactas. Rodar de novo é seguro.");
  process.exit(1);
});
