/**
 * Convertido de CommonJS pra ESM.
 *
 * Era o último `require()` do repositório, e o lint reclamava dele em seis
 * linhas. O resto dos scripts já é `.mjs` (gen-favicon, backup-firestore,
 * restore-firestore) — este tinha ficado pra trás, e o custo de deixar era
 * seis erros permanentes que faziam o lint parecer sempre sujo.
 *
 * `__dirname` não existe em ESM; `import.meta.url` é o equivalente.
 */
import admin from "firebase-admin";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const serviceAccount = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../serviceAccountKey.json"), "utf8")
);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

async function main() {
  const batch = db.batch();

  batch.set(db.collection("products").doc("produto_teste"), {
    sku: "SKU_TESTE",
    name: "Produto de teste",
    cost: 29.9,
    active: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  batch.set(db.collection("operational_costs").doc("custo_teste"), {
    name: "Custo operacional teste",
    type: "fixed",
    value: 100,
    active: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  batch.set(db.collection("settings").doc("main"), {
    currency: "BRL",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await batch.commit();
  console.log("Seed concluído com sucesso");
}


/**
 * ─── ESTE SCRIPT ESCREVE NO FIRESTORE DE VERDADE ─────────────────────────
 *
 * Duas travas, e as duas nasceram do mesmo incidente: eu importei este
 * arquivo só pra checar a sintaxe depois de convertê-lo pra ESM, e ele
 * RODOU — escreveu três documentos de teste na base de produção.
 *
 * 1. Só executa quando é CHAMADO direto. Importar (pra checar sintaxe, pra
 *    reusar uma função, pro editor indexar) não dispara mais nada.
 * 2. Mesmo chamado direto, exige `--confirmar`. Um script cujo nome começa
 *    com `seed` parece inofensivo e não é: ele escreve na base apontada
 *    pelo serviceAccountKey.json, que aqui é a de produção.
 */
const chamadoDireto = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (!chamadoDireto) {
  console.error("Este script não roda por importação. Chame-o direto.");
} else if (!process.argv.includes("--confirmar")) {
  console.error(
    [
      "Este script ESCREVE dados de teste no Firestore apontado por",
      "serviceAccountKey.json — que nesta máquina é a base de PRODUÇÃO.",
      "",
      "Se é isso mesmo, repita com --confirmar.",
    ].join("\n"),
  );
  process.exit(1);
} else {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
