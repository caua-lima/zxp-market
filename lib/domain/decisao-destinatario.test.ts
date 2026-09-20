import { describe, expect, it } from "vitest";
import { MAX_ADIAMENTOS_POR_PREFERENCIA, decidirDestinatario } from "./decisao-destinatario";
import {
  interpretarPreferencias,
  preferenciasIndisponiveis,
  type LeituraDePreferencias,
} from "./notification-preferences";
import type { AcessoDoDestinatario } from "./notificacao-publico";

const AGORA = 1_800_000_000_000;
const MEIO_DIA = { minutosDoDia: 12 * 60, diaSemana: 2 };
const TRES_DA_MANHA = { minutosDoDia: 3 * 60, diaSemana: 2 };

const DONO: AcessoDoDestinatario = { papel: "owner", permissoesEdicao: [] };
const MEMBRO: AcessoDoDestinatario = { papel: "member", permissoesEdicao: [] };

function decidir(over: Partial<Parameters<typeof decidirDestinatario>[0]> = {}) {
  return decidirDestinatario({
    type: "sale_paid", isSummary: false, acesso: DONO,
    leitura: interpretarPreferencias(undefined), agoraBR: MEIO_DIA, adiamentos: 0, agora: AGORA, ...over,
  });
}

describe("decidirDestinatario", () => {
  it("dono sem preferência salva: envia completo — o app continua como sempre foi", () => {
    expect(decidir()).toEqual({ acao: "enviar", nivel: "completo" });
  });

  it("member: envia, sem financeiro", () => {
    expect(decidir({ acesso: MEMBRO })).toEqual({ acao: "enviar", nivel: "sem_financeiro" });
  });

  it("dono que desligou o financeiro: sem financeiro", () => {
    const leitura = interpretarPreferencias({ showFinancialValuesInPush: false });
    expect(decidir({ leitura })).toEqual({ acao: "enviar", nivel: "sem_financeiro" });
  });

  it("perdeu o acesso: suprime — a decisão é do momento do envio", () => {
    expect(decidir({ acesso: undefined })).toEqual({ acao: "suprimir", motivo: "sem_acesso" });
  });

  it("desligou aquele tipo: suprime por preferência", () => {
    const leitura = interpretarPreferencias({ toggles: { sale_paid: false } });
    expect(decidir({ leitura })).toEqual({ acao: "suprimir", motivo: "preferencia" });
  });

  it("horário silencioso derruba o não crítico", () => {
    const leitura = interpretarPreferencias({ quietHoursEnabled: true });
    expect(decidir({ leitura, agoraBR: TRES_DA_MANHA })).toEqual({ acao: "suprimir", motivo: "preferencia" });
  });

  it("mas prejuízo é crítico e atravessa o horário silencioso", () => {
    const leitura = interpretarPreferencias({ quietHoursEnabled: true });
    expect(decidir({ type: "sale_negative_margin", leitura, agoraBR: TRES_DA_MANHA })).toEqual({ acao: "enviar", nivel: "completo" });
  });
});

describe("preferência ilegível — nunca vira consentimento", () => {
  const indisponivel: LeituraDePreferencias = preferenciasIndisponiveis("firestore: 14");

  it("indisponível: ADIA em vez de descartar ou de decidir no escuro", () => {
    const d = decidir({ leitura: indisponivel });
    expect(d).toMatchObject({ acao: "adiar", motivo: "preferencia_indisponivel" });
    if (d.acao === "adiar") expect(d.ate).toBeGreaterThan(AGORA);
  });

  it("esgotados os adiamentos, envia a versão SEGURA (sem financeiro), não descarta", () => {
    expect(decidir({ leitura: indisponivel, adiamentos: MAX_ADIAMENTOS_POR_PREFERENCIA })).toEqual({ acao: "enviar", nivel: "sem_financeiro" });
  });

  it("documento inválido: envia, mas sem financeiro", () => {
    const leitura = interpretarPreferencias({ showFinancialValuesInPush: "sim" });
    expect(decidir({ leitura })).toEqual({ acao: "enviar", nivel: "sem_financeiro" });
  });

  it("um campo ruim não derruba os outros: toggle desligado continua valendo", () => {
    const leitura = interpretarPreferencias({ highValueThreshold: "x", toggles: { sale_paid: false } });
    expect(decidir({ leitura })).toEqual({ acao: "suprimir", motivo: "preferencia" });
  });

  it("um destinatário com problema NÃO afeta o outro — cada decisão é independente", () => {
    const ruim = decidir({ leitura: indisponivel });
    const bom = decidir();
    expect(ruim.acao).toBe("adiar");
    expect(bom.acao).toBe("enviar");
  });
});
