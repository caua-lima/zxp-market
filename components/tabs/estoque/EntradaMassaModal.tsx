"use client";

import { useMemo, useState } from "react";
import Modal from "@/components/Modal";
import { fmtBRL } from "@/lib/domain/calc";
import { calcularEntradaMassa, type LinhaEntrada, type ProdutoParaEntrada } from "@/lib/domain/entrada-massa";
import { addMovimento } from "@/lib/firebase/data";
import type { Product } from "@/lib/domain/types";
import {
  custoMedioDe, fullDe, parseNum, todayISO,
} from "@/components/tabs/estoque/estoque-compartilhado";
import type { EstoqueML } from "@/components/tabs/estoque/estoque-compartilhado";

/**
 * Entrada de várias compras de uma vez.
 *
 * Saiu de `EstoqueTab.tsx` junto com os outros modais de operação em massa:
 * são telas inteiras, com estado e validação próprios, que só apareciam
 * quando alguém clicava — e ocupavam um sexto do arquivo.
 */
export default function EntradaMassaModal({ produtos, estoqueML, onClose, onSaved }: {
  produtos: Product[];
  estoqueML: EstoqueML;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [data, setData] = useState(todayISO());
  const [obs, setObs] = useState("");
  const [busca, setBusca] = useState("");
  const [linhas, setLinhas] = useState<Record<string, { qtd: string; custo: string }>>({});
  const [salvando, setSalvando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [falhas, setFalhas] = useState<string[]>([]);

  /**
   * Os produtos no formato que o domínio entende. O estoque vem do MESMO
   * `fullDe`/`estoqueForaDoFull` que o modal individual usa — sem isso o
   * blend aqui partiria de um estoque diferente, e os dois caminhos dariam
   * custos médios distintos pra mesma compra.
   */
  const paraDominio: ProdutoParaEntrada[] = useMemo(() => produtos.map((p) => {
    const { qtd: full, proprio, ehFull } = fullDe(p, estoqueML);
    return {
      id: p.id, nome: p.name || p.id, custoMedio: custoMedioDe(p),
      full, casa: p.qtdLocal ?? 0, proprio, ehFull,
    };
  }), [produtos, estoqueML]);

  const linhasEntrada: LinhaEntrada[] = useMemo(() => Object.entries(linhas).map(([produtoId, v]) => ({
    produtoId,
    quantidade: v.qtd.trim() === "" ? null : parseNum(v.qtd),
    custoUnitario: v.custo.trim() === "" ? null : parseNum(v.custo),
  })), [linhas]);

  const resultado = useMemo(
    () => calcularEntradaMassa(paraDominio, linhasEntrada),
    [paraDominio, linhasEntrada],
  );

  const termo = busca.trim().toLowerCase();
  const visiveis = termo
    ? produtos.filter((p) => (p.name || "").toLowerCase().includes(termo) || (p.sku || "").toLowerCase().includes(termo))
    : produtos;

  const set = (id: string, campo: "qtd" | "custo", valor: string) =>
    setLinhas((s) => ({ ...s, [id]: { qtd: s[id]?.qtd ?? "", custo: s[id]?.custo ?? "", [campo]: valor } }));

  /**
   * Último custo digitado, pra repetir no próximo campo. Numa nota do mesmo
   * fornecedor o custo costuma se repetir, e redigitar é onde nasce o erro.
   */
  const ultimoCusto = useMemo(() => {
    const preenchidos = Object.values(linhas).map((v) => v.custo).filter((c) => c.trim() !== "");
    return preenchidos[preenchidos.length - 1] ?? "";
  }, [linhas]);

  async function salvar() {
    if (resultado.erros.length) { alert(resultado.erros.join("\n")); return; }
    if (!resultado.linhas.length) { alert("Preencha ao menos um produto."); return; }
    if (!obs.trim()) { alert("Informe o motivo/nota desta compra — fica no histórico de cada produto."); return; }
    if (!data) { alert("Informe a data da compra."); return; }
    if (!confirm(
      `Dar entrada em ${resultado.linhas.length} produto(s), `
      + `${resultado.unidadesTotais} unidade(s), total de ${fmtBRL(resultado.totalGeral)}?`
    )) return;

    setSalvando(true);
    setFalhas([]);
    const errosAoSalvar: string[] = [];
    let n = 0;
    /**
     * Sequencial, e não Promise.all: cada gravação recalcula o produto
     * (recomputeProduto) e invalida cache. Em paralelo, duas entradas do
     * mesmo produto poderiam ler o estoque antes de a outra gravar.
     *
     * Cada produto é independente: se um falhar, os outros seguem, e a tela
     * DIZ quais falharam — parar no primeiro erro deixaria a nota metade
     * lançada sem o usuário saber quais entraram.
     */
    for (const l of resultado.linhas) {
      try {
        await addMovimento({
          id: `${Date.now()}-${l.produtoId}-${Math.random().toString(36).slice(2, 8)}`,
          productId: l.produtoId,
          tipo: "entrada",
          quantidade: l.quantidade,
          custoUnit: l.custoUnitario,
          data,
          obs: obs.trim(),
          // Mesma razão do lançamento avulso: é o denominador que o livro não sabe.
          estoqueAntes: l.estoqueAntes,
          custoMedioAntes: l.custoMedioAtual,
        });
      } catch (e) {
        errosAoSalvar.push(`${l.nome}: ${e instanceof Error ? e.message : String(e)}`);
      }
      setProgresso(++n);
    }
    setSalvando(false);
    if (errosAoSalvar.length) { setFalhas(errosAoSalvar); return; }
    onSaved();
  }

  return (
    <Modal open onClose={salvando ? () => {} : onClose}>
      <div className="modal-head">
        <h3>Entrada em massa (compra)</h3>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={salvando}>Fechar</button>
      </div>

      <div className="form-grid" style={{ marginBottom: 10 }}>
        <div className="config-field" style={{ margin: 0 }}>
          <label>Data da compra</label>
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} disabled={salvando} />
          <div className="hint">Vale pra todas as linhas. O custo novo passa a valer desta data em diante.</div>
        </div>
        <div className="config-field" style={{ margin: 0 }}>
          <label>Nota / motivo</label>
          <input
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            placeholder="Ex.: NF 1234 - Fornecedor X"
            disabled={salvando}
          />
          <div className="hint">Fica no histórico de cada produto lançado.</div>
        </div>
      </div>

      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Filtrar produto por nome ou SKU..."
        style={{ width: "100%", marginBottom: 8 }}
        disabled={salvando}
      />

      <div style={{ maxHeight: "42vh", overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
        <table className="table" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Produto</th>
              <th style={{ width: 78 }}>Qtd</th>
              <th style={{ width: 104 }}>Custo un.</th>
              <th style={{ width: 92, textAlign: "right" }}>Total</th>
              <th style={{ width: 132, textAlign: "right" }}>Custo médio</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((p) => {
              const l = linhas[p.id] ?? { qtd: "", custo: "" };
              const calc = resultado.linhas.find((c) => c.produtoId === p.id);
              return (
                <tr key={p.id}>
                  <td style={{ textAlign: "left" }}>
                    {p.name || p.id}
                    {p.sku && <span style={{ color: "var(--muted)", fontSize: ".75rem" }}> · {p.sku}</span>}
                  </td>
                  <td>
                    <input
                      inputMode="decimal" value={l.qtd} disabled={salvando}
                      onChange={(e) => set(p.id, "qtd", e.target.value)}
                      style={{ width: "100%" }} placeholder="—"
                    />
                  </td>
                  <td>
                    <input
                      inputMode="decimal" value={l.custo} disabled={salvando}
                      onChange={(e) => set(p.id, "custo", e.target.value)}
                      onFocus={() => { if (!l.custo && ultimoCusto) set(p.id, "custo", ultimoCusto); }}
                      style={{ width: "100%" }} placeholder="—"
                    />
                  </td>
                  <td style={{ textAlign: "right" }}>{calc ? fmtBRL(calc.total) : "—"}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {calc ? (
                      <span style={{ color: calc.encarece ? "var(--yellow)" : "var(--muted)" }}>
                        {fmtBRL(calc.custoMedioAtual)} → <b>{fmtBRL(calc.custoMedioNovo)}</b>
                        {calc.encarece && (
                          <span title="Esta compra sobe o custo médio — a margem de todas as vendas futuras cai."> ▲</span>
                        )}
                      </span>
                    ) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {resultado.erros.length > 0 && (
        <div className="hint" style={{ color: "var(--red-text)", marginTop: 8 }}>
          {resultado.erros.map((e) => <div key={e}>• {e}</div>)}
        </div>
      )}
      {falhas.length > 0 && (
        <div className="hint" style={{ color: "var(--red-text)", marginTop: 8 }}>
          <b>Estes NÃO foram lançados (os demais entraram):</b>
          {falhas.map((e) => <div key={e}>• {e}</div>)}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: ".84rem" }}>
          <b>{resultado.linhas.length}</b> produto(s) · <b>{resultado.unidadesTotais}</b> un ·{" "}
          total <b style={{ color: "var(--text)" }}>{fmtBRL(resultado.totalGeral)}</b>
        </div>
        <button
          type="button" className="btn btn-primary"
          onClick={salvar}
          disabled={salvando || resultado.erros.length > 0 || resultado.linhas.length === 0}
        >
          {salvando ? `Lançando ${progresso}/${resultado.linhas.length}...` : "Lançar entradas"}
        </button>
      </div>
    </Modal>
  );
}
