"use client";

import { useMemo, useState } from "react";
import Modal from "@/components/Modal";
import { agruparBaixasPorRemessa, type RemessaAgrupada } from "@/lib/domain/remessa-agrupada";
import type { EstoqueMovimento, Product } from "@/lib/domain/types";

/**
 * As baixas do Full agrupadas por ENVIO, no formato do painel do Mercado
 * Livre.
 *
 * ─── POR QUE ESTE FORMATO ───────────────────────────────────────────────
 *
 * A conferência é sempre contra a tela do ML, que mostra um ENVIO por linha
 * ("#75664648 · 260 un · processamento finalizado") e abre o detalhe por
 * produto num clique. O histórico daqui mostrava um lançamento por produto,
 * quatro linhas idênticas na data e na observação — comparar exigia somar de
 * cabeça e torcer pra não errar.
 *
 * Espelhando o formato, conferir vira ler os dois lados lado a lado: mesmo
 * número de envio, mesmo total.
 */
export default function BaixasPorRemessa({
  movimentos, products, onEditar,
}: {
  movimentos: EstoqueMovimento[];
  products: Product[];
  /** Abre o editor do lançamento — a correção continua sendo por movimento. */
  onEditar: (mov: EstoqueMovimento) => void;
}) {
  const [aberta, setAberta] = useState<RemessaAgrupada | null>(null);
  const [busca, setBusca] = useState("");

  const nomePorId = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products) m.set(p.id, p.name || "Sem nome");
    return m;
  }, [products]);

  const { remessas } = useMemo(
    () => agruparBaixasPorRemessa(movimentos, nomePorId),
    [movimentos, nomePorId],
  );

  const termo = busca.trim().toLowerCase();
  const visiveis = termo
    ? remessas.filter((r) =>
      r.remessa.includes(termo) || r.produtos.some((p) => p.nome.toLowerCase().includes(termo)))
    : remessas;

  const movPorId = useMemo(() => {
    const m = new Map<string, EstoqueMovimento>();
    for (const x of movimentos) m.set(x.id, x);
    return m;
  }, [movimentos]);

  const dataBR = (d: string) => (d ? d.split("-").reverse().join("/") : "—");

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">
          Baixas por envio
          <span className="panel-sub"> · {remessas.length} envio(s) · confira contra o painel do ML</span>
        </span>
      </div>

      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Filtrar por número do envio ou produto..."
        style={{ width: "100%", marginBottom: 10 }}
      />

      {visiveis.length === 0 ? (
        <div className="empty-state">
          <span className="empty-ico">📦</span>
          Nenhuma baixa de envio no histórico.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Envio</th>
                <th style={{ textAlign: "right" }}>Unidades</th>
                <th style={{ textAlign: "right" }}>Produtos</th>
                <th style={{ textAlign: "left" }}>Data da baixa</th>
                <th style={{ textAlign: "right" }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((r) => (
                <tr key={r.remessa}>
                  <td style={{ textAlign: "left", fontWeight: 700 }}>
                    #{r.remessa}
                    {/* A baixa automática foi removida do app; marcar o que veio
                        dela ajuda a saber qual lançamento merece conferência
                        extra, porque foi ela que errou 20 por 19. */}
                    {r.automatica && (
                      <span
                        className="chip chip-muted" style={{ marginLeft: 6 }}
                        title="Lançada pela baixa automática, que foi removida por dar quantidade errada. Vale conferir contra o painel do ML."
                      >
                        automática
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 800 }}>{r.totalUnidades} un</td>
                  <td style={{ textAlign: "right", color: "var(--muted)" }}>{r.produtos.length}</td>
                  <td style={{ textAlign: "left", color: "var(--muted)" }}>{dataBR(r.data)}</td>
                  <td style={{ textAlign: "right" }}>
                    <button type="button" className="btn btn-ghost btn-xs" onClick={() => setAberta(r)}>
                      Conferir detalhes
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {aberta && (
        <Modal open onClose={() => setAberta(null)}>
          <div className="modal-head">
            <h3>Envio n.º {aberta.remessa}</h3>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAberta(null)}>Fechar</button>
          </div>

          <div style={{ padding: "10px 14px", borderRadius: 10, background: "var(--surface2)", marginBottom: 12 }}>
            <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>Baixado do estoque em {dataBR(aberta.data)}</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 800 }}>
              {aberta.totalUnidades} un em {aberta.produtos.length} produto(s)
            </div>
            <div style={{ fontSize: ".74rem", color: "var(--muted)", marginTop: 4 }}>
              Compare com &quot;Declaradas / Processadas&quot; do envio #{aberta.remessa} no painel do
              Mercado Livre. Diferença aqui significa baixa lançada errada — corrija na linha.
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Produto</th>
                  <th style={{ textAlign: "right" }}>Baixado</th>
                  <th style={{ textAlign: "right" }}>Ação</th>
                </tr>
              </thead>
              <tbody>
                {aberta.produtos.map((p) => (
                  <tr key={p.movimentoId}>
                    <td style={{ textAlign: "left" }}>{p.nome}</td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{p.unidades} un</td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        type="button" className="btn btn-warning btn-xs"
                        onClick={() => {
                          const m = movPorId.get(p.movimentoId);
                          if (!m) return;
                          setAberta(null);
                          onEditar(m);
                        }}
                      >
                        Corrigir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ textAlign: "left", fontWeight: 700 }}>Total</td>
                  <td style={{ textAlign: "right", fontWeight: 800 }}>{aberta.totalUnidades} un</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </Modal>
      )}
    </div>
  );
}
