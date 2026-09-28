"use client";

import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/api/authed-fetch";
import { useAccess } from "@/components/tabs/AccessGuard";
import type { ItemDeSaude, Nivel } from "@/lib/domain/saude";

/**
 * Saúde da operação (Etapa 4): as rotinas desta empresa rodaram? a fila de
 * notificações anda? o ML está recusando chamadas? Só quem administra vê.
 */
const COR: Record<Nivel, string> = { ok: "var(--green)", atencao: "var(--warning)", falha: "var(--red-text)" };
const ICONE: Record<Nivel, string> = { ok: "✓", atencao: "!", falha: "✕" };

export default function SaudePanel() {
  const { papel } = useAccess();
  const [dados, setDados] = useState<{ geral: Nivel; itens: ItemDeSaude[] } | null>(null);

  useEffect(() => {
    if (papel !== "owner") return;
    let vivo = true;
    authedFetch("/api/saude", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo && j) setDados(j); })
      .catch(() => { /* sem rede: sem painel */ });
    return () => { vivo = false; };
  }, [papel]);

  if (papel !== "owner" || !dados) return null;
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3 style={{ margin: "0 0 10px", fontSize: ".95rem" }}>
        Saúde da operação <span style={{ color: COR[dados.geral] }}>{ICONE[dados.geral]}</span>
      </h3>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
        {dados.itens.map((i) => (
          <li key={i.id} style={{ display: "flex", gap: 8, fontSize: ".82rem" }}>
            <span aria-hidden="true" style={{ width: 16, color: COR[i.nivel], fontWeight: 700 }}>{ICONE[i.nivel]}</span>
            <span><b>{i.titulo}</b> — <span style={{ color: "var(--muted)" }}>{i.texto}</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}
