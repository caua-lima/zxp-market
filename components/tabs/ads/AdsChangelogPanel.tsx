"use client";

import { useMemo, useState } from "react";
import type { AdsAlteracao, AdsAlteracaoTipo, Product } from "@/lib/domain/types";
import { ADS_ALTERACAO_TIPO_LABEL } from "@/lib/domain/types";
import { addAdsAlteracao, deleteAdsAlteracao } from "@/lib/firebase/data";
import { useAccess } from "@/components/tabs/AccessGuard";
import { mapearCampanhasParaProdutos, type ItemCampanha } from "@/lib/domain/ads-campaign-link";
import { ADS_ALTERACAO_TIPOS, formatarResumoAlteracao } from "@/lib/domain/ads-changelog";

type Campanha = { id: string; name: string; status: string };

function fmtQuando(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Registro MANUAL de alterações de campanha — não é dado do Mercado Livre, é
 * a equipe documentando a PRÓPRIA mudança pra saber quando mexeu da última
 * vez. Estruturado (tipo + valor anterior/novo) desde a Fase 6 da reforma:
 * dá pra montar frases automáticas ("ROAS alvo: 16x → 20x") e filtrar por
 * tipo — registro antigo (só com `nota`) continua aparecendo normalmente.
 */
export default function AdsChangelogPanel({
  campanhas, products, itemCampaigns = [], entries, initialCampaignId,
}: {
  campanhas: Campanha[]; products: Product[]; itemCampaigns?: ItemCampanha[];
  /** Assinado uma vez em AdsTab.tsx (não aqui) — evita 2 listeners simultâneos na mesma coleção. */
  entries: AdsAlteracao[];
  /** Pré-seleciona a campanha ao vir do drawer ("Registrar alteração" de um anúncio específico). */
  initialCampaignId?: string;
}) {
  const { canEditTab, displayName } = useAccess();
  const canEdit = canEditTab("ads");

  const [campaignId, setCampaignId] = useState(initialCampaignId ?? "");
  const [productId, setProductId] = useState(() => {
    if (!initialCampaignId) return "";
    return mapearCampanhasParaProdutos(products, itemCampaigns).get(initialCampaignId)?.[0]?.id ?? "";
  });
  const [tipo, setTipo] = useState<AdsAlteracaoTipo>("outro");
  const [valorAnterior, setValorAnterior] = useState("");
  const [valorNovo, setValorNovo] = useState("");
  const [motivo, setMotivo] = useState("");
  const [nota, setNota] = useState("");
  const [salvando, setSalvando] = useState(false);

  const [filtroProduto, setFiltroProduto] = useState("");
  const [filtroCampanha, setFiltroCampanha] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<AdsAlteracaoTipo | "">("");
  const [filtroResponsavel, setFiltroResponsavel] = useState("");
  const [filtroDesde, setFiltroDesde] = useState("");
  const [filtroAte, setFiltroAte] = useState("");

  const produtosOrdenados = useMemo(() => [...products].sort((a, b) => a.name.localeCompare(b.name)), [products]);
  const campanhasOrdenadas = useMemo(() => [...campanhas].sort((a, b) => a.name.localeCompare(b.name)), [campanhas]);

  const produtosPorCampanha = useMemo(() => mapearCampanhasParaProdutos(products, itemCampaigns), [products, itemCampaigns]);

  function selecionarCampanha(id: string) {
    setCampaignId(id);
    const vinculados = produtosPorCampanha.get(id) ?? [];
    if (vinculados.length >= 1) setProductId(vinculados[0].id);
  }

  const produtosDaCampanhaAtual = produtosPorCampanha.get(campaignId) ?? [];

  async function salvar() {
    const campanha = campanhas.find((c) => c.id === campaignId);
    const produto = products.find((p) => p.id === productId);
    if (!campanha) { alert("Selecione a campanha."); return; }
    if (!produto) { alert("Selecione o produto — é o que permite filtrar depois."); return; }
    if (!valorNovo.trim() && !nota.trim()) { alert("Informe o novo valor ou uma observação (ex.: \"subi o ROAS pra 20x\")."); return; }
    setSalvando(true);
    try {
      await addAdsAlteracao({
        campaignId: campanha.id, campaignName: campanha.name,
        productId: produto.id, productName: produto.name,
        tipo, valorAnterior: valorAnterior.trim() || undefined, valorNovo: valorNovo.trim() || undefined,
        motivo: motivo.trim() || undefined,
        nota: nota.trim() || `${ADS_ALTERACAO_TIPO_LABEL[tipo]}: ${valorNovo.trim()}`,
        createdByName: displayName,
      });
      setValorAnterior(""); setValorNovo(""); setMotivo(""); setNota("");
    } catch (err) {
      alert("Erro ao salvar: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSalvando(false);
    }
  }

  const filtradas = entries.filter((e) => {
    if (filtroProduto && e.productId !== filtroProduto) return false;
    if (filtroCampanha && e.campaignId !== filtroCampanha) return false;
    if (filtroTipo && e.tipo !== filtroTipo) return false;
    if (filtroResponsavel && !(e.createdByName || e.createdBy).toLowerCase().includes(filtroResponsavel.toLowerCase())) return false;
    const dia = new Date(e.createdAt).toISOString().slice(0, 10);
    if (filtroDesde && dia < filtroDesde) return false;
    if (filtroAte && dia > filtroAte) return false;
    return true;
  });

  const filtrosAtivos = !!(filtroProduto || filtroCampanha || filtroTipo || filtroResponsavel || filtroDesde || filtroAte);

  return (
    <div className="dash" style={{ gap: 16 }}>
      {canEdit && (
        <div className="panel">
          <div className="panel-head" style={{ marginBottom: 6 }}>
            <span className="panel-title">Registrar alteração</span>
            <span className="panel-sub">alterações registradas pela equipe — não vem do Mercado Livre</span>
          </div>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <div className="config-field">
              <label>Campanha</label>
              <select value={campaignId} onChange={(e) => selecionarCampanha(e.target.value)}>
                <option value="">Selecione…</option>
                {campanhasOrdenadas.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.status ? ` (${c.status})` : ""}</option>
                ))}
              </select>
              {campanhas.length === 0 && (
                <div className="hint">Nenhuma campanha carregada ainda — abra a aba &quot;Publicidade direta&quot; uma vez pra buscar do Mercado Livre.</div>
              )}
            </div>
            <div className="config-field">
              <label>Produto{produtosDaCampanhaAtual.length >= 1 ? " (preenchido pela campanha)" : ""}</label>
              <select value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">Selecione…</option>
                {produtosOrdenados.map((p) => (
                  <option key={p.id} value={p.id}>{p.name || "Sem nome"}</option>
                ))}
              </select>
              {produtosDaCampanhaAtual.length > 1 && (
                <div className="hint">
                  Esta campanha está vinculada a {produtosDaCampanhaAtual.length} produtos ({produtosDaCampanhaAtual.map((p) => p.name || "sem nome").join(", ")}) — confirme se selecionou o certo.
                </div>
              )}
            </div>
            <div className="config-field">
              <label>Tipo de mudança</label>
              <select value={tipo} onChange={(e) => setTipo(e.target.value as AdsAlteracaoTipo)}>
                {ADS_ALTERACAO_TIPOS.map((t) => (
                  <option key={t} value={t}>{ADS_ALTERACAO_TIPO_LABEL[t]}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", marginTop: 10 }}>
            <div className="config-field">
              <label>Valor anterior (opcional)</label>
              <input type="text" placeholder="Ex: 16x" value={valorAnterior} onChange={(e) => setValorAnterior(e.target.value)} />
            </div>
            <div className="config-field">
              <label>Valor novo (opcional)</label>
              <input type="text" placeholder="Ex: 20x" value={valorNovo} onChange={(e) => setValorNovo(e.target.value)} />
            </div>
            <div className="config-field">
              <label>Motivo (opcional)</label>
              <input type="text" placeholder="Ex: ROAS acima do alvo há 5 dias" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            </div>
          </div>
          <div className="config-field" style={{ marginTop: 10 }}>
            <label>Observação {valorNovo.trim() ? "(opcional)" : ""}</label>
            <input
              type="text" placeholder='Ex: "subi o ROAS pra 20x"' value={nota}
              onChange={(e) => setNota(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") salvar(); }}
            />
          </div>
          <button type="button" className="btn btn-success btn-sm" style={{ marginTop: 10 }} onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando…" : "＋ Registrar"}
          </button>
        </div>
      )}

      <div className="panel">
        <div className="panel-head" style={{ marginBottom: 6 }}>
          <span className="panel-title">Histórico</span>
          <span className="panel-sub">{filtradas.length} registro{filtradas.length === 1 ? "" : "s"}</span>
        </div>

        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          <div className="config-field">
            <label>Produto</label>
            <select value={filtroProduto} onChange={(e) => setFiltroProduto(e.target.value)}>
              <option value="">Todos</option>
              {produtosOrdenados.map((p) => (<option key={p.id} value={p.id}>{p.name || "Sem nome"}</option>))}
            </select>
          </div>
          <div className="config-field">
            <label>Campanha</label>
            <select value={filtroCampanha} onChange={(e) => setFiltroCampanha(e.target.value)}>
              <option value="">Todas</option>
              {campanhasOrdenadas.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
          </div>
          <div className="config-field">
            <label>Tipo</label>
            <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value as AdsAlteracaoTipo | "")}>
              <option value="">Todos</option>
              {ADS_ALTERACAO_TIPOS.map((t) => (<option key={t} value={t}>{ADS_ALTERACAO_TIPO_LABEL[t]}</option>))}
            </select>
          </div>
          <div className="config-field">
            <label>Responsável</label>
            <input type="text" placeholder="nome ou e-mail" value={filtroResponsavel} onChange={(e) => setFiltroResponsavel(e.target.value)} />
          </div>
          <div className="config-field">
            <label>De</label>
            <input type="date" value={filtroDesde} onChange={(e) => setFiltroDesde(e.target.value)} />
          </div>
          <div className="config-field">
            <label>Até</label>
            <input type="date" value={filtroAte} onChange={(e) => setFiltroAte(e.target.value)} />
          </div>
        </div>
        {filtrosAtivos && (
          <button
            type="button" className="btn btn-ghost btn-xs" style={{ marginTop: 6 }}
            onClick={() => { setFiltroProduto(""); setFiltroCampanha(""); setFiltroTipo(""); setFiltroResponsavel(""); setFiltroDesde(""); setFiltroAte(""); }}
          >
            Limpar filtros
          </button>
        )}

        {filtradas.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: ".84rem", padding: "16px 0" }}>
            {filtrosAtivos ? "Nenhuma alteração bate com esse filtro." : "Nenhuma alteração registrada ainda."}
          </div>
        ) : (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            {filtradas.map((e) => (
              <div key={e.id} style={{
                background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10,
                padding: "10px 14px", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap",
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, fontSize: ".86rem" }}>{e.productName}</span>
                    <span style={{ fontSize: ".75rem", color: "var(--muted)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "1px 7px" }}>
                      {e.campaignName}
                    </span>
                    {e.tipo && (
                      <span style={{ fontSize: ".75rem", fontWeight: 700, color: "var(--brand)", background: "var(--brand-soft)", borderRadius: 6, padding: "1px 7px" }}>
                        {ADS_ALTERACAO_TIPO_LABEL[e.tipo]}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: ".84rem", color: "var(--text)" }}>{formatarResumoAlteracao(e)}</div>
                  {e.motivo && <div style={{ fontSize: ".8rem", color: "var(--muted)", marginTop: 2 }}>Motivo: {e.motivo}</div>}
                  {e.tipo && e.nota && e.nota !== formatarResumoAlteracao(e) && <div style={{ fontSize: ".8rem", color: "var(--muted)", marginTop: 2 }}>{e.nota}</div>}
                  <div style={{ fontSize: ".75rem", color: "var(--muted)", marginTop: 4 }}>
                    {fmtQuando(e.createdAt)} · {e.createdByName || e.createdBy}
                  </div>
                </div>
                {canEdit && (
                  <button
                    type="button" className="btn btn-ghost btn-xs"
                    onClick={() => { if (confirm("Excluir este registro?")) deleteAdsAlteracao(e.id).catch(() => {}); }}
                  >
                    Excluir
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
