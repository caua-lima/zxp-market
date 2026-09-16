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
  const now = admin.firestore.FieldValue.serverTimestamp();

  batch.set(db.collection("ml_orders").doc("order_test_001"), {
    order_id: "ORDER_TEST_001",
    status: "paid",
    date_created: "2026-05-17T00:00:00.000Z",
    total_amount: 199.9,
    currency: "BRL",
    buyer_id: "buyer_test_001",
    shipping_status: "delivered",
    items: [
      {
        sku: "SKU_TESTE",
        title: "Produto de teste",
        quantity: 1,
        unit_price: 199.9,
      },
    ],
    createdAt: now,
  });

  batch.set(db.collection("ml_returns").doc("return_test_001"), {
    return_id: "RETURN_TEST_001",
    order_id: "ORDER_TEST_001",
    status: "none",
    date_created: "2026-05-17T00:00:00.000Z",
    amount: 0,
    reason: "",
    createdAt: now,
  });

  batch.set(db.collection("ml_ads_campaigns").doc("campaign_test_001"), {
    campaign_id: "CAMPAIGN_TEST_001",
    name: "Campanha teste 1",
    status: "active",
    daily_budget: 50,
    channel: "product_ads",
    createdAt: now,
  });

  batch.set(db.collection("ml_ads_spend").doc("spend_test_001"), {
    campaign_id: "CAMPAIGN_TEST_001",
    date: "2026-05-17",
    spend: 12.34,
    clicks: 18,
    impressions: 1200,
    conversions: 2,
    roas: 16.16,
    createdAt: now,
  });

  await batch.commit();
  console.log("Seed ML base concluído com sucesso");
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
