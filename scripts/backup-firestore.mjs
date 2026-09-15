#!/usr/bin/env node
/**
 * Exporta o Firestore pra arquivos locais, uma coleção por linha de JSONL.
 *
 * ─── POR QUE NÃO O EXPORT NATIVO DO FIREBASE ─────────────────────────────
 *
 * `gcloud firestore export` grava num bucket do MESMO projeto do Google
 * Cloud. Isso cobre o data center pegar fogo e não cobre o cenário provável:
 * a conta ser suspensa, a chave vazar, ou um script apagar a coleção errada —
 * em todos eles o bucket vai junto. Um backup que morre com o original não é
 * backup, é redundância.
 *
 * Este script grava onde quem roda mandar: disco local, pendrive, outro
 * provedor. O formato é JSONL simples e legível — dá pra abrir com editor de
 * texto e ler o custo de um produto sem subir nada em lugar nenhum.
 *
 * ─── O QUE ELE NÃO FAZ ───────────────────────────────────────────────────
 *
 * Não escreve nada no Firestore. Este processo só lê. Restaurar é o outro
 * script, de propósito: o comando que destrói não pode ser o mesmo que o
 * comando que salva, ou uma flag errada vira perda de dados.
 *
 * ─── USO ─────────────────────────────────────────────────────────────────
 *
 *   node scripts/backup-firestore.mjs --saida ./backups
 *
 * Variáveis: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 * (as mesmas do app — leia de .env.local, nunca passe em argumento: argumento
 * de linha de comando aparece na lista de processos da máquina).
 */
import fs from "node:fs";
import path from "node:path";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
// O Node 24 lê TypeScript direto, entao o inventario tem UMA definicao so —
// a mesma que o app e os testes usam. Copiar a lista pra ca seria garantir
// que backup e app discordassem na primeira colecao nova.
import { colecoesParaBackup, INVENTARIO } from "../lib/domain/backup-inventario.ts";

const args = process.argv.slice(2);
const opt = (nome, padrao) => {
  const i = args.indexOf(`--${nome}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : padrao;
};

const saida = opt("saida", "./backups");

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = (process.env.FIREBASE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");

if (!projectId || !clientEmail || !privateKey) {
  console.error(
    "Faltam as credenciais do Admin SDK.\n" +
    "Defina FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL e FIREBASE_PRIVATE_KEY no ambiente.\n" +
    "Elas são as mesmas que o app usa — carregue do .env.local, não cole aqui."
  );
  process.exit(1);
}

initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore();

/** Carimbo do backup: o nome do diretório é a data, pra retenção poder lê-la. */
const agora = new Date();
const carimbo = agora.toISOString().replace(/[:.]/g, "-").slice(0, 19);
const destino = path.join(saida, `${projectId}_${carimbo}`);
fs.mkdirSync(destino, { recursive: true });

/**
 * Serializa um documento preservando Timestamp e referência.
 *
 * O JSON puro transformaria Timestamp num objeto `{_seconds, _nanoseconds}`
 * que a restauração devolveria como mapa comum — e a data viraria um objeto
 * que nenhuma query de intervalo encontra. Marcar o tipo é o que permite
 * reconstruir na volta.
 */
function serializar(v) {
  if (v === null || v === undefined) return v;
  if (typeof v?.toDate === "function") return { __tipo: "timestamp", iso: v.toDate().toISOString() };
  if (typeof v?.path === "string" && typeof v?.id === "string") return { __tipo: "ref", path: v.path };
  if (Array.isArray(v)) return v.map(serializar);
  if (typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = serializar(x);
    return o;
  }
  return v;
}

/**
 * Exporta uma coleção, inclusive as subcoleções de cada documento.
 *
 * `usuarios` guarda as preferências em usuarios/{uid}/preferences — um export
 * que só lesse o documento raiz salvaria um documento vazio e daria a
 * impressão de ter salvado.
 */
async function exportar(nome) {
  const linhas = [];
  let docs = 0;

  async function percorrer(ref, prefixo) {
    const snap = await ref.get();
    for (const d of snap.docs) {
      linhas.push(JSON.stringify({ caminho: `${prefixo}/${d.id}`, dados: serializar(d.data()) }));
      docs += 1;
      for (const sub of await d.ref.listCollections()) {
        await percorrer(sub, `${prefixo}/${d.id}/${sub.id}`);
      }
    }
  }

  await percorrer(db.collection(nome), nome);
  fs.writeFileSync(path.join(destino, `${nome}.jsonl`), linhas.join("\n") + (linhas.length ? "\n" : ""));
  return docs;
}

const resumo = { projeto: projectId, feitoEm: agora.toISOString(), colecoes: {} };
let falhou = false;

for (const nome of colecoesParaBackup()) {
  try {
    const n = await exportar(nome);
    resumo.colecoes[nome] = n;
    console.log(`  ${nome}: ${n} documento(s)`);
  } catch (e) {
    /**
     * Uma coleção que falha NÃO derruba as outras, mas o processo termina com
     * código de erro. Um backup parcial que sai com sucesso é a pior saída
     * possível: alguém confia nele até precisar.
     */
    falhou = true;
    resumo.colecoes[nome] = { erro: String(e?.message ?? e) };
    console.error(`  ${nome}: FALHOU — ${e?.message ?? e}`);
  }
}

resumo.completo = !falhou;
fs.writeFileSync(path.join(destino, "resumo.json"), JSON.stringify(resumo, null, 2));

const vazias = Object.entries(resumo.colecoes).filter(([, n]) => n === 0).map(([k]) => k);
if (vazias.length) {
  console.log(`\nColeções vazias (pode ser normal): ${vazias.join(", ")}`);
}

const criticas = INVENTARIO.filter((i) => i.classe === "irrecuperavel").map((i) => i.colecao);
const criticasVazias = criticas.filter((c) => resumo.colecoes[c] === 0);
if (criticasVazias.includes("estoque") || criticasVazias.includes("controleAcesso")) {
  console.error(
    "\nATENÇÃO: estoque ou controleAcesso saíram vazios. Ou o projeto é outro,\n" +
    "ou as credenciais não enxergam esses dados. Não trate este dump como backup."
  );
  falhou = true;
}

console.log(`\n${falhou ? "Backup INCOMPLETO" : "Backup completo"} em ${destino}`);
process.exit(falhou ? 1 : 0);
