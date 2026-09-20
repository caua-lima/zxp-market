import { describe, expect, it } from "vitest";
import {
  LIMITE_INSTALACOES_POR_USUARIO,
  alvosDoDesvinculo,
  decidirReconciliacao,
  idDoRegistro,
  lerVinculoLocal,
  planejarVinculo,
  situacaoDoVinculo,
  validarEntradaDeVinculo,
  validarTokenSolto,
  type RegistroDePush,
  type VinculoLocal,
} from "./push-registro";

const TOKEN_A = "fcm-token-do-aparelho-A-" + "x".repeat(40);
const TOKEN_B = "fcm-token-do-aparelho-B-" + "y".repeat(40);
const DEV_1 = "dev-11111111";
const DEV_2 = "dev-22222222";

function reg(email: string, deviceId: string, token: string, updatedAt = 1000, docId?: string): RegistroDePush {
  return { docId: docId ?? idDoRegistro(email, deviceId), email, deviceId, token, updatedAt };
}

describe("validarEntradaDeVinculo", () => {
  it("aceita token e deviceId bem formados", () => {
    expect(validarEntradaDeVinculo({ token: TOKEN_A, deviceId: DEV_1 })).toEqual({ ok: true, token: TOKEN_A, deviceId: DEV_1 });
  });
  it("recusa corpo que não é objeto, token curto/gigante/com espaço, deviceId estranho", () => {
    expect(validarEntradaDeVinculo(null).ok).toBe(false);
    expect(validarEntradaDeVinculo("x").ok).toBe(false);
    expect(validarEntradaDeVinculo({ token: "curto", deviceId: DEV_1 }).ok).toBe(false);
    expect(validarEntradaDeVinculo({ token: "a".repeat(5000), deviceId: DEV_1 }).ok).toBe(false);
    expect(validarEntradaDeVinculo({ token: TOKEN_A + " x", deviceId: DEV_1 }).ok).toBe(false);
    expect(validarEntradaDeVinculo({ token: TOKEN_A, deviceId: "../../x" }).ok).toBe(false);
    expect(validarEntradaDeVinculo({ token: TOKEN_A }).ok).toBe(false);
  });
});

describe("planejarVinculo — o aparelho trocou de dono", () => {
  it("o mesmo token vinculado a OUTRA conta: o registro dela sai", () => {
    // A ativou, saiu (ou nem saiu) e B entrou no mesmo navegador: o token é o mesmo.
    const existentes = [reg("a@zxp.com", DEV_1, TOKEN_A)];
    const plano = planejarVinculo(existentes, { email: "b@zxp.com", token: TOKEN_A, deviceId: DEV_1 });
    expect(plano.gravarId).toBe(idDoRegistro("b@zxp.com", DEV_1));
    expect(plano.apagar).toEqual([{ docId: idDoRegistro("a@zxp.com", DEV_1), motivo: "mesmo_token_outro_registro" }]);
  });

  it("registro legado (id = o próprio token) com o mesmo token também sai", () => {
    const legado = reg("a@zxp.com", "", TOKEN_A, 500, TOKEN_A);
    const plano = planejarVinculo([legado], { email: "a@zxp.com", token: TOKEN_A, deviceId: DEV_1 });
    expect(plano.apagar.map((a) => a.docId)).toEqual([TOKEN_A]);
  });

  it("renovar o token da MESMA instalação sobrescreve, não acumula", () => {
    const antigo = reg("a@zxp.com", DEV_1, TOKEN_A);
    const plano = planejarVinculo([antigo], { email: "a@zxp.com", token: TOKEN_B, deviceId: DEV_1 });
    expect(plano.gravarId).toBe(antigo.docId);
    expect(plano.apagar).toEqual([]);
  });

  it("outro aparelho da mesma pessoa NÃO é tocado — e-mail igual não prova aparelho igual", () => {
    const celular = reg("a@zxp.com", DEV_1, TOKEN_A);
    const plano = planejarVinculo([celular], { email: "a@zxp.com", token: TOKEN_B, deviceId: DEV_2 });
    expect(plano.apagar).toEqual([]);
  });

  it("registro legado de OUTRO aparelho da mesma pessoa continua", () => {
    // O comportamento antigo apagava todo legado de quem tinha um registro novo.
    const legadoDoCelular = reg("a@zxp.com", "", "token-legado-do-celular-" + "z".repeat(30), 500, "token-legado-do-celular-" + "z".repeat(30));
    const plano = planejarVinculo([legadoDoCelular], { email: "a@zxp.com", token: TOKEN_A, deviceId: DEV_1 });
    expect(plano.apagar).toEqual([]);
  });

  it("registro de outra pessoa com outro token nunca é considerado", () => {
    const deOutro = reg("c@zxp.com", DEV_2, TOKEN_B);
    const plano = planejarVinculo([deOutro], { email: "a@zxp.com", token: TOKEN_A, deviceId: DEV_1 });
    expect(plano.apagar).toEqual([]);
  });

  it("caixa do e-mail não cria um segundo dono", () => {
    const plano = planejarVinculo([reg("a@zxp.com", DEV_1, TOKEN_A)], { email: "A@ZXP.com", token: TOKEN_A, deviceId: DEV_1 });
    expect(plano.gravarId).toBe(idDoRegistro("a@zxp.com", DEV_1));
    expect(plano.apagar).toEqual([]);
  });
});

