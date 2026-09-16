import { describe, it, expect } from "vitest";
import { serializar, desserializar, linhaDoDump, lerLinhaDoDump } from "./backup-serie";

/** Um Timestamp do Firestore, só no que o serializador olha. */
const ts = (iso: string) => ({ toDate: () => new Date(iso) });

/** Uma DocumentReference. */
const ref = (path: string) => ({ path, id: path.split("/").pop() ?? "" });

/** As fábricas do lado da volta — aqui, marcadores que dá pra inspecionar. */
const FABRICAS = {
  paraData: (iso: string) => ({ __eh: "Data", iso }),
  paraRef: (path: string) => ({ __eh: "Ref", path }),
};

describe("serializar", () => {
  it("marca o Timestamp em vez de virar mapa de campos internos", () => {
    expect(serializar(ts("2026-09-16T12:00:00.000Z")))
      .toEqual({ __tipo: "timestamp", iso: "2026-09-16T12:00:00.000Z" });
  });

  it("marca a referência pelo caminho", () => {
    expect(serializar(ref("estoque/p1"))).toEqual({ __tipo: "ref", path: "estoque/p1" });
  });

  it("Timestamp vem ANTES de objeto — invertendo, ele viraria um mapa", () => {
    const s = serializar(ts("2026-01-01T00:00:00.000Z")) as Record<string, unknown>;
    expect(s.__tipo).toBe("timestamp");
    expect(s.toDate).toBeUndefined();
  });

  it("referência vem antes de objeto pelo mesmo motivo", () => {
    const s = serializar(ref("a/b")) as Record<string, unknown>;
    expect(s.__tipo).toBe("ref");
    expect(s.id).toBeUndefined();
  });

  it("desce em objeto aninhado", () => {
    const s = serializar({ nome: "x", meta: { criadoEm: ts("2026-05-05T00:00:00.000Z") } }) as Record<string, Record<string, unknown>>;
    expect(s.meta.criadoEm).toEqual({ __tipo: "timestamp", iso: "2026-05-05T00:00:00.000Z" });
  });

  it("desce em array, inclusive de objetos", () => {
    const s = serializar([1, ts("2026-02-02T00:00:00.000Z"), { a: ref("c/d") }]) as unknown[];
    expect(s[0]).toBe(1);
    expect(s[1]).toEqual({ __tipo: "timestamp", iso: "2026-02-02T00:00:00.000Z" });
    expect((s[2] as Record<string, unknown>).a).toEqual({ __tipo: "ref", path: "c/d" });
  });

  it("preserva null e undefined — e os dois são diferentes", () => {
    expect(serializar(null)).toBeNull();
    expect(serializar(undefined)).toBeUndefined();
  });

  it("deixa escalar em paz, inclusive string de data desta base", () => {
    // Esta base guarda data como string ISO e epoch. Nenhuma das duas pode
    // virar marcação — elas já são o valor.
    expect(serializar("2026-09-09")).toBe("2026-09-09");
    expect(serializar(1788991355418)).toBe(1788991355418);
    expect(serializar(false)).toBe(false);
  });
});

describe("desserializar", () => {
  it("reconstrói a data a partir da marca", () => {
    expect(desserializar({ __tipo: "timestamp", iso: "2026-09-16T12:00:00.000Z" }, FABRICAS))
      .toEqual({ __eh: "Data", iso: "2026-09-16T12:00:00.000Z" });
  });

  it("reconstrói a referência", () => {
    expect(desserializar({ __tipo: "ref", path: "estoque/p1" }, FABRICAS))
      .toEqual({ __eh: "Ref", path: "estoque/p1" });
  });

  it("marca incompleta não vira data — fica como o mapa que é", () => {
    // Sem `iso`, chamar a fábrica produziria Invalid Date gravado no banco.
    const r = desserializar({ __tipo: "timestamp" }, FABRICAS);
    expect(r).toEqual({ __tipo: "timestamp" });
  });

  it("um campo chamado __tipo que não é marca sobrevive", () => {
    const r = desserializar({ __tipo: "produto", nome: "x" }, FABRICAS) as Record<string, unknown>;
    expect(r.__tipo).toBe("produto");
    expect(r.nome).toBe("x");
  });
});

