"use client";

import { useMemo, useState } from "react";
import { fmtBRL } from "@/lib/domain/calc";
import { salvarCustoRemessaFull } from "@/lib/firebase/data";
import { diffCustos, parseCusto, totalInformado, type LinhaCusto } from "@/lib/domain/custo-coleta";

/**
 * Custos de coleta do Full — todos visíveis, todos editáveis, salvos em lote.
 *
 * ─── POR QUE EM LOTE ────────────────────────────────────────────────────
 *
 * A versão anterior salvava uma coleta por vez e recarregava tudo a cada
 * salvar. Com cinco valores pra informar isso eram cinco recarregamentos, e a
 * cada um se perdia a rolagem e o foco — no meio de um trabalho que é
 * naturalmente sequencial (abrir o Seller Center, copiar, colar, repetir).
 *
 * Agora os campos ficam todos abertos, o que muda fica destacado, e um botão
 * só grava tudo com UM recarregamento no fim.
 *
 * O que conta como alteração é decidido em lib/domain/custo-coleta.ts, que
 * tem a sutileza importante: campo em branco só apaga custo se ANTES havia
 * um. Sem isso, salvar em lote gravaria null por cima das linhas que o
 * usuário nem tocou.
 */

export type RemessaCusto = {
  remessa: string;
  data: string;
  recebido: number;
  custo: number | null;
  custoEstimado?: boolean;
};

type Props = {
  remessas: RemessaCusto[];
  /** Recarrega os dados — chamado UMA vez, no fim do lote. */
  onSalvo: () => void | Promise<void>;
  /** Começa aberto quando há pendência (uso na DRE, onde a falta aparece). */
  iniciarAberto?: boolean;
  titulo?: string;
};