describe("planejarVinculo — teto por pessoa", () => {
  const muitos = Array.from({ length: LIMITE_INSTALACOES_POR_USUARIO }, (_, i) =>
    reg("a@zxp.com", `dev-${String(i).padStart(8, "0")}`, `token-${i}-` + "k".repeat(30), 100 + i));

  it("na décima primeira instalação, sai a MAIS ANTIGA e nunca a recém-gravada", () => {
    const plano = planejarVinculo(muitos, { email: "a@zxp.com", token: TOKEN_A, deviceId: DEV_2 });
    expect(plano.apagar).toEqual([{ docId: muitos[0].docId, motivo: "acima_do_limite" }]);
    expect(plano.gravarId).toBe(idDoRegistro("a@zxp.com", DEV_2));
  });

  it("abaixo do teto ninguém sai", () => {
    const plano = planejarVinculo(muitos.slice(0, 3), { email: "a@zxp.com", token: TOKEN_A, deviceId: DEV_2 });
    expect(plano.apagar).toEqual([]);
  });

  it("regravar uma instalação já existente não conta duas vezes", () => {
    const plano = planejarVinculo(muitos, { email: "a@zxp.com", token: TOKEN_B, deviceId: "dev-00000003" });
    expect(plano.apagar).toEqual([]);
  });
});

describe("alvosDoDesvinculo", () => {
  const existentes = [
    reg("a@zxp.com", DEV_1, TOKEN_A),
    reg("a@zxp.com", DEV_2, TOKEN_B),
    reg("b@zxp.com", DEV_1, "token-de-b-" + "w".repeat(30)),
  ];

  it("por instalação: só o registro (pessoa, instalação)", () => {
    expect(alvosDoDesvinculo(existentes, { email: "a@zxp.com", deviceId: DEV_1 })).toEqual([existentes[0].docId]);
  });

  it("instalação de outra pessoa não é alcançada pelo e-mail errado", () => {
    expect(alvosDoDesvinculo(existentes, { email: "c@zxp.com", deviceId: DEV_1 })).toEqual([]);
  });

  it("por posse do token: apaga o registro que tem esse token, de quem for", () => {
    expect(alvosDoDesvinculo(existentes, { token: TOKEN_B })).toEqual([existentes[1].docId]);
  });

  it("sem critério nenhum, nada sai", () => {
    expect(alvosDoDesvinculo(existentes, {})).toEqual([]);
    expect(alvosDoDesvinculo(existentes, { deviceId: DEV_1 })).toEqual([]);
  });
});

describe("validarTokenSolto", () => {
  it("só devolve token de formato válido", () => {
    expect(validarTokenSolto({ token: TOKEN_A })).toBe(TOKEN_A);
    expect(validarTokenSolto({ token: "x" })).toBeNull();
    expect(validarTokenSolto(undefined)).toBeNull();
  });
});

