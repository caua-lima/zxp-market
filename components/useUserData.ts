"use client";

import { useEffect, useState } from "react";
import {
  watchCosts,
  watchDraft,
  watchGoalEntries,
  watchGoals,
  watchProducts,
} from "@/lib/firebase/data";
import type {
  Cost,
  DraftToday,
  GoalEntry,
  Goals,
  Product,
} from "@/lib/domain/types";

export type UserData = {
  draft: DraftToday | null;
  goals: Goals | null;
  goalEntries: GoalEntry[];
  costs: Cost[];
  products: Product[];
  ready: boolean;
};

export function useUserData(uid: string | undefined): UserData {
  const [draft, setDraft] = useState<DraftToday | null>(null);
  const [goals, setGoals] = useState<Goals | null>(null);
  const [goalEntries, setGoalEntries] = useState<GoalEntry[]>([]);
  const [costs, setCosts] = useState<Cost[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!uid) {
      setDraft(null);
      setGoals(null);
      setGoalEntries([]);
      setCosts([]);
      setProducts([]);
      setReady(false);
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
     */
    const destravar = setTimeout(() => setReady(true), 6000);

    let f1 = true, f3 = true, f4 = true, f5 = true, f6 = true;

    const u1 = watchDraft(uid, (d) => {
      setDraft(d);
      if (f1) { f1 = false; markReady(); }
    });
    const u3 = watchGoals(uid, (g) => {
      setGoals(g);
      if (f3) { f3 = false; markReady(); }
    });
    const u4 = watchCosts(uid, (c) => {
      setCosts(c);
      if (f4) { f4 = false; markReady(); }
    });
    const u5 = watchProducts(uid, (ps) => {
      setProducts(ps);
      if (f5) { f5 = false; markReady(); }
    });
    const u6 = watchGoalEntries(uid, (es) => {
      setGoalEntries(es);
      if (f6) { f6 = false; markReady(); }
    });

    return () => { clearTimeout(destravar); u1(); u3(); u4(); u5(); u6(); };
  }, [uid]);

  return { draft, goals, goalEntries, costs, products, ready };
}
