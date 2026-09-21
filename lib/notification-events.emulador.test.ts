import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getApps, initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore, type Firestore } from "firebase-admin/firestore";
import { createNotificationEventIdempotent, garantirEspelho, limparTestesAntigos, limparTestesDosFeeds, repararEspelhosPendentes, type NewNotificationEvent } from "./notification-events";

/**
 * O espelho redigido contra o emulador do Firestore (`npm run test:emulador`).
 *
 * O que se prova aqui é o que nenhum mock provaria: que a falha do espelho
 * deixa rastro, que o retry conserta, e que consertar NÃO apaga a marca de
 * lido de quem já leu.
 */

let db: Firestore;

const evento = (over: Partial<NewNotificationEvent> = {}): NewNotificationEvent => ({
  type: "sale_negative_margin", severity: "danger", entityType: "order", entityId: "2000123456",
  dedupeKey: "sale_paid:2000123456", title: "Venda confirmada · revisar margem",
  body: "Menta · prejuízo estimado de R$ 18,40", orderId: "2000123456", productName: "Menta",
  grossAmount: 79.9, estimatedProfit: -18.4, estimatedMargin: -23, financialState: "estimated",
  deepLink: "/?tab=pedidos&order=2000123456", ...over,
});

const original = (id = "sale_paid:2000123456") => db.collection("notification_events").doc(id);
const espelho = (id = "sale_paid:2000123456") => db.collection("notification_events_publico").doc(id);