describe("situacaoDoVinculo — 'ativo' é DA PESSOA na tela", () => {
  const vinculo: VinculoLocal = { email: "a@zxp.com", deviceId: DEV_1, token: TOKEN_A, em: 1 };

  it("mesmo e-mail: ativo (ignorando caixa)", () => {
    expect(situacaoDoVinculo(vinculo, "A@zxp.com")).toBe("ativo");
  });
  it("outro e-mail no mesmo navegador: NÃO é ativo — era o falso 'notificações ativas'", () => {
    expect(situacaoDoVinculo(vinculo, "b@zxp.com")).toBe("outra_pessoa");
  });
  it("sem vínculo", () => {
    expect(situacaoDoVinculo(null, "a@zxp.com")).toBe("sem_vinculo");
  });
  it("sem ninguém logado, o vínculo existente não é de quem está na tela", () => {
    expect(situacaoDoVinculo(vinculo, null)).toBe("outra_pessoa");
  });
});

describe("lerVinculoLocal", () => {
  it("lê um vínculo válido e recusa lixo", () => {
    const v = { email: "a@zxp.com", deviceId: DEV_1, token: TOKEN_A, em: 5 };
    expect(lerVinculoLocal(JSON.stringify(v))).toEqual(v);
    expect(lerVinculoLocal(null)).toBeNull();
    expect(lerVinculoLocal("{quebrado")).toBeNull();
    expect(lerVinculoLocal(JSON.stringify({ email: "a@zxp.com" }))).toBeNull();
    expect(lerVinculoLocal(JSON.stringify({ email: "", deviceId: DEV_1, token: TOKEN_A }))).toBeNull();
  });
});

describe("decidirReconciliacao — login, troca de conta, rotação", () => {
  const vinculoDeA: VinculoLocal = { email: "a@zxp.com", deviceId: DEV_1, token: TOKEN_A, em: 1 };

  it("A → B no mesmo navegador, B nunca quis push aqui: solta o vínculo de A", () => {
    const r = decidirReconciliacao({ permissao: "granted", vinculo: vinculoDeA, emailAtual: "b@zxp.com", querPush: false, tokenAtual: TOKEN_A });
    expect(r).toEqual({ acao: "soltar_do_anterior" });
  });

  it("A → B, B já quis push aqui: reativa pra B (o servidor troca o dono do token)", () => {
    const r = decidirReconciliacao({ permissao: "granted", vinculo: vinculoDeA, emailAtual: "b@zxp.com", querPush: true, tokenAtual: TOKEN_A });
    expect(r).toEqual({ acao: "reativar", soltarAnterior: true });
  });

  it("token rodou: registra o novo sem pedir nada", () => {
    const r = decidirReconciliacao({ permissao: "granted", vinculo: vinculoDeA, emailAtual: "a@zxp.com", querPush: true, tokenAtual: TOKEN_B });
    expect(r).toEqual({ acao: "reativar", soltarAnterior: false });
  });

  it("tudo em ordem: nada a fazer", () => {
    const r = decidirReconciliacao({ permissao: "granted", vinculo: vinculoDeA, emailAtual: "a@zxp.com", querPush: true, tokenAtual: TOKEN_A });
    expect(r).toEqual({ acao: "nada" });
  });

  it("voltou a entrar depois de sair (vínculo solto, intenção guardada): reativa", () => {
    const r = decidirReconciliacao({ permissao: "granted", vinculo: null, emailAtual: "a@zxp.com", querPush: true, tokenAtual: TOKEN_B });
    expect(r).toEqual({ acao: "reativar", soltarAnterior: false });
  });

  it("permissão revogada no sistema: não tenta reativar", () => {
    const r = decidirReconciliacao({ permissao: "denied", vinculo: null, emailAtual: "a@zxp.com", querPush: true, tokenAtual: null });
    expect(r).toEqual({ acao: "nada" });
  });

  it("pessoa que nunca quis push, sem vínculo: nada", () => {
    const r = decidirReconciliacao({ permissao: "granted", vinculo: null, emailAtual: "a@zxp.com", querPush: false, tokenAtual: null });
    expect(r).toEqual({ acao: "nada" });
  });
});
