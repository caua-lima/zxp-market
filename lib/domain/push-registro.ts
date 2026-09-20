/**
 * Quem está registrado pra receber push — e como esse registro nasce, troca de
 * dono e morre.
 *
 * ─── O BURACO ───────────────────────────────────────────────────────────
 *
 * O registro de um aparelho era gravado direto do navegador, a chave local
 * `push_enabled` valia pro NAVEGADOR (não pra pessoa) e sair da conta não
 * desfazia nada. O que isso permitia, no mesmo navegador:
 *
 *  1. A ativa o push e sai. O registro de A continua vivo, apontando pro token
 *     deste navegador, e o push de A (com o faturamento da empresa) segue
 *     chegando na tela de quem usar o aparelho depois.
 *  2. B entra. A tela mostra "notificações ativas" — a chave local diz que sim
 *     — mas o registro é de A: B nunca recebe nada e ninguém percebe.
 *  3. Desativar engolia o erro. O botão voltava a "desligado" com o registro
 *     ainda no servidor.
 *
 * O cliente não consegue consertar (1) sozinho: as regras do Firestore, com
 * razão, não deixam B apagar o documento de A. Por isso o registro passou a
 * ser feito por uma rota do servidor, que aplica as invariantes abaixo.
 *
 * ─── AS INVARIANTES ─────────────────────────────────────────────────────
 *
 *  - Um token pertence a UMA pessoa. Token é o aparelho; se ele aparece num
 *    pedido de vínculo de outra conta, o aparelho trocou de dono e o registro
 *    antigo sai.
 *  - Um (pessoa, instalação) tem UM registro: renovar o token sobrescreve.
 *  - Nada se conclui pelo e-mail. Dois registros do mesmo e-mail com tokens
 *    diferentes são, até prova em contrário, dois aparelhos.
 *  - Há teto de instalações por pessoa, pra o registro não virar um depósito.
 */

/** Instalações simultâneas por pessoa. Folgado: ninguém tem dez celulares. */
export const LIMITE_INSTALACOES_POR_USUARIO = 10;

const DEVICE_ID = /^[A-Za-z0-9-]{8,64}$/;
const TAMANHO_TOKEN = { min: 20, max: 4096 };

export type EntradaValida = { token: string; deviceId: string };

/** Valida o corpo de um pedido de vínculo. O token do FCM é opaco: só se confere o formato. */
export function validarEntradaDeVinculo(cru: unknown): ({ ok: true } & EntradaValida) | { ok: false; motivo: string } {
  if (typeof cru !== "object" || cru === null) return { ok: false, motivo: "corpo inválido" };
  const { token, deviceId } = cru as Record<string, unknown>;
  if (typeof token !== "string" || token.length < TAMANHO_TOKEN.min || token.length > TAMANHO_TOKEN.max || /\s/.test(token)) {
    return { ok: false, motivo: "token inválido" };
  }
  if (typeof deviceId !== "string" || !DEVICE_ID.test(deviceId)) {
    return { ok: false, motivo: "deviceId inválido" };
  }
  return { ok: true, token, deviceId };
}

/** Só o token, pro desvínculo por posse (ver alvosDoDesvinculo). */
export function validarTokenSolto(cru: unknown): string | null {
  if (typeof cru !== "object" || cru === null) return null;
  const { token } = cru as Record<string, unknown>;
  return typeof token === "string" && token.length >= TAMANHO_TOKEN.min && token.length <= TAMANHO_TOKEN.max && !/\s/.test(token)
    ? token
    : null;
}

/** Id determinístico por (pessoa, instalação) — nunca acumula. */
export function idDoRegistro(email: string, deviceId: string): string {
  // "/" quebraria o caminho do documento; o resto do e-mail é seguro.
  return `${email.toLowerCase().replace(/\//g, "_")}__${deviceId}`;
}

export type RegistroDePush = {
  docId: string;
  email: string;
  token: string;
  deviceId: string;
  updatedAt: number;
};

export type PlanoDeVinculo = {
  /** Id do registro que fica com o token. */
  gravarId: string;
  /** Registros que saem, com o porquê — o porquê vai pro log, não pro usuário. */
  apagar: { docId: string; motivo: "mesmo_token_outro_registro" | "acima_do_limite" }[];
};

/**
 * O que gravar e o que apagar ao vincular `entrada` a `email`.
 *
 * `existentes` deve conter os registros com o MESMO TOKEN e os do MESMO
 * E-MAIL (a rota busca os dois). Registros de outras pessoas com outros
 * tokens nunca chegam aqui e nunca são tocados.
 */
