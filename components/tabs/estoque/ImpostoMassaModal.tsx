"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import { upsertProduct } from "@/lib/firebase/data";
import { impostoNaData, type Product } from "@/lib/domain/types";
import { parseNum, todayISO } from "@/components/tabs/estoque/estoque-compartilhado";

/**
 * Alíquota de imposto em vários produtos de uma vez.
 *
 * Saiu de `EstoqueTab.tsx` pelo mesmo motivo dos outros modais: é uma tela
 * inteira, com estado e validação próprios, que só existe depois de um
 * clique — e ocupava cento e sessenta linhas de um arquivo de três mil.
 */
export default function ImpostoMassaModal({ uid, produtos, escopoBusca, onClose }: {
  uid: string; produtos: Product[]; escopoBusca: string; onClose: () => void;
}) {
  const [valor, setValor] = useState("4");
  const [desde, setDesde] = useState(todayISO());
  const [salvando, setSalvando] = useState(false);
  const [feito, setFeito] = useState(0);
  // Todos marcados de início: o caso comum é aplicar em tudo, e desmarcar é
  // mais rápido do que marcar produto por produto.
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set(produtos.map((p) => p.id)));

  const pct = parseNum(valor);
  const alvos = produtos.filter((p) => marcados.has(p.id));
  const jaTem = alvos.filter((p) => parseNum(p.imposto ?? "0") > 0);

  const alterna = (id: string) => setMarcados((s) => {
    const novo = new Set(s);
    if (novo.has(id)) novo.delete(id); else novo.add(id);
    return novo;
  });

  async function aplicar() {
    if (!Number.isFinite(pct) || pct < 0) { alert("Informe um percentual válido."); return; }
    if (!desde) { alert("Informe a data de início."); return; }
    if (!alvos.length) { alert("Selecione ao menos um produto."); return; }
    setSalvando(true);
    try {
      let n = 0;
      for (const p of alvos) {
        /**
         * Substitui a faixa da mesma data e mantém as demais: assim dá pra
         * corrigir a alíquota sem perder o histórico de vigências.
         */
        const faixas = (p.impostoFaixas ?? []).filter((f) => f.desde !== desde);
        faixas.push({ desde, pct });
        faixas.sort((a, b) => a.desde.localeCompare(b.desde));
        await upsertProduct(uid, {
          ...p,
          impostoFaixas: faixas,
          // `imposto` segue como a alíquota vigente hoje (compat e exibição).
          imposto: String(impostoNaData({ imposto: p.imposto, impostoFaixas: faixas }, todayISO())),
        });
        n += 1;
        setFeito(n);
      }
      onClose();
    } catch (e) {
      alert("Erro ao aplicar imposto: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal open onClose={onClose}>
      <div className="modal-title">Imposto em massa</div>
      <div className="modal-sub">aplica o mesmo percentual em vários produtos de uma vez</div>

      <div className="config-field">
        <label htmlFor="impmassa-1">Imposto (%)</label>
        <input id="impmassa-1"
          type="number" min="0" step="0.01" value={valor}
          onChange={(e) => setValor(e.target.value)}
          style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 16, outline: "none" }}
        />
      </div>

      <div className="config-field">
        <label htmlFor="impmassa-2">Vale a partir de</label>
        <input id="impmassa-2"
          type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
          style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 16, outline: "none" }}
        />
      </div>

      <div className="config-field" style={{ marginTop: 4 }}>
        <label style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
          <span>Produtos ({alvos.length} de {produtos.length})</span>
          <span style={{ display: "flex", gap: 8 }}>
            <button
              type="button" className="btn btn-ghost btn-xs"
              onClick={() => setMarcados(new Set(produtos.map((p) => p.id)))}
            >
              todos
            </button>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setMarcados(new Set())}>
              nenhum
            </button>
          </span>
        </label>
        <div style={{
          maxHeight: 220, overflow: "auto", borderRadius: 8,
          border: "1px solid var(--border)", background: "var(--surface2)", padding: 6,
        }}>
          {produtos.map((p) => {
            const on = marcados.has(p.id);
            const atual = parseNum(p.imposto ?? "0");
            return (
              <label key={p.id} style={{
                display: "flex", gap: 8, alignItems: "center", padding: "6px 8px",
                borderRadius: 6, cursor: "pointer", background: on ? "rgba(233,169,45,.1)" : undefined,
              }}>
                <input type="checkbox" checked={on} onChange={() => alterna(p.id)} style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: ".84rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.name || "Sem nome"}
                </span>
                <span style={{ fontSize: ".75rem", color: atual > 0 ? "var(--accent)" : "var(--muted)", whiteSpace: "nowrap" }}>
                  {atual > 0 ? `hoje ${atual}%` : "sem imposto"}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <div style={{
        marginTop: 12, padding: "10px 12px", borderRadius: 8, fontSize: ".82rem", lineHeight: 1.55,
        background: "var(--surface2)", border: "1px solid var(--border)",
      }}>
        Vai aplicar <b>{pct}%</b> em <b>{alvos.length} produto{alvos.length === 1 ? "" : "s"}</b>
        {escopoBusca ? <> — a lista mostra só os da busca “{escopoBusca}”.</> : <>.</>}
        {jaTem.length > 0 && (
          <div style={{ marginTop: 6, color: "var(--warning)" }}>
            {jaTem.length === 1
              ? "1 deles já tem imposto e será sobrescrito."
              : `${jaTem.length} deles já têm imposto e serão sobrescritos.`}
          </div>
        )}
      </div>

      <div style={{
        marginTop: 10, padding: "10px 12px", borderRadius: 8, fontSize: ".82rem", lineHeight: 1.55,
        background: "rgba(54,179,126,.1)", border: "1px solid rgba(54,179,126,.35)", color: "var(--green)",
      }}>
        Vendas <b>antes de {desde.split("-").reverse().join("/")}</b> continuam sem esse imposto —
        o lucro dos meses já fechados não muda.
      </div>

      <div className="modal-btns">
        <button type="button" className="btn btn-success" onClick={aplicar} disabled={salvando || alvos.length === 0}>
          {salvando ? `Aplicando… ${feito}/${alvos.length}` : `Aplicar em ${alvos.length}`}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={salvando}>Cancelar</button>
      </div>
    </Modal>
  );
}
