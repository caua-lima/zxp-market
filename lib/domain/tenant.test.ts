import { describe, expect, it } from "vitest";
import {
  ehOwner, licencaValida, normalizarPapel, podeAcessarTenant, podeEditarAba, situacaoDaConta,
  type Licenca, type MembroTenant,
} from "./tenant";

const AGORA = Date.parse("2026-08-17T12:00:00Z");
const DIA = 86400000;

function membro(over: Partial<MembroTenant> = {}): MembroTenant {
  return { tenantId: "t-vazxpress", email: "dono@x.com", papel: "owner", ...over };
}
function licenca(over: Partial<Licenca> = {}): Licenca {
  return { email: "dono@x.com", status: "ativo", expiresAt: AGORA + 30 * DIA, ...over };
}

describe("licencaValida", () => {
  it("ativa e dentro do prazo vale", () => {
    expect(licencaValida(licenca(), AGORA)).toBe(true);
  });

  it("sem licenca nao vale — e o caso de quem nunca comprou", () => {
    expect(licencaValida(null, AGORA)).toBe(false);
    expect(licencaValida(undefined, AGORA)).toBe(false);
  });

  it("suspensa nao vale nem dentro do prazo", () => {
    expect(licencaValida(licenca({ status: "suspenso" }), AGORA)).toBe(false);
  });

  it("vencida nao vale", () => {
    expect(licencaValida(licenca({ expiresAt: AGORA - DIA }), AGORA)).toBe(false);
  });

  it("expiresAt null/ausente = sem prazo (o caso do dono do SaaS)", () => {
    expect(licencaValida(licenca({ expiresAt: null }), AGORA)).toBe(true);
    expect(licencaValida({ email: "e", status: "ativo" }, AGORA)).toBe(true);
  });

  it("expiresAt 0 e prazo de verdade (epoch), nao 'sem prazo'", () => {
    // Guarda contra `if (!expiresAt)`, que trataria 0 como ausente.
    expect(licencaValida(licenca({ expiresAt: 0 }), AGORA)).toBe(false);
  });

  it("o vencimento e estrito: no instante exato ja nao vale", () => {
    expect(licencaValida(licenca({ expiresAt: AGORA }), AGORA)).toBe(false);
    expect(licencaValida(licenca({ expiresAt: AGORA + 1 }), AGORA)).toBe(true);
  });
});

describe("situacaoDaConta — o motivo por trás do licencaValida()==false", () => {
  it("ativa e no prazo: ok", () => {
    expect(situacaoDaConta(licenca(), AGORA)).toBe("ok");
  });

  it("sem licenca: sem_licenca, nao 'suspenso' nem 'vencido'", () => {
    expect(situacaoDaConta(null, AGORA)).toBe("sem_licenca");
    expect(situacaoDaConta(undefined, AGORA)).toBe("sem_licenca");
  });

  it("suspensa: suspenso, mesmo se o prazo ainda nao venceu", () => {
    expect(situacaoDaConta(licenca({ status: "suspenso", expiresAt: AGORA + DIA }), AGORA)).toBe("suspenso");
  });

  it("vencida: vencido", () => {
    expect(situacaoDaConta(licenca({ expiresAt: AGORA - DIA }), AGORA)).toBe("vencido");
  });

  it("suspensa E vencida: suspenso ganha — e a causa mais direta de bloquear", () => {
    expect(situacaoDaConta(licenca({ status: "suspenso", expiresAt: AGORA - DIA }), AGORA)).toBe("suspenso");
  });

  it("sem prazo (dono do SaaS) nunca vence", () => {
    expect(situacaoDaConta(licenca({ expiresAt: null }), AGORA)).toBe("ok");
  });

  it("concorda com licencaValida() em toda combinacao: ok se e só se valida", () => {
    for (const status of ["ativo", "suspenso"] as const) {
      for (const expiresAt of [null, AGORA - DIA, AGORA, AGORA + DIA]) {
        const l = licenca({ status, expiresAt });
        expect(situacaoDaConta(l, AGORA) === "ok").toBe(licencaValida(l, AGORA));
      }
    }
  });
});

describe("podeEditarAba", () => {
  it("owner edita tudo, mesmo sem permissoesEdicao", () => {
    const o = membro({ papel: "owner" });
    expect(podeEditarAba(o, "estoque")).toBe(true);
    expect(podeEditarAba(o, "custos")).toBe(true);
  });

  it("colaborador so edita a aba liberada", () => {
    const c = membro({ papel: "colaborador", permissoesEdicao: ["estoque"] });
    expect(podeEditarAba(c, "estoque")).toBe(true);
    expect(podeEditarAba(c, "custos")).toBe(false);
  });

  it("colaborador sem lista e somente-leitura — comportamento historico", () => {
    expect(podeEditarAba(membro({ papel: "colaborador" }), "estoque")).toBe(false);
    expect(podeEditarAba(membro({ papel: "colaborador", permissoesEdicao: [] }), "estoque")).toBe(false);
  });

  it("sem membro nao edita nada", () => {
    expect(podeEditarAba(null, "estoque")).toBe(false);
  });
});

describe("normalizarPapel — papeis legados", () => {
  it("'admin' e 'user' viram colaborador, nunca owner", () => {
    expect(normalizarPapel("admin")).toBe("colaborador");
    expect(normalizarPapel("user")).toBe("colaborador");
    expect(normalizarPapel(undefined)).toBe("colaborador");
  });

  it("so 'owner' literal vira owner", () => {
    expect(normalizarPapel("owner")).toBe("owner");
    expect(normalizarPapel("Owner")).toBe("colaborador");
  });
});

describe("podeAcessarTenant — o isolamento entre clientes", () => {
  it("membro do tenant, com licenca valida, acessa", () => {
    expect(podeAcessarTenant(membro(), "t-vazxpress", licenca(), AGORA)).toBe(true);
  });

  it("NAO acessa tenant de outro cliente — o ponto central do multi-tenant", () => {
    expect(podeAcessarTenant(membro({ tenantId: "t-a" }), "t-b", licenca(), AGORA)).toBe(false);
  });

  it("colaborador acessa o MESMO tenant do owner — e o que o modelo users/{uid} quebrava", () => {
    const colab = membro({ papel: "colaborador", email: "socio@x.com", permissoesEdicao: ["estoque"] });
    expect(podeAcessarTenant(colab, "t-vazxpress", licenca(), AGORA)).toBe(true);
  });

  it("licenca vencida derruba o colaborador junto com o owner", () => {
    // A licenca e da OPERACAO. Se valesse por pessoa, o owner deixaria vencer
    // e seguiria operando pelo colaborador.
    const colab = membro({ papel: "colaborador" });
    const vencida = licenca({ expiresAt: AGORA - DIA });
    expect(podeAcessarTenant(colab, "t-vazxpress", vencida, AGORA)).toBe(false);
  });

  it("sem vinculo nao acessa nada, mesmo com licenca valida", () => {
    expect(podeAcessarTenant(null, "t-vazxpress", licenca(), AGORA)).toBe(false);
  });

  it("tenantId vazio nunca casa — evita '' === '' liberar tudo", () => {
    expect(podeAcessarTenant(membro({ tenantId: "" }), "", licenca(), AGORA)).toBe(false);
  });
});

describe("ehOwner", () => {
  it("distingue owner de colaborador e de ausente", () => {
    expect(ehOwner(membro({ papel: "owner" }))).toBe(true);
    expect(ehOwner(membro({ papel: "colaborador" }))).toBe(false);
    expect(ehOwner(null)).toBe(false);
  });
});
