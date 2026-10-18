"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { authedFetch } from "@/lib/api/authed-fetch";
import { useAccess } from "@/components/tabs/AccessGuard";

/**
 * Leva a troca de SKU feita no app pros anúncios do Mercado Livre.
 *
 * Primeiro SIMULA (nada é gravado): mostra, anúncio por anúncio, o que muda, o
 * que já está certo e o que fica de fora e por quê. Só depois, com o clique do
 * dono, aplica — e cada anúncio é relido e conferido. A decisão de cada caso
 * está em lib/domain/sku-ml.ts; a escrita, em /api/ml/sku.
 */

export type TrocaDeSku = { productId: string; nome: string; skuAntigo: string; skuNovo: string };

type Anuncio = {
  mlb: string;
  titulo: string;
  acao: "alterar" | "ja-esta" | "nao-mexer";
  skuAtual: string;
  motivo?: string;
  variacoes?: (string | number)[];
  totalVariacoes?: number;
  resultado?: "ok" | "erro";
  erro?: string;
};
type ProdutoNoMl = { productId: string; nome: string; skuAntigo: string; skuNovo: string; anuncios: Anuncio[]; aviso?: string };

const CORES = { alterar: "var(--accent)", "ja-esta": "var(--green)", "nao-mexer": "var(--muted)" } as const;

