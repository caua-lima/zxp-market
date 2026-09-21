"use client";

import { useState } from "react";
import { authedFetch } from "@/lib/api/authed-fetch";

type Resultado = { mes: string; orders: number; returns: number };

/**
 * Puxa o histórico de pedidos pra trás, mês a mês.
 *
 * Fica aqui, na aba Desempenho, porque é aqui que a falta dele aparece: sem
 * pedido ANTES do período, ninguém pode ser marcado como comprador
 * "frequente" e a taxa de recompra fica travada em 0% — por definição, não
 * porque ninguém recomprou.
 *
 * Roda um mês por requisição de propósito (ver app/api/ml/backfill): a função
 * da Vercel morre em 60s e o plano Spark do Firestore dá 20 mil escritas por
 * dia. Encadear no cliente, com pausa entre os meses, deixa o progresso
 * visível e permite parar no meio sem deixar nada inconsistente — cada mês é
 * gravado por order_id, então repetir reescreve em vez de duplicar.
 */
export default function BackfillHistorico({ onConcluir }: { onConcluir?: () => void }) {
  const [meses, setMeses] = useState(12);
  const [rodando, setRodando] = useState(false);
  const [parar, setParar] = useState(false);
  const [feitos, setFeitos] = useState<Resultado[]>([]);
  const [erro, setErro] = useState("");
  const [aberto, setAberto] = useState(false);

  async function rodar() {
    setRodando(true);
    setParar(false);
    setErro("");
    setFeitos([]);

    const hoje = new Date(Date.now() - 3 * 3600 * 1000);
    let ano = hoje.getUTCFullYear();
    let mes = hoje.getUTCMonth() + 1;
    const acumulado: Resultado[] = [];

    for (let i = 0; i < meses; i++) {
      if (parar) break;
      try {
        const r = await authedFetch(`/api/ml/backfill?ano=${ano}&mes=${mes}`, { method: "POST" });
        const j = await r.json();
        if (!r.ok || j.error) {
          setErro(`Parou em ${ano}-${String(mes).padStart(2, "0")}: ${j.details ?? j.error ?? `HTTP ${r.status}`}`);
          break;
        }
        acumulado.push({ mes: j.mes, orders: j.orders ?? 0, returns: j.returns ?? 0 });
        setFeitos([...acumulado]);
        ano = j.proximo.ano;
        mes = j.proximo.mes;
      } catch (e) {
        setErro(`Falhou em ${ano}-${String(mes).padStart(2, "0")}: ${e instanceof Error ? e.message : String(e)}`);
        break;
      }
      // Respiro entre meses: sem isso a sequência vira rajada no ML (que já
      // devolveu HTTP 429 neste projeto) e no Firestore.
      await new Promise((res) => setTimeout(res, 1200));
    }

    setRodando(false);
    onConcluir?.();
  }

  const totalPedidos = feitos.reduce((s, f) => s + f.orders, 0);

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 6 }}>
        <span className="panel-title">Histórico de pedidos</span>
        <span className="panel-sub">puxa meses antigos do Mercado Livre</span>
      </div>

      {!aberto ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAberto(true)}>
          Puxar histórico antigo
        </button>
      ) : (
        <>
          <div style={{ fontSize: ".8rem", color: "var(--muted)", lineHeight: 1.55, marginBottom: 12 }}>
            A sincronização normal só cobre o mês atual e o anterior. Sem histórico mais antigo, a{" "}
            <b>taxa de recompra fica travada</b> — ninguém pode ser marcado como comprador frequente se não
            existe pedido dele de antes. Isto puxa mês a mês, de trás pra frente. Pode fechar a tela e voltar:
            cada mês já puxado fica salvo.
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <label style={{ fontSize: ".8rem", color: "var(--muted)" }} htmlFor="backfill-1">Quantos meses pra trás</label>
            <select id="backfill-1"
              className="inp" style={{ width: 110 }} value={meses} disabled={rodando}
              onChange={(e) => setMeses(Number(e.target.value))}
            >
              {[6, 12, 18, 24].map((m) => <option key={m} value={m}>{m} meses</option>)}
            </select>
            {!rodando ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={rodar}>Começar</button>
            ) : (
              <button type="button" className="btn btn-danger btn-sm" onClick={() => setParar(true)}>Parar</button>
            )}
          </div>

          {(rodando || feitos.length > 0) && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ height: 8, borderRadius: 99, background: "var(--surface2)", overflow: "hidden" }}>
                <div style={{
                  width: `${Math.min((feitos.length / meses) * 100, 100)}%`, height: "100%",
                  background: "var(--brand)", transition: "width .3s",
                }} />
              </div>
              <div style={{ fontSize: ".8rem", color: "var(--muted)", marginTop: 6 }}>
                {feitos.length} de {meses} meses · <b style={{ color: "var(--text)" }}>{totalPedidos}</b> pedidos
                sincronizados{rodando ? " · puxando…" : ""}
              </div>
            </div>
          )}

          {feitos.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {feitos.map((f) => (
                <span key={f.mes} className="chip chip-muted" title={`${f.orders} pedidos · ${f.returns} devoluções`}>
                  {f.mes} · {f.orders}
                </span>
              ))}
            </div>
          )}

          {erro && (
            <div className="note note-danger" style={{ marginTop: 10 }}>
              {erro}
              <div style={{ marginTop: 4, fontSize: ".75rem" }}>
                O que já foi puxado continua salvo — dá pra rodar de novo depois que resolver.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
