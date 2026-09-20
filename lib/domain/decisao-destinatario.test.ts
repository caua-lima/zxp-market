import { describe, expect, it } from "vitest";
import { MAX_ADIAMENTOS_POR_PREFERENCIA, decidirDestinatario } from "./decisao-destinatario";
import {
  interpretarPreferencias,
  preferenciasIndisponiveis,
  type LeituraDePreferencias,
} from "./notification-preferences";
import type { AcessoDoDestinatario } from "./notificacao-publico";
import type { SalePushPayload } from "./notifications";

/** 2026-09-22 (terça) 15:00 UTC = 12:00 em Brasília. */
const MEIO_DIA = Date.UTC(2026, 8, 22, 15, 0);
/** 2026-09-22 (terça) 06:00 UTC = 03:00 em Brasília. */
const TRES_DA_MANHA = Date.UTC(2026, 8, 22, 6, 0);

const DONO: AcessoDoDestinatario = { papel: "owner", permissoesEdicao: [] };
const MEMBRO: AcessoDoDestinatario = { papel: "member", permissoesEdicao: [] };

const venda = (over: Partial<SalePushPayload> = {}): Pick<SalePushPayload, "type" | "grossAmount" | "financialState"> => ({
  type: "sale_paid", grossAmount: "129.90", financialState: "estimated", ...over,
});

function decidir(over: Partial<Parameters<typeof decidirDestinatario>[0]> = {}) {
  return decidirDestinatario({
    type: "sale_paid", isSummary: false, payload: venda(), acesso: DONO,
    leitura: interpretarPreferencias(undefined), adiamentos: 0, agora: MEIO_DIA, ...over,
  });
}

describe("decidirDestinatario", () => {
  it("dono sem preferência salva: envia completo — o app continua como sempre foi", () => {
    expect(decidir()).toEqual({ acao: "enviar", nivel: "completo", tipo: "sale_paid" });
  });

  it("member: envia, sem financeiro", () => {
    expect(decidir({ acesso: MEMBRO })).toMatchObject({ acao: "enviar", nivel: "sem_financeiro" });
  });

  it("dono que desligou o financeiro: sem financeiro", () => {
    const leitura = interpretarPreferencias({ showFinancialValuesInPush: false });
    expect(decidir({ leitura })).toMatchObject({ acao: "enviar", nivel: "sem_financeiro" });
  });

  it("perdeu o acesso: suprime — a decisão é do momento do envio", () => {
    expect(decidir({ acesso: undefined })).toEqual({ acao: "suprimir", motivo: "sem_acesso" });
  });

  it("desligou aquele tipo: suprime, dizendo que foi o toggle", () => {
    const leitura = interpretarPreferencias({ toggles: { sale_paid: false } });
    expect(decidir({ leitura })).toEqual({ acao: "suprimir", motivo: "preferencia_toggle" });
  });

  it("horário silencioso derruba o não crítico, dizendo que foi o horário", () => {
    const leitura = interpretarPreferencias({ quietHoursEnabled: true });
    expect(decidir({ leitura, agora: TRES_DA_MANHA })).toEqual({ acao: "suprimir", motivo: "horario_silencioso" });
  });

  it("mas prejuízo é crítico e atravessa o horário silencioso", () => {
    const leitura = interpretarPreferencias({ quietHoursEnabled: true });
    expect(decidir({ type: "sale_negative_margin", payload: venda({ type: "sale_negative_margin" }), leitura, agora: TRES_DA_MANHA }))
      .toMatchObject({ acao: "enviar", nivel: "completo" });
  });

  it("…a menos que a pessoa tenha desligado a travessia dos críticos", () => {
    const leitura = interpretarPreferencias({ quietHoursEnabled: true, quietHoursCriticalBypass: false });
    expect(decidir({ type: "sale_negative_margin", payload: venda({ type: "sale_negative_margin" }), leitura, agora: TRES_DA_MANHA }))
      .toEqual({ acao: "suprimir", motivo: "horario_silencioso" });
  });

  it("crítico atravessa o silêncio mas NUNCA o toggle do próprio tipo", () => {
    const leitura = interpretarPreferencias({ quietHoursEnabled: true, toggles: { sale_cancelled: false } });
    expect(decidir({ type: "sale_cancelled", payload: venda({ type: "sale_cancelled" }), leitura, agora: TRES_DA_MANHA }))
      .toEqual({ acao: "suprimir", motivo: "preferencia_toggle" });
  });

  it("o silêncio é lido no fuso DA PESSOA: o mesmo instante cai dentro ou fora conforme o fuso escolhido", () => {
    const leitura = interpretarPreferencias({ quietHoursEnabled: true, quietHoursStart: "07:00", quietHoursEnd: "09:00", quietHoursTimezone: "America/New_York" });
    // 15:00 UTC = 11:00 em NY (verão) — fora de 07–09.
    expect(decidir({ leitura })).toMatchObject({ acao: "enviar" });
    // 12:00 UTC = 08:00 em NY — dentro.
    expect(decidir({ leitura, agora: Date.UTC(2026, 8, 22, 12, 0) })).toEqual({ acao: "suprimir", motivo: "horario_silencioso" });
  });
});

