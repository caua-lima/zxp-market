"use client";

import { useEffect, useMemo, useState } from "react";
import { authedFetch } from "@/lib/api/authed-fetch";
import { fmtBRL } from "@/lib/domain/calc";
import { gruposExistentes } from "@/lib/domain/grupo-produto";
import { vendasPorCanal, type LinhaPorCanal, type ProdutoParaCanal, type TotalDeVenda, type VendaDoAnuncio } from "@/lib/domain/vendas-por-canal";

/**
 * Vendas por canal — quanto cada produto vendeu só nas agências, só no Full e
 * nos dois juntos. O estoque é separado por tipo de anúncio (um cadastro pro
 * Full, outro pras agências), mas pra decidir é o mesmo produto: o grupo liga
 * os dois (ver lib/domain/vendas-por-canal.ts).
 *
 * Base: as "Vendas brutas" do período — as mesmas da Curva ABC e do Seller
 * Center (pedidos válidos, sem cancelados/devolvidos).
 */

const LINHAS_INICIAIS = 12;
const COR = { agencias: "var(--brand)", full: "var(--green)", semCanal: "var(--border)" } as const;
const fmtInt = (n: number) => n.toLocaleString("pt-BR");
const pct = (parte: number, todo: number) => (todo > 0 ? (parte / todo) * 100 : 0);
const fmtPct = (v: number) => `${v.toFixed(v >= 10 || v === 0 ? 0 : 1).replace(".", ",")}%`;

function Celula({ t, cor }: { t: TotalDeVenda; cor?: string }) {
  if (t.valor === 0 && t.unidades === 0) return <span style={{ color: "var(--muted)" }}>—</span>;
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontWeight: 700, color: cor }}>{fmtBRL(t.valor)}</div>
      <div style={{ fontSize: ".75rem", color: "var(--muted)", fontWeight: 400 }}>{fmtInt(t.unidades)} un</div>
    </div>
  );
}