export function planejarVinculo(
  existentes: RegistroDePush[],
  entrada: EntradaValida & { email: string },
  limite = LIMITE_INSTALACOES_POR_USUARIO,
): PlanoDeVinculo {
  const email = entrada.email.toLowerCase();
  const gravarId = idDoRegistro(email, entrada.deviceId);
  const apagar: PlanoDeVinculo["apagar"] = [];
  const marcados = new Set<string>([gravarId]);

  // 1) Mesmo token em outro registro: o aparelho é o mesmo, o dono mudou (ou o
  //    registro é um legado indexado pelo próprio token). Sai.
  for (const r of existentes) {
    if (r.token === entrada.token && r.docId !== gravarId && !marcados.has(r.docId)) {
      apagar.push({ docId: r.docId, motivo: "mesmo_token_outro_registro" });
      marcados.add(r.docId);
    }
  }

  // 2) Teto por pessoa. Conta o registro que está sendo gravado; se estourar,
  //    saem os mais antigos DESTA pessoa — nunca o que acabou de ser gravado.
  const restantes = existentes
    .filter((r) => r.email.toLowerCase() === email && !marcados.has(r.docId))
    .sort((a, b) => a.updatedAt - b.updatedAt);
  let excesso = restantes.length + 1 - limite;
  for (const r of restantes) {
    if (excesso <= 0) break;
    apagar.push({ docId: r.docId, motivo: "acima_do_limite" });
    excesso -= 1;
  }

  return { gravarId, apagar };
}

/**
 * Quem sai num pedido de desvínculo.
 *
 * Dois critérios, e nenhum é "o e-mail":
 *  - instalação: (pessoa autenticada, deviceId) — o botão "desativar";
 *  - posse do token: quem sabe o token controla o aparelho. É o que permite
 *    desfazer o registro DEPOIS de sair da conta (ou sem rede na hora de
 *    sair), quando já não existe sessão pra autenticar.
 */
export function alvosDoDesvinculo(
  existentes: RegistroDePush[],
  criterio: { email?: string; deviceId?: string; token?: string },
): string[] {
  const email = criterio.email?.toLowerCase();
  return existentes
    .filter((r) => {
      const porInstalacao = !!email && !!criterio.deviceId && r.email.toLowerCase() === email && r.deviceId === criterio.deviceId;
      const porToken = !!criterio.token && r.token === criterio.token;
      return porInstalacao || porToken;
    })
    .map((r) => r.docId);
}

/**
 * O que este navegador guarda sobre o próprio vínculo, e a pergunta que
 * importa: esse vínculo é DA pessoa que está na tela?
 */
export type VinculoLocal = { email: string; deviceId: string; token: string; em: number };

export type SituacaoDoVinculo = "ativo" | "outra_pessoa" | "sem_vinculo";

export function situacaoDoVinculo(vinculo: VinculoLocal | null, emailAtual: string | null | undefined): SituacaoDoVinculo {
  if (!vinculo) return "sem_vinculo";
  if (!emailAtual) return "outra_pessoa";
  return vinculo.email.toLowerCase() === emailAtual.toLowerCase() ? "ativo" : "outra_pessoa";
}

/** Lê o vínculo salvo, sem confiar no que está no localStorage. */
export function lerVinculoLocal(bruto: string | null): VinculoLocal | null {
  if (!bruto) return null;
  try {
    const v = JSON.parse(bruto) as Partial<VinculoLocal>;
    if (typeof v.email === "string" && typeof v.deviceId === "string" && typeof v.token === "string" && v.email && v.token) {
      return { email: v.email, deviceId: v.deviceId, token: v.token, em: typeof v.em === "number" ? v.em : 0 };
    }
  } catch { /* JSON quebrado é o mesmo que nenhum vínculo */ }
  return null;
}

/**
 * O que fazer ao reconciliar (login, troca de conta, volta ao app).
 *
 *  - `reativar`: a pessoa já quis notificações neste navegador e há permissão —
 *    (re)registra o token atual sem pedir nada.
 *  - `soltar_do_anterior`: o vínculo é de outra pessoa e esta não quer push
 *    aqui — desfaz o do anterior.
 *  - `nada`: nada a fazer.
 */
export type AcaoDeReconciliacao =
  | { acao: "nada" }
  | { acao: "reativar"; soltarAnterior: boolean }
  | { acao: "soltar_do_anterior" };

export function decidirReconciliacao(params: {
  permissao: "granted" | "denied" | "default" | "indisponivel";
  vinculo: VinculoLocal | null;
  emailAtual: string;
  querPush: boolean;
  tokenAtual: string | null;
}): AcaoDeReconciliacao {
  const situacao = situacaoDoVinculo(params.vinculo, params.emailAtual);
  const soltarAnterior = situacao === "outra_pessoa";

  if (params.permissao !== "granted" || !params.querPush) {
    return soltarAnterior ? { acao: "soltar_do_anterior" } : { acao: "nada" };
  }
  // Quer push e há permissão: reativa se não há vínculo ativo, ou se o token rodou.
  if (situacao !== "ativo") return { acao: "reativar", soltarAnterior };
  if (params.tokenAtual && params.vinculo && params.tokenAtual !== params.vinculo.token) {
    return { acao: "reativar", soltarAnterior: false };
  }
  return { acao: "nada" };
}
