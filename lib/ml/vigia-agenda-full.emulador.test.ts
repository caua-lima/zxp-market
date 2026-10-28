import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A vigia da agenda do Full contra o emulador REAL do Firestore. O ML e o envio
 * do push são simulados — nenhuma chamada real.
 */

const avisos = vi.hoisted(() => ({ lista: [] as { evento: Record<string, unknown>; payload: Record<string, unknown> }[] }));

vi.mock("@/lib/firebase/admin", async () => {
  const { getApps, initializeApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const app = getApps().find((a) => a.name === "vigia-teste") ?? initializeApp({ projectId: "zxp-teste-vigia" }, "vigia-teste");
  const db = getFirestore(app);
  const { comCaminhosDeDados } = await import("@/lib/firebase/db-de-dados");
  return { getAdminDb: () => comCaminhosDeDados(db) };
});
vi.mock("@/app/api/ml/token", () => ({ getMlAccessToken: vi.fn(async () => "tok") }));
vi.mock("@/lib/notification-dispatch", () => ({
  criarEventoEPublicar: vi.fn(async (evento: Record<string, unknown>, spec: { payload: Record<string, unknown> }) => {
    avisos.lista.push({ evento, payload: spec.payload });
    return { created: true, eventId: String(evento.dedupeKey), enviados: 1 };
  }),
  especDoPush: (_id: string, _t: string, payload: Record<string, unknown>) => ({ payload }),
}));

const { getAdminDb } = await import("@/lib/firebase/admin");
const { vigiarAgendasFull, INTERVALO_MINIMO_MS } = await import("./vigia-agenda-full");
const db = getAdminDb();

/** Um ML falso: o que cada endereço responde. */
function mlFalso(respostas: Record<string, { status: number; corpo?: unknown }>) {
  const chamadas: string[] = [];
  const buscar = async (url: string, init: RequestInit) => {
    chamadas.push(url);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    const caminho = url.replace("https://api.mercadolibre.com", "");
    const r = respostas[caminho] ?? { status: 404, corpo: { error: "resource not found" } };
    return new Response(r.corpo === undefined ? "" : JSON.stringify(r.corpo), { status: r.status });
  };
  return { buscar, chamadas };
}

const AGORA = Date.parse("2026-10-28T20:10:00.000-03:00");

beforeEach(async () => {
  avisos.lista.length = 0;
  const s = await db.collection("full_agenda_vigias").get();
  await Promise.all(s.docs.map((d) => d.ref.delete()));
});

async function vigiar(id = "80517703", extra: Record<string, unknown> = {}) {
  await db.doc(`full_agenda_vigias/${id}`).set({ inboundId: id, ativa: true, criadoEm: 1, criadoPor: "dono@a.com", ...extra });
}

describe("vigia da agenda do Full", () => {
  it("ML bloqueia (403): estado 'sem acesso', sem aviso", async () => {
    await vigiar();
    const ml = mlFalso({ "/inbounds/80517703": { status: 403 }, "/inbounds/80517703/appointments": { status: 403 } });
    const r = await vigiarAgendasFull({ agora: AGORA, buscar: ml.buscar });
    expect(r).toMatchObject({ vigias: 1, consultadas: 1, avisos: 0 });
    const d = (await db.doc("full_agenda_vigias/80517703").get()).data()!;
    expect(d).toMatchObject({ estado: "sem_acesso", ultimaConsulta: AGORA, consultas: 1 });
    expect(String(d.detalhe)).toContain("/appointments 403");
    expect(avisos.lista).toHaveLength(0);
  });

  it("sem datas: guarda a resposta pra conferência, sem aviso", async () => {
    await vigiar();
    const ml = mlFalso({ "/inbounds/80517703": { status: 200, corpo: { id: 80517703, status: "working", available_dates: [] } } });
    await vigiarAgendasFull({ agora: AGORA, buscar: ml.buscar });
    const d = (await db.doc("full_agenda_vigias/80517703").get()).data()!;
    expect(d.estado).toBe("sem_datas");
    expect(d.amostra).toContain('"status":"working"');
    expect(avisos.lista).toHaveLength(0);
  });

  it("abriu data: avisa UMA vez por data nova, com o número do envio e a aba Full", async () => {
    await vigiar();
    const livre = mlFalso({ "/inbounds/80517703/availability": { status: 200, corpo: { slots: [{ date: "2026-10-30" }, { date: "2026-10-31" }] } } });
    await vigiarAgendasFull({ agora: AGORA, buscar: livre.buscar });
    expect(avisos.lista).toHaveLength(1);
    const { evento, payload } = avisos.lista[0];
    expect(evento).toMatchObject({ type: "full_agenda", entityId: "80517703", deepLink: "/?tab=full", dedupeKey: "full_agenda:80517703:2026-10-30" });
    expect(String(evento.title)).toContain("#80517703");
    expect(String(evento.body)).toContain("30/10 e 31/10");
    expect(payload).toMatchObject({ type: "full_agenda", deepLink: "/?tab=full" });
    expect((await db.doc("full_agenda_vigias/80517703").get()).data()).toMatchObject({ estado: "datas_liberadas", datas: ["2026-10-30", "2026-10-31"], avisadoDatas: "2026-10-30,2026-10-31" });

    // mesmas datas na próxima passagem: não repete
    await vigiarAgendasFull({ agora: AGORA + INTERVALO_MINIMO_MS, buscar: livre.buscar });
    expect(avisos.lista).toHaveLength(1);

    // data nova: avisa de novo
    const outra = mlFalso({ "/inbounds/80517703/availability": { status: 200, corpo: { slots: [{ date: "2026-11-03" }] } } });
    await vigiarAgendasFull({ agora: AGORA + 2 * INTERVALO_MINIMO_MS, buscar: outra.buscar });
    expect(avisos.lista).toHaveLength(2);
  });

  it("não pergunta ao ML antes do intervalo mínimo; vigia desligada fica de fora", async () => {
    await vigiar("80517703", { ultimaConsulta: AGORA - 60_000 });
    await vigiar("90000001", { ativa: false });
    const ml = mlFalso({});
    const r = await vigiarAgendasFull({ agora: AGORA, buscar: ml.buscar });
    expect(r).toMatchObject({ vigias: 1, consultadas: 0 });
    expect(ml.chamadas).toHaveLength(0);
  });

  it("sem conexão com o ML: não quebra e diz isso", async () => {
    await vigiar();
    const r = await vigiarAgendasFull({ agora: AGORA, token: null });
    expect(r).toMatchObject({ semToken: true, consultadas: 0 });
  });
});
