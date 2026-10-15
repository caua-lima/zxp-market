import { describe, expect, it } from "vitest";
import {
  dataValida,
  disponivelParaAgencias,
  quandoFalta,
  reservasPorProduto,
  rotuloDoDia,
  validarEnvio,
  type EnvioFullAgendado,
  type SaidaFull,
} from "./envio-full-agendado";

const HOJE = "2026-10-15"; // quinta
const envio = (x: Partial<EnvioFullAgendado> & { id: string }): EnvioFullAgendado => ({
  productId: "limao", quantidade: 199, data: "2026-10-21", criadoEm: "2026-10-15", status: "agendado", ...x,
});
const saida = (quantidade: number, data: string, productId = "limao"): SaidaFull => ({ productId, tipo: "saida_full", quantidade, data });

describe("o caso do limão caipira: entram 379, 199 vão pro Full na quarta", () => {
  it("as agências ficam com 180, não com 379", () => {
    const r = reservasPorProduto([envio({ id: "a" })], [], HOJE).get("limao")!;
    expect(r.reservado).toBe(199);
    expect(r.proximaData).toBe("2026-10-21");
    expect(disponivelParaAgencias(379, r.reservado)).toEqual({ livre: 180, reservado: 199, faltam: 0 });
  });

  it("depois que a baixa de 199 é lançada, o livro caiu e a reserva some — sem descontar duas vezes", () => {
    const r = reservasPorProduto([envio({ id: "a" })], [saida(199, "2026-10-21")], HOJE).get("limao")!;
    expect(r.reservado).toBe(0);
    expect(r.envios[0]).toMatchObject({ atendido: 199, restante: 0, atrasado: false });
    // O galpão agora tem 379 − 199 = 180 no livro e nada reservado: continua 180.
    expect(disponivelParaAgencias(180, r.reservado).livre).toBe(180);
  });

  it("baixa parcial abate só o que saiu", () => {
    const r = reservasPorProduto([envio({ id: "a" })], [saida(150, "2026-10-21")], HOJE).get("limao")!;
    expect(r.reservado).toBe(49);
    expect(r.envios[0].atendido).toBe(150);
  });
});

describe("a reserva só vale enquanto o envio está em aberto", () => {
  it("enviado e cancelado não seguram unidade", () => {
    const m = reservasPorProduto([
      envio({ id: "a", status: "enviado" }),
      envio({ id: "b", status: "cancelado" }),
    ], [], HOJE);
    expect(m.size).toBe(0);
  });

  it("vários envios do mesmo produto somam; produtos diferentes não se misturam", () => {
    const m = reservasPorProduto([
      envio({ id: "a", quantidade: 100, data: "2026-10-21" }),
      envio({ id: "b", quantidade: 60, data: "2026-10-28" }),
      envio({ id: "c", productId: "menta", quantidade: 40 }),
    ], [], HOJE);
    expect(m.get("limao")!.reservado).toBe(160);
    expect(m.get("limao")!.proximaData).toBe("2026-10-21");
    expect(m.get("menta")!.reservado).toBe(40);
  });

  it("a saída abate o envio mais próximo primeiro", () => {
    const r = reservasPorProduto([
      envio({ id: "longe", quantidade: 60, data: "2026-10-28" }),
      envio({ id: "perto", quantidade: 100, data: "2026-10-21" }),
    ], [saida(100, "2026-10-21")], HOJE).get("limao")!;
    const por = Object.fromEntries(r.envios.map((e) => [e.envio.id, e.restante]));
    expect(por).toEqual({ perto: 0, longe: 60 });
    expect(r.reservado).toBe(60);
    expect(r.proximaData).toBe("2026-10-28");
  });

  it("saída de ANTES do agendamento não apaga a reserva nova", () => {
    const r = reservasPorProduto([envio({ id: "a", criadoEm: "2026-10-15" })], [saida(199, "2026-10-10")], HOJE).get("limao")!;
    expect(r.reservado).toBe(199);
  });

  it("saída de outro produto, ou que não é saída pro Full, não abate", () => {
    const r = reservasPorProduto([envio({ id: "a" })], [
      saida(199, "2026-10-21", "menta"),
      { productId: "limao", tipo: "entrada", quantidade: 199, data: "2026-10-21" },
    ], HOJE).get("limao")!;
    expect(r.reservado).toBe(199);
  });

  it("uma saída grande não abate mais de uma vez a mesma unidade", () => {
    const r = reservasPorProduto([
      envio({ id: "a", quantidade: 100, data: "2026-10-21" }),
      envio({ id: "b", quantidade: 100, data: "2026-10-28" }),
    ], [saida(130, "2026-10-21")], HOJE).get("limao")!;
    expect(r.reservado).toBe(70); // 200 − 130
  });
});

