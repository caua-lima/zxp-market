"use client";

import { janelaRecomendadaMeses, type ResultadoCompradores } from "@/lib/domain/repurchase";

function fmtDataBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export default function CompradoresPanel({
  compradores, months, periodoInicio, historicoDesde, to, dias, semComprador, onUsarJanela,
}: {
  compradores: ResultadoCompradores;
  months: number;
  periodoInicio: string;
  historicoDesde: string | null;
  /** Fim do período analisado (hoje, em ISO) — base pra calcular a janela viável. */
  to: string;
  /** Quando setado, o período foi medido em dias (pra comparar com o painel do ML). */
  dias?: number | null;
  /** Pedidos do período sem comprador identificado — ficam fora da conta. */
  semComprador?: number;
  /** Troca a janela do painel pra uma que o histórico sincronizado sustenta. */
  onUsarJanela?: (meses: number) => void;
}) {
  const cor = (t: number) => (t >= 20 ? "var(--green)" : t >= 10 ? "var(--yellow)" : "var(--red)");
  const pctFrequentes = compradores.total > 0 ? (compradores.frequentes / compradores.total) * 100 : 0;
  // Se o pedido mais antigo sincronizado é de DENTRO do período (ou nem existe
  // margem antes dele), não dá pra saber quem já comprava antes — "novos"
  // fica inflado por falta de dado, não porque ninguém recomprou de verdade.
  const historicoIncompleto = historicoDesde != null && historicoDesde >= periodoInicio;
  // Janela que o histórico sincronizado de fato sustenta — sem isso o aviso
  // dizia "tente uma janela menor" sem dizer qual, e 3m podia ser pequeno ou
  // grande demais dependendo de quanto histórico existe.
  const janelaViavel = janelaRecomendadaMeses(historicoDesde, to);

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 10 }}>
        <span className="panel-title">Detalhe dos compradores</span>
        <span className="panel-sub">
          {dias != null ? `últimos ${dias} dias` : `últimos ${months} ${months === 1 ? "mês" : "meses"}`}
        </span>
      </div>

      {compradores.total === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: ".85rem" }}>Sem compradores identificados no período.</div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 64, height: 64, borderRadius: "50%",
                background: `conic-gradient(var(--accent) 0% ${pctFrequentes}%, var(--surface2) ${pctFrequentes}% 100%)`,
              }} />
              <div>
                <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>Total de compradores</div>
                <div style={{ fontSize: "1.3rem", fontWeight: 800 }}>{compradores.total}</div>
              </div>
            </div>
            <div>
              <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>Frequentes</div>
              <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--accent)" }}>{compradores.frequentes}</div>
            </div>
            <div>
              <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>Novos</div>
              <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>{compradores.novos}</div>
            </div>
            <div>
              <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>Taxa de recompra</div>
              <div style={{ fontSize: "1.3rem", fontWeight: 800, color: compradores.taxaRecompra != null ? cor(compradores.taxaRecompra) : "var(--muted)" }}>
                {compradores.taxaRecompra != null ? `${compradores.taxaRecompra.toFixed(1)}%` : "—"}
              </div>
            </div>
          </div>
          {(semComprador ?? 0) > 0 && (
            <div style={{
              marginBottom: 10, padding: "8px 12px", borderRadius: 8, fontSize: ".8rem", lineHeight: 1.5,
              background: "var(--warning-soft)", border: "1px solid rgba(255,138,31,.35)", color: "var(--warning)",
            }}>
              <b>{semComprador} pedido(s) do período sem comprador identificado</b> — eles ficam de fora da conta
              acima, então a taxa está subestimada. Acontece com pedido que entrou pelo aviso em tempo real e
              ainda não passou por uma sincronização completa: clique em <b>⟳ Atualizar ML</b> no Dashboard
              pra preencher.
            </div>
          )}
          {historicoIncompleto && (
            <div style={{
              marginBottom: 10, padding: "8px 12px", borderRadius: 8, fontSize: ".8rem", lineHeight: 1.5,
              background: "var(--warning-soft)", border: "1px solid rgba(255,138,31,.35)", color: "var(--warning)",
            }}>
              O pedido mais antigo que temos sincronizado é de {historicoDesde ? fmtDataBR(historicoDesde) : "—"},
              já dentro (ou perto) do início do período. Sem pedido de antes pra comparar, ninguém consegue ser
              marcado como <b>frequente</b> — por isso a taxa acima aparece como 0%. Não significa que ninguém
              recomprou: significa que não dá pra saber com o histórico que temos.
              {janelaViavel != null ? (
                <div style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn btn-warning btn-xs"
                    onClick={() => onUsarJanela?.(janelaViavel)}
                    disabled={!onUsarJanela || janelaViavel === months}
                  >
                    Usar janela de {janelaViavel} {janelaViavel === 1 ? "mês" : "meses"}
                  </button>
                  <span style={{ marginLeft: 8, fontSize: ".75rem" }}>
                    deixa o histórico anterior livre pra servir de comparação
                  </span>
                </div>
              ) : (
                <div style={{ marginTop: 6, fontSize: ".75rem" }}>
                  Ainda não há histórico suficiente pra nenhuma janela honesta — são necessários pelo menos
                  ~2 meses de pedidos sincronizados.
                </div>
              )}
            </div>
          )}
          <div style={{ fontSize: ".75rem", color: "var(--muted)", lineHeight: 1.5 }}>
            Frequente = já tinha comprado de você ANTES do período. Novo = primeira compra dentro do período.
            Taxa de recompra = frequentes ÷ total de compradores do período — mesmo critério do painel
            &quot;Detalhe dos compradores&quot; do próprio Mercado Livre.
          </div>
        </>
      )}
    </div>
  );
}
