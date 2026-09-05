"use client";

import { useMemo, useState } from "react";
import { TIPO_MOVIMENTO_LABEL, type EstoqueMovimento, type Product } from "@/lib/domain/types";
import { deleteMovimento, logAudit, updateMovimento } from "@/lib/firebase/data";
import { fmtBRL } from "@/lib/domain/calc";
import Modal from "@/components/Modal";
import BaixasPorRemessa from "@/components/tabs/full/BaixasPorRemessa";

type Filtro = "todos" | "saida_full" | "entrada" | "saldo_inicial" | "ajuste";

const FILTROS: { id: Filtro; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "saida_full", label: "Baixas do Full" },
  { id: "entrada", label: "Entradas" },
  { id: "saldo_inicial", label: "Custo do Full" },
  { id: "ajuste", label: "Ajustes" },
];

/**
 * Histórico consolidado de TODAS as movimentações, de TODOS os produtos —
 * a lista em EstoqueTab só aparece expandindo produto por produto, um de
 * cada vez. Aqui é a visão de auditoria: "o que já foi baixado do Full",
 * "o que já entrou", com filtro e busca, e cada linha corrigível ou excluível
 * sem precisar saber de antemão de qual produto ela é.
 */
export default function HistoricoMovimentos({ movimentos, products }: { movimentos: EstoqueMovimento[]; products: Product[] }) {
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busca, setBusca] = useState("");
  const [editando, setEditando] = useState<EstoqueMovimento | null>(null);

  const nomePorId = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products) m.set(p.id, p.name || "Sem nome");
    return m;
  }, [products]);

  const contagem = useMemo(() => {
    const c: Record<Filtro, number> = { todos: movimentos.length, saida_full: 0, entrada: 0, saldo_inicial: 0, ajuste: 0 };
    for (const m of movimentos) c[m.tipo] = (c[m.tipo] ?? 0) + 1;
    return c;
  }, [movimentos]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return movimentos
      .filter((m) => filtro === "todos" || m.tipo === filtro)
      .filter((m) => !q || (nomePorId.get(m.productId) ?? "").toLowerCase().includes(q) || (m.obs ?? "").toLowerCase().includes(q))
      .sort((a, b) => (b.data ?? "").localeCompare(a.data ?? "") || (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }, [movimentos, filtro, busca, nomePorId]);

  async function excluir(m: EstoqueMovimento) {
    const nome = nomePorId.get(m.productId) ?? "produto";
    if (!confirm(`Excluir esta movimentação de "${nome}"?\n\n${TIPO_MOVIMENTO_LABEL[m.tipo]} · ${m.quantidade} un em ${m.data}\n\nO custo médio será recalculado.`)) return;
    try {
      await deleteMovimento(m.id, m.productId);
      logAudit({
        acao: "excluir", entidade: "movimento", entidadeId: m.id,
        entidadeLabel: `${nome} · ${TIPO_MOVIMENTO_LABEL[m.tipo]}`,
        detalhe: `${m.quantidade} un em ${m.data}`,
      }).catch(() => {});
    } catch (e) {
      alert("Não consegui excluir: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  return (
    <>
      {/* Agrupado por ENVIO primeiro, no formato do painel do ML: a
          conferencia e sempre contra a tela deles, e comparar um envio com
          quatro lancamentos soltos exigia somar de cabeca. A lista plana
          continua abaixo, pra corrigir ou excluir lancamento avulso. */}
      <BaixasPorRemessa movimentos={movimentos} products={products} onEditar={setEditando} />

    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel-head" style={{ marginBottom: 6 }}>
        <span className="panel-title">Histórico de movimentações</span>
        <span className="panel-sub">todas as entradas e baixas do Full, de todos os produtos — corrija ou exclua qualquer lançamento</span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        {FILTROS.map((f) => (
          <button
            key={f.id} type="button"
            className={`btn btn-xs ${filtro === f.id ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setFiltro(f.id)}
          >
            {f.label} ({contagem[f.id] ?? 0})
          </button>
        ))}
      </div>

      <input
        type="text"
        placeholder="Buscar por produto ou observação…"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        style={{
          width: "100%", maxWidth: 320, marginBottom: 12, padding: "7px 10px",
          background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)",
        }}
      />

      {filtrados.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: ".85rem", padding: "12px 0" }}>
          {movimentos.length === 0 ? "Nenhuma movimentação lançada ainda." : "Nada encontrado com esse filtro."}
        </div>
      ) : (
        <div className="table-wrapper" style={{ border: "1px solid var(--border)" }}>
          <table className="tbl-modern tbl-cards">
            <thead>
              <tr>
                <th>Data</th><th style={{ textAlign: "left" }}>Produto</th><th style={{ textAlign: "left" }}>Tipo</th>
                <th>Qtd</th><th>Custo un.</th><th style={{ textAlign: "left" }}>Obs</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((m) => {
                const isCompra = m.tipo === "entrada" || m.tipo === "saldo_inicial";
                const sign = isCompra ? "+" : m.tipo === "saida_full" ? "−" : (m.quantidade >= 0 ? "+" : "−");
                const cor = isCompra ? "var(--green)" : m.tipo === "saida_full" ? "var(--yellow)" : (m.quantidade >= 0 ? "var(--green)" : "var(--red)");
                return (
                  <tr key={m.id}>
                    <td style={{ color: "var(--muted)" }}>{m.data}</td>
                    <td data-label="Produto" style={{ textAlign: "left", fontWeight: 600 }}>
                      {nomePorId.get(m.productId) ?? <em style={{ color: "var(--red)" }}>produto removido</em>}
                    </td>
                    <td data-label="Tipo" style={{ textAlign: "left" }}>
                      <span style={{ color: cor, fontWeight: 700 }}>{TIPO_MOVIMENTO_LABEL[m.tipo]}</span>
                    </td>
                    <td data-label="Qtd" style={{ color: cor, fontWeight: 700 }}>{sign}{Math.abs(m.quantidade)}</td>
                    <td data-label="Custo un.">{isCompra && m.custoUnit != null ? fmtBRL(m.custoUnit) : "—"}</td>
                    <td data-label="Obs" style={{ textAlign: "left", color: "var(--muted)", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.obs || "—"}
                      {m.updatedAt && (
                        <span title={`Corrigido${m.updatedBy ? ` por ${m.updatedBy}` : ""}`} style={{ marginLeft: 6, fontSize: ".65rem", color: "var(--warning)", fontWeight: 700 }}>
                          · editado
                        </span>
                      )}
                    </td>
                    <td data-cell="acoes">
                      <div className="row-actions" style={{ justifyContent: "flex-end" }}>
                        <button type="button" className="btn btn-ghost btn-xs" onClick={() => setEditando(m)}>Editar</button>
                        <button type="button" className="btn btn-danger btn-xs" onClick={() => excluir(m)}>Excluir</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editando && (
        <EditarMovimentoModal
          mov={editando}
          nomeProduto={nomePorId.get(editando.productId) ?? "produto"}
          onClose={() => setEditando(null)}
          onSaved={() => setEditando(null)}
        />
      )}
    </div>
    </>
  );
}

function EditarMovimentoModal({
  mov, nomeProduto, onClose, onSaved,
}: {
  mov: EstoqueMovimento; nomeProduto: string; onClose: () => void; onSaved: () => void;
}) {
  // Só saída pro Full e ajuste têm a quantidade livre pra corrigir aqui: nem
  // uma nem outro mexem no custo médio (ver updateMovimento em
  // lib/firebase/data.ts), então mudar o número é seguro e imediato.
  const editavelQtd = mov.tipo === "saida_full" || mov.tipo === "ajuste";
  const [data, setData] = useState(mov.data);
  const [qtd, setQtd] = useState(String(mov.quantidade));
  const [obs, setObs] = useState(mov.obs ?? "");
  const [saving, setSaving] = useState(false);

  async function salvar() {
    const qNum = editavelQtd ? Math.round(Number(qtd)) : mov.quantidade;
    if (editavelQtd && !Number.isFinite(qNum)) { alert("Informe uma quantidade válida."); return; }
    if (editavelQtd && mov.tipo === "saida_full" && qNum <= 0) { alert("A quantidade da baixa precisa ser maior que zero."); return; }
    if (!data) { alert("Informe a data."); return; }
    setSaving(true);
    try {
      await updateMovimento(mov.id, mov.productId, {
        data, obs: obs.trim() || undefined,
        ...(editavelQtd ? { quantidade: qNum } : {}),
      });
      logAudit({
        acao: "editar", entidade: "movimento", entidadeId: mov.id,
        entidadeLabel: `${nomeProduto} · ${TIPO_MOVIMENTO_LABEL[mov.tipo]}`,
        detalhe: `${mov.quantidade} un em ${mov.data} → ${qNum} un em ${data}`,
      }).catch(() => {});
      onSaved();
    } catch (e) {
      alert("Não consegui salvar: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose}>
      <div className="modal-title">Corrigir movimentação — {nomeProduto}</div>
      <div className="modal-sub">{TIPO_MOVIMENTO_LABEL[mov.tipo]}</div>

      <div className="config-field">
        <label>Data</label>
        <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
      </div>

      {editavelQtd ? (
        <div className="config-field">
          <label>Quantidade{mov.tipo === "ajuste" ? " (negativo = perda/baixa)" : ""}</label>
          <input type="number" inputMode="numeric" value={qtd} onChange={(e) => setQtd(e.target.value)} />
        </div>
      ) : (
        <div className="note" style={{ fontSize: ".78rem", lineHeight: 1.5, marginBottom: 12 }}>
          Quantidade e custo de <b>{TIPO_MOVIMENTO_LABEL[mov.tipo]}</b> não são editáveis aqui: eles já entraram no
          cálculo do custo médio no momento em que foram lançados, e mudar o número agora não refaz essa conta —
          só sobrescreveria o valor sem corrigir o que já foi apurado com ele. Pra corrigir de verdade,{" "}
          <b>exclua esta movimentação e lance de novo</b> com o valor certo, na aba Estoque — isso recalcula o
          custo médio do zero, direito.
        </div>
      )}

      <div className="config-field">
        <label>Observação</label>
        <input type="text" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Motivo da correção" />
      </div>

      <div className="modal-btns">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={salvar}>
          {saving ? "Salvando…" : "Salvar correção"}
        </button>
      </div>
    </Modal>
  );
}
