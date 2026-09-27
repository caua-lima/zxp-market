import { describe, expect, it } from "vitest";
import {
  bloqueioPara,
  deStatusDoProvedor,
  direitosDaEmpresa,
  estadoEfetivo,
  planoDoPreco,
  podeAdicionarMembro,
  podeConectarConta,
  trialNovo,
  type AssinaturaDoProvedor,
} from "./assinatura";

const DIA = 86_400_000;
const T0 = Date.UTC(2026, 8, 1);
const env = { STRIPE_PRICE_ESSENCIAL: "price_ess", STRIPE_PRICE_PROFISSIONAL: "price_pro" };

const sub = (p: Partial<AssinaturaDoProvedor>): AssinaturaDoProvedor => ({
  id: "sub_1", clienteId: "cus_1", status: "active", precoId: "price_ess", periodoFim: T0 + 30 * DIA,
  cancelaNoFimDoPeriodo: false, canceladaEm: null, trialFim: null, tenantId: "emp-a", ...p,
});

describe("S25 — máquina de estados da assinatura", () => {
  it("sem assinatura gravada = interna (a operação que já existia): sem limite, sem bloqueio", () => {
    expect(direitosDaEmpresa(null, T0)).toEqual({ plano: "interno", estado: "interna", bloqueada: false, membros: null, conexoes: null });
  });

  it("trial local: vale até o fim; no dia seguinte, encerrado e bloqueado", () => {
    const t = trialNovo(T0);
    expect(estadoEfetivo(t, T0 + 13 * DIA)).toBe("trial");
    expect(estadoEfetivo(t, T0 + 14 * DIA)).toBe("trial_encerrado");
    expect(bloqueioPara(t, T0 + 14 * DIA)).toMatchObject({ motivo: "trial_encerrado" });
    expect(bloqueioPara(t, T0)).toBeNull();
  });

  it("cobrança falhou: carência de 7 dias com acesso normal, depois inadimplente e bloqueada", () => {
    const a = deStatusDoProvedor(sub({ status: "past_due" }), null, { agora: T0, env });
    expect(a).toMatchObject({ estado: "carencia", falhouEm: T0 });
    expect(direitosDaEmpresa(a, T0 + 6 * DIA).bloqueada).toBe(false);
    expect(direitosDaEmpresa(a, T0 + 7 * DIA)).toMatchObject({ estado: "inadimplente", bloqueada: true });
  });

  it("um retry que falha de novo NÃO renova a carência (conta da primeira falha)", () => {
    const primeira = deStatusDoProvedor(sub({ status: "past_due" }), null, { agora: T0, env });
    const retry = deStatusDoProvedor(sub({ status: "past_due" }), primeira, { agora: T0 + 3 * DIA, env });
    expect(retry.falhouEm).toBe(T0);
  });

  it("pagou depois de falhar: volta a ativa e limpa a falha", () => {
    const falhou = deStatusDoProvedor(sub({ status: "past_due" }), null, { agora: T0, env });
    expect(deStatusDoProvedor(sub({ status: "active" }), falhou, { agora: T0 + DIA, env })).toMatchObject({ estado: "ativa", falhouEm: null });
  });

  it("cancelar no fim do período: continua ativa com cancelaEm; cancelada de fato bloqueia sem apagar", () => {
    const agendado = deStatusDoProvedor(sub({ cancelaNoFimDoPeriodo: true }), null, { agora: T0, env });
    expect(agendado).toMatchObject({ estado: "ativa", cancelaEm: T0 + 30 * DIA });
    const cancelada = deStatusDoProvedor(sub({ status: "canceled" }), agendado, { agora: T0 + 31 * DIA, env });
    expect(direitosDaEmpresa(cancelada, T0 + 31 * DIA)).toMatchObject({ estado: "cancelada", bloqueada: true });
  });

  it("todos os status do Stripe têm destino", () => {
    const destinos = Object.fromEntries(
      ["trialing", "active", "incomplete", "incomplete_expired", "past_due", "unpaid", "canceled", "paused", "algo_novo"].map((s) => [
        s, deStatusDoProvedor(sub({ status: s }), null, { agora: T0, env }).estado,
      ]),
    );
    expect(destinos).toEqual({
      trialing: "trial", active: "ativa", incomplete: "incompleta", incomplete_expired: "cancelada", past_due: "carencia",
      unpaid: "inadimplente", canceled: "cancelada", paused: "inadimplente", algo_novo: "cancelada",
    });
  });

  it("upgrade/downgrade: o plano sai do PREÇO da assinatura, conferido contra as variáveis", () => {
    expect(planoDoPreco("price_pro", env)).toBe("profissional");
    expect(planoDoPreco("price_desconhecido", env)).toBeNull();
    const up = deStatusDoProvedor(sub({ precoId: "price_pro" }), null, { agora: T0, env });
    expect(direitosDaEmpresa(up, T0)).toMatchObject({ plano: "profissional", membros: 10 });
  });

  it("limites: conta o dono; plano rebaixado com gente acima do limite não remove ninguém, só barra novos", () => {
    const d = direitosDaEmpresa(deStatusDoProvedor(sub({}), null, { agora: T0, env }), T0);
    expect(podeAdicionarMembro(d, 2)).toBe(true);
    expect(podeAdicionarMembro(d, 3)).toBe(false);
    expect(podeAdicionarMembro(d, 7)).toBe(false);
    expect(podeConectarConta(d, 0)).toBe(true);
    expect(podeConectarConta(d, 1)).toBe(false);
    const bloqueada = direitosDaEmpresa(trialNovo(T0), T0 + 20 * DIA);
    expect(podeAdicionarMembro(bloqueada, 0)).toBe(false);
    expect(podeConectarConta(bloqueada, 0)).toBe(false);
  });
});
