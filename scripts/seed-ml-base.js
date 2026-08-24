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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});