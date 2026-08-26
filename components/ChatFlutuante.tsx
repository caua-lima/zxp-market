"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * A casca dos chats flutuantes — botão no canto que abre um painel.
 *
 * Existe porque o Consultor de Ads e o chat de Dúvidas precisam do MESMO
 * comportamento de janela (posição, área segura do iPhone, Esc pra fechar,
 * largura que não estoura em tela pequena) e de conteúdos completamente
 * diferentes. Sem isto seriam duas cópias da parte chata, e a segunda
 * divergiria da primeira na primeira correção.
 *
 * Só cuida da JANELA. O que aparece dentro é problema de quem usa.
 */
export default function ChatFlutuante({
  titulo, subtitulo, rotuloBotao, icone, corpo, rodape, aberto, onAberto,
}: {
  titulo: string;
  subtitulo: string;
  /** Texto acessível do botão fechado. */
  rotuloBotao: string;
  /** Símbolo do botão fechado — curto, cabe num círculo de 48px. */
  icone: string;
  corpo: ReactNode;
  rodape: ReactNode;
  /** Controle externo opcional; sem ele o componente cuida do próprio estado. */
  aberto?: boolean;
  onAberto?: (v: boolean) => void;
}) {
  const [internoAberto, setInternoAberto] = useState(false);
  const estaAberto = aberto ?? internoAberto;
  const definir = (v: boolean) => (onAberto ? onAberto(v) : setInternoAberto(v));

  // Esc fecha — é o que se espera de qualquer sobreposição.
  useEffect(() => {
    if (!estaAberto) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") definir(false); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  if (!estaAberto) {
    return (
      <button
        type="button"
        onClick={() => definir(true)}
        aria-label={rotuloBotao}
        title={rotuloBotao}
        style={{
          position: "fixed", right: 18, bottom: 18, zIndex: 60,
          width: 52, height: 52, borderRadius: "50%",
          background: "var(--brand)", color: "#10100E",
          border: "none", cursor: "pointer", fontSize: "1.25rem", fontWeight: 700,
          boxShadow: "0 4px 16px rgba(0,0,0,.4)",
          // Respeita a barra inferior do iPhone.
          marginBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        {icone}
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label={titulo}
      style={{
        position: "fixed", right: 18, bottom: 18, zIndex: 60,
        // Nunca mais largo que a tela menos as margens — medido no iPhone.
        width: "min(420px, calc(100vw - 36px))",
        maxHeight: "min(600px, calc(100vh - 36px))",
        display: "flex", flexDirection: "column",
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 14, boxShadow: "0 10px 34px rgba(0,0,0,.45)",
        marginBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 10, padding: "11px 14px", borderBottom: "1px solid var(--border)",
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: ".88rem", color: "var(--text)" }}>{titulo}</div>
          <div style={{ fontSize: ".7rem", color: "var(--muted)" }}>{subtitulo}</div>
        </div>
        <button
          type="button" onClick={() => definir(false)} aria-label="Fechar"
          style={{
            background: "none", border: "none", color: "var(--muted)",
            cursor: "pointer", fontSize: "1.1rem", lineHeight: 1, flexShrink: 0,
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        {corpo}
      </div>

      <div style={{ padding: 12, borderTop: "1px solid var(--border)" }}>
        {rodape}
      </div>
    </div>
  );
}
