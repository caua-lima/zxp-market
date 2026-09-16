"use client";

import { useEffect, useMemo, useState } from "react";
import type { EstoqueMovimento, Product } from "@/lib/domain/types";
import { watchMovimentos } from "@/lib/firebase/data";
import RemessasFull from "@/components/tabs/full/RemessasFull";
import HistoricoMovimentos from "@/components/tabs/full/HistoricoMovimentos";
import EstoqueRetidoFull, { type EstoqueFullRetido } from "@/components/tabs/full/EstoqueRetidoFull";
import { authedFetch } from "@/lib/api/authed-fetch";
import TelaHeader from "@/components/TelaHeader";

/**
 * Aba exclusiva do Full — baixa de estoque a partir do que o Mercado Livre
 * JÁ recebeu, dado real da API. Chegou a ter um bloco de "coleta agendada"
 * manual, removido: era um formulário 100% manual sem automação nenhuma.
 *
 * Correção de uma suposição que ficou aqui por muito tempo: "a API do ML não
 * expõe trânsito" só vale pro AGENDAMENTO da coleta. O estoque em trânsito
 * ENTRE CENTROS, avariado, em revisão ou em processo interno é exposto sim,
 * em `/inventories/{id}/stock/fulfillment` — e nunca era consultado. Ver
 * EstoqueRetidoFull.
 */
export default function FullTab({ products }: { products: Product[] }) {
  const [movimentos, setMovimentos] = useState<EstoqueMovimento[]>([]);
  const [retido, setRetido] = useState<EstoqueFullRetido | null>(null);
  useEffect(() => watchMovimentos(setMovimentos), []);

  useEffect(() => {
    let vivo = true;
    // Best-effort: a rota tem cache de 5 min e o painel some se ela falhar.
    authedFetch("/api/ml/gestao-full", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => { if (vivo) setRetido(j.estoqueFull ?? null); })
      .catch(() => { /* sem painel de retido */ });
    return () => { vivo = false; };
  }, []);

  /** Custo médio por produto, pra estimar o valor imobilizado no retido. */
  const custoPorProduto = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products) {
      m.set(p.id, p.custoMedio ?? (Number(String(p.custo ?? "0").replace(",", ".")) || 0));
    }
    return m;
  }, [products]);

  return (
    <div className="dash">
      <TelaHeader
        titulo="Full"
        subtitulo="baixa de estoque a partir do que o ML já recebeu"
      />

      <EstoqueRetidoFull dados={retido} custoPorProduto={custoPorProduto} />
      <RemessasFull movimentos={movimentos} />
      <HistoricoMovimentos movimentos={movimentos} products={products} />
    </div>
  );
}
