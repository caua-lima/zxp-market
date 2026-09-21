import { describe, expect, it } from "vitest";
import {
  explicarTeste,
  montarDiagnostico,
  type DestinoDoTeste,
  type DiagnosticoLocal,
  type DiagnosticoServidor,
} from "./diagnostico-push";

const d = (over: Partial<DestinoDoTeste> = {}): DestinoDoTeste => ({ este: true, status: "accepted", ...over });

describe("explicarTeste — cada causa de 'zero aceitos' pede uma correção diferente", () => {
  it("aceito: diz o que o servidor sabe e o que NÃO sabe, sem mandar reinstalar", () => {
    const r = explicarTeste([d()], true);
    expect(r.resultado).toBe("aceito");
    expect(r.explicacao).toContain("entregou a mensagem ao Firebase");
    expect(r.explicacao).toContain("Reinstalar o app não deve ser o primeiro passo");
  });

  it("sem registro DESTE aparelho: manda ativar, não reinstalar", () => {
    const r = explicarTeste([d({ este: false })], true);
    expect(r.resultado).toBe("sem_registro");
    expect(r.explicacao).toContain("Este aparelho");
    expect(r.explicacao).not.toMatch(/reinstal/i);
  });

  it("sem aparelho nenhum registrado (teste sem alvo)", () => {
    expect(explicarTeste([], false)).toMatchObject({ resultado: "sem_registro" });
  });

  it("token recusado pelo Firebase: reativa em 📱 — reinstalar não é necessário", () => {
    const r = explicarTeste([d({ status: "permanent_failure", motivo: "token_invalido", erro: "messaging/registration-token-not-registered" })], true);
    expect(r.resultado).toBe("falha");
    expect(r.explicacao).toContain("Desative e ative de novo");
    expect(r.explicacao).toContain("reinstalar o app não é necessário");
  });

  it("acesso removido NÃO é ausência de registro", () => {
    const r = explicarTeste([d({ status: "suppressed", motivo: "sem_acesso" })], true);
    expect(r.resultado).toBe("suprimido");
    expect(r.explicacao).toContain("acesso");
    expect(r.explicacao).not.toContain("registro");
  });

  it("Firebase instável: pendente, e diz que se resolve sozinho", () => {
    const r = explicarTeste([d({ status: "retry_scheduled", erro: "messaging/internal-error" })], true);
    expect(r.resultado).toBe("pendente");
    expect(r.explicacao).toContain("tenta de novo sozinho");
  });

  it("tentativas esgotadas: é do lado do servidor/provedor", () => {
    const r = explicarTeste([d({ status: "permanent_failure", motivo: "tentativas_esgotadas", erro: "messaging/internal-error" })], true);
    expect(r.explicacao).toContain("servidor ou do provedor");
  });

  it("recusa do provedor por outro motivo", () => {
    const r = explicarTeste([d({ status: "permanent_failure", motivo: "recusado_pelo_provedor", erro: "messaging/invalid-argument" })], true);
    expect(r.resultado).toBe("falha");
    expect(r.explicacao).toContain("messaging/invalid-argument");
  });

  it("expirado: pede pra repetir", () => {
    expect(explicarTeste([d({ status: "expired" })], true).explicacao).toContain("Repita o teste");
  });

  it("com alvo, o resultado de OUTRO aparelho seu não mascara o deste", () => {
    const r = explicarTeste([d({ este: false, status: "accepted" }), d({ este: true, status: "permanent_failure", motivo: "token_invalido" })], true);
    expect(r.resultado).toBe("falha");
  });

  it("sem alvo, o melhor resultado entre os aparelhos vale", () => {
    const r = explicarTeste([d({ este: false, status: "permanent_failure", motivo: "token_invalido" }), d({ este: false, status: "accepted" })], false);
    expect(r.resultado).toBe("aceito");
  });

  it("nenhuma explicação vaza token nem e-mail", () => {
    const r = explicarTeste([d({ status: "permanent_failure", motivo: "token_invalido", erro: "messaging/registration-token-not-registered" })], true);
    expect(r.explicacao).not.toMatch(/@|token-[a-z0-9]{10,}/i);
  });
});

