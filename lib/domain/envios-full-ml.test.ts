import { describe, expect, it } from "vitest";
import amostra from "./__fixtures__/envios-full-ml.json";
import {
  custoAGravar, diaDaColeta, enviosParaDetalhar, idDaBaixa, idDoComplemento, lerDetalheDoEnvio, lerEnvioDaLista,
  mesclarEnvio, planejarBaixas, planejarReservas, planejarTravamento, situacaoDoEnvio,
  type EnvioFullML, type ReservaExistente,
} from "./envios-full-ml";

// 22/11/2026 12:00 em Brasília — o dia da leitura.
const HOJE = Date.parse("2026-11-22T12:00:00-03:00");
// 24/11/2026 00:30 — passou o prazo de editar a coleta do dia 25 (23/11 23:59).
const DEPOIS_DO_PRAZO = Date.parse("2026-11-24T00:30:00-03:00");

const lista = amostra.lista.map(lerEnvioDaLista).filter((e): e is EnvioFullML => !!e);
const porId = (id: string) => lista.find((e) => e.id === id)!;
const agendado = mesclarEnvio(porId("80517703"), lerDetalheDoEnvio(amostra.detalheAgendado))!;
const fechado = mesclarEnvio(porId("81226703"), lerDetalheDoEnvio(amostra.detalheFechado))!;

/** Os produtos do Full, pelo MLB que o envio traz (MLB → id no Estoque). */
const produtos = new Map([
  ["MLB5261764761", "mentaLimao"], ["MLB7232049658", "puraFolha"], ["MLB5261764729", "tradicional"],
  ["MLB7232047356", "boldoMenta"], ["MLB4662183905", "mentaStronger"], ["MLB7575165184", "mentaCereja"],
  ["MLB7408788724", "abacaxi"], ["MLB4662184615", "limaoCaipira"],
]);

describe("leitura da página do ML", () => {
  it("lista: coleta, prazo pra editar e quantidade do envio de 25/11", () => {
    const e = porId("80517703");
    expect(e.coletaEm).toBe("2026-11-25T18:00:00-03:00");
    expect(e.editarAte).toBe("2026-11-23T23:59:00-03:00");
    expect(e.declarado).toBe(1750);
    expect(e.custo).toBeNull(); // nada cobrado ainda
  });

  it("lista: custo já cobrado vem como definitivo (#78453533: R$ 142,88)", () => {
    expect(porId("78453533").custo).toEqual({ valor: 142.88, estimado: false, cobrado: true });
  });

  it("detalhe: os 8 produtos do envio, pelo MLB do Full", () => {
    expect(agendado.produtos).toHaveLength(8);
    expect(agendado.produtos.find((p) => p.sku === "MentaLimão")).toMatchObject({ itemId: "MLB5261764761", declarado: 220, recebido: 0 });
    expect(agendado.produtos.reduce((s, p) => s + p.declarado, 0)).toBe(1750);
  });

  it("detalhe: custo ESTIMADO da coleta antes de coletar (R$ 691,28)", () => {
    expect(agendado.custo).toEqual({ valor: 691.28, estimado: true, cobrado: false });
  });

  it("linha que não é envio é ignorada, não vira lixo", () => {
    expect(lerEnvioDaLista({ id: "abc" })).toBeNull();
    expect(lerDetalheDoEnvio({})).toBeNull();
  });

  it("dia da coleta em Brasília", () => {
    expect(diaDaColeta(agendado)).toBe("2026-11-25");
  });
});

describe("situação do envio", () => {
  it("antes do prazo: agendado; depois: travado", () => {
    expect(situacaoDoEnvio(agendado, HOJE)).toBe("agendado");
    expect(situacaoDoEnvio(agendado, DEPOIS_DO_PRAZO)).toBe("travado");
  });

  it("finalizado, cancelado, vencido e rascunho", () => {
    expect(situacaoDoEnvio(fechado, HOJE)).toBe("finalizado");
    expect(situacaoDoEnvio(porId("80958851"), HOJE)).toBe("cancelado");
    expect(situacaoDoEnvio(porId("75293943"), HOJE)).toBe("vencido");
    expect(situacaoDoEnvio(porId("81551147"), HOJE)).toBe("rascunho");
  });
});

