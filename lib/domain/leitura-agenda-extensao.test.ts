import { describe, expect, it } from "vitest";
import { caminhoDasDatasDaColeta, ESCOLHA_O_ENDERECO, lerRespostaDaColeta, temHorarioLivre } from "../../extensao-vigia-full/leitura.js";
import { proximoHorario } from "../../extensao-vigia-full/horario.js";

/**
 * O formato real de schedule-availability?shipment_type=pickup (03/11/2026):
 * três endereços; o antigo, em outra cidade, com horário; os dois em uso, sem.
 */
const end = (id: number, rua: string, numero: string, cidade: string) => ({ id, street_name: rua, street_number: numero, city_name: cidade });
const RESPOSTA = {
  availability_ref_id: "abc",
  availability: [
    { address: { ...end(11, "Rua Antiga", "136", "São Paulo"), errors: [] }, schedule_slots: [{ date: "2026-11-05T00:00:00.000-03:00", available_slots: [{ slot_id: "x", from: "08:00", to: "12:00" }] }] },
    { address: { ...end(22, "Rua Um", "173", "Mogi Guaçu"), errors: ["address_slots_not_available"] }, schedule_slots: [] },
    { address: { ...end(33, "Rua Dois", "81", "Mogi Guaçu"), errors: ["address_slots_not_available"] }, schedule_slots: [] },
  ],
};
const COM_DATA_NO_MEU = {
  availability: [
    { address: { ...end(33, "Rua Dois", "81", "Mogi Guaçu"), errors: [] }, schedule_slots: [{ date: "2026-11-07T00:00:00.000-03:00", available_slots: [{ slot_id: "y" }] }] },
  ],
};
const URL_API = "https://vendedores.mercadolivre.com.br/api/shipping/inbounds/80517703/appointment-v2/schedule-availability?shipment_type=pickup";

describe("lerRespostaDaColeta (extensão do Chrome — só a coleta, só nos endereços marcados)", () => {
  it("pergunta sempre a coleta (pickup), nunca as outras formas", () => {
    expect(caminhoDasDatasDaColeta(80517703)).toBe("/api/shipping/inbounds/80517703/appointment-v2/schedule-availability?shipment_type=pickup");
  });

  it("horário só no endereço antigo de outra cidade: NÃO é data pra quem marcou o seu (o alarme falso de 03/11)", () => {
    expect(lerRespostaDaColeta(200, URL_API, RESPOSTA, ["33"])).toMatchObject({ estado: "sem_datas", trecho: "sem horário na coleta (endereço escolhido)" });
    expect(lerRespostaDaColeta(200, URL_API, RESPOSTA, ["22", "33"]).estado).toBe("sem_datas");
  });

  it("horário no endereço marcado: data de verdade, com o dia", () => {
    expect(lerRespostaDaColeta(200, URL_API, COM_DATA_NO_MEU, ["33"])).toMatchObject({
      estado: "datas", datas: ["2026-11-07"], trecho: "com horário: coleta no endereço escolhido · 2026-11-07",
    });
  });

  it("nenhum endereço marcado: não toca e pede pra escolher, listando os endereços", () => {
    const r = lerRespostaDaColeta(200, URL_API, RESPOSTA, []);
    expect(r.estado).toBe("indefinido");
    expect(r.trecho).toBe(ESCOLHA_O_ENDERECO);
    expect(r.enderecos).toEqual([
      { id: "11", rotulo: "Rua Antiga 136 · São Paulo" },
      { id: "22", rotulo: "Rua Um 173 · Mogi Guaçu" },
      { id: "33", rotulo: "Rua Dois 81 · Mogi Guaçu" },
    ]);
  });

  it("o endereço marcado sumiu da resposta: não toca", () => {
    expect(lerRespostaDaColeta(200, URL_API, RESPOSTA, ["99"]).estado).toBe("indefinido");
  });

  it("caiu no login: pede pra entrar no ML", () => {
    expect(lerRespostaDaColeta(200, "https://www.mercadolivre.com.br/login/identification?x=1", null, ["33"]).estado).toBe("login");
    expect(lerRespostaDaColeta(401, URL_API, null, ["33"]).estado).toBe("login");
    expect(lerRespostaDaColeta(403, URL_API, null, ["33"]).estado).toBe("login");
  });

  it("erro do ML ou resposta estranha: indefinido (nunca alarme falso, nunca 'sem data' inventado)", () => {
    expect(lerRespostaDaColeta(404, URL_API, null, ["33"])).toMatchObject({ estado: "indefinido", trecho: "o ML respondeu 404" });
    expect(lerRespostaDaColeta(500, URL_API, COM_DATA_NO_MEU, ["33"]).estado).toBe("indefinido");
    expect(lerRespostaDaColeta(200, URL_API, null, ["33"]).estado).toBe("indefinido");
    expect(lerRespostaDaColeta(200, URL_API, { erro: "x" }, ["33"]).estado).toBe("indefinido");
  });
});

