import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O lado do servidor das vendas ao vivo em tempo real, contra o emulador REAL
 * do Firestore: o sinal que a barra escuta e o push do mini painel fixo.
 * O FCM e o cálculo da barra são simulados — nenhum push de verdade sai.
 */

const fcm = vi.hoisted(() => ({ enviados: [] as { tokens: string[]; data: Record<string, string>; webpush?: unknown }[] }));
const calculo = vi.hoisted(() => ({ chamadas: [] as unknown[] }));

vi.mock("@/lib/firebase/admin", async () => {
  const { getApps, initializeApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const app = getApps().find((a) => a.name === "ao-vivo-teste") ?? initializeApp({ projectId: "zxp-teste-ao-vivo-srv" }, "ao-vivo-teste");
  const db = getFirestore(app);
  const { comCaminhosDeDados } = await import("@/lib/firebase/db-de-dados");
  return {
    getAdminDb: () => comCaminhosDeDados(db),
    getAdminMessaging: () => ({
      sendEachForMulticast: async (m: { tokens: string[]; data: Record<string, string>; webpush?: unknown }) => {
        fcm.enviados.push(m);
        return { successCount: m.tokens.length, responses: m.tokens.map(() => ({ success: true })) };
      },
    }),
  };
});

vi.mock("@/lib/ml/ao-vivo-calculo", () => ({
  calcularAoVivo: vi.fn(async (o: unknown) => {
    calculo.chamadas.push(o);
    return {
      doCache: false,
      body: {
        dia: "2026-10-23", horaAtual: 14, atualizadoEm: 1,
        hoje: { vendas: 4320.5, pedidos: 18, unidades: 25, canceladoValor: 0, canceladoPedidos: 0 },
        ontemAteAgora: { vendas: 3000, pedidos: 10, unidades: 12 }, ontemInteiro: { vendas: 5000, pedidos: 20, unidades: 22 },
        porHora: { hoje: Array(24).fill(0), ontem: Array(24).fill(0) },
        ultimaVenda: { em: 1, valor: 189.9, titulo: "Limão" }, compradores: 17, topProdutos: [], idsHoje: [],
        metaDoDia: null, visitas: null, fonte: "ml",
      },
    };
  }),
}));

const { getAdminDb } = await import("@/lib/firebase/admin");
const { publicarSinalAoVivo } = await import("./ao-vivo-tempo-real");

const db = getAdminDb();
const agoraISO = () => new Date(Date.now() - 60_000).toISOString();
const estado = (id: string, status = "paid") => ({
  order_id: id, status, date_created: agoraISO(), total_amount: 189.9, items: [{ title: "Limão", quantity: 2 }],
});

async function limpar() {
  for (const c of ["ao_vivo", "pushTokens", "controleAcesso"]) {
    const s = await db.collection(c).get();
    await Promise.all(s.docs.map((d) => d.ref.delete()));
  }
}

beforeEach(async () => {
  fcm.enviados.length = 0;
  calculo.chamadas.length = 0;
  await limpar();
});

describe("publicarSinalAoVivo", () => {
  it("venda nova vira sinal com seq; mudança de envio não; cancelamento sim", async () => {
    expect(await publicarSinalAoVivo(db, estado("1"), undefined)).toMatchObject({ orderId: "1", valida: true, valor: 189.9, unidades: 2 });
    let s = (await db.doc("ao_vivo/sinal").get()).data()!;
    expect(s).toMatchObject({ seq: 1, orderId: "1", valida: true });

    expect(await publicarSinalAoVivo(db, estado("1"), { status: "paid" })).toBeNull();
    expect((await db.doc("ao_vivo/sinal").get()).get("seq")).toBe(1);

    expect(await publicarSinalAoVivo(db, estado("1", "cancelled"), { status: "paid" })).toMatchObject({ valida: false });
    s = (await db.doc("ao_vivo/sinal").get()).data()!;
    expect(s).toMatchObject({ seq: 2, orderId: "1", valida: false });
  });
});