describe("reservas a partir dos envios do ML", () => {
  it("envio agendado cria uma reserva por produto, no dia da coleta", () => {
    const { acoes, semCadastro } = planejarReservas([agendado], produtos, [], HOJE);
    expect(semCadastro).toEqual([]);
    expect(acoes).toHaveLength(8);
    expect(acoes).toContainEqual({ tipo: "criar", inboundId: "80517703", productId: "mentaLimao", quantidade: 220, data: "2026-11-25" });
  });

  it("adota a reserva feita à mão pro mesmo envio (obs '#80517703'), sem duplicar", () => {
    const manual: ReservaExistente = {
      id: "env1", productId: "mentaLimao", quantidade: 220, data: "2026-11-25", status: "agendado",
      obs: "Coleta Full #80517703 - ultima coleta em casa", anuncioJaBaixado: true,
    };
    const { acoes } = planejarReservas([agendado], produtos, [manual], HOJE);
    expect(acoes.filter((a) => a.tipo === "criar" && a.productId === "mentaLimao")).toHaveLength(0);
    expect(acoes).toContainEqual({ tipo: "atualizar", id: "env1", inboundId: "80517703", quantidade: 220, data: "2026-11-25" });
  });

  it("mudou a quantidade no ML, muda a reserva", () => {
    const r: ReservaExistente = { id: "env1", productId: "mentaLimao", quantidade: 200, data: "2026-11-25", status: "agendado", inboundId: "80517703" };
    const { acoes } = planejarReservas([agendado], produtos, [r], HOJE);
    expect(acoes).toContainEqual({ tipo: "atualizar", id: "env1", inboundId: "80517703", quantidade: 220, data: "2026-11-25" });
  });

  it("envio cancelado no ML solta a reserva", () => {
    const r: ReservaExistente = { id: "env9", productId: "mentaLimao", quantidade: 50, data: "2026-11-28", status: "agendado", inboundId: "80958851" };
    const { acoes } = planejarReservas([porId("80958851")], produtos, [r], HOJE);
    expect(acoes).toEqual([{ tipo: "encerrar", id: "env9", inboundId: "80958851", status: "cancelado" }]);
  });

  it("produto do envio sem cadastro no Estoque é reportado, não chutado", () => {
    const { semCadastro } = planejarReservas([agendado], new Map([["MLB5261764761", "mentaLimao"]]), [], HOJE);
    expect(semCadastro).toHaveLength(7);
  });

  it("envio só da lista (detalhe ainda não lido) não reserva às cegas", () => {
    expect(planejarReservas([porId("80958791")], produtos, [], HOJE).acoes).toEqual([]);
  });
});

describe("prazo de editar passou: o anúncio de agência desce", () => {
  const reserva = (over: Partial<ReservaExistente> = {}): ReservaExistente => ({
    id: "env1", productId: "mentaLimao", quantidade: 220, data: "2026-11-25", status: "agendado", inboundId: "80517703", ...over,
  });

  it("antes do prazo não mexe no anúncio", () => {
    expect(planejarTravamento([agendado], [reserva()], HOJE)).toEqual([]);
  });

  it("depois do prazo, baixa o que ainda está no anúncio", () => {
    expect(planejarTravamento([agendado], [reserva()], DEPOIS_DO_PRAZO))
      .toEqual([{ reservaId: "env1", inboundId: "80517703", productId: "mentaLimao", quantidade: 220 }]);
  });

  it("reserva já baixada à mão (22/11) não desce de novo", () => {
    expect(planejarTravamento([agendado], [reserva({ anuncioJaBaixado: true })], DEPOIS_DO_PRAZO)).toEqual([]);
  });
});

