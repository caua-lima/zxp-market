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
const { aparelhosComPainelFixo, enviarPainelFixo, publicarSinalAoVivo } = await import("./ao-vivo-tempo-real");

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

describe("mini painel fixo", () => {
  beforeEach(async () => {
    const hoje = Date.now();
    await db.doc("controleAcesso/dono@a.com").set({ email: "dono@a.com", role: "owner" });
    await db.doc("controleAcesso/temp@a.com").set({ email: "temp@a.com", role: "user", expiraEm: hoje - 1000 });
    await db.doc("pushTokens/dono@a.com__cel").set({ email: "dono@a.com", token: "tok-cel", deviceId: "cel", painelFixoEmpresa: "raiz" });
    await db.doc("pushTokens/dono@a.com__pc").set({ email: "dono@a.com", token: "tok-pc", deviceId: "pc" }); // não fixou
    await db.doc("pushTokens/dono@a.com__outra").set({ email: "dono@a.com", token: "tok-outra", deviceId: "outra", painelFixoEmpresa: "t-b" });
    await db.doc("pushTokens/temp@a.com__cel").set({ email: "temp@a.com", token: "tok-temp", deviceId: "cel", painelFixoEmpresa: "raiz" });
    await db.doc("pushTokens/saiu@a.com__cel").set({ email: "saiu@a.com", token: "tok-saiu", deviceId: "cel", painelFixoEmpresa: "raiz" });
  });

  it("só o aparelho que fixou o painel DESTA empresa, de quem ainda tem acesso", async () => {
    const a = await aparelhosComPainelFixo(db, "raiz");
    expect(a.map((x) => x.token)).toEqual(["tok-cel"]);
  });

  it("manda o placar calculado (já com o pedido), só em data, com TTL curto", async () => {
    const r = await enviarPainelFixo({ orderId: "9", valida: true }, estado("9"));
    expect(r).toEqual({ aparelhos: 1, enviados: 1 });
    expect(calculo.chamadas[0]).toMatchObject({ empresa: "raiz", pedido: { orderId: "9", valida: true } });
    expect(fcm.enviados).toHaveLength(1);
    const m = fcm.enviados[0];
    expect(m.tokens).toEqual(["tok-cel"]);
    expect(m.data.type).toBe("ao_vivo");
    expect(JSON.parse(m.data.placar)).toMatchObject({ dia: "2026-10-23", vendas: 4320.5, pedidos: 18, unidades: 25, ontemAteAgora: 3000 });
    expect(m.webpush).toEqual({ headers: { TTL: "900", Urgency: "high", Topic: "aovivo" } });
  });

  it("ninguém fixou: nem calcula nem envia", async () => {
    await limpar();
    expect(await enviarPainelFixo({ orderId: "9", valida: true }, null)).toEqual({ aparelhos: 0, enviados: 0 });
    expect(calculo.chamadas).toHaveLength(0);
    expect(fcm.enviados).toHaveLength(0);
  });
});