/** Um banco em que TODA transação falha — o espelho é gravado por transação. */
function bancoComEspelhoQuebrado(): Firestore {
  return {
    collection: db.collection.bind(db),
    runTransaction: async () => { throw Object.assign(new Error("indisponivel"), { code: 14 }); },
  } as unknown as Firestore;
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("rode com o emulador: npm run test:emulador");
  const app = getApps().find((a) => a.name === "eventos-teste") ?? initializeApp({ projectId: "zxp-teste-eventos" }, "eventos-teste");
  db = getFirestore(app);
});
beforeEach(async () => {
  for (const col of ["notification_events", "notification_events_publico"]) {
    const snap = await db.collection(col).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  // O feed direcionado tem subcoleções: apaga por e-mail conhecido dos testes.
  for (const email of ["socio@zxp.com", "dono@zxp.com", "a@zxp.com", "b@zxp.com"]) {
    const itens = await db.collection("notification_feed").doc(email).collection("itens").get();
    await Promise.all(itens.docs.map((d) => d.ref.delete()));
  }
});
afterAll(async () => { await db?.terminate(); });

describe("criação", () => {
  it("cria o evento e o espelho SEM dinheiro, com type e severity normalizados", async () => {
    const r = await createNotificationEventIdempotent(evento(), db);
    expect(r).toEqual({ created: true, eventId: "sale_paid:2000123456" });
    const completo = (await original().get()).data()!;
    expect(completo.grossAmount).toBe(79.9);
    expect(completo.type).toBe("sale_negative_margin");

    const publico = (await espelho().get()).data()!;
    expect(publico).not.toHaveProperty("grossAmount");
    expect(publico).not.toHaveProperty("estimatedProfit");
    expect(publico).not.toHaveProperty("financialState");
    expect(publico.type).toBe("sale_paid");
    expect(publico.severity).toBe("success");
    expect(JSON.stringify(publico)).not.toContain("18,40");
  });

  it("um retry NÃO recria o evento", async () => {
    await createNotificationEventIdempotent(evento(), db);
    expect((await createNotificationEventIdempotent(evento(), db)).created).toBe(false);
  });
});

describe("falha do espelho — não é mais silenciosa", () => {
  it("o evento nasce mesmo com o espelho falhando, e fica MARCADO como pendente", async () => {
    const r = await createNotificationEventIdempotent(evento(), bancoComEspelhoQuebrado());
    expect(r.created).toBe(true);
    expect((await original().get()).data()?.espelhoPendente).toBe(true);
    expect((await espelho().get()).exists).toBe(false);
  });

  it("o retry (created: false) CONSERTA o espelho que faltava e limpa a marca", async () => {
    await createNotificationEventIdempotent(evento(), bancoComEspelhoQuebrado());
    const r = await createNotificationEventIdempotent(evento(), db);
    expect(r.created).toBe(false);
    expect((await espelho().get()).exists).toBe(true);
    expect((await original().get()).data()).not.toHaveProperty("espelhoPendente");
  });

  it("a varredura conserta os pendentes sem depender de um retry do produtor", async () => {
    await createNotificationEventIdempotent(evento(), bancoComEspelhoQuebrado());
    await createNotificationEventIdempotent(evento({ dedupeKey: "sale_paid:2", entityId: "2", orderId: "2" }), bancoComEspelhoQuebrado());
    expect(await repararEspelhosPendentes(db)).toBe(2);
    expect((await espelho().get()).exists).toBe(true);
    expect((await espelho("sale_paid:2").get()).exists).toBe(true);
    expect(await repararEspelhosPendentes(db)).toBe(0);
  });

  it("o espelho que já existe não é tocado num retry comum", async () => {
    await createNotificationEventIdempotent(evento(), db);
    await espelho().update({ readBy: { "membro@zxp.com": 123 } });
    await createNotificationEventIdempotent(evento(), db);
    expect((await espelho().get()).data()?.readBy).toEqual({ "membro@zxp.com": 123 });
  });
});

describe("garantirEspelho — consertar NÃO apaga quem já leu", () => {
  it("regrava o conteúdo público e PRESERVA readBy e dismissedBy", async () => {
    await createNotificationEventIdempotent(evento(), db);
    await espelho().update({ readBy: { "membro@zxp.com": 111 }, dismissedBy: { "membro@zxp.com": 222 } });

    const r = await garantirEspelho(db, "sale_paid:2000123456", (await original().get()).data()!);
    expect(r).toBe("atualizado");
    const publico = (await espelho().get()).data()!;
    expect(publico.readBy).toEqual({ "membro@zxp.com": 111 });
    expect(publico.dismissedBy).toEqual({ "membro@zxp.com": 222 });
  });

  it("espelho ANTIGO (com type vazando e campo interno) é reprojetado, mantendo o lido", async () => {
    await original().set({ ...evento(), id: "sale_paid:2000123456", createdAt: new Date(1) });
    await espelho().set({
      type: "sale_negative_margin", severity: "danger", title: "x", body: "y", delivery: { pushError: "interno" },
      readBy: { "membro@zxp.com": 7 }, dismissedBy: {},
    });

    await garantirEspelho(db, "sale_paid:2000123456", (await original().get()).data()!);
    const publico = (await espelho().get()).data()!;
    expect(publico.type).toBe("sale_paid");
    expect(publico.severity).toBe("success");
    expect(publico).not.toHaveProperty("delivery");
    expect(publico.readBy).toEqual({ "membro@zxp.com": 7 });
  });

  it("marca de lido que chega durante o reparo não se perde — 10 reparos e 10 marcas concorrentes", async () => {
    await createNotificationEventIdempotent(evento(), db);
    const dados = (await original().get()).data()!;
    await Promise.all([
      ...Array.from({ length: 10 }, () => garantirEspelho(db, "sale_paid:2000123456", dados)),
      // FieldPath: o ponto do e-mail seria lido como caminho aninhado (é o que o app já faz).
      ...Array.from({ length: 10 }, (_, i) => espelho().update(new FieldPath("readBy", `leitor${i}@zxp.com`), i + 1)),
    ]);
    const lidos = (await espelho().get()).data()?.readBy ?? {};
    // Cada leitor gravou UMA vez. O reparo é uma transação: se uma marca chega entre a
    // leitura e a escrita, ele refaz — então nenhuma das dez pode ter sido apagada.
    expect(Object.keys(lidos)).toHaveLength(10);
    for (let i = 0; i < 10; i++) expect(lidos[`leitor${i}@zxp.com`]).toBe(i + 1);
  });
});

describe("eventos DIRECIONADOS — o feed é da pessoa, não do time (N16)", () => {
  const tarefa = (over: Partial<NewNotificationEvent> = {}): NewNotificationEvent => ({
    type: "task_assigned", severity: "info", entityType: "task", entityId: "t1",
    dedupeKey: "task_assigned:t1:1700000000000", title: "Nova tarefa atribuída a você",
    body: "Conferir o custo da Menta · prioridade alta", financialState: "unavailable", deepLink: "/?tab=tarefas&task=t1", ...over,
  });
  const feed = (email: string, id = "task_assigned:t1:1700000000000") =>
    db.collection("notification_feed").doc(email).collection("itens").doc(id);

  it("nasce SÓ no feed de quem deve vê-lo — nunca nas coleções do time", async () => {
    const r = await createNotificationEventIdempotent(tarefa(), db, { audiencia: ["socio@zxp.com"] });
    expect(r.created).toBe(true);
    expect((await feed("socio@zxp.com").get()).exists).toBe(true);
    expect((await original("task_assigned:t1:1700000000000").get()).exists).toBe(false);
    expect((await espelho("task_assigned:t1:1700000000000").get()).exists).toBe(false);
  });

  it("o feed de OUTRA pessoa não recebe o aviso", async () => {
    await createNotificationEventIdempotent(tarefa(), db, { audiencia: ["socio@zxp.com"] });
    expect((await feed("dono@zxp.com").get()).exists).toBe(false);
  });

  it("guarda a audiência e o lido é da própria pessoa (sem mapa por e-mail)", async () => {
    await createNotificationEventIdempotent(tarefa(), db, { audiencia: ["socio@zxp.com"] });
    const d = (await feed("socio@zxp.com").get()).data()!;
    expect(d.audiencia).toEqual(["socio@zxp.com"]);
    expect(d.lidoEm).toBeNull();
    expect(d.dispensadoEm).toBeNull();
    expect(d).not.toHaveProperty("readBy");
  });

  it("idempotente: o mesmo evento não nasce duas vezes", async () => {
    expect((await createNotificationEventIdempotent(tarefa(), db, { audiencia: ["socio@zxp.com"] })).created).toBe(true);
    expect((await createNotificationEventIdempotent(tarefa(), db, { audiencia: ["socio@zxp.com"] })).created).toBe(false);
  });

  it("e-mail em caixa diferente cai no MESMO feed", async () => {
    await createNotificationEventIdempotent(tarefa(), db, { audiencia: ["Socio@ZXP.com"] });
    expect((await feed("socio@zxp.com").get()).exists).toBe(true);
  });

  it("duas pessoas na audiência: cada uma ganha o PRÓPRIO documento", async () => {
    await createNotificationEventIdempotent(tarefa(), db, { audiencia: ["a@zxp.com", "b@zxp.com"] });
    await feed("a@zxp.com").update({ lidoEm: 5 });
    expect((await feed("b@zxp.com").get()).data()?.lidoEm).toBeNull();
  });

  it("teste de A não vira aviso na Central de B", async () => {
    await createNotificationEventIdempotent(
      { ...tarefa(), type: "test", dedupeKey: "test:a:1", title: "TESTE · Nova venda confirmada", entityId: "teste-sale_paid" },
      db, { audiencia: ["a@zxp.com"] },
    );
    expect((await feed("b@zxp.com", "test:a:1").get()).exists).toBe(false);
    expect((await original("test:a:1").get()).exists).toBe(false);
  });

  it("limparTestesAntigos apaga só teste vencido, só do feed da pessoa", async () => {
    await createNotificationEventIdempotent({ ...tarefa(), type: "test", dedupeKey: "test:a:velho" }, db, { audiencia: ["a@zxp.com"] });
    await createNotificationEventIdempotent({ ...tarefa(), type: "test", dedupeKey: "test:a:novo" }, db, { audiencia: ["a@zxp.com"] });
    await createNotificationEventIdempotent(tarefa({ dedupeKey: "task_assigned:t9:1" }), db, { audiencia: ["a@zxp.com"] });
    await feed("a@zxp.com", "test:a:velho").update({ createdAt: new Date(Date.now() - 8 * 24 * 3600 * 1000) });

    expect(await limparTestesAntigos(db, ["a@zxp.com"])).toBe(1);
    expect((await feed("a@zxp.com", "test:a:velho").get()).exists).toBe(false);
    expect((await feed("a@zxp.com", "test:a:novo").get()).exists).toBe(true);
    expect((await feed("a@zxp.com", "task_assigned:t9:1").get()).exists).toBe(true);
  });
  it("limparTestesDosFeeds acha os feeds sem documento-pai e limpa os de todo mundo", async () => {
    await createNotificationEventIdempotent({ ...tarefa(), type: "test", dedupeKey: "test:a:velho2" }, db, { audiencia: ["a@zxp.com"] });
    await createNotificationEventIdempotent({ ...tarefa(), type: "test", dedupeKey: "test:b:velho2" }, db, { audiencia: ["b@zxp.com"] });
    await createNotificationEventIdempotent({ ...tarefa(), type: "test", dedupeKey: "test:b:novo2" }, db, { audiencia: ["b@zxp.com"] });
    const velho = { createdAt: new Date(Date.now() - 8 * 24 * 3600 * 1000) };
    await feed("a@zxp.com", "test:a:velho2").update(velho);
    await feed("b@zxp.com", "test:b:velho2").update(velho);
    // O pai nunca foi gravado: é isso que o caminho real produz.
    expect((await db.collection("notification_feed").doc("a@zxp.com").get()).exists).toBe(false);

    expect(await limparTestesDosFeeds(db)).toBe(2);
    expect((await feed("a@zxp.com", "test:a:velho2").get()).exists).toBe(false);
    expect((await feed("b@zxp.com", "test:b:velho2").get()).exists).toBe(false);
    expect((await feed("b@zxp.com", "test:b:novo2").get()).exists).toBe(true);
  });
});
