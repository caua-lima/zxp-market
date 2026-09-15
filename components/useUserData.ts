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

export function useUserData(uid: string | null | undefined): UserData {
  const [draft, setDraft] = useState<DraftToday | null>(null);
  const [goals, setGoals] = useState<Goals | null>(null);
  const [goalEntries, setGoalEntries] = useState<GoalEntry[]>([]);
  const [costs, setCosts] = useState<Cost[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [ready, setReady] = useState(false);
  const [fontes, setFontes] = useState<EstadosDasFontes>(FONTES_INICIAIS);

  useEffect(() => {
    if (!uid) {
      setDraft(null);
      setGoals(null);
      setGoalEntries([]);
      setCosts([]);
      setProducts([]);
      setReady(false);
      setFontes(FONTES_INICIAIS);
      return;
    }

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
      if (loaded >= TOTAL) setReady(true);
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
     * Por isso cada fonte agora carrega o próprio estado. A tela continua
     * utilizável com o que chegou; o que não chegou é dito, não fingido.
     */
    const destravar = setTimeout(() => setReady(true), 6000);

    const marcar = (fonte: keyof EstadosDasFontes, estado: EstadoFonte) =>
      setFontes((atual) => (atual[fonte].situacao === estado.situacao && estado.situacao === "carregada"
        ? atual
        : { ...atual, [fonte]: estado }));

    let f1 = true, f3 = true, f4 = true, f5 = true, f6 = true;

    /**
     * `markReady` é chamado também no ERRO. Sem isso a contagem nunca fecha
     * quando uma fonte é negada, e a tela depende do destravamento por tempo —
     * seis segundos de espera por algo que já se sabe que não vem.
     */
    const u1 = watchDraft(uid, (d) => {
      setDraft(d);
      marcar("rascunho", fonteCarregada());
      if (f1) { f1 = false; markReady(); }
    }, (e) => {
      marcar("rascunho", fonteComErro(e));
      if (f1) { f1 = false; markReady(); }
    });

    const u3 = watchGoals(uid, (g) => {
      setGoals(g);
      marcar("metas", fonteCarregada());
      if (f3) { f3 = false; markReady(); }
    }, (e) => {
      marcar("metas", fonteComErro(e));
      if (f3) { f3 = false; markReady(); }
    });

    const u4 = watchCosts(uid, (c) => {
      setCosts(c);
      marcar("custos", fonteCarregada());
      if (f4) { f4 = false; markReady(); }
    }, (e) => {
      marcar("custos", fonteComErro(e));
      if (f4) { f4 = false; markReady(); }
    });

    const u5 = watchProducts(uid, (ps) => {
      setProducts(ps);
      marcar("produtos", fonteCarregada());
      if (f5) { f5 = false; markReady(); }
    }, (e) => {
      marcar("produtos", fonteComErro(e));
      if (f5) { f5 = false; markReady(); }
    });

    const u6 = watchGoalEntries(uid, (es) => {
      setGoalEntries(es);
      marcar("historicoMetas", fonteCarregada());
      if (f6) { f6 = false; markReady(); }
    }, (e) => {
      marcar("historicoMetas", fonteComErro(e));
      if (f6) { f6 = false; markReady(); }
    });

    return () => { clearTimeout(destravar); u1(); u3(); u4(); u5(); u6(); };
  }, [uid]);

  return { draft, goals, goalEntries, costs, products, ready, fontes };
}
