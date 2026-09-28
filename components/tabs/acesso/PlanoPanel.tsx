"use client";

import { useEffect, useState } from "react";
import { irPara } from "@/lib/ir-para";
import { authedFetch } from "@/lib/api/authed-fetch";
import { useAccess } from "@/components/tabs/AccessGuard";
import { ROTULO_DO_ESTADO } from "@/lib/domain/texto-assinatura";
import type { EstadoDaAssinatura } from "@/lib/domain/assinatura";

/**
 * Plano da empresa (S25): estado, limites e uso; o dono assina (checkout do
 * Stripe) ou gerencia (portal do Stripe: cartão, faturas, troca de plano,
 * cancelamento). Só no modo empresa — no modo raiz não há cobrança.
 *
 * A volta do checkout NÃO muda o plano aqui: quem muda é o webhook. Por isso,
 * voltando do checkout, a tela consulta de novo por alguns segundos.
 */

type Estado = {
  modo: string;
  direitos?: { plano: string; estado: EstadoDaAssinatura; bloqueada: boolean; membros: number | null; conexoes: number | null };
  uso?: { membros: number };
  trialAte?: number | null;
  periodoFim?: number | null;
  cancelaEm?: number | null;
  temAssinatura?: boolean;
  cobrancaLigada?: boolean;
  planos?: { id: string; nome: string; membros: number | null; conexoes: number | null }[];
};

const data = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleDateString("pt-BR") : "—");
const limite = (n: number | null | undefined) => (n == null ? "sem limite" : String(n));

/** `atualizarCom`: muda quando o time muda — o uso ("2 de 3") tem que acompanhar. */
export default function PlanoPanel({ atualizarCom }: { atualizarCom?: unknown } = {}) {
  const { papel } = useAccess();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [acao, setAcao] = useState<{ rodando: boolean; erro?: string }>({ rodando: false });
  const [voltouDoCheckout] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("cobranca") === "voltou");

  useEffect(() => {
    let vivo = true;
    const carregar = () =>
      authedFetch("/api/billing/estado", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (vivo && j) setEstado(j as Estado); })
        .catch(() => { /* sem rede: o painel some, o resto da tela segue */ });
    void carregar();
    // Voltando do checkout: o webhook costuma chegar em segundos; consulta por até ~30 s.
    let n = 0;
    const id = voltouDoCheckout ? window.setInterval(() => { n += 1; void carregar(); if (n >= 6) window.clearInterval(id); }, 5000) : undefined;
    return () => { vivo = false; if (id) window.clearInterval(id); };
  }, [voltouDoCheckout, atualizarCom]);

  if (!estado || estado.modo !== "tenant" || !estado.direitos) return null;
  const d = estado.direitos;
  const dono = papel === "owner";

  async function ir(caminho: string, corpo?: unknown) {
    setAcao({ rodando: true });
    try {
      const r = await authedFetch(caminho, { method: "POST", headers: { "Content-Type": "application/json" }, body: corpo ? JSON.stringify(corpo) : undefined });
      const j = (await r.json().catch(() => ({}))) as { url?: string; error?: string; details?: string };
      if (r.ok && j.url) { irPara(j.url); return; }
      setAcao({ rodando: false, erro: j.details ?? j.error ?? `Falhou (${r.status})` });
    } catch {
      setAcao({ rodando: false, erro: "Falha de rede." });
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: ".95rem" }}>Plano</h3>
        <span style={{ fontSize: ".8rem", fontWeight: 700, color: d.bloqueada ? "var(--red-text)" : d.estado === "carencia" ? "var(--warning)" : "var(--green)" }}>
          {ROTULO_DO_ESTADO[d.estado]}
        </span>
      </div>

      <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: "8px 16px", margin: "12px 0", fontSize: ".82rem" }}>
        <div><dt style={{ color: "var(--muted)" }}>Plano</dt><dd style={{ margin: 0, fontWeight: 600, textTransform: "capitalize" }}>{d.plano}</dd></div>
        <div><dt style={{ color: "var(--muted)" }}>Pessoas</dt><dd style={{ margin: 0, fontWeight: 600 }}>{estado.uso?.membros ?? "—"} de {limite(d.membros)}</dd></div>
        <div><dt style={{ color: "var(--muted)" }}>Contas do ML</dt><dd style={{ margin: 0, fontWeight: 600 }}>{limite(d.conexoes)}</dd></div>
        {d.estado === "trial" && <div><dt style={{ color: "var(--muted)" }}>Teste até</dt><dd style={{ margin: 0, fontWeight: 600 }}>{data(estado.trialAte)}</dd></div>}
        {estado.periodoFim && <div><dt style={{ color: "var(--muted)" }}>{estado.cancelaEm ? "Termina em" : "Renova em"}</dt><dd style={{ margin: 0, fontWeight: 600 }}>{data(estado.cancelaEm ?? estado.periodoFim)}</dd></div>}
      </dl>

      {d.bloqueada && (
        <p style={{ margin: "0 0 12px", fontSize: ".82rem", color: "var(--red-text)" }}>
          Modo somente leitura: dá pra ver e exportar tudo, mas nada novo é gravado. Nenhum dado foi apagado.
        </p>
      )}
      {voltouDoCheckout && !estado.temAssinatura && (
        <p style={{ margin: "0 0 12px", fontSize: ".82rem", color: "var(--muted)" }}>
          Pagamento em confirmação com o Stripe — o plano atualiza sozinho em alguns segundos.
        </p>
      )}

      {dono && estado.cobrancaLigada && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {estado.temAssinatura ? (
            <button type="button" className="btn btn-primary btn-xs" disabled={acao.rodando} onClick={() => ir("/api/billing/portal")}>
              Gerenciar assinatura
            </button>
          ) : (
            (estado.planos ?? []).map((p) => (
              <button key={p.id} type="button" className="btn btn-primary btn-xs" disabled={acao.rodando} onClick={() => ir("/api/billing/checkout", { plano: p.id })}>
                Assinar {p.nome} · até {limite(p.membros)} pessoas
              </button>
            ))
          )}
          {acao.erro && <span style={{ fontSize: ".8rem", color: "var(--red-text)" }}>✕ {acao.erro}</span>}
        </div>
      )}
      {dono && !estado.cobrancaLigada && d.estado !== "interna" && (
        <p style={{ margin: 0, fontSize: ".78rem", color: "var(--muted)" }}>A cobrança pelo app ainda não está ligada.</p>
      )}
    </div>
  );
}
