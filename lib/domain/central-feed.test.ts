import { describe, expect, it } from "vitest";
import {
  contarNaoLidas,
  estaLido,
  lerCriadoEm,
  mesclarFeeds,
  normalizarItemPessoal,
  situacaoDaCentral,
  textoDeHora,
  textoDoCabecalho,
  type EstadoDaFonte,
} from "./central-feed";
import type { NotificationEvent } from "./notifications";

const AGORA = Date.UTC(2026, 8, 22, 15, 0);
const EU = "dono@zxp.com";

const fonte = (over: Partial<EstadoDaFonte> = {}): EstadoDaFonte => ({ carregando: false, erro: null, doCache: false, temMais: false, ...over });

function evento(id: string, over: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    id, type: "sale_paid", severity: "success", entityType: "order", entityId: id, dedupeKey: id,
    title: "t", body: "b", financialState: "estimated", deepLink: "/", createdAt: { toMillis: () => AGORA - 60_000 },
    readBy: {}, dismissedBy: {}, ...over,
  };
}

describe("lerCriadoEm — nunca devolve 'agora' por engano", () => {
  it("Timestamp do cliente (toMillis)", () => expect(lerCriadoEm({ toMillis: () => 1_800_000_000_000 })).toBe(1_800_000_000_000));
  it("{seconds, nanoseconds}", () => expect(lerCriadoEm({ seconds: 1_800_000_000, nanoseconds: 500_000_000 })).toBe(1_800_000_000_500));
  it("{_seconds} do Admin SDK serializado", () => expect(lerCriadoEm({ _seconds: 1_800_000_000, _nanoseconds: 0 })).toBe(1_800_000_000_000));
  it("milissegundos numéricos", () => expect(lerCriadoEm(1_800_000_000_000)).toBe(1_800_000_000_000));
  it("segundos numéricos viram milissegundos", () => expect(lerCriadoEm(1_800_000_000)).toBe(1_800_000_000_000));
  it("ISO", () => expect(lerCriadoEm("2026-09-22T12:00:00.000Z")).toBe(Date.UTC(2026, 8, 22, 12, 0)));

  it("tudo o que é ilegível vira null — a versão antiga devolvia Date.now()", () => {
    for (const ruim of [undefined, null, "", "ontem", {}, { toMillis: () => Number.NaN }, Number.NaN, -5, 0, [], true]) {
      expect(lerCriadoEm(ruim), String(JSON.stringify(ruim))).toBeNull();
    }
  });
});

describe("mesclarFeeds", () => {
  it("ordena do mais recente pro mais antigo, misturando as fontes", () => {
    const r = mesclarFeeds([
      { origem: "time", itens: [evento("a", { createdAt: 1_000_000_000_000 }), evento("c", { createdAt: 3_000_000_000_000 })] },
      { origem: "pessoal", itens: [evento("b", { createdAt: 2_000_000_000_000 })] },
    ]);
    expect(r.map((i) => i.id)).toEqual(["c", "b", "a"]);
    expect(r.map((i) => i.origem)).toEqual(["time", "pessoal", "time"]);
  });

  it("item com data ilegível vai pro FIM, não pro topo", () => {
    const r = mesclarFeeds([{ origem: "time", itens: [evento("sem-data", { createdAt: "lixo" }), evento("ok", { createdAt: 1_800_000_000_000 })] }]);
    expect(r.map((i) => i.id)).toEqual(["ok", "sem-data"]);
    expect(r[1].criadoEmMs).toBeNull();
  });

  it("não repete o mesmo id da mesma origem, mas ids iguais de origens diferentes convivem", () => {
    const r = mesclarFeeds([
      { origem: "time", itens: [evento("x"), evento("x")] },
      { origem: "pessoal", itens: [evento("x")] },
    ]);
    expect(r).toHaveLength(2);
  });

  it("70 itens permanecem ordenados e sem perda", () => {
    const itens = Array.from({ length: 70 }, (_, i) => evento(`e${i}`, { createdAt: 1_800_000_000_000 + i * 1000 }));
    const r = mesclarFeeds([{ origem: "time", itens }]);
    expect(r).toHaveLength(70);
    expect(r[0].id).toBe("e69");
    expect(r[69].id).toBe("e0");
  });
});

describe("normalizarItemPessoal", () => {
  it("o lido do feed pessoal vira readBy[email] — a tela não precisa saber a diferença", () => {
    const r = normalizarItemPessoal({ id: "t", type: "task_assigned", lidoEm: 123, dispensadoEm: null }, EU);
    expect(r.readBy).toEqual({ [EU]: 123 });
    expect(r.dismissedBy).toEqual({});
    expect(r).not.toHaveProperty("lidoEm");
  });

  it("não lido: mapa vazio", () => {
    expect(normalizarItemPessoal({ id: "t", lidoEm: null }, EU).readBy).toEqual({});
  });
});

