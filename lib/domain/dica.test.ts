import { describe, expect, it } from "vitest";
import { deslocamentoDaDica } from "./dica";

describe("S28 — dica sem sair da tela", () => {
  it("no meio da tela não desloca", () => {
    expect(deslocamentoDaDica({ centro: 600, largura: 210, larguraTela: 1363 })).toBe(0);
  });
  it("ícone perto da borda direita: puxa pra dentro até a margem (o caso do Dashboard em 1363 px)", () => {
    // centro 1290 → a dica ia de 1185 a 1395; tem que acabar em 1351.
    expect(deslocamentoDaDica({ centro: 1290, largura: 210, larguraTela: 1363 })).toBe(-44);
  });
  it("ícone perto da borda esquerda: empurra pra direita", () => {
    expect(deslocamentoDaDica({ centro: 40, largura: 210, larguraTela: 375 })).toBe(77);
  });
  it("tela mais estreita que a dica: a dica encolhe e fica centrada na tela", () => {
    expect(deslocamentoDaDica({ centro: 300, largura: 210, larguraTela: 200 })).toBe(-200);
  });
});
