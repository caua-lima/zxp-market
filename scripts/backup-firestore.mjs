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
import { linhaDoDump } from "../lib/domain/backup-serie.ts";

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
 * A serialização mora em lib/domain/backup-serie.ts, com teste.
 *
 * Ela vivia aqui, e a metade de volta vivia no script de restauração — as
 * duas pontas da mesma conversa, em arquivos diferentes, sem nada
 * garantindo que combinassem. E é a parte mais provável de estar errada,
 * porque é a única que não dá pra conferir olhando o resultado: um
 * Timestamp mal serializado vira um mapa de aparência inofensiva, e o erro
 * só aparece numa restauração em que a data não filtra nada.
 */

/**
 * Exporta uma coleção, inclusive as subcoleções de cada documento.
 *
 * ─── O DOCUMENTO FANTASMA (S15 da auditoria SaaS) ───────────────────────
 *
 * `usuarios` guarda as preferências em usuarios/{uid}/preferences — mas
 * NADA no app grava o documento usuarios/{uid} EM SI, só a subcoleção
 * (`saveNotificationPreferences`, lib/firebase/data.ts). No Firestore, um
 * documento que só tem subcoleção e nenhum campo próprio NÃO EXISTE pra uma
 * query — `db.collection('usuarios').get()` devolve ZERO documentos, mesmo
 * com preferências reais gravadas por baixo. Confirmado contra o emulador:
 * `usuarios (top-level): 0 docs`, `usuarios/{uid} existe? false`, e ainda
 * assim `usuarios/{uid}/preferences/notifications` está lá.
 *
 * A varredura de cima pra baixo (`percorrer`, a partir de `snap.docs`)
 * NUNCA alcança essa subcoleção — não porque ela é rara, mas porque é a
 * ÚNICA forma como `usuarios` é escrito hoje. O backup de `usuarios` saía
 * sempre vazio, silenciosamente, pra QUALQUER quantidade de gente com
 * preferência salva.
 *
 * A saída: depois da varredura normal, uma consulta `collectionGroup` pelo
 * nome de cada subcoleção conhecida por viver sob documento fantasma
 * (`SUBCOLECOES_ORFAS`) — ela enxerga o documento mesmo sem o pai existir,
 * porque não depende de `collection.get()` no nível do pai. Filtra pelo
 * prefixo do caminho (`usuarios/`) e pula o que a varredura normal já achou
 * (dedupe por caminho), caso o pai um dia passe a ser escrito também.
 */

/**
 * `{ pai, subcolecao }` — cada par que vive só como filho de um documento
 * que ninguém grava. Se outra coleção ganhar o mesmo padrão no futuro, o
 * teste de `backup-inventario.test.ts` não pega isso sozinho (ele só cobra
 * a CLASSIFICAÇÃO da coleção pai, não a forma como ela é escrita) — então
 * fica registrado aqui, ao lado do porquê.
 */
const SUBCOLECOES_ORFAS = [{ pai: "usuarios", subcolecao: "preferences" }];

async function exportar(nome) {
  const linhas = [];
  const caminhosVistos = new Set();
  let docs = 0;

  async function percorrer(ref, prefixo) {
    const snap = await ref.get();
    for (const d of snap.docs) {
      const caminho = `${prefixo}/${d.id}`;
      linhas.push(linhaDoDump(caminho, d.data()));
      caminhosVistos.add(caminho);
      docs += 1;
      for (const sub of await d.ref.listCollections()) {
        await percorrer(sub, `${caminho}/${sub.id}`);
      }
    }
  }

  await percorrer(db.collection(nome), nome);

  for (const { pai, subcolecao } of SUBCOLECOES_ORFAS) {
    if (pai !== nome) continue;
    const grupo = await db.collectionGroup(subcolecao).get();
    for (const d of grupo.docs) {
      const caminho = d.ref.path;
      if (!caminho.startsWith(`${pai}/`) || caminhosVistos.has(caminho)) continue;
      linhas.push(linhaDoDump(caminho, d.data()));
      caminhosVistos.add(caminho);
      docs += 1;
    }
  }

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
