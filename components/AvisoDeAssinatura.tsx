"use client";

import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/api/authed-fetch";
import { avisoDaAssinatura, type EstadoParaAviso } from "@/lib/domain/texto-assinatura";

/**
 * Faixa no topo quando a assinatura da empresa pede atenção (S25): bloqueada
 * (somente leitura), cobrança falhando ou teste grátis acabando. Sem isto, a
 * primeira notícia do bloqueio seria um "sem permissão" ao salvar.
 * Só no modo empresa; no modo raiz a rota responde { modo: "raiz" } e nada aparece.
 */
export default function AvisoDeAssinatura() {
  // O relógio é lido quando a resposta chega, não a cada render (render puro).
  const [estado, setEstado] = useState<{ dados: EstadoParaAviso | null; agora: number } | null>(null);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_ZXP_MODO_DADOS !== "tenant") return;
    let vivo = true;
    authedFetch("/api/billing/estado", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo) setEstado({ dados: j as EstadoParaAviso | null, agora: Date.now() }); })
      .catch(() => { /* sem rede: sem faixa */ });
    return () => { vivo = false; };
  }, []);

  const aviso = estado ? avisoDaAssinatura(estado.dados, estado.agora) : null;
  if (!aviso) return null;
  const perigo = aviso.tom === "perigo";
  return (
    <div
      role="status"
      style={{
        marginBottom: 14, padding: "8px 14px", borderRadius: 8, fontSize: ".82rem",
        background: perigo ? "var(--red-bg)" : "var(--warning-soft)",
        border: `1px solid ${perigo ? "rgba(229,72,77,.35)" : "rgba(255,138,31,.35)"}`,
        color: perigo ? "var(--red-text)" : "var(--warning)",
      }}
    >
      {aviso.texto}
    </div>
  );
}
