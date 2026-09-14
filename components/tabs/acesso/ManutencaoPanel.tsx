"use client";

import { useState } from "react";
import { authedFetch } from "@/lib/api/authed-fetch";
import { useAccess } from "@/components/tabs/AccessGuard";

/**
 * As rotinas de manutenção que precisam rodar UMA vez, depois de um deploy.
 *
 * ─── POR QUE UM BOTÃO, E NÃO UM COMANDO ─────────────────────────────────
 *
 * A alternativa era o dono abrir o terminal e mandar um POST com um ID token
 * do Firebase no cabeçalho — o que exige extrair o token do navegador na mão.
 * É o tipo de instrução que ninguém segue, e a rotina simplesmente não roda.
 *
 * Aqui a sessão já está autenticada: o `authedFetch` anexa o token sozinho e
 * a rota confere a capacidade `administrar` do outro lado, igual a qualquer
 * outra chamada do app.
 */

type Estado = { tipo: "parado" } | { tipo: "rodando" } | { tipo: "fim"; texto: string; erro: boolean };

export default function ManutencaoPanel() {
  const { papel } = useAccess();
  const [espelho, setEspelho] = useState<Estado>({ tipo: "parado" });

  // Só quem administra vê. A rota barra de qualquer jeito; isto é a UX.
  if (papel !== "owner") return null;

  async function espelharAvisos() {
    setEspelho({ tipo: "rodando" });
    try {
      const res = await authedFetch("/api/notificacoes/espelhar", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEspelho({ tipo: "fim", erro: true, texto: json?.details || json?.error || `Falhou (${res.status})` });
        return;
      }
      setEspelho({
        tipo: "fim",
        erro: false,
        texto: json.criados === 0
          ? `Nada a fazer — os ${json.jaExistiam} avisos já tinham espelho.`
          : `${json.criados} avisos espelhados (${json.jaExistiam} já tinham).`,
      });
    } catch {
      setEspelho({ tipo: "fim", erro: true, texto: "Falha de rede." });
    }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3 style={{ margin: "0 0 4px", fontSize: ".95rem" }}>Manutenção</h3>
      <p style={{ margin: "0 0 12px", fontSize: ".78rem", color: "var(--muted)" }}>
        Rotinas que rodam uma vez, sob demanda. Nenhuma apaga nada.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <button
          type="button"
          onClick={espelharAvisos}
          disabled={espelho.tipo === "rodando"}
          style={{
            background: espelho.tipo === "rodando" ? "var(--surface2)" : "var(--brand)",
            color: espelho.tipo === "rodando" ? "var(--muted)" : "#10100E",
            border: "none", borderRadius: 8, padding: "7px 14px",
            fontWeight: 700, fontSize: ".8rem",
            cursor: espelho.tipo === "rodando" ? "not-allowed" : "pointer",
          }}
        >
          {espelho.tipo === "rodando" ? "Espelhando..." : "Espelhar avisos antigos"}
        </button>

        {espelho.tipo === "fim" && (
          <span style={{ fontSize: ".78rem", color: espelho.erro ? "var(--red)" : "var(--green)" }}>
            {espelho.erro ? "✕" : "✓"} {espelho.texto}
          </span>
        )}
      </div>

      <p style={{ margin: "8px 0 0", fontSize: ".72rem", color: "var(--muted)", maxWidth: 620 }}>
        {/*
          As regras do Firestore são por DOCUMENTO: não dá pra liberar um aviso
          e esconder lucro e margem dentro dele. Por isso cada aviso novo passa
          a ser gravado também numa versão sem dinheiro, que é a única que quem
          não vê financeiro alcança. O histórico nasceu antes disso — sem esta
          rotina, essas pessoas abrem a Central vazia até chegar um aviso novo.
        */}
        Cria a versão sem dados financeiros dos avisos já existentes, para quem
        não pode ver custo e margem. Só cria o que falta.
      </p>
    </div>
  );
}
