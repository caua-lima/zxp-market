import "server-only";
import { randomUUID } from "node:crypto";
import { getAdminDb } from "../../../lib/firebase/admin";
import { refreshAccessToken } from "@/lib/ml/client";
import {
  LEASE_MS,
  decidirGravacaoDoRefresh,
  podeAssumirRenovacao,
  precisaRenovar,
  relogioDoToken,
  type DadosToken,
} from "@/lib/domain/token-ml";

export type MlTokenData = DadosToken & {
  user_id?: string | number | null;
  user_profile?: unknown;
};

const REF = () => getAdminDb().collection("ml_tokens").doc("main");

export async function getMlTokenData(): Promise<MlTokenData | null> {
  const doc = await REF().get();
  if (!doc.exists) return null;
  return doc.data() as MlTokenData;
}

/**
 * Renova o token, coordenando com quem mais estiver tentando.
 *
 * ─── POR QUE ISTO NÃO É SÓ UM `set` ─────────────────────────────────────
 *
 * Antes era: se venceu, chama o ML e grava. Sem coordenação nenhuma.
 *
 * Duas requisições que achassem o token vencido ao mesmo tempo — e num app com
 * cron, webhook e telas abertas isso acontece — chamavam `refreshAccessToken`
 * com o MESMO refresh_token. O Mercado Livre ROTACIONA esse token: a segunda
 * chamada usa um valor já consumido e falha. Pior: a resposta que chegasse por
 * último sobrescrevia a mais nova com a mais velha, deixando gravado um token
 * que já não vale — e aí TODA chamada ao ML falhava até alguém reconectar.
 *
 * ─── A ORDEM, E POR QUE ELA É ASSIM ─────────────────────────────────────
 *
 *   1. transação: confere a geração e toma a concessão (nada de rede aqui);
 *   2. FORA da transação: chama o ML;
 *   3. transação: confere a geração de novo e grava.
 *
 * A chamada externa fica fora da transação de propósito: o Firestore REEXECUTA
 * o callback de uma transação em caso de contenção, e isso dispararia vários
 * refresh — exatamente o problema que estamos resolvendo.
 *
 * A dupla conferência de geração existe porque a conexão pode ser trocada
 * ENQUANTO o ML responde. Gravar assim mesmo ressuscitaria a conexão anterior,
 * com o token de uma conta que já não é a conectada.
 *
 * ─── S05 DA AUDITORIA SAAS ───────────────────────────────────────────────
 *
 * A gravação também é compare-and-set no refresh token (grava só se ninguém
 * gravou um mais novo desde a leitura), e a concessão tem DONO: quem falha
 * libera só a própria, nunca a de outro processo ainda trabalhando. A chamada
 * ao ML é uma tentativa só, com tempo que cabe na concessão. O porquê de cada
 * escolha está em lib/domain/token-ml.ts (decidirGravacaoDoRefresh,
 * TIMEOUT_TROCA_TOKEN_MS).
 */
async function renovarCoordenado(atual: MlTokenData): Promise<string | null> {
  if (!atual.refresh_token) return null;

  const db = getAdminDb();
  const ref = REF();
  const dono = randomUUID();

  // 1. Toma a concessão — ou descobre que outro já está renovando.
  const assumiu = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = (snap.data() ?? {}) as MlTokenData;

    // Alguém já renovou enquanto chegávamos aqui: aproveita e não chama o ML.
    if (!precisaRenovar(d, Date.now())) return { tipo: "ja_renovado" as const, token: d.access_token ?? null };
    if (!podeAssumirRenovacao(d, Date.now())) return { tipo: "ocupado" as const };

    tx.update(ref, { refreshLeaseAte: Date.now() + LEASE_MS, refreshLeaseDono: dono });
    return { tipo: "assumiu" as const, geracao: Number(d.geracao ?? 0), refresh: d.refresh_token ?? null };
  });

  if (assumiu.tipo === "ja_renovado") return assumiu.token;

  if (assumiu.tipo === "ocupado") {
    /**
     * Outro processo está renovando. Espera a gravação dele em vez de disparar
     * uma segunda chamada — é o refresh token rotacionado que está em jogo.
     * Se não vier a tempo, devolve o que houver: melhor uma chamada que talvez
     * falhe do que travar a requisição.
     */
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const d = await getMlTokenData();
      if (d && !precisaRenovar(d, Date.now())) return d.access_token ?? null;
    }
    return (await getMlTokenData())?.access_token ?? null;
  }

  if (!assumiu.refresh) return null;

  // 2. A chamada externa, FORA da transação.
  let renovado;
  try {
    renovado = await refreshAccessToken(assumiu.refresh);
  } catch (err) {
    // Libera a concessão — se ainda for DESTE processo. Antes era um `update`
    // cego: o processo que falhava apagava a concessão de outro que ainda
    // estava no meio da própria renovação.
    await db.runTransaction(async (tx) => {
      const d = ((await tx.get(ref)).data() ?? {}) as MlTokenData;
      if (d.refreshLeaseDono === dono) tx.update(ref, { refreshLeaseAte: null, refreshLeaseDono: null });
    }).catch(() => {});
    throw err;
  }

  // 3. Grava — se a conexão é a mesma E ninguém gravou um token mais novo.
  const gravou = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = (snap.data() ?? {}) as MlTokenData;
    const decisao = decidirGravacaoDoRefresh({ geracao: assumiu.geracao, refreshUsado: assumiu.refresh!, dono }, d);
    const soltar = decisao.liberarConcessao ? { refreshLeaseAte: null, refreshLeaseDono: null } : {};

    if (!decisao.gravar) {
      if (decisao.liberarConcessao) tx.update(ref, soltar);
      // Conexão trocada: o token é de outra conta, descarta. Token mais novo
      // já gravado: o do documento é o que vale.
      return decisao.motivo === "token_mais_novo_ja_gravado" ? d.access_token ?? null : null;
    }

    const relogio = relogioDoToken(renovado.expires_in ?? atual.expires_in, Date.now());
    tx.set(ref, {
      access_token: renovado.access_token ?? null,
      refresh_token: renovado.refresh_token ?? assumiu.refresh,
      expires_in: renovado.expires_in ?? atual.expires_in ?? null,
      user_id: renovado.user_id ?? atual.user_id ?? null,
      ...relogio,
      // `updated_at` volta a ser o que o nome diz: quando o documento mudou.
      // Ele NÃO é mais o relógio de expiração — ver lib/domain/token-ml.ts.
      updated_at: new Date().toISOString(),
      ...soltar,
    }, { merge: true });

    return renovado.access_token ?? null;
  });

  return gravou;
}

export async function getMlTokenStatus() {
  const data = await getMlTokenData();
  return {
    connected: Boolean(data?.refresh_token || data?.access_token),
    user_id: data?.user_id ? String(data.user_id) : null,
    user_profile: data?.user_profile || null,
  };
}

export async function getMlAccessToken() {
  const tokenData = await getMlTokenData();
  if (!tokenData) return null;

  if (!precisaRenovar(tokenData, Date.now())) return tokenData.access_token ?? null;

  // Sem refresh token não há o que renovar. Devolve o que existe: pode estar
  // vencido, e aí o ML responde 401 — que é uma informação melhor que `null`.
  if (!tokenData.refresh_token) return tokenData.access_token ?? null;

  return renovarCoordenado(tokenData);
}
