import { describe, expect, it } from "vitest";
import {
  celulaCsv, devidoDe, gerarDaRecorrencia, novosPelaReferencia, posicaoDaConta, registrarBaixa,
  resultadoDoPeriodo, situacaoDe, transferir, type Conta, type Movimento, type Obrigacao,
} from "./modelo";

const obrig = (p: Partial<Obrigacao> = {}): Obrigacao => ({
  id: "o1", descricao: "Contador", categoria: "Serviços", favorecido: "Escritório", competencia: "2026-11",
  vencimento: "2026-11-10", centavos: 50000, natureza: "despesa", baixas: [], ...p,
});
const mov = (p: Partial<Movimento>): Movimento => ({
  id: "m", contaId: "mp", centavos: 0, natureza: "receita", data: "2026-11-05", descricao: "", categoria: "", origem: "manual", ...p,
});

describe("contas a pagar", () => {
  it("prevista não é saída; baixa parcial reduz o devido; não passa do que falta", () => {
    const o = obrig();
    expect(devidoDe(o)).toBe(50000);
    const b1 = registrarBaixa(o, { contaId: "mp", centavos: 20000, data: "2026-11-08", movimentoId: "pg1" });
    expect(b1.ok && devidoDe(b1.obrigacao)).toBe(30000);
    expect(b1.ok && b1.movimento.centavos).toBe(-20000);
    const demais = b1.ok ? registrarBaixa(b1.obrigacao, { contaId: "mp", centavos: 30001, data: "2026-11-09", movimentoId: "pg2" }) : b1;
    expect(demais.ok).toBe(false);
  });
  it("o mesmo pagamento duas vezes não duplica", () => {
    const b1 = registrarBaixa(obrig(), { contaId: "mp", centavos: 100, data: "2026-11-08", movimentoId: "pg1" });
    const b2 = b1.ok ? registrarBaixa(b1.obrigacao, { contaId: "mp", centavos: 100, data: "2026-11-08", movimentoId: "pg1" }) : b1;
    expect(b2.ok).toBe(false);
  });
  it("situação: vencida, parcial, paga", () => {
    expect(situacaoDe(obrig(), "2026-11-11")).toBe("vencida");
    expect(situacaoDe(obrig({ baixas: [{ movimentoId: "x", centavos: 1, data: "2026-11-01" }] }), "2026-11-01")).toBe("parcial");
    expect(situacaoDe(obrig({ baixas: [{ movimentoId: "x", centavos: 50000, data: "2026-11-01" }] }), "2026-12-01")).toBe("paga");
  });
});

describe("recorrência", () => {
  const r = { id: "aluguel", descricao: "Aluguel", categoria: "Estrutura", favorecido: "X", centavos: 100000, natureza: "despesa" as const, diaVencimento: 31, desde: "2026-01" };
  it("uma por competência; dia 31 vira o último dia em fevereiro", () => {
    const os = gerarDaRecorrencia(r, "2026-03", new Set());
    expect(os.map((o) => o.vencimento)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });
  it("gerar de novo não duplica", () => {
    const primeira = gerarDaRecorrencia(r, "2026-03", new Set());
    const segunda = gerarDaRecorrencia(r, "2026-04", new Set(primeira.map((o) => o.id)));
    expect(segunda.map((o) => o.competencia)).toEqual(["2026-04"]);
  });
});

describe("caixa", () => {
  it("transferência MP → banco não vira receita nem despesa", () => {
    const t = transferir({ id: "t1", de: "mp", para: "banco", centavos: 8200, data: "2026-11-10" })!;
    expect(resultadoDoPeriodo(t, "2026-11-01", "2026-11-30").resultado).toBe(0);
    expect(t[0].centavos + t[1].centavos).toBe(0);
  });
  it("sem saldo de abertura não existe saldo — só movimentação", () => {
    const sem: Conta = { id: "mp", nome: "Mercado Pago", tipo: "mercado_pago", ativa: true };
    expect(posicaoDaConta(sem, [mov({ centavos: 500 })]).tipo).toBe("so_movimentacao");
    const com: Conta = { ...sem, abertura: { centavos: 10000, data: "2026-11-01", comprovacao: "print do app" } };
    const p = posicaoDaConta(com, [mov({ centavos: 500, data: "2026-10-31" }), mov({ centavos: 2000, data: "2026-11-02" })]);
    expect(p).toMatchObject({ tipo: "saldo", centavos: 12000 });
  });
  it("compra de estoque e retirada saem do caixa mas não do resultado", () => {
    const r = resultadoDoPeriodo([
      mov({ centavos: 10000, natureza: "receita" }),
      mov({ centavos: -3000, natureza: "despesa" }),
      mov({ centavos: -5000, natureza: "compra_estoque" }),
      mov({ centavos: -1000, natureza: "retirada" }),
    ], "2026-11-01", "2026-11-30");
    expect(r).toMatchObject({ resultado: 7000, compraEstoque: -5000, retiradas: -1000 });
  });
  it("importação deduplica pela referência, não por valor+data", () => {
    const ja = [mov({ id: "a", refExterna: "mp-1", centavos: 500 })];
    const chegando = [mov({ id: "b", refExterna: "mp-1", centavos: 500 }), mov({ id: "c", centavos: 500 }), mov({ id: "d", centavos: 500 })];
    expect(novosPelaReferencia(ja, chegando).map((m) => m.id)).toEqual(["c", "d"]);
  });
  it("CSV não executa fórmula importada", () => {
    expect(celulaCsv("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(celulaCsv("-12,50")).toBe("'-12,50");
    expect(celulaCsv("Contador")).toBe("Contador");
  });
});