describe("limiar de alto valor por pessoa (N11)", () => {
  const alto = venda({ type: "sale_high_value", grossAmount: "300.00" });

  it("A (limiar 250) recebe a venda de R$ 300 como ALTO VALOR", () => {
    const a = interpretarPreferencias({ highValueThreshold: 250 });
    expect(decidir({ type: "sale_high_value", payload: alto, leitura: a })).toMatchObject({ acao: "enviar", tipo: "sale_high_value" });
  });

  it("B (limiar 1000) recebe a MESMA venda como venda comum", () => {
    const b = interpretarPreferencias({ highValueThreshold: 1000 });
    expect(decidir({ type: "sale_high_value", payload: alto, leitura: b })).toMatchObject({ acao: "enviar", tipo: "sale_paid" });
  });

  it("o toggle checado é o do tipo que a pessoa VÊ: B com 'venda comum' desligada não recebe", () => {
    const b = interpretarPreferencias({ highValueThreshold: 1000, toggles: { sale_paid: false } });
    expect(decidir({ type: "sale_high_value", payload: alto, leitura: b })).toEqual({ acao: "suprimir", motivo: "preferencia_toggle" });
  });

  it("A com 'alto valor' desligado e a venda de R$ 300: não recebe (é alto valor pra ela)", () => {
    const a = interpretarPreferencias({ highValueThreshold: 250, toggles: { sale_high_value: false } });
    expect(decidir({ type: "sale_high_value", payload: alto, leitura: a })).toEqual({ acao: "suprimir", motivo: "preferencia_toggle" });
  });

  it("limiar BAIXO transforma venda comum em alto valor pra quem pediu", () => {
    const c = interpretarPreferencias({ highValueThreshold: 100 });
    expect(decidir({ payload: venda({ grossAmount: "150.00" }), leitura: c })).toMatchObject({ tipo: "sale_high_value" });
  });

  it("margem baixa e prejuízo NÃO dependem do limiar — são risco, não valor", () => {
    const c = interpretarPreferencias({ highValueThreshold: 10 });
    expect(decidir({ type: "sale_low_margin", payload: venda({ type: "sale_low_margin", grossAmount: "500.00" }), leitura: c }))
      .toMatchObject({ tipo: "sale_low_margin" });
  });

  it("sem dado financeiro calculado, não inventa classificação por valor", () => {
    const b = interpretarPreferencias({ highValueThreshold: 1 });
    expect(decidir({ payload: venda({ financialState: "unavailable" }), leitura: b })).toMatchObject({ tipo: "sale_paid" });
  });
});

