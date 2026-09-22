"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AvisoDaFonte from "@/components/AvisoDaFonte";
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
  /** O livro bateu o teto de leitura (S22 da auditoria SaaS) — ver HistoricoMovimentos. */
  const [movimentosTruncados, setMovimentosTruncados] = useState(false);
  const [retido, setRetido] = useState<EstoqueFullRetido | null>(null);
  /**
   * O estado da fonte do estoque retido. Antes, uma falha da rota era engolida e o
   * painel simplesmente não aparecia — igual a "não há nada retido". Agora a falha
   * é dita: sem dado nenhum é "erro"; com dado anterior é "desatualizado" (o painel
   * segue na tela, com o aviso de que pode estar velho).
   */
  const [fonteRetido, setFonteRetido] = useState<"carregando" | "ok" | "erro">("carregando");
  const [tentando, setTentando] = useState(false);
  useEffect(() => watchMovimentos((movs, truncado) => { setMovimentos(movs); setMovimentosTruncados(truncado); }), []);

  const carregarRetido = useCallback(async (): Promise<void> => {
    try {
      const r = await authedFetch("/api/ml/gestao-full", { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      setRetido(j.estoqueFull ?? null);
      setFonteRetido("ok");
    } catch {
      setFonteRetido("erro");
    }
  }, []);

  useEffect(() => {
    // Assíncrono de propósito (o setState acontece depois do await), não no corpo do efeito.
    void (async () => { await carregarRetido(); })();
  }, [carregarRetido]);

  async function tentarDeNovo() {
    setTentando(true);
    await carregarRetido();
    setTentando(false);
  }

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

      {fonteRetido === "carregando" && <AvisoDaFonte estado="carregando" fonte="o estoque retido no Full" />}
      {fonteRetido === "erro" && (
        <AvisoDaFonte
          estado={retido ? "desatualizado" : "erro"}
          fonte="o estoque retido no Full"
          naoSignifica={retido ? undefined : "Isso NÃO quer dizer que não há unidades retidas — só que não sei quantas há."}
          aoTentar={tentarDeNovo} tentando={tentando}
        />
      )}
      <EstoqueRetidoFull dados={retido} custoPorProduto={custoPorProduto} />
      <RemessasFull movimentos={movimentos} />
      <HistoricoMovimentos movimentos={movimentos} products={products} truncado={movimentosTruncados} />
    </div>
  );
}