export default function VendasPorCanal({
  curvaBruta, produtos,
}: {
  curvaBruta?: VendaDoAnuncio[];
  produtos: readonly ProdutoParaCanal[];
}) {
  /** Logística de cada anúncio, como o ML informa. Sem resposta, o canal do cadastro faz o papel. */
  const [logistica, setLogistica] = useState<Record<string, string>>({});
  const [todas, setTodas] = useState(false);

  useEffect(() => {
    let vivo = true;
    authedFetch("/api/ml/estoque-ml", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { estoque?: Record<string, { logistic?: string }> } | null) => {
        if (!vivo || !j?.estoque) return;
        const m: Record<string, string> = {};
        for (const [mlb, it] of Object.entries(j.estoque)) if (it?.logistic) m[mlb.toUpperCase().replace(/^MLB/, "")] = it.logistic;
        setLogistica(m);
      })
      .catch(() => { /* sem o ML: vale o canal do cadastro */ });
    return () => { vivo = false; };
  }, []);

  const resumo = useMemo(
    () => vendasPorCanal(curvaBruta ?? [], produtos, (id) => logistica[String(id).toUpperCase().replace(/^MLB/, "")]),
    [curvaBruta, produtos, logistica],
  );
  const temGrupo = gruposExistentes(produtos).length > 0;

  if (!curvaBruta?.length) return null;

  const { total, full, agencias, semCanal } = resumo;
  const visiveis = todas ? resumo.linhas : resumo.linhas.slice(0, LINHAS_INICIAIS);

  const blocos: { chave: keyof typeof COR; rotulo: string; t: TotalDeVenda }[] = [
    { chave: "agencias", rotulo: "Só nas agências", t: agencias },
    { chave: "full", rotulo: "Só no Full", t: full },
  ];

  return (
    <div className="panel">
      <div className="panel-title" style={{ marginBottom: 4 }}>Vendas por canal — Full × agências</div>
      <div style={{ fontSize: ".75rem", color: "var(--muted)", marginBottom: 12, lineHeight: 1.5 }}>
        Vendas brutas do período (sem cancelados nem devolvidos), somando o <b>mesmo produto</b> nos dois anúncios.
        O canal de cada venda vem da logística do anúncio no Mercado Livre.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 12 }}>
        {blocos.map(({ chave, rotulo, t }) => (
          <div key={chave} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", borderLeft: `4px solid ${COR[chave]}` }}>
            <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>{rotulo}</div>
            <div style={{ fontSize: "1.2rem", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{fmtBRL(t.valor)}</div>
            <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>{fmtInt(t.unidades)} un · {fmtPct(pct(t.valor, total.valor))} do total</div>
          </div>
        ))}
        <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", borderLeft: "4px solid var(--text)" }}>
          <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>Os dois juntos</div>
          <div style={{ fontSize: "1.2rem", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{fmtBRL(total.valor)}</div>
          <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>{fmtInt(total.unidades)} un · {fmtInt(total.pedidos)} pedidos</div>
        </div>
      </div>

      {/* A divisão em uma barra: a cor ajuda, mas cada trecho tem o nome e o % escritos. */}
      <div role="img" aria-label={`Agências ${fmtPct(pct(agencias.valor, total.valor))}, Full ${fmtPct(pct(full.valor, total.valor))}${semCanal.valor > 0 ? `, não identificado ${fmtPct(pct(semCanal.valor, total.valor))}` : ""}`}
        style={{ display: "flex", height: 10, borderRadius: 6, overflow: "hidden", background: "var(--surface2)", marginBottom: 6 }}>
        <div style={{ width: `${pct(agencias.valor, total.valor)}%`, background: COR.agencias }} />
        <div style={{ width: `${pct(full.valor, total.valor)}%`, background: COR.full }} />
        <div style={{ width: `${pct(semCanal.valor, total.valor)}%`, background: COR.semCanal }} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: ".75rem", color: "var(--muted)", marginBottom: 12 }}>
        <span><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: COR.agencias, marginRight: 5 }} />Agências {fmtPct(pct(agencias.valor, total.valor))}</span>
        <span><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: COR.full, marginRight: 5 }} />Full {fmtPct(pct(full.valor, total.valor))}</span>
        {semCanal.valor > 0 && (
          <span title="Anúncios cuja logística o ML não informou e cujo cadastro não tem canal. Defina o canal no cadastro do produto.">
            <i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: COR.semCanal, marginRight: 5 }} />Não identificado {fmtBRL(semCanal.valor)}
          </span>
        )}
      </div>

      {!temGrupo && (
        <div className="note note-accent" style={{ marginBottom: 12, fontSize: ".82rem" }}>
          Pra somar o Full e as agências do <b>mesmo produto</b>, dê o mesmo <b>Grupo</b> aos dois cadastros (Estoque → Editar produto, ou
          o botão <b>＋ Outro anúncio</b>). Enquanto isso, cada cadastro aparece como um produto separado.
        </div>
      )}

      <div className="table-wrapper" style={{ border: "none" }}>
        <table className="tbl-modern tbl-cards">
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Produto</th>
              <th style={{ textAlign: "right" }}>Só agências</th>
              <th style={{ textAlign: "right" }}>Só Full</th>
              <th style={{ textAlign: "right" }}>Os dois juntos</th>
              <th style={{ textAlign: "right" }}>% agências</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((l: LinhaPorCanal) => (
              <tr key={l.chave}>
                <td style={{ textAlign: "left", fontWeight: 600 }}>
                  {l.nome}
                  {l.agrupado && <span style={{ marginLeft: 6, fontSize: ".7rem", fontWeight: 700, color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 5, padding: "1px 6px" }}>Full + agências</span>}
                  {l.semCanal.valor > 0 && <div style={{ fontSize: ".75rem", fontWeight: 400, color: "var(--muted)" }}>{fmtBRL(l.semCanal.valor)} sem canal identificado</div>}
                </td>
                <td data-label="Só agências" style={{ textAlign: "right" }}><Celula t={l.agencias} cor="var(--brand)" /></td>
                <td data-label="Só Full" style={{ textAlign: "right" }}><Celula t={l.full} cor="var(--green)" /></td>
                <td data-label="Os dois juntos" style={{ textAlign: "right" }}><Celula t={l.total} /></td>
                <td data-label="% agências" style={{ textAlign: "right", whiteSpace: "nowrap", color: l.pctAgencias == null ? "var(--muted)" : undefined }}>
                  {l.pctAgencias == null ? "—" : fmtPct(l.pctAgencias)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {resumo.linhas.length > LINHAS_INICIAIS && (
        <button type="button" className="btn btn-ghost btn-xs" style={{ marginTop: 8 }} onClick={() => setTodas((v) => !v)}>
          {todas ? "Mostrar menos" : `Ver todos (${resumo.linhas.length})`}
        </button>
      )}
    </div>
  );
}
