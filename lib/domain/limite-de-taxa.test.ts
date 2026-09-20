import { describe, expect, it } from "vitest";
import { consumirLimite, type EstadoDoLimite } from "./limite-de-taxa";

const T0 = 1_800_000_000_000;
const cfg = { max: 3, janelaMs: 60_000 };

function repetir(n: number, agora: number, inicial: EstadoDoLimite | null = null) {
  let estado = inicial;
  const permitidos: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const r = consumirLimite(estado, agora + i, cfg);
    permitidos.push(r.permitido);
    estado = r.estado;
  }
  return { permitidos, estado };
}

describe("consumirLimite", () => {
  it("deixa passar até o máximo e recusa o excedente", () => {
    expect(repetir(5, T0).permitidos).toEqual([true, true, true, false, false]);
  });

  it("a recusa diz quanto esperar", () => {
    const { estado } = repetir(3, T0);
    const r = consumirLimite(estado, T0 + 10_000, cfg);
    expect(r.permitido).toBe(false);
    expect(r.esperarSegundos).toBe(50);
  });

  it("depois da janela, reabre do zero", () => {
    const { estado } = repetir(3, T0);
    const r = consumirLimite(estado, T0 + 60_000, cfg);
    expect(r.permitido).toBe(true);
    expect(r.estado).toEqual({ inicio: T0 + 60_000, contagem: 1 });
  });

  it("recusar não consome: o contador não passa do máximo", () => {
    const { estado } = repetir(10, T0);
    expect(estado?.contagem).toBe(3);
  });

  it("relógio voltando (estado do futuro) abre janela nova em vez de travar pra sempre", () => {
    const r = consumirLimite({ inicio: T0 + 999_999_999, contagem: 99 }, T0, cfg);
    expect(r.permitido).toBe(true);
  });

  it("sem estado: primeira ação passa", () => {
    expect(consumirLimite(null, T0, cfg)).toMatchObject({ permitido: true, estado: { inicio: T0, contagem: 1 } });
  });
});
