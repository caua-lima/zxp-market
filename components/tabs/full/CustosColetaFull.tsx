"use client";

import { useMemo, useState } from "react";
import { fmtBRL } from "@/lib/domain/calc";
import { salvarCustoRemessaFull } from "@/lib/firebase/data";
import type { Remessa } from "@/lib/domain/remessas";

/**
 * Todos os custos de coleta do Full, num lugar só — e editáveis pra sempre.
 *
 * ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────
 *
 * O editor de custo vivia só na lista de remessas PENDENTES de baixa. Assim
 * que a baixa era dada, a remessa saía da lista e o custo ia junto: não havia
 * como conferir o que foi informado, nem corrigir um valor digitado errado.
 * E é um valor que entra direto no Resultado líquido da DRE — errar nele
 * distorce o lucro do mês inteiro, em silêncio.
 *
 * Aqui a remessa nunca some. Fica o histórico completo, o que já foi
 * informado, o que falta, e o total que está batendo na DRE.
 *
 * ─── POR QUE null NÃO É ZERO ────────────────────────────────────────────
 *
 * `custo: null` quer dizer "não sabemos" — o ML não expõe esse valor pela
 * API. Tratar como R$ 0,00 subestimaria o custo e inflaria o lucro. Por isso
 * a linha aparece como pendente, nunca como zero.
 */

type Props = {
  remessas: Remessa[];
  /** Recarrega os dados depois de salvar — o total precisa refletir na hora. */
  onSalvo: () => void | Promise<void>;
};

export default function CustosColetaFull({ remessas, onSalvo }: Props) {
  const [aberto, setAberto] = useState(false);
  const [rascunho, setRascunho] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState("");
  const [erro, setErro] = useState("");

  // Transferência entre centros do ML não é coleta sua — não tem taxa sua.
  const lista = useMemo(
    () => remessas.filter((r) => !r.ehTransferencia).sort((a, b) => b.data.localeCompare(a.data)),
    [remessas],
  );

  const comCusto = lista.filter((r) => r.custo != null);
  const semCusto = lista.filter((r) => r.custo == null);
  const total = comCusto.reduce((s, r) => s + (r.custo ?? 0), 0);

  async function salvar(r: Remessa) {
    const bruto = (rascunho[r.remessa] ?? "").trim().replace(",", ".");
    // Campo vazio limpa o custo (volta pra "não informado"), que é diferente
    // de gravar zero — zero é coleta grátis, uma informação de verdade.
    const n = bruto === "" ? null : Number(bruto);
    if (bruto !== "" && (!Number.isFinite(n) || (n as number) < 0)) {
      setErro("Informe um valor válido.");
      return;
    }
    setSalvando(r.remessa);
    setErro("");
    try {
      await salvarCustoRemessaFull(r.remessa, n);
      setRascunho((s) => {
        const proximo = { ...s };
        delete proximo[r.remessa];
        return proximo;
      });
      await onSalvo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando("");
    }
  }

  if (lista.length === 0) return null;

  return (
    <section className="panel" style={{ marginTop: 12 }}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
          width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer",
          color: "inherit", textAlign: "left",
        }}
      >
        <span>
          <span className="panel-title">Custos de coleta do Full</span>
          <span className="panel-sub" style={{ display: "block" }}>
            {comCusto.length} informado(s) · {fmtBRL(total)} no total
            {semCusto.length > 0 && ` · ${semCusto.length} pendente(s)`}
          </span>
        </span>
        <span style={{ color: "var(--muted)", fontSize: ".8rem" }}>{aberto ? "▲" : "▼"}</span>
      </button>

      {aberto && (
        <div style={{ marginTop: 12 }}>
          {erro && <div className="note note-warn" style={{ marginBottom: 8 }}>{erro}</div>}

          <div style={{ fontSize: ".74rem", color: "var(--muted)", lineHeight: 1.6, marginBottom: 10 }}>
            O Mercado Livre não expõe esse valor pela API. Pegue em{" "}
            <b>Envios › detalhe do envio › Tarifas › Custo da coleta Full</b> (o valor marcado como{" "}
            <i>estimado</i> serve). Entra direto no Resultado líquido da DRE — por isso vale conferir.
          </div>

          <div className="table-wrapper" style={{ border: "none" }}>
            <table className="tbl-modern tbl-cards">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Remessa</th>
                  <th style={{ textAlign: "left" }}>Data</th>
                  <th style={{ textAlign: "right" }}>Unidades</th>
                  <th style={{ textAlign: "right" }}>Custo da coleta</th>
                  <th style={{ textAlign: "right" }}>Alterar</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((r) => {
                  const emEdicao = rascunho[r.remessa] !== undefined;
                  const temCusto = r.custo != null;
                  return (
                    <tr key={r.remessa}>
                      <td style={{ textAlign: "left", fontFamily: "ui-monospace,monospace", fontWeight: 700 }}>
                        #{r.remessa}
                      </td>
                      <td data-label="Data" style={{ textAlign: "left", color: "var(--muted)" }}>
                        {r.data.split("-").reverse().join("/")}
                      </td>
                      <td data-label="Unidades" style={{ textAlign: "right" }}>{r.recebido} un</td>
                      <td data-label="Custo" style={{ textAlign: "right" }}>
                        {temCusto ? (
                          <b style={{ color: "var(--red)" }}>
                            {fmtBRL(r.custo as number)}
                            {r.custoEstimado && (
                              <span
                                style={{ color: "var(--muted)", fontWeight: 400, fontSize: ".72rem" }}
                                title="Valor informado por você — o ML mostra como estimado."
                              >
                                {" "}(estimado)
                              </span>
                            )}
                          </b>
                        ) : (
                          <span style={{ color: "var(--warning)", fontWeight: 700 }}>não informado</span>
                        )}
                      </td>
                      <td data-cell="acoes" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          {emEdicao ? (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontSize: ".72rem", color: "var(--muted)" }}>R$</span>
                              <input
                                type="number" min="0" step="0.01" inputMode="decimal" autoFocus
                                aria-label={`Custo da coleta da remessa ${r.remessa}`}
                                className="inp"
                                style={{ width: 96, padding: "4px 8px", fontSize: ".8rem" }}
                                value={rascunho[r.remessa]}
                                onChange={(e) => setRascunho((s) => ({ ...s, [r.remessa]: e.target.value }))}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") salvar(r);
                                  if (e.key === "Escape") {
                                    setRascunho((s) => {
                                      const p = { ...s };
                                      delete p[r.remessa];
                                      return p;
                                    });
                                  }
                                }}
                              />
                              <button
                                type="button" className="btn btn-success btn-xs"
                                disabled={salvando === r.remessa}
                                onClick={() => salvar(r)}
                              >
                                {salvando === r.remessa ? "…" : "Salvar"}
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button" className="btn btn-ghost btn-xs"
                              onClick={() =>
                                setRascunho((s) => ({
                                  ...s,
                                  [r.remessa]: r.custo != null ? String(r.custo) : "",
                                }))
                              }
                            >
                              {temCusto ? "Alterar" : "Informar"}
                            </button>
                          )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {semCusto.length > 0 && (
            <div style={{ marginTop: 10, fontSize: ".74rem", color: "var(--muted)", lineHeight: 1.6 }}>
              As {semCusto.length} coleta(s) sem custo <b>não entram</b> no total acima nem na DRE —
              ficam de fora em vez de contar como R$ 0,00, que subestimaria o custo e inflaria o lucro.
            </div>
          )}
        </div>
      )}
    </section>
  );
}