describe("envio atrasado", () => {
  it("passou do dia e ainda sobra reserva: avisa", () => {
    const r = reservasPorProduto([envio({ id: "a", data: "2026-10-13", criadoEm: "2026-10-08" })], [], HOJE).get("limao")!;
    expect(r.envios[0].atrasado).toBe(true);
    expect(r.reservado).toBe(199); // ainda segura: a pessoa decide cancelar ou lançar a baixa
  });
  it("hoje ainda não é atraso; atendido por inteiro nunca é", () => {
    expect(reservasPorProduto([envio({ id: "a", data: HOJE })], [], HOJE).get("limao")!.envios[0].atrasado).toBe(false);
    expect(reservasPorProduto([envio({ id: "a", data: "2026-10-13", criadoEm: "2026-10-08" })], [saida(199, "2026-10-13")], HOJE).get("limao")!.envios[0].atrasado).toBe(false);
  });
});

describe("disponível pras agências", () => {
  it("reservou mais do que tem em casa: livre é 0 e mostra quanto falta", () => {
    expect(disponivelParaAgencias(180, 199)).toEqual({ livre: 0, reservado: 199, faltam: 19 });
  });
  it("saldo negativo no livro conta como zero", () => {
    expect(disponivelParaAgencias(-5, 0)).toEqual({ livre: 0, reservado: 0, faltam: 0 });
    expect(disponivelParaAgencias(-5, 10)).toEqual({ livre: 0, reservado: 10, faltam: 10 });
  });
  it("sem reserva, é tudo que está em casa", () => {
    expect(disponivelParaAgencias(379, 0).livre).toBe(379);
  });
});

describe("validação do agendamento", () => {
  const ok = { productId: "limao", quantidade: 199, data: "2026-10-21" };
  it("aceita um envio normal", () => expect(validarEnvio(ok, HOJE)).toBeNull());
  it("aceita hoje", () => expect(validarEnvio({ ...ok, data: HOJE }, HOJE)).toBeNull());
  it("recusa quantidade zero, negativa, fracionada ou NaN", () => {
    for (const q of [0, -1, 1.5, NaN]) expect(validarEnvio({ ...ok, quantidade: q }, HOJE)).toMatch(/inteiro/);
  });
  it("recusa dia passado, inexistente ou vazio", () => {
    expect(validarEnvio({ ...ok, data: "2026-10-14" }, HOJE)).toMatch(/passou/);
    expect(validarEnvio({ ...ok, data: "2026-02-30" }, HOJE)).toMatch(/dia do envio/);
    expect(validarEnvio({ ...ok, data: "" }, HOJE)).toMatch(/dia do envio/);
  });
  it("recusa sem produto", () => expect(validarEnvio({ ...ok, productId: " " }, HOJE)).toMatch(/produto/));
  it("dataValida", () => {
    expect(dataValida("2026-02-28")).toBe(true);
    expect(dataValida("2026-02-29")).toBe(false);
    expect(dataValida("21/10/2026")).toBe(false);
    expect(dataValida(null)).toBe(false);
  });
});

describe("texto do dia", () => {
  it("dia da semana: 21/10/2026 é quarta", () => expect(rotuloDoDia("2026-10-21")).toBe("qua, 21/10"));
  it("data inválida volta como veio", () => expect(rotuloDoDia("xx")).toBe("xx"));
  it("quando falta", () => {
    expect(quandoFalta("2026-10-15", HOJE)).toBe("hoje");
    expect(quandoFalta("2026-10-16", HOJE)).toBe("amanhã");
    expect(quandoFalta("2026-10-21", HOJE)).toBe("em 6 dias");
    expect(quandoFalta("2026-10-13", HOJE)).toBe("há 2 dias");
  });
});
