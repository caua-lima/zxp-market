#!/usr/bin/env node
/**
 * Etapa 4 — saúde de TODAS as empresas numa tabela (só leitura).
 * Mesma avaliação da tela do dono (lib/domain/saude.ts).
 *
 *   node --env-file=.env.producao scripts/saude-das-empresas.mjs
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8199 FIREBASE_PROJECT_ID=zxp-ensaio node scripts/saude-das-empresas.mjs
 *
 * Não lê venda nem dado pessoal: só carimbos e contagens.
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { avaliarSaude, diasAte, nivelGeral } from "../lib/domain/saude.ts";

const emulador = process.env.FIRESTORE_EMULATOR_HOST;
const projeto = process.env.FIREBASE_PROJECT_ID;
if (emulador) initializeApp({ projectId: projeto ?? "zxp-ensaio" });
else {
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY ?? "").replace(/\n/g, "\n");
  if (!clientEmail || !privateKey || !projeto) {
    console.error("Faltam FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL e FIREBASE_PRIVATE_KEY. Veja docs/saas/OPERACAO.md (C1).");
    process.exit(1);
  }
  initializeApp({ credential: cert({ projectId: projeto, clientEmail, privateKey }) });
}
const db = getFirestore();
const agora = Date.now();
const dias = diasAte(agora, 7);
const conta = (q) => q.count().get().then((s) => s.data().count).catch(() => 0);

const empresas = await db.collection("tenants").listDocuments();
if (empresas.length === 0) console.log("Nenhuma empresa em tenants/ (modo raiz ainda?).");
const SIMBOLO = { ok: "✓", atencao: "!", falha: "✕" };

for (const e of empresas) {
  const base = `tenants/${e.id}`;
  const [dados, cron, worker, conexao, pend, falhas, entregas, contadores] = await Promise.all([
    e.get(),
    db.doc(`${base}/cron_estado/ultima_execucao`).get(),
    db.doc(`${base}/cron_estado/worker`).get(),
    db.doc(`${base}/connections/main`).get(),
    conta(db.collection(`${base}/ml_webhook_inbox`).where("estado", "==", "pendente")),
    conta(db.collection(`${base}/ml_webhook_inbox`).where("estado", "==", "falhou")),
    conta(db.collection(`${base}/notification_entregas`).where("estado", "==", "pendente")),
    db.getAll(...dias.map((d) => db.doc(`${base}/cron_estado/ml_saude_${d}`))),
  ]);
  const soma = (c) => contadores.reduce((s, d) => s + Number(d.data()?.[c] ?? 0), 0);
  const c = conexao.data() ?? {};
  const itens = avaliarSaude({
    agora,
    cronEm: cron.data()?.em ?? null,
    workerEm: worker.data()?.em ?? null,
    mlConectado: Boolean(c.refresh_token || c.access_token),
    inboxPendentes: pend,
    inboxFalhas: falhas,
    entregasPendentes: entregas,
    ml429: soma("s429"),
    ml5xx: soma("s5xx"),
    mlTimeouts: soma("timeouts"),
    bloqueada: Boolean(dados.data()?.bloqueio),
  });
  const geral = nivelGeral(itens);
  console.log(`\n${SIMBOLO[geral]} ${e.id} — ${dados.data()?.name ?? "(sem nome)"} · ${dados.data()?.assinatura?.estado ?? "interna"}`);
  for (const i of itens.filter((x) => x.nivel !== "ok")) console.log(`   ${SIMBOLO[i.nivel]} ${i.titulo}: ${i.texto}`);
}
process.exit(0);