export default function CustosColetaFull({
  remessas, onSalvo, iniciarAberto = false, titulo = "Custos de coleta do Full",
}: Props) {
  const [aberto, setAberto] = useState(iniciarAberto);
  const [rascunho, setRascunho] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [salvos, setSalvos] = useState(0);

  const lista = useMemo(
    () => [...remessas].sort((a, b) => b.data.localeCompare(a.data)),
    [remessas],
  );

  const linhas: LinhaCusto[] = useMemo(
    () => lista.map((r) => ({ remessa: r.remessa, custo: r.custo })),
    [lista],
  );

  const { alteracoes, invalidas } = useMemo(
    () => diffCustos(linhas, rascunho),
    [linhas, rascunho],
  );

  const comCusto = lista.filter((r) => r.custo != null);
  const semCusto = lista.filter((r) => r.custo == null);
  const total = totalInformado(linhas);

  // Prévia do total incluindo o que está editado mas ainda não salvo — o
  // número que a DRE vai mostrar depois de gravar.
  const totalPrevisto = useMemo(() => {
    const mapa = new Map(alteracoes.map((a) => [a.remessa, a.valor]));
    return linhas.reduce((s, l) => s + ((mapa.has(l.remessa) ? mapa.get(l.remessa)! : l.custo) ?? 0), 0);
  }, [linhas, alteracoes]);

  async function salvarTudo() {
    if (salvando || alteracoes.length === 0) return;
    if (invalidas.length > 0) {
      setErro(`Valor inválido em ${invalidas.length} linha(s) — corrija antes de salvar.`);
      return;
    }
    setSalvando(true);
    setErro("");
    try {
      // Sequencial de propósito: são poucas linhas, e em paralelo um erro no
      // meio deixaria metade gravada sem dizer quais.
      for (const a of alteracoes) {
        await salvarCustoRemessaFull(a.remessa, a.valor);
      }
      const n = alteracoes.length;
      setRascunho({});
      setSalvos(n);
      await onSalvo(); // UM recarregamento, no fim
      setTimeout(() => setSalvos(0), 4000);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  }

  function descartar() {
    setRascunho({});
    setErro("");
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
          <span className="panel-title">{titulo}</span>
          <span className="panel-sub" style={{ display: "block" }}>
            {comCusto.length} de {lista.length} informado(s) · {fmtBRL(total)} no total
            {semCusto.length > 0 && (
              <b style={{ color: "var(--warning)" }}> · {semCusto.length} pendente(s)</b>
            )}
          </span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          {alteracoes.length > 0 && (
            <span style={{
              fontSize: ".7rem", fontWeight: 700, color: "var(--brand)",
              background: "var(--warning-soft)", borderRadius: 999, padding: "2px 8px",
            }}>
              {alteracoes.length} não salva(s)
            </span>
          )}
          <span style={{ color: "var(--muted)", fontSize: ".8rem" }}>{aberto ? "▲" : "▼"}</span>
        </span>
      </button>

      {aberto && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: ".74rem", color: "var(--muted)", lineHeight: 1.6, marginBottom: 12 }}>
            O Mercado Livre não expõe esse valor pela API. Pegue em{" "}
            <b style={{ color: "var(--text)" }}>Envios › detalhe do envio › Tarifas › Custo da coleta Full</b>{" "}
            (o valor marcado como <i>estimado</i> serve). Preencha quantas quiser e salve de uma vez —
            entra direto no Resultado líquido da DRE.
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {lista.map((r) => {
              const digitado = rascunho[r.remessa];
              const tocada = digitado !== undefined;
              const invalida = tocada && !parseCusto(digitado).ok;
              const mudou = alteracoes.some((a) => a.remessa === r.remessa);
              const valorCampo = tocada ? digitado : (r.custo != null ? String(r.custo) : "");

              return (
                <div
                  key={r.remessa}
                  style={{
                    /**
                     * `auto-fit` + `minmax` em vez de três colunas fixas: as
                     * mínimas somavam 350px + gaps e vazavam do painel num
                     * iPhone (335px úteis, medido). Assim as colunas caem pra
                     * baixo sozinhas quando não cabem, sem media query.
                     */
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))",
                    gap: 8, alignItems: "center",
                    padding: "8px 10px", borderRadius: 8,
                    background: mudou ? "var(--warning-soft)" : "var(--surface2)",
                    border: `1px solid ${invalida ? "var(--red)" : mudou ? "rgba(255,138,31,.45)" : "transparent"}`,
                    transition: "background .15s, border-color .15s",
                  }}
                >
                  <span style={{ fontFamily: "ui-monospace,monospace", fontSize: ".78rem", fontWeight: 700 }}>
                    #{r.remessa}
                  </span>

                  <span style={{ fontSize: ".74rem", color: "var(--muted)" }}>
                    {r.data.split("-").reverse().join("/")} · {r.recebido} un
                    {r.custo != null && !tocada && r.custoEstimado && (
                      <span title="Valor informado por você — o ML mostra como estimado."> · estimado</span>
                    )}
                  </span>

                  <span style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end", minWidth: 0 }}>
                    <span style={{ fontSize: ".72rem", color: "var(--muted)" }}>R$</span>
                    <input
                      type="text" inputMode="decimal"
                      aria-label={`Custo da coleta da remessa ${r.remessa}`}
                      placeholder="—"
                      value={valorCampo}
                      onChange={(e) => setRascunho((s) => ({ ...s, [r.remessa]: e.target.value }))}
                      onKeyDown={(e) => {
                        // Enter salva o lote inteiro: a mão já está no teclado
                        // e o fluxo é preencher várias e confirmar.
                        if (e.key === "Enter") { e.preventDefault(); salvarTudo(); }
                        if (e.key === "Escape") {
                          setRascunho((s) => { const p = { ...s }; delete p[r.remessa]; return p; });
                        }
                      }}
                      style={{
                        width: "100%", maxWidth: 120, minWidth: 76,
                        fontSize: 16, padding: "6px 9px", textAlign: "right",
                        background: "var(--bg)",
                        border: `1px solid ${invalida ? "var(--red)" : "var(--border)"}`,
                        borderRadius: 7, color: invalida ? "var(--red)" : "var(--text)",
                        fontWeight: mudou ? 700 : 400, outline: "none",
                      }}
                    />
                    {mudou && !invalida && (
                      <span style={{ color: "var(--brand)", fontSize: ".9rem" }} title="Alterado — falta salvar">●</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Barra de ação: só aparece quando há o que salvar. */}
          {alteracoes.length > 0 && (
            <div style={{
              display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10,
              marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)",
            }}>
              <button type="button" className="btn btn-success" disabled={salvando} onClick={salvarTudo}>
                {salvando ? "Salvando…" : `Salvar ${alteracoes.length} alteração(ões)`}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={salvando} onClick={descartar}>
                Descartar
              </button>
              <span style={{ fontSize: ".76rem", color: "var(--muted)" }}>
                Total ficará em <b style={{ color: "var(--text)" }}>{fmtBRL(totalPrevisto)}</b>
              </span>
            </div>
          )}

          {erro && <div className="note note-warn" style={{ marginTop: 10 }}>{erro}</div>}
          {salvos > 0 && !erro && (
            <div style={{ marginTop: 10, fontSize: ".78rem", color: "var(--green)", fontWeight: 600 }}>
              ✓ {salvos} custo(s) salvo(s).
            </div>
          )}

          {semCusto.length > 0 && (
            <div style={{ marginTop: 10, fontSize: ".73rem", color: "var(--muted)", lineHeight: 1.6 }}>
              As {semCusto.length} coleta(s) sem custo <b>não entram</b> no total nem na DRE — ficam de fora
              em vez de contar como R$ 0,00, que subestimaria o custo e inflaria o lucro. Deixar o campo
              vazio numa que já tem custo <b>apaga</b> o valor.
            </div>
          )}
        </div>
      )}
    </section>
  );
}