describe("a ida e a volta fecham", () => {
  it("documento com data, referência, aninhamento e array", () => {
    const original = {
      nome: "Suplemento Menta",
      custoMedio: 18.4,
      ativo: true,
      criadoEm: ts("2026-03-01T10:30:00.000Z"),
      dono: ref("controleAcesso/caualm4@gmail.com"),
      faixas: [
        { desde: "2026-01-01", custo: 12.9 },
        { desde: "2026-08-12", custo: 18.4, em: ts("2026-08-12T00:00:00.000Z") },
      ],
      meta: { nota: null, revisadoEm: ts("2026-09-01T00:00:00.000Z") },
    };

    const volta = desserializar(serializar(original), FABRICAS) as Record<string, unknown>;

    expect(volta.nome).toBe("Suplemento Menta");
    expect(volta.custoMedio).toBe(18.4);
    expect(volta.ativo).toBe(true);
    expect(volta.criadoEm).toEqual({ __eh: "Data", iso: "2026-03-01T10:30:00.000Z" });
    expect(volta.dono).toEqual({ __eh: "Ref", path: "controleAcesso/caualm4@gmail.com" });

    const faixas = volta.faixas as Record<string, unknown>[];
    expect(faixas[0]).toEqual({ desde: "2026-01-01", custo: 12.9 });
    expect(faixas[1].em).toEqual({ __eh: "Data", iso: "2026-08-12T00:00:00.000Z" });

    expect((volta.meta as Record<string, unknown>).nota).toBeNull();
  });

  it("documento só com escalares — o formato real desta base", () => {
    // Medido no dump de produção: esta base não usa Timestamp em lugar nenhum.
    // Datas são string ISO e epoch em milissegundos. A ida e a volta não podem
    // mexer em nada disso.
    const original = {
      data: "2026-09-09",
      createdAt: 1788991355418,
      quantidade: -3,
      obs: "",
      custoUnit: "18.40",
    };
    expect(desserializar(serializar(original), FABRICAS)).toEqual(original);
  });

  it("valor profundamente aninhado sobrevive", () => {
    const original = { a: { b: { c: { d: [{ e: ts("2026-06-06T00:00:00.000Z") }] } } } };
    const v = desserializar(serializar(original), FABRICAS);

    // Desce campo a campo em vez de `as any`: se a estrutura mudar, o teste
    // aponta em QUAL nível quebrou, e não numa linha de acesso encadeado.
    const a = (v as Record<string, unknown>).a as Record<string, unknown>;
    const b = a.b as Record<string, unknown>;
    const c = b.c as Record<string, unknown>;
    const d = c.d as Record<string, unknown>[];
    expect(d[0].e).toEqual({ __eh: "Data", iso: "2026-06-06T00:00:00.000Z" });
  });
});

describe("linha do dump", () => {
  it("uma linha por documento, com o caminho junto", () => {
    const l = linhaDoDump("estoque/p1", { nome: "x", em: ts("2026-01-01T00:00:00.000Z") });
    expect(l).not.toContain("\n");
    expect(JSON.parse(l).caminho).toBe("estoque/p1");
  });

  it("lê de volta o que escreveu", () => {
    const l = linhaDoDump("estoque/p1", { nome: "x", em: ts("2026-01-01T00:00:00.000Z") });
    const { caminho, dados } = lerLinhaDoDump(l, FABRICAS);
    expect(caminho).toBe("estoque/p1");
    expect((dados as Record<string, unknown>).em).toEqual({ __eh: "Data", iso: "2026-01-01T00:00:00.000Z" });
  });

  it("caminho de subcoleção sobrevive inteiro", () => {
    const l = linhaDoDump("usuarios/u1/preferences/tema", { escuro: true });
    expect(lerLinhaDoDump(l, FABRICAS).caminho).toBe("usuarios/u1/preferences/tema");
  });
});
