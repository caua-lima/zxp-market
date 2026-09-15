'use client'

import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/api/authed-fetch";
import { iniciarVinculoML } from "@/lib/ml/iniciar-vinculo";

type MlStatus = {
  connected: boolean;
  user_id: string | null;
};

/** @param aviso motivo de uma volta recusada do ML, lido por MlAccountStatus. */
export function MLConnectButton({ aviso }: { aviso?: string | null } = {}) {
  const [status, setStatus] = useState<MlStatus>({ connected: false, user_id: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(aviso ?? null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    async function loadStatus() {
      try {
        // Verifica se o usuário desconectou intencionalmente
        const isDisconnected = localStorage.getItem('ml_disconnected');
        if (isDisconnected === 'true') {
          setStatus({ connected: false, user_id: null });
          setLoading(false);
          return;
        }

        const res = await authedFetch("/api/ml/status", { cache: "no-store" });
        if (!res.ok) {
          const json = await res.json();
          throw new Error(json?.error || "Não foi possível verificar a conexão ML");
        }

        const json = await res.json();
        if (json.connected) {
          // Se conectado, limpa o flag de desconectado
          localStorage.removeItem('ml_disconnected');
          setStatus({ connected: Boolean(json.connected), user_id: json.user_id ?? null });
        } else {
          setStatus({ connected: false, user_id: null });
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus({ connected: false, user_id: null });
      } finally {
        setLoading(false);
      }
    }

    loadStatus();
  }, []);

  async function handleConnect() {
    setConnecting(true);
    // O pedido e autenticado: o servidor confere que quem clica administra o
    // app antes de abrir a transacao OAuth.
    const erro = await iniciarVinculoML();
    if (erro) {
      setError(erro);
      setConnecting(false);
    }
  }

  if (loading) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 12px",
          borderRadius: 8,
          background: "var(--surface2)",
          border: "1px solid var(--border)",
          color: "var(--muted)",
          fontSize: ".82rem",
        }}
      >
        ⏳ Verificando ML...
      </span>
    );
  }

  if (status.connected) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 12px",
          borderRadius: 8,
          background: "var(--green)",
          color: "#fff",
          fontWeight: 600,
          fontSize: ".82rem",
        }}
      >
        ✅ ML conectado
      </span>
    );
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
    <button
      type="button"
      onClick={handleConnect}
      disabled={connecting}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: connecting ? "var(--surface2)" : "var(--brand)",
        color: connecting ? "var(--muted)" : "#10100E",
        fontWeight: 700,
        fontSize: ".82rem",
        padding: "5px 12px",
        borderRadius: 8,
        border: connecting ? "1px solid var(--border)" : "none",
        whiteSpace: "nowrap",
        cursor: connecting ? 'not-allowed' : 'pointer',
        opacity: connecting ? 0.6 : 1,
      }}
    >
      {connecting ? '⏳ Conectando...' : '🛒 Conectar ML'}
    </button>
    {error && (
      <span style={{ color: "var(--red)", fontSize: ".75rem", maxWidth: 220 }}>{error}</span>
    )}
    </span>
  );
}
