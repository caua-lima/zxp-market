#!/usr/bin/env node
/**
 * Restaura um dump gerado por backup-firestore.mjs.
 *
 * ─── O DESTINO PADRÃO É OUTRO PROJETO, E ISSO É O PONTO ──────────────────
 *
 * "Uma cópia no mesmo banco não resolve todos os cenários de perda." O
 * cenário que ela não resolve é o mais provável de todos: não é o data center
 * pegar fogo, é um script apagar a coleção errada — e a cópia ao lado morre
 * junto.
 *
 * Restaurar POR CIMA da produção também é um cenário de perda: se o dump for
 * de ontem, tudo que entrou hoje some. Por isso escrever no mesmo projeto de
 * origem exige `--confirmar-producao` DIGITADO na hora, e o script mostra o
 * que vai acontecer antes.
 *
 * ─── E É AQUI QUE SE TESTA O BACKUP ──────────────────────────────────────
 *
 * Backup que nunca foi restaurado não é backup, é arquivo. Este script existe
 * tanto pra emergência quanto pro ensaio: restaurar num projeto descartável,
 * abrir o app apontando pra ele e conferir que o custo médio de um produto
 * conhecido voltou certo. `--conferir` faz a parte mecânica disso.
 *
 * ─── USO ─────────────────────────────────────────────────────────────────
 *
 *   # ensaio, num projeto separado (o caminho normal)
 *   node scripts/restore-firestore.mjs --dump ./backups/zxp_2026-09-15T12-00-00 --projeto zxp-restore-teste
 *
 *   # só conferir o que tem no dump, sem escrever nada
 *   node scripts/restore-firestore.mjs --dump ./backups/... --conferir
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  ORDEM_DE_RESTAURACAO, podeRestaurar, avaliarDestino, explicarDestino, classeDe,
} from "../lib/domain/backup-inventario.ts";
import { lerLinhaDoDump } from "../lib/domain/backup-serie.ts";

const args = process.argv.slice(2);
const opt = (n, p) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : p; };
const flag = (n) => args.includes(`--${n}`);

const dump = opt("dump");
const soConferir = flag("conferir");

if (!dump || !fs.existsSync(dump)) {
  console.error("Informe --dump <diretório> de um backup existente.");
  process.exit(1);
}

const resumoPath = path.join(dump, "resumo.json");
const resumo = fs.existsSync(resumoPath) ? JSON.parse(fs.readFileSync(resumoPath, "utf8")) : null;

console.log(`Dump: ${dump}`);
if (resumo) {
  console.log(`  projeto de origem: ${resumo.projeto}`);
  console.log(`  feito em: ${resumo.feitoEm}`);
  /**
   * Um dump marcado incompleto pode ser restaurado, mas nunca em silêncio: a
   * coleção que faltou vai ficar VAZIA no destino, e vazio é indistinguível
   * de "não tinha nada" depois que a restauração termina.
   */
  if (resumo.completo === false) {
    console.log("  ATENÇÃO: este backup saiu INCOMPLETO. Coleções que falharam voltarão vazias.");
  }
}

/** Idade do dump — o que realmente se perde ao restaurar sobre produção. */
const idadeHoras = resumo?.feitoEm
  ? (Date.now() - Date.parse(resumo.feitoEm)) / 3600000
  : null;

const arquivos = fs.readdirSync(dump).filter((f) => f.endsWith(".jsonl"));
console.log("\nConteúdo:");
let totalDocs = 0;
for (const nome of ORDEM_DE_RESTAURACAO) {
  const f = path.join(dump, `${nome}.jsonl`);
  if (!fs.existsSync(f)) { console.log(`  ${nome}: AUSENTE do dump`); continue; }
  const n = fs.readFileSync(f, "utf8").split("\n").filter(Boolean).length;
  totalDocs += n;
  console.log(`  ${nome}: ${n} documento(s) [${classeDe(nome)}]`);
}
const extras = arquivos.map((f) => f.replace(/\.jsonl$/, "")).filter((c) => !ORDEM_DE_RESTAURACAO.includes(c));
for (const c of extras) {
  console.log(`  ${c}: presente no dump e FORA da ordem de restauração — não será restaurado`);
}

