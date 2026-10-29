import { describe, expect, it } from "vitest";
import { lerPaginaDeAgendamento } from "../../extensao-vigia-full/leitura.js";
import { proximoHorario } from "../../extensao-vigia-full/horario.js";

/** Um trecho do HTML real (28/10/2026), com o dicionário de traduções que traz a frase "Não temos datas". */
const pagina = (tipos: string, extra = "") =>
  `<script>_n.ctx.t={"Não temos datas":[null,"{0}Não temos datas disponíveis no momento.{1} Desculpe, tente novamente nos próximos dias."]}</script>` +
  `<script id="__NORDIC_RENDERING_CTX__">_n.ctx.r={"appProps":{"pageProps":{"data":{"inboundId":80517703,"userProfile":"FBM_PREMIUM","status":"working",` +
  `"carriers":null,"pickupScheduleAvailability":null,"ftlFtlpSupplierScheduleAvailability":null,"initialSelectedNodeAvailability":null,"selectedNodeAvailability":null,${extra}` +
  `"availableShipmentTypes":${tipos}}}}}</script>`;

const FECHADO = '[{"type":"pickup","enabled":false,"has_active_recurrences":false},{"type":"ftl","enabled":false},{"type":"ftlp","enabled":false},{"type":"supplier","enabled":false}]';
const URL_OK = "https://vendedores.mercadolivre.com.br/shipping/inbounds/80517703/appointment-v2";

describe("lerPaginaDeAgendamento (extensão do Chrome)", () => {
  it("todas as formas de envio desligadas: sem data (a frase do dicionário não engana)", () => {
    expect(lerPaginaDeAgendamento(pagina(FECHADO), 80517703, URL_OK)).toEqual({ estado: "sem_datas", tipos: [] });
  });

  it("uma forma de envio ligada: abriu data", () => {
    const aberto = FECHADO.replace('"type":"pickup","enabled":false', '"type":"pickup","enabled":true');
    expect(lerPaginaDeAgendamento(pagina(aberto), 80517703, URL_OK)).toEqual({ estado: "datas", tipos: ["pickup"] });
  });

  it("disponibilidade preenchida também conta", () => {
    const html = pagina(FECHADO).replace('"pickupScheduleAvailability":null', '"pickupScheduleAvailability":{"dates":["2026-10-30"]}');
    expect(lerPaginaDeAgendamento(html, 80517703, URL_OK).estado).toBe("datas");
  });

  it("caiu no login: pede pra entrar no ML", () => {
    expect(lerPaginaDeAgendamento("<html>Digite seu e-mail ou telefone para iniciar sessão</html>", 80517703, "https://www.mercadolivre.com.br/login/identification?x=1").estado).toBe("login");
    expect(lerPaginaDeAgendamento("<html><title>Digite seu e-mail ou telefone para iniciar sessão</title></html>", 80517703, URL_OK).estado).toBe("login");
  });

  it("página de outro envio ou formato desconhecido: indefinido (nunca alarme falso)", () => {
    expect(lerPaginaDeAgendamento(pagina(FECHADO), 99999999, URL_OK).estado).toBe("indefinido");
    expect(lerPaginaDeAgendamento(pagina("quebrado"), 80517703, URL_OK).estado).toBe("indefinido");
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
