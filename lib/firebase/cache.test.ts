import { beforeEach, describe, expect, it, vi } from "vitest";
import { assinarComCache, invalidar, limparCache, revalidarVencidos } from "./cache";

/** Deixa as microtasks pendentes rodarem. */
const escoar = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  limparCache();
});

describe("SYNC-02 — a invalidacao que se perdia", () => {
  it("escrita DURANTE a busca nao e engolida pela resposta antiga", async () => {
    /**
     * `rebuscar` comecava com `if (e.buscando) return e.buscando;`. Quando uma
     * busca estava EM VOO e uma escrita acontecia, `invalidar` devolvia a
     * promessa da busca ja em andamento — que leu o Firestore ANTES da escrita
     * e, ao terminar, gravava `e.at = Date.now()`, marcando como fresco um
     * dado que ja nascia velho.
     *
     * Na pratica: lancar uma movimentacao enquanto a lista carrega fazia o
     * lancamento nao aparecer.
     */
    let versao = "antes";
    let liberar: (() => void) | null = null;
    // So a PRIMEIRA busca fica presa — e ela que simula a leitura em voo.
    // As seguintes respondem na hora, como no mundo real.
    const buscar = vi.fn(async () => {
      if (buscar.mock.calls.length === 1) {
        await new Promise<void>((r) => { liberar = r; });
      }
      return versao;
    });

    const vistos: string[] = [];
    assinarComCache("k", buscar, (d) => vistos.push(d));
    await escoar();

    // A escrita acontece com a busca ainda em voo.
    versao = "depois";
    invalidar("k");

    // A busca antiga volta agora, com o dado de ANTES da escrita.
    liberar!();
    await escoar();
    await escoar();
    await escoar();

    // O valor final tem que ser o de DEPOIS da escrita.
    expect(vistos.at(-1)).toBe("depois");
    expect(vistos).not.toContain("antes");
  });

  it("duas buscas simultaneas continuam sendo UMA leitura", async () => {
    // A protecao de custo que existia nao pode ter se perdido na correcao.
    const buscar = vi.fn(async () => "x");
    assinarComCache("k", buscar, () => {});
    assinarComCache("k", buscar, () => {});
    await escoar();
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it("cache quente nao custa leitura nenhuma", async () => {
    const buscar = vi.fn(async () => "x");
    assinarComCache("k", buscar, () => {});
    await escoar();
    expect(buscar).toHaveBeenCalledTimes(1);

    const vistos: string[] = [];
    assinarComCache("k", buscar, (d) => vistos.push(d));
    await escoar();
    expect(buscar).toHaveBeenCalledTimes(1);
    expect(vistos).toEqual(["x"]);
  });

  it("invalidar com a busca parada dispara uma nova", async () => {
    let versao = "a";
    const buscar = vi.fn(async () => versao);
    const vistos: string[] = [];
    assinarComCache("k", buscar, (d) => vistos.push(d));
    await escoar();

    versao = "b";
    invalidar("k");
    await escoar();
    expect(vistos).toEqual(["a", "b"]);
  });

  it("invalidar sem ninguem ouvindo nao busca a toa", async () => {
    const buscar = vi.fn(async () => "x");
    const cancelar = assinarComCache("k", buscar, () => {});
    await escoar();
    cancelar();

    invalidar("k");
    await escoar();
    expect(buscar).toHaveBeenCalledTimes(1);
  });
});

describe("SYNC-01 — o TTL que nunca disparava pra quem ja estava inscrito", () => {
  it("revalidarVencidos rebusca chave velha com ouvinte", async () => {
    /**
     * A validade era conferida so na INSCRICAO. Depois de inscrito, o
     * componente segurava o dado indefinidamente: uma aba aberta a tarde
     * inteira mostrava o estado da manha, e o TTL so tinha efeito na PROXIMA
     * montagem.
     */
    let versao = "manha";
    const buscar = vi.fn(async () => versao);
    const vistos: string[] = [];
    assinarComCache("k", buscar, (d) => vistos.push(d), { ttl: 10 });
    await escoar();

    versao = "tarde";
    await new Promise((r) => setTimeout(r, 20)); // passa do TTL
    revalidarVencidos(10);
    await escoar();

    expect(vistos).toEqual(["manha", "tarde"]);
  });

  it("nao rebusca o que acabou de ser lido", async () => {
    // Varrer tudo a cada tique gastaria leitura a toa numa chave lida ha
    // dez segundos — o oposto do que este arquivo existe pra fazer.
    const buscar = vi.fn(async () => "x");
    assinarComCache("k", buscar, () => {}, { ttl: 60_000 });
    await escoar();

    revalidarVencidos(60_000);
    await escoar();
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it("chave sem ouvinte nao e revalidada", async () => {
    const buscar = vi.fn(async () => "x");
    const cancelar = assinarComCache("k", buscar, () => {}, { ttl: 1 });
    await escoar();
    cancelar();

    await new Promise((r) => setTimeout(r, 10));
    revalidarVencidos(1);
    await escoar();
    expect(buscar).toHaveBeenCalledTimes(1);
  });
});

describe("erro nao envenena o cache", () => {
  it("busca que falha nao publica nem marca como fresca", async () => {
    const erros: string[] = [];
    const buscar = vi.fn(async () => { throw new Error("rede caiu"); });
    const vistos: unknown[] = [];
    assinarComCache("k", buscar, (d) => vistos.push(d), { onError: (m) => erros.push(m) });
    await escoar();

    expect(vistos).toEqual([]);
    expect(erros).toEqual(["rede caiu"]);
  });

  it("depois do erro, uma nova inscricao tenta de novo", async () => {
    let falhar = true;
    const buscar = vi.fn(async () => {
      if (falhar) throw new Error("x");
      return "ok";
    });
    assinarComCache("k", buscar, () => {}, { onError: () => {} });
    await escoar();

    falhar = false;
    const vistos: string[] = [];
    assinarComCache("k", buscar, (d) => vistos.push(d), { onError: () => {} });
    await escoar();
    expect(vistos).toEqual(["ok"]);
  });
});

describe("limparCache", () => {
  it("apaga tudo — e o que impede dado de uma conta vazar pra outra", async () => {
    const buscar = vi.fn(async () => "x");
    assinarComCache("k", buscar, () => {});
    await escoar();

    limparCache();

    const vistos: string[] = [];
    assinarComCache("k", buscar, (d) => vistos.push(d));
    await escoar();
    expect(buscar).toHaveBeenCalledTimes(2);
    expect(vistos).toEqual(["x"]);
  });
});