describe("rajada de vendas — agrupamento por pessoa (N11/N12)", () => {
  const agrupa = interpretarPreferencias({ groupFastSales: true });
  const individual = interpretarPreferencias({ groupFastSales: false });

  it("o aviso avulso de uma venda que caiu na rajada: quem AGRUPA não recebe — e isso não é falha", () => {
    expect(decidir({ rajada: "individual_agrupada", leitura: agrupa })).toEqual({ acao: "suprimir", motivo: "agrupada_em_resumo" });
  });

  it("…quem NÃO agrupa recebe cada venda", () => {
    expect(decidir({ rajada: "individual_agrupada", leitura: individual })).toMatchObject({ acao: "enviar" });
  });

  it("o resumo da rajada: quem agrupa recebe", () => {
    expect(decidir({ isSummary: true, rajada: "resumo", leitura: agrupa })).toMatchObject({ acao: "enviar" });
  });

  it("…quem não agrupa NÃO recebe o resumo — já recebeu as vendas uma a uma", () => {
    expect(decidir({ isSummary: true, rajada: "resumo", leitura: individual })).toEqual({ acao: "suprimir", motivo: "prefere_individual" });
  });

  it("quem ligou 'agrupar' mas desligou o RESUMO recebe as vendas avulsas — não fica sem nada", () => {
    const l = interpretarPreferencias({ groupFastSales: true, toggles: { sales_summary: false } });
    expect(decidir({ rajada: "individual_agrupada", leitura: l })).toMatchObject({ acao: "enviar" });
    expect(decidir({ isSummary: true, rajada: "resumo", leitura: l })).toEqual({ acao: "suprimir", motivo: "prefere_individual" });
  });

  it("duas pessoas, mesma rajada, decisões diferentes e previsíveis", () => {
    const avulso = [agrupa, individual].map((leitura) => decidir({ rajada: "individual_agrupada", leitura }).acao);
    const resumo = [agrupa, individual].map((leitura) => decidir({ isSummary: true, rajada: "resumo", leitura }).acao);
    expect(avulso).toEqual(["suprimir", "enviar"]);
    expect(resumo).toEqual(["enviar", "suprimir"]);
  });

  it("o resumo respeita o toggle de resumo e o horário silencioso", () => {
    const quieto = interpretarPreferencias({ quietHoursEnabled: true });
    expect(decidir({ isSummary: true, rajada: "resumo", leitura: quieto, agora: TRES_DA_MANHA })).toEqual({ acao: "suprimir", motivo: "horario_silencioso" });
  });
});

describe("preferência ilegível — nunca vira consentimento", () => {
  const indisponivel: LeituraDePreferencias = preferenciasIndisponiveis("firestore: 14");

  it("indisponível: ADIA em vez de descartar ou de decidir no escuro", () => {
    const d = decidir({ leitura: indisponivel });
    expect(d).toMatchObject({ acao: "adiar", motivo: "preferencia_indisponivel" });
    if (d.acao === "adiar") expect(d.ate).toBeGreaterThan(MEIO_DIA);
  });

  it("esgotados os adiamentos, envia a versão SEGURA (sem financeiro), não descarta", () => {
    expect(decidir({ leitura: indisponivel, adiamentos: MAX_ADIAMENTOS_POR_PREFERENCIA })).toMatchObject({ acao: "enviar", nivel: "sem_financeiro" });
  });

  it("documento inválido: envia, mas sem financeiro", () => {
    const leitura = interpretarPreferencias({ showFinancialValuesInPush: "sim" });
    expect(decidir({ leitura })).toMatchObject({ acao: "enviar", nivel: "sem_financeiro" });
  });

  it("um campo ruim não derruba os outros: toggle desligado continua valendo", () => {
    const leitura = interpretarPreferencias({ highValueThreshold: "x", toggles: { sale_paid: false } });
    expect(decidir({ leitura })).toEqual({ acao: "suprimir", motivo: "preferencia_toggle" });
  });

  it("dias de silêncio nulos (o caso que quebrava o .includes) não lançam", () => {
    const leitura = interpretarPreferencias({ quietHoursEnabled: true, quietHoursDays: null });
    expect(() => decidir({ leitura })).not.toThrow();
  });

  it("um destinatário com problema NÃO afeta o outro — cada decisão é independente", () => {
    expect(decidir({ leitura: indisponivel }).acao).toBe("adiar");
    expect(decidir().acao).toBe("enviar");
  });
});