describe("baixa segue o que o ML recebeu — inclusive o que chega depois", () => {
  // O caso relatado: o ML registrou 169, depois 180.
  const comRecebido = (n: number): EnvioFullML => ({
    ...fechado,
    produtos: [{ sku: "MentaLimão", inventoryId: "LCCU20168", itemId: "MLB5261764761", titulo: "Menta Limão", declarado: 180, recebido: n, aVenda: n, diferenca: 180 - n }],
  });

  it("primeira baixa usa o mesmo id da baixa manual (não duplica com ela)", () => {
    const { pendentes } = planejarBaixas([comRecebido(169)], produtos, [], HOJE);
    expect(pendentes).toEqual([expect.objectContaining({ productId: "mentaLimao", recebido: 169, baixado: 0, falta: 169, idLancamento: idDaBaixa("81226703", "mentaLimao") })]);
  });

  it("169 baixadas, ML agora diz 180: complemento de 11", () => {
    const movs = [{ id: idDaBaixa("81226703", "mentaLimao"), productId: "mentaLimao", tipo: "saida_full", quantidade: 169 }];
    const { pendentes } = planejarBaixas([comRecebido(180)], produtos, movs, HOJE);
    expect(pendentes).toEqual([expect.objectContaining({ falta: 11, baixado: 169, idLancamento: idDoComplemento("81226703", "mentaLimao", 180) })]);
  });

  it("com o complemento lançado, nada pendente", () => {
    const movs = [
      { id: idDaBaixa("81226703", "mentaLimao"), productId: "mentaLimao", tipo: "saida_full", quantidade: 169 },
      { id: idDoComplemento("81226703", "mentaLimao", 180), productId: "mentaLimao", tipo: "saida_full", quantidade: 11 },
    ];
    expect(planejarBaixas([comRecebido(180)], produtos, movs, HOJE).pendentes).toEqual([]);
  });

  it("ML recontou pra baixo: não desfaz sozinho, avisa", () => {
    const movs = [{ id: idDaBaixa("81226703", "mentaLimao"), productId: "mentaLimao", tipo: "saida_full", quantidade: 180 }];
    const r = planejarBaixas([comRecebido(178)], produtos, movs, HOJE);
    expect(r.pendentes).toEqual([]);
    expect(r.excesso).toEqual([expect.objectContaining({ falta: -2 })]);
  });

  it("envio só agendado não pede baixa", () => {
    expect(planejarBaixas([agendado], produtos, [], HOJE).pendentes).toEqual([]);
  });
});

describe("custo da coleta", () => {
  it("vazio: grava o estimado", () => {
    expect(custoAGravar(agendado, null)).toEqual({ valor: 691.28, origem: "ml-estimado" });
  });

  it("valor digitado à mão não é trocado por estimativa", () => {
    expect(custoAGravar(agendado, { custoManual: 650, custoInformadoPor: "dono@exemplo.com" })).toBeNull();
  });

  it("o COBRADO substitui até o digitado — é o definitivo", () => {
    expect(custoAGravar(porId("78453533"), { custoManual: 140, custoInformadoPor: "dono@exemplo.com" }))
      .toEqual({ valor: 142.88, origem: "ml-cobrado" });
  });

  it("sem mudança, não regrava", () => {
    expect(custoAGravar(porId("78453533"), { custoManual: 142.88, custoInformadoPor: "ml-cobrado" })).toBeNull();
  });
});

describe("o que a extensão precisa abrir no detalhe", () => {
  it("agendados e finalizados recentes ainda sem custo cobrado; nunca cancelado/rascunho", () => {
    const ids = enviosParaDetalhar([...lista.filter((e) => e.id !== "80517703" && e.id !== "81226703"), agendado, fechado], HOJE);
    expect(ids).toContain("80517703");
    expect(ids).toContain("80958791");
    expect(ids).toContain("81226703"); // finalizado há 12 dias, custo ainda estimado
    expect(ids).not.toContain("80958851");
    expect(ids).not.toContain("81551147");
    expect(ids).not.toContain("78453533"); // finalizado há mais de 30 dias
  });
});
