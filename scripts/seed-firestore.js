const admin = require("firebase-admin");
const { carregarCredencial } = require("./_lib/credencial.cjs");

const credencial = carregarCredencial();
console.log(`projeto : ${credencial.projectId}  (via ${credencial.origem})`);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(credencial),
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});