// ── montarDiagnostico ─────────────────────────────────────────────────


const localOk = (over: Partial<DiagnosticoLocal> = {}): DiagnosticoLocal => ({
  suportado: true, permissao: "granted", standalone: true, ios: false,
  swRegistrado: true, swVersao: "v1", swEsperada: "v1",
  vinculo: "ativo", tokenConfere: true, registroNoServidor: true, ultimoRecebimento: null, ...over,
});
const servidorOk = (over: Partial<DiagnosticoServidor> = {}): DiagnosticoServidor => ({
  acesso: "ok", preferencias: "ok", aparelhos: { total: 1, esteRegistrado: true }, ultimosEnvios: [], ...over,
});
const secao = (r: ReturnType<typeof montarDiagnostico>, id: string) => r.find((s) => s.id === id)!;
const texto = (r: ReturnType<typeof montarDiagnostico>) => r.flatMap((s) => s.linhas).join("\n");

describe("montarDiagnostico — cada camada diz o que sabe", () => {
  it("tudo em ordem: nenhuma camada em problema", () => {
    const r = montarDiagnostico(localOk(), servidorOk());
    expect(r.filter((s) => s.nivel === "problema" || s.nivel === "atencao")).toEqual([]);
  });

  it("permissão bloqueada é problema DO APARELHO, e não manda reinstalar", () => {
    const r = montarDiagnostico(localOk({ permissao: "denied" }), servidorOk());
    expect(secao(r, "aparelho").nivel).toBe("problema");
    expect(texto(r)).toContain("BLOQUEADA");
    expect(texto(r)).not.toMatch(/reinstale/i);
  });

  it("Service Worker antigo: troca em 📱, 'não é preciso reinstalar'", () => {
    const r = montarDiagnostico(localOk({ swVersao: null }), servidorOk());
    expect(secao(r, "aparelho").nivel).toBe("atencao");
    expect(texto(r)).toContain("não é preciso reinstalar");
  });

  it("Service Worker de versão diferente da publicada", () => {
    expect(texto(montarDiagnostico(localOk({ swVersao: "v0", swEsperada: "v1" }), servidorOk()))).toContain("desatualizado (v0; esperado v1)");
  });

  it("iOS fora da Tela de Início: explica a condição (o gesto no app instalado)", () => {
    const r = montarDiagnostico(localOk({ ios: true, standalone: false }), servidorOk());
    expect(texto(r)).toContain("Tela de Início");
    expect(texto(r)).toContain("dentro do app instalado");
  });

  it("iOS instalado não recebe o aviso de instalação", () => {
    expect(texto(montarDiagnostico(localOk({ ios: true, standalone: true }), servidorOk()))).not.toContain("Tela de Início");
  });

  it("navegador sem suporte no iOS diz a versão mínima", () => {
    expect(texto(montarDiagnostico(localOk({ suportado: false, ios: true }), servidorOk()))).toContain("iOS 16.4");
  });

  it("registro sumiu do servidor: problema do VÍNCULO, distinto do aparelho", () => {
    const r = montarDiagnostico(localOk({ registroNoServidor: false }), servidorOk({ aparelhos: { total: 0, esteRegistrado: false } }));
    expect(secao(r, "vinculo").nivel).toBe("problema");
    expect(secao(r, "aparelho").nivel).toBe("ok");
    expect(texto(r)).toContain("reinstalar o app não é necessário");
  });

  it("vinculado a outra conta", () => {
    expect(secao(montarDiagnostico(localOk({ vinculo: "outra_pessoa" }), servidorOk()), "vinculo").nivel).toBe("problema");
  });

  it("sem vínculo: atenção, manda ativar", () => {
    const r = montarDiagnostico(localOk({ vinculo: "sem_vinculo" }), servidorOk());
    expect(secao(r, "vinculo").nivel).toBe("atencao");
  });

  it("acesso removido é problema da CONTA", () => {
    const r = montarDiagnostico(localOk(), servidorOk({ acesso: "sem_acesso" }));
    expect(secao(r, "conta").nivel).toBe("problema");
    expect(secao(r, "aparelho").nivel).toBe("ok");
  });

  it("preferências inválidas e indisponíveis são atenção, com o efeito explicado", () => {
    expect(texto(montarDiagnostico(localOk(), servidorOk({ preferencias: "invalida" })))).toContain("voltaram ao padrão");
    expect(texto(montarDiagnostico(localOk(), servidorOk({ preferencias: "indisponivel" })))).toContain("sem valores financeiros");
  });

  it("OUTROS aparelhos ficam numa seção própria e não contam pra este", () => {
    const r = montarDiagnostico(localOk(), servidorOk({ aparelhos: { total: 3, esteRegistrado: true } }));
    expect(secao(r, "outros").linhas[0]).toContain("2 outro(s)");
    expect(secao(r, "outros").linhas[0]).toContain("não dizem nada sobre ESTE");
  });

  it("servidor mudo: as camadas dele viram 'desconhecido', não 'ok'", () => {
    const r = montarDiagnostico(localOk({ registroNoServidor: null }), null);
    expect(secao(r, "conta").nivel).toBe("desconhecido");
    expect(secao(r, "servidor").nivel).toBe("desconhecido");
    expect(secao(r, "vinculo").nivel).toBe("desconhecido");
  });

  it("envios: aceitos, suprimidos, falhas e cliques contados — e 'aceito' não é 'exibido'", () => {
    const r = montarDiagnostico(localOk(), servidorOk({
      ultimosEnvios: [
        { status: "accepted", clicado: true }, { status: "accepted", clicado: false },
        { status: "permanent_failure", motivo: "token_invalido", erro: "x", clicado: false },
        { status: "suppressed", motivo: "preferencia_toggle", clicado: false },
      ],
    }));
    expect(secao(r, "servidor").linhas[0]).toContain("2 aceito(s)");
    expect(secao(r, "servidor").linhas[0]).toContain("tocou em 1");
    expect(secao(r, "servidor").nivel).toBe("atencao");
    expect(texto(r)).toContain("não que ela apareceu na tela");
  });

  it("tudo suprimido: diz que NADA foi enviado ao Firebase", () => {
    const r = montarDiagnostico(localOk(), servidorOk({ ultimosEnvios: [{ status: "suppressed", clicado: false }] }));
    expect(texto(r)).toContain("Nada foi enviado ao Firebase");
  });

  it("o Service Worker viu o push e exibiu: observado ok", () => {
    const r = montarDiagnostico(localOk({ ultimoRecebimento: { eventId: "e", tipo: "test", recebidoEm: 1, exibidoEm: 2, erro: null } }), servidorOk());
    expect(secao(r, "observado").nivel).toBe("ok");
  });

  it("o Service Worker recebeu mas não exibiu: problema no aparelho, com o erro", () => {
    const r = montarDiagnostico(localOk({ ultimoRecebimento: { eventId: "e", tipo: "test", recebidoEm: 1, exibidoEm: null, erro: "NotAllowedError" } }), servidorOk());
    expect(secao(r, "observado").nivel).toBe("problema");
    expect(texto(r)).toContain("NotAllowedError");
  });

  it("nenhum push observado ainda: desconhecido, não problema", () => {
    expect(secao(montarDiagnostico(localOk(), servidorOk()), "observado").nivel).toBe("desconhecido");
  });

  it("nada no diagnóstico manda reinstalar como primeiro passo", () => {
    for (const l of [localOk({ permissao: "denied" }), localOk({ swVersao: null }), localOk({ vinculo: "sem_vinculo" }), localOk({ registroNoServidor: false })]) {
      // As frases que DIZEM que não é preciso reinstalar são permitidas; qualquer outra menção a reinstalar, não.
      const t = texto(montarDiagnostico(l, servidorOk()))
        .replace(/não é preciso reinstalar o app/gi, "")
        .replace(/reinstalar o app não é necessário/gi, "")
        .replace(/Reinstalar o app não deve ser o primeiro passo/gi, "");
      expect(t).not.toMatch(/reinstal|remova da tela inicial|desinstal/i);
    }
  });
});
