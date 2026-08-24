#!/usr/bin/env node
/**
 * Remove do tenant os documentos que NÃO existem mais na coleção de origem.
 *
 * ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────
 *
 * A migração é idempotente por id: rodar de novo reescreve por cima. O que ela
 * não faz — de propósito, porque apagar é irreversível — é remover o que
 * sobrou de uma execução anterior. Se um produto foi migrado num dia e
 * excluído do cadastro depois, ele continua vivo dentro de `tenants/{id}/`.
 *
 * Isso não é sujeira inofensiva. Medido nesta conta: sobraram 4 produtos de um
 * cadastro antigo, e um deles carregava os MESMOS MLBs de um produto atual.
 * Depois da virada, o mesmo anúncio apareceria em dois produtos — CMV contado
 * duas vezes e estoque duplicado, a mesma classe de erro que já custou caro
 * neste app, entrando pela porta da migração.
 *
 * ─── AS GARANTIAS ───────────────────────────────────────────────────────
 *
 * 1. DRY-RUN POR PADRÃO. Sem `--apply`, lista e não apaga.
 * 2. SÓ APAGA ÓRFÃO PROVADO. Um doc só é candidato se o id NÃO existir na
 *    coleção de origem. Origem vazia aborta: seria apagar tudo por engano.
 * 3. NÃO TOCA NA ORIGEM. Só escreve (deleta) dentro de `tenants/{id}/`.
 *
 * ─── USO ────────────────────────────────────────────────────────────────
 *
 *   node scripts/limpar-orfaos-tenant.mjs --tenant=vazxpress --colecao=estoque
 *   node scripts/limpar-orfaos-tenant.mjs --tenant=vazxpress --colecao=estoque --apply
 */

import admin from "firebase-admin";
import { carregarCredencial } from "./_lib/credencial.mjs";

function arg(nome) {
  const p = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return p ? p.slice(nome.length + 3) : "";
}

const TENANT = arg("tenant");
const COLECAO = arg("colecao");
const APLICAR = process.argv.includes("--apply");

if (!TENANT || !COLECAO) {
  console.error(
    "Faltou argumento.\n\n" +
    "  node scripts/limpar-orfaos-tenant.mjs --tenant=<id> --colecao=<nome> [--apply]\n",
  );
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

const linha = "─".repeat(66);
console.log(`\n${"═".repeat(66)}`);
console.log(`  ÓRFÃOS NO TENANT — ${APLICAR ? "APAGANDO DE VERDADE (--apply)" : "SIMULAÇÃO (dry-run)"}`);
console.log("═".repeat(66));
console.log(`  projeto : ${credencial.projectId}  (via ${credencial.origem})`);
console.log(`  origem  : ${COLECAO}`);
console.log(`  tenant  : tenants/${TENANT}/${COLECAO}\n`);

const [origem, destino] = await Promise.all([
  db.collection(COLECAO).get(),
  db.collection("tenants").doc(TENANT).collection(COLECAO).get(),
]);

/**
 * Trava mais importante do script. Origem vazia pode significar "coleção
 * legitimamente vazia" OU "nome da coleção digitado errado" — e no segundo
 * caso todo o conteúdo do tenant viraria órfão. Recusar é a única leitura
 * segura.
 */
if (origem.empty) {
  console.error(
    `  A coleção de origem "${COLECAO}" está VAZIA.\n\n` +
    `  Recusando: se o nome estiver errado, todos os ${destino.size} documentos do\n` +
    `  tenant seriam classificados como órfãos e apagados.\n`,
  );
  process.exit(1);
}

const idsOrigem = new Set(origem.docs.map((d) => d.id));
const orfaos = destino.docs.filter((d) => !idsOrigem.has(d.id));

console.log(`  origem : ${origem.size} documento(s)`);
console.log(`  tenant : ${destino.size} documento(s)`);
console.log(`  órfãos : ${orfaos.length}\n`);

if (orfaos.length === 0) {
  console.log("  Nada a fazer — o tenant não tem documento que a origem não tenha.\n");
  process.exit(0);
}

for (const d of orfaos) {
  const x = d.data() ?? {};
  const rotulo = x.name ?? x.nome ?? x.title ?? "(sem nome)";
  console.log(`    ${d.id}  ${rotulo}`);
}

console.log(`\n${linha}`);
if (!APLICAR) {
  console.log(`\n  NADA FOI APAGADO. Confira a lista e rode de novo com --apply.\n`);
  console.log(`  node scripts/limpar-orfaos-tenant.mjs --tenant=${TENANT} --colecao=${COLECAO} --apply\n`);
} else {
  const lote = db.batch();
  for (const d of orfaos) lote.delete(d.ref);
  await lote.commit();
  console.log(`\n  ✓ ${orfaos.length} documento(s) removido(s) de tenants/${TENANT}/${COLECAO}.`);
  console.log(`  A coleção de origem "${COLECAO}" não foi tocada.\n`);
}
console.log(linha + "\n");
process.exit(0);