if (soConferir) {
  console.log(`\n${totalDocs} documento(s) no total. Nada foi escrito (--conferir).`);
  process.exit(0);
}

const origem = resumo?.projeto ?? process.env.FIREBASE_PROJECT_ID;
const destinoProjeto = opt("projeto", process.env.FIREBASE_PROJECT_ID);

const decisao = avaliarDestino({
  projetoDeOrigem: origem,
  projetoDeDestino: destinoProjeto,
  confirmouProducao: flag("confirmar-producao"),
});

console.log(`\nDestino: ${destinoProjeto || "(nenhum)"}`);
console.log(explicarDestino(decisao.motivo));

if (!decisao.permitido) {
  if (decisao.motivo === "producao_sem_confirmacao" && idadeHoras !== null) {
    console.error(
      `\nEste dump tem ${idadeHoras.toFixed(1)}h. Restaurar sobre a produção descarta ` +
      "tudo que foi cadastrado nesse intervalo — custo, despesa, remessa, tarefa."
    );
  }
  process.exit(1);
}

/**
 * Mesmo autorizado, escrever sobre produção pede a digitação do nome do
 * projeto. Uma flag pode estar num histórico de shell; digitar o nome é um
 * ato deliberado do momento.
 */
if (decisao.motivo === "producao_confirmada") {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const resposta = await new Promise((r) =>
    rl.question(`Digite o nome do projeto pra confirmar a sobrescrita (${destinoProjeto}): `, (a) => { rl.close(); r(a.trim()); })
  );
  if (resposta !== destinoProjeto) {
    console.error("Nome não confere. Nada foi escrito.");
    process.exit(1);
  }
}

const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = (process.env.FIREBASE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");
if (!clientEmail || !privateKey) {
  console.error("Faltam FIREBASE_CLIENT_EMAIL e FIREBASE_PRIVATE_KEY do projeto de DESTINO.");
  process.exit(1);
}

initializeApp({ credential: cert({ projectId: destinoProjeto, clientEmail, privateKey }) });
const db = getFirestore();

/**
 * As fábricas que a desserialização precisa.
 *
 * `backup-serie` não pode importar `firebase-admin` — ele roda em teste e
 * no editor, onde o SDK não existe. Quem tem o SDK traz as duas.
 */
const FABRICAS = {
  paraData: (iso) => Timestamp.fromDate(new Date(iso)),
  paraRef: (caminho) => db.doc(caminho),
};

let escritos = 0;
for (const nome of ORDEM_DE_RESTAURACAO) {
  if (!podeRestaurar(nome)) { console.log(`  ${nome}: pulado (nunca restaurar)`); continue; }
  const f = path.join(dump, `${nome}.jsonl`);
  if (!fs.existsSync(f)) continue;

  const linhas = fs.readFileSync(f, "utf8").split("\n").filter(Boolean);
  /**
   * Lotes de 400 — o limite do batch do Firestore é 500, e a folga cobre o
   * caso de um documento contar como mais de uma operação.
   */
  for (let i = 0; i < linhas.length; i += 400) {
    const lote = db.batch();
    for (const l of linhas.slice(i, i + 400)) {
      const { caminho, dados } = lerLinhaDoDump(l, FABRICAS);
      lote.set(db.doc(caminho), dados);
    }
    await lote.commit();
  }
  escritos += linhas.length;
  console.log(`  ${nome}: ${linhas.length} restaurado(s)`);
}

console.log(`\n${escritos} documento(s) restaurados em ${destinoProjeto}.`);
console.log(
  "O ensaio só termina quando você ABRIR o app apontando pra este projeto e\n" +
  "conferir um valor que você conhece de cor — o custo médio de um produto, por\n" +
  "exemplo. Contagem de documento certa não prova que o conteúdo voltou certo."
);