describe("situacaoDaCentral — 'lista vazia' não quer dizer 'tudo em dia'", () => {
  it("antes de qualquer resposta: carregando", () => {
    expect(situacaoDaCentral([fonte({ carregando: true }), fonte({ carregando: true })], 0)).toBe("carregando");
  });

  it("erro de permissão em TODAS as fontes: erro (a lista vazia é mentira)", () => {
    expect(situacaoDaCentral([fonte({ erro: "permission-denied" }), fonte({ erro: "permission-denied" })], 0)).toBe("erro");
  });

  it("uma fonte falhou e a outra funciona: parcial — mostra o que há e avisa", () => {
    expect(situacaoDaCentral([fonte({ erro: "unavailable" }), fonte()], 3)).toBe("parcial");
  });

  it("veio do cache (offline ou sincronizando): desatualizada, mesmo com zero itens", () => {
    expect(situacaoDaCentral([fonte({ doCache: true }), fonte()], 0)).toBe("desatualizada");
  });

  it("carregou do servidor, sem erro e sem nada: vazia", () => {
    expect(situacaoDaCentral([fonte(), fonte()], 0)).toBe("vazia");
  });

  it("com itens e tudo certo: ok", () => {
    expect(situacaoDaCentral([fonte(), fonte()], 5)).toBe("ok");
  });
});

describe("textoDoCabecalho — 'Tudo em dia' só quando é verdade", () => {
  const texto = (situacao: Parameters<typeof textoDoCabecalho>[0], n: number, exato: boolean, offline = false) =>
    textoDoCabecalho(situacao, { n, exato }, offline);

  it("ok, zero não lidas, histórico todo carregado: 'Tudo em dia'", () => {
    expect(texto("ok", 0, true)).toBe("Tudo em dia");
  });

  it("zero nas 50 mais recentes MAS há mais antigas: NÃO afirma tudo em dia", () => {
    expect(texto("ok", 0, false)).toBe("Nenhuma não lida entre as mais recentes");
  });

  it("70 não lidas com 50 carregadas: mostra 50+, não 50", () => {
    expect(texto("ok", 50, false)).toBe("50+ não lida(s)");
    expect(texto("ok", 12, true)).toBe("12 não lida(s)");
  });

  it("erro NUNCA vira 'Tudo em dia'", () => {
    expect(texto("erro", 0, true)).toBe("Não consegui carregar as notificações");
  });

  it("offline com zero não lidas: diz que está sem conexão", () => {
    expect(texto("desatualizada", 0, true, true)).toBe("Sem conexão — mostrando o que estava salvo");
    expect(texto("desatualizada", 0, true, true)).not.toContain("Tudo em dia");
  });

  it("nenhuma situação exceto 'ok' completo produz 'Tudo em dia'", () => {
    for (const s of ["carregando", "erro", "parcial", "desatualizada", "vazia"] as const) {
      for (const offline of [true, false]) {
        expect(texto(s, 0, true, offline), `${s}/${offline}`).not.toBe("Tudo em dia");
      }
    }
  });
});

describe("contarNaoLidas", () => {
  const itens = mesclarFeeds([{ origem: "time", itens: [evento("a", { readBy: { [EU]: 1 } }), evento("b"), evento("c")] }]);

  it("conta só as não lidas DA PESSOA", () => {
    expect(contarNaoLidas(itens, EU, [fonte()]).n).toBe(2);
    expect(contarNaoLidas(itens, "outro@zxp.com", [fonte()]).n).toBe(3);
  });

  it("não é exato quando há mais por carregar", () => {
    expect(contarNaoLidas(itens, EU, [fonte({ temMais: true })]).exato).toBe(false);
    expect(contarNaoLidas(itens, EU, [fonte()]).exato).toBe(true);
  });

  it("estaLido sem e-mail nunca conta como lido", () => {
    expect(estaLido(evento("a", { readBy: { "": 1 } }), "")).toBe(false);
  });

  it("o lido é do e-mail, não do papel: trocar de papel não 'ressuscita' o item", () => {
    // O readBy é indexado pelo e-mail — o mesmo antes e depois de a pessoa virar member.
    const lido = evento("a", { readBy: { [EU]: 1 } });
    expect(estaLido(lido, EU)).toBe(true);
  });
});

describe("textoDeHora", () => {
  it("data ilegível não vira 'agora'", () => expect(textoDeHora(null, AGORA)).toBe("data indisponível"));
  it("agora, minutos e horas", () => {
    expect(textoDeHora(AGORA - 20_000, AGORA)).toBe("agora");
    expect(textoDeHora(AGORA - 5 * 60_000, AGORA)).toBe("5 min atrás");
    expect(textoDeHora(AGORA - 3 * 3600_000, AGORA)).toBe("3h atrás");
  });
  it("mais de um dia: data", () => {
    expect(textoDeHora(AGORA - 30 * 3600_000, AGORA)).toMatch(/^\d{2}\/\d{2}$/);
  });
  it("relativo AVANÇA com o relógio (a tela precisa reler o tempo)", () => {
    const ms = AGORA - 4 * 60_000;
    expect(textoDeHora(ms, AGORA)).toBe("4 min atrás");
    expect(textoDeHora(ms, AGORA + 10 * 60_000)).toBe("14 min atrás");
  });
  it("data bem no futuro (relógio torto) não finge 'agora'", () => {
    expect(textoDeHora(AGORA + 3600_000, AGORA)).toMatch(/^\d{2}\/\d{2}$/);
  });
});
