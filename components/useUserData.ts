"use client";

import { useEffect, useState } from "react";
import {
  watchCosts,
  watchDraft,
  watchGoalEntries,
  watchGoals,
  watchProducts,
} from "@/lib/firebase/data";
import type { Cost, DraftToday, GoalEntry, Goals, Product } from "@/lib/domain/types";
import {
  FONTE_CARREGANDO,
  fonteCarregada,
  fonteComErro,
  type EstadoFonte,
} from "@/lib/domain/estado-fonte";

/** Cada fonte que esta função assina, com o estado de cada uma. */
export type EstadosDasFontes = {
  rascunho: EstadoFonte;
  metas: EstadoFonte;
  custos: EstadoFonte;
  produtos: EstadoFonte;
  historicoMetas: EstadoFonte;
};

export type UserData = {
  draft: DraftToday | null;
  goals: Goals | null;
  goalEntries: GoalEntry[];
  costs: Cost[];
  products: Product[];
  ready: boolean;
  /**
   * O estado de cada fonte, separadamente.
   *
   * Existe porque `ready: true` com `costs: []` significava duas coisas
   * opostas — e a tela mostrava a mais tranquilizadora. Ver
   * lib/domain/estado-fonte.
   */
  fontes: EstadosDasFontes;
};

const FONTES_INICIAIS: EstadosDasFontes = {
  rascunho: FONTE_CARREGANDO,
  metas: FONTE_CARREGANDO,
  custos: FONTE_CARREGANDO,
  produtos: FONTE_CARREGANDO,
  historicoMetas: FONTE_CARREGANDO,
};

/** O conteúdo, sem a conta — é o que a tela lê. */
type Conteudo = Omit<UserData, "fontes"> & { fontes: EstadosDasFontes };

const VAZIO: Conteudo = {
  draft: null,
  goals: null,
  goalEntries: [],
  costs: [],
  products: [],
  ready: false,
  fontes: FONTES_INICIAIS,
};

/**
 * Os dados do usuário, CARREGANDO A CONTA A QUE ELES PERTENCEM.
 *
 * ─── O QUADRO DA CONTA ANTERIOR ──────────────────────────────────────────
 *
 * Eram sete estados soltos e um efeito que começava assim:
 *
 *     useEffect(() => {
 *       if (!uid) { setDraft(null); setGoals(null); setCosts([]); ... }
 *
 * Reset síncrono dentro do efeito — e o efeito roda DEPOIS da pintura. Na
 * troca de conta, a sequência é: `uid` muda, o app repinta com os produtos,
 * custos e metas da conta ANTERIOR, e só no quadro seguinte o efeito limpa.
 *
 * E pior: a limpeza só acontecia quando `uid` virava NULO. Trocar direto de
 * uma conta pra outra — que é o que o seletor de conta faz — não passava por
 * null, então os dados da primeira ficavam na tela até cada assinatura da
 * segunda responder, uma a uma.
 *
 * Num app onde a tela mostra custo de produto e resultado financeiro, isso
 * não é um flash cosmético.
 *
 * Com a conta carimbada no estado, conteúdo de outra conta simplesmente não
 * é o conteúdo desta: a troca zera tudo NO RENDER, sem efeito e sem quadro
 * intermediário.
 */