function Linha({ a, skuNovo }: { a: Anuncio; skuNovo: string }) {
  const detalhe = a.acao === "alterar"
    ? `${a.skuAtual || "sem SKU"} → ${skuNovo}${a.totalVariacoes ? ` · ${a.variacoes?.length ?? 0} de ${a.totalVariacoes} variações` : ""}`
    : a.acao === "ja-esta" ? `já está com ${skuNovo}` : (a.motivo ?? "");
  const status = a.resultado === "ok" ? { cor: "var(--green)", txt: "✓ alterado e conferido" }
    : a.resultado === "erro" ? { cor: "var(--red-text)", txt: `✗ ${a.erro ?? "falhou"}` }
    : a.acao === "alterar" ? { cor: CORES.alterar, txt: "vai mudar" }
    : a.acao === "ja-esta" ? { cor: CORES["ja-esta"], txt: "nada a fazer" }
    : { cor: CORES["nao-mexer"], txt: "não vou mexer" };
  return (
    <li style={{ padding: "8px 0", borderTop: "1px solid var(--border)", fontSize: ".82rem", lineHeight: 1.5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span style={{ minWidth: 0, overflowWrap: "anywhere" }}><b>{a.mlb}</b>{a.titulo && <span style={{ color: "var(--muted)" }}> · {a.titulo}</span>}</span>
        <span style={{ color: status.cor, fontWeight: 700, overflowWrap: "anywhere" }}>{status.txt}</span>
      </div>
      <div style={{ color: "var(--muted)", overflowWrap: "anywhere" }}>{detalhe}</div>
    </li>
  );
}

export default function SincronizarSkuMlModal({ trocas, onClose }: { trocas: TrocaDeSku[]; onClose: () => void }) {
  const { isOwner } = useAccess();
  const [produtos, setProdutos] = useState<ProdutoNoMl[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [fase, setFase] = useState<"simulando" | "pronto" | "aplicando" | "aplicado">("simulando");

  useEffect(() => {
    let vivo = true;
    authedFetch("/api/ml/sku", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modo: "simular", itens: trocas.map(({ productId, skuAntigo, skuNovo }) => ({ productId, skuAntigo, skuNovo })) }),
    })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!vivo) return;
        if (!r.ok) { setErro(j?.details || j?.error || `Falha ao consultar o Mercado Livre (HTTP ${r.status}).`); setFase("pronto"); return; }
        setProdutos(j.produtos as ProdutoNoMl[]);
        setFase("pronto");
      })
      .catch(() => { if (vivo) { setErro("Sem conexão com o servidor."); setFase("pronto"); } });
    return () => { vivo = false; };
  }, [trocas]);

  const aAlterar = (produtos ?? []).reduce((n, p) => n + p.anuncios.filter((a) => a.acao === "alterar").length, 0);

  async function aplicar() {
    if (!confirm(`Alterar o SKU em ${aAlterar} anúncio(s) no Mercado Livre?\n\nIsso muda o anúncio de verdade (o comprador não vê o SKU, mas os pedidos passam a vir com o novo).`)) return;
    setFase("aplicando");
    setErro(null);
    try {
      const r = await authedFetch("/api/ml/sku", {
        method: "POST", headers: { "Content-Type": "application/json" },
        // Só os produtos que têm algo a mudar.
        body: JSON.stringify({
          modo: "aplicar",
          itens: (produtos ?? []).filter((p) => p.anuncios.some((a) => a.acao === "alterar"))
            .map(({ productId, skuAntigo, skuNovo }) => ({ productId, skuAntigo, skuNovo })),
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) { setErro(j?.details || j?.error || `O servidor recusou (HTTP ${r.status}).`); setFase("pronto"); return; }
      // Mantém na tela os produtos que não tinham o que mudar, com o resultado dos que tinham.
      const porId = new Map((j.produtos as ProdutoNoMl[]).map((p) => [p.productId, p]));
      setProdutos((atual) => (atual ?? []).map((p) => porId.get(p.productId) ?? p));
      setFase("aplicado");
    } catch {
      setErro("Sem conexão com o servidor. Simule de novo antes de repetir — parte pode ter entrado.");
      setFase("pronto");
    }
  }

  const ok = (produtos ?? []).reduce((n, p) => n + p.anuncios.filter((a) => a.resultado === "ok").length, 0);
  const falhas = (produtos ?? []).reduce((n, p) => n + p.anuncios.filter((a) => a.resultado === "erro").length, 0);

  return (
    <Modal open wide onClose={fase === "aplicando" ? () => {} : onClose} titulo="Atualizar SKU no Mercado Livre">
      <div className="modal-title">Atualizar SKU no Mercado Livre</div>
      <div className="modal-sub">o SKU já mudou no app — aqui ele vai pros anúncios, pra você não precisar mudar nos dois</div>

      {fase === "simulando" && <div style={{ padding: "16px 0", color: "var(--muted)" }}>Consultando os anúncios no Mercado Livre…</div>}
      {erro && <div className="note note-danger" role="alert" style={{ margin: "8px 0" }}>{erro}</div>}

      {produtos && (
        <div style={{ maxHeight: "50vh", overflowY: "auto", margin: "8px 0" }}>
          {produtos.map((p) => (
            <div key={p.productId} style={{ padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 10, marginBottom: 8, background: "var(--surface2)" }}>
              <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{p.nome}</div>
              <div style={{ fontSize: ".78rem", color: "var(--muted)", overflowWrap: "anywhere" }}>SKU {p.skuAntigo || "vazio"} → <b style={{ color: "var(--text)" }}>{p.skuNovo}</b></div>
              {p.aviso && <div style={{ fontSize: ".8rem", color: "var(--warning)", marginTop: 4 }}>{p.aviso}</div>}
              <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0 }}>
                {p.anuncios.map((a) => <Linha key={a.mlb} a={a} skuNovo={p.skuNovo} />)}
              </ul>
            </div>
          ))}
        </div>
      )}

      {fase === "aplicado" && (
        <div className={falhas ? "note note-danger" : "note note-accent"} role="status" style={{ marginBottom: 8 }}>
          {ok} anúncio(s) alterado(s) e conferido(s){falhas ? ` · ${falhas} com problema — veja acima` : ""}.
        </div>
      )}
      {fase === "pronto" && produtos && aAlterar > 0 && !isOwner && (
        <div className="note note-accent" style={{ marginBottom: 8, fontSize: ".82rem" }}>Só o dono da conta altera os anúncios no Mercado Livre. Peça pra ele abrir esta tela.</div>
      )}

      <div className="modal-btns">
        {fase !== "aplicado" && (
          <button type="button" className="btn btn-success" onClick={aplicar} disabled={fase !== "pronto" || aAlterar === 0 || !isOwner}>
            {fase === "aplicando" ? "Alterando no Mercado Livre…" : aAlterar ? `Atualizar ${aAlterar} anúncio(s) no ML` : "Nada a alterar no ML"}
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={fase === "aplicando"}>{fase === "aplicado" ? "Fechar" : "Agora não"}</button>
      </div>
    </Modal>
  );
}