describe("temHorarioLivre (as datas de verdade, de schedule-availability)", () => {
  it("coleta liberada, centros próximos sem data: NÃO tem horário (o print de 03/11)", () => {
    const resposta = {
      availability_ref_id: "abc",
      availability: [{ address: { id: 1, errors: ["address_slots_not_available"] }, schedule_slots: [] }],
    };
    expect(temHorarioLivre(resposta)).toEqual({ livre: false, datas: [] });
    expect(temHorarioLivre({ availability: [{ address: { id: 1, errors: [] }, schedule_slots: [{ date: "2026-11-05", node_id: "BRSP06", available_slots: [] }] }] }).livre).toBe(false);
  });

  it("coleta com horário livre num dia: tem data (e diz qual)", () => {
    const resposta = {
      availability: [{
        address: { id: 1, errors: [] },
        schedule_slots: [
          { date: "2026-11-06T00:00:00.000-03:00", node_id: "BRSP06", available_slots: [{ from: "08:00", to: "12:00", charges: { amount: 0 } }] },
          { date: "2026-11-05T00:00:00.000-03:00", node_id: "BRSP06", available_slots: [] },
        ],
      }],
    };
    expect(temHorarioLivre(resposta)).toEqual({ livre: true, datas: ["2026-11-06"] });
  });

  it("ftl/ftlp/supplier (por centro) também vale", () => {
    const resposta = [{ node: { id: "BRSP06" }, schedule_slots: [{ date: "2026-11-10", available_slots: [{ id: "s1" }] }] }];
    expect(temHorarioLivre(resposta).livre).toBe(true);
  });

  it("resposta vazia ou estranha: não tem horário", () => {
    for (const r of [null, undefined, {}, [], "erro", { availability: null }]) expect(temHorarioLivre(r).livre).toBe(false);
  });
});

describe("proximoHorario (extensão do Chrome)", () => {
  // 28/10/2026 no horário de Brasília (UTC-3)
  const as = (h: number, m: number, s = 0) => Date.UTC(2026, 9, 28, h + 3, m, s);

  it("de 2 em 2: ligou 12:01:08, próxima 12:02:00; depois 12:04, 12:06…", () => {
    expect(proximoHorario(2, as(12, 1, 8))).toBe(as(12, 2));
    expect(proximoHorario(2, as(12, 2, 0))).toBe(as(12, 4));
    expect(proximoHorario(2, as(12, 3, 50))).toBe(as(12, 4));
    expect(proximoHorario(2, as(12, 58, 30))).toBe(as(13, 0));
  });

  it("o Chrome acordou um tiquinho antes do horário: não confere duas vezes", () => {
    expect(proximoHorario(2, as(12, 3, 59))).toBe(as(12, 6));
  });

  it("com data aberta, todo minuto cheio", () => {
    expect(proximoHorario(1, as(21, 47, 12))).toBe(as(21, 48));
  });
});