export function useUserData(uid: string | null | undefined): UserData {
  const [dados, setDados] = useState<{ uid: string; c: Conteudo } | null>(null);

  // Conteúdo de outra conta não é o desta. Decidido no render.
  const atual = uid && dados?.uid === uid ? dados.c : VAZIO;

  useEffect(() => {
    if (!uid) return;

    /**
     * Aplica uma mudança ao conteúdo DESTA conta.
     *
     * Se o estado guardado for de outra conta (ou não existir), começa do
     * vazio em vez de mesclar — mesclar traria metade dos dados da conta
     * anterior pra dentro da nova.
     */
    const aplicar = (patch: Partial<Conteudo>) =>
      setDados((a) => ({
        uid,
        c: a && a.uid === uid ? { ...a.c, ...patch } : { ...VAZIO, ...patch },
      }));

    let loaded = 0;
    // Fase de emergência (cota do Firestore estourada): watchDays foi removido
    // daqui — a coleção `dias` (histórico arquivado) não tinha NENHUM
    // consumidor de verdade (GoalsProgressBars, o único componente que
    // recebia essa prop, nunca era renderizado em lugar nenhum) e era relida
    // por inteiro em todo carregamento, sem limit(). Zero leitura é melhor
    // que leitura limitada quando o dado não tem uso nenhum.
    const TOTAL = 5;
    const markReady = () => {
      loaded += 1;
      if (loaded >= TOTAL) aplicar({ ready: true });
    };

    /**
     * Rede de segurança: `ready` só virava true com as CINCO assinaturas
     * respondendo, e nenhuma delas chama markReady quando falha. Bastava uma
     * ser recusada pra tela ficar carregando pra sempre, sem erro visível.
     *
     * Isso deixou de ser hipotético: o papel `member` não enxerga `custos`
     * nem `estoque` (ver firestore.rules), então duas assinaturas são
     * negadas por definição. Vale também pra estouro de cota do Firestore, que
     * esta base já viveu — em ambos os casos, mostrar o que carregou é melhor
     * que uma espera infinita.
     *
     * ─── O QUE A REDE NÃO RESOLVIA ────────────────────────────────────────
     *
     * Ela destrava a tela, e destrava com `costs: []` e `products: []` nos
     * valores INICIAIS. Quem consome não tinha como distinguir "não há custo
     * cadastrado" de "a assinatura de custos foi negada" — e a tela mostrava a
     * primeira, que é a versão tranquilizadora e falsa.
     *
     * Por isso cada fonte carrega o próprio estado. A tela continua utilizável
     * com o que chegou; o que não chegou é dito, não fingido.
     */
    const destravar = setTimeout(() => aplicar({ ready: true }), 6000);

    const marcar = (fonte: keyof EstadosDasFontes, estado: EstadoFonte) =>
      setDados((a) => {
        const base = a && a.uid === uid ? a.c : VAZIO;
        if (base.fontes[fonte].situacao === estado.situacao && estado.situacao === "carregada") {
          return a && a.uid === uid ? a : { uid, c: base };
        }
        return { uid, c: { ...base, fontes: { ...base.fontes, [fonte]: estado } } };
      });

    let f1 = true, f3 = true, f4 = true, f5 = true, f6 = true;

    /**
     * `markReady` é chamado também no ERRO. Sem isso a contagem nunca fecha
     * quando uma fonte é negada, e a tela depende do destravamento por tempo —
     * seis segundos de espera por algo que já se sabe que não vem.
     */
    const u1 = watchDraft(uid, (d) => {
      aplicar({ draft: d });
      marcar("rascunho", fonteCarregada());
      if (f1) { f1 = false; markReady(); }
    }, (e) => {
      marcar("rascunho", fonteComErro(e));
      if (f1) { f1 = false; markReady(); }
    });

    const u3 = watchGoals(uid, (g) => {
      aplicar({ goals: g });
      marcar("metas", fonteCarregada());
      if (f3) { f3 = false; markReady(); }
    }, (e) => {
      marcar("metas", fonteComErro(e));
      if (f3) { f3 = false; markReady(); }
    });

    const u4 = watchCosts(uid, (c) => {
      aplicar({ costs: c });
      marcar("custos", fonteCarregada());
      if (f4) { f4 = false; markReady(); }
    }, (e) => {
      marcar("custos", fonteComErro(e));
      if (f4) { f4 = false; markReady(); }
    });

    const u5 = watchProducts(uid, (ps) => {
      aplicar({ products: ps });
      marcar("produtos", fonteCarregada());
      if (f5) { f5 = false; markReady(); }
    }, (e) => {
      marcar("produtos", fonteComErro(e));
      if (f5) { f5 = false; markReady(); }
    });

    const u6 = watchGoalEntries(uid, (es) => {
      aplicar({ goalEntries: es });
      marcar("historicoMetas", fonteCarregada());
      if (f6) { f6 = false; markReady(); }
    }, (e) => {
      marcar("historicoMetas", fonteComErro(e));
      if (f6) { f6 = false; markReady(); }
    });

    return () => { clearTimeout(destravar); u1(); u3(); u4(); u5(); u6(); };
  }, [uid]);

  return atual;
}
