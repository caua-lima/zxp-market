"use client";

import { useEffect, useRef, useState } from "react";
import { buscarTopicos, sugestoesPara, type Topico } from "@/lib/domain/ajuda";

/**
 * Chat de dúvidas sobre o sistema — flutuante, disponível em toda tela.
 *
 * ─── POR QUE SEPARADO DO CONSULTOR DE ADS ───────────────────────────────
 *
 * O consultor de Ads (aba Ads) responde sobre os SEUS NÚMEROS e vive dentro
 * da aba, junto da tabela que ele comenta. Este aqui responde sobre COMO O
 * APP FUNCIONA — a resposta é a mesma todo dia e a dúvida aparece em
 * qualquer tela, então ele acompanha o usuário em vez de morar num lugar.
 *
 * O raciocínio completo está em lib/domain/ajuda.ts.
 *
 * ─── POR QUE FICA ESCONDIDO ATÉ SER CHAMADO ─────────────────────────────
 *
 * Um botão pequeno no canto. Ajuda que ocupa espaço permanente vira ruído
 * pra quem já sabe usar — e quem já sabe é a maioria do tempo, inclusive
 * pra quem não sabia ontem.
 */

type Msg = { de: "voce" | "ajuda"; texto: string; topicos?: Topico[] };

export default function AjudaChat({ abaAtual }: { abaAtual?: string }) {
  const [aberto, setAberto] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [texto, setTexto] = useState("");
  const fimRef = useRef<HTMLDivElement>(null);

  // Esc fecha — é o que se espera de qualquer sobreposição.
  useEffect(() => {
    if (!aberto) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setAberto(false); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [aberto]);

  function perguntar(pergunta: string) {
    const q = pergunta.trim();
    if (!q) return;
    const achados = buscarTopicos(q, abaAtual);
    const resposta: Msg = achados.length > 0
      ? {
        de: "ajuda",
        texto: achados.length === 1 ? "" : "Achei estas respostas:",
        topicos: achados,
      }
      : {
        de: "ajuda",
        // Admite não saber em vez de inventar um caminho que não existe.
        texto:
          "Não tenho resposta pronta pra isso. Tente com outras palavras, ou use uma das sugestões — "
          + "só sei responder sobre como usar o sistema.",
      };
    setMsgs((m) => [...m, { de: "voce", texto: q }, resposta]);
    setTexto("");
    requestAnimationFrame(() => fimRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
  }

  const sugestoes = sugestoesPara(abaAtual);

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        aria-label="Abrir ajuda"
        title="Dúvidas sobre o sistema"
        style={{
          position: "fixed", right: 18, bottom: 18, zIndex: 60,
          width: 48, height: 48, borderRadius: "50%",
          background: "var(--brand)", color: "#10100E",
          border: "none", cursor: "pointer", fontSize: "1.2rem", fontWeight: 700,
          boxShadow: "0 4px 14px rgba(0,0,0,.35)",
          // Respeita o notch/barra inferior do iPhone.
          marginBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        ?
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Ajuda"
      style={{
        position: "fixed", right: 18, bottom: 18, zIndex: 60,
        width: "min(380px, calc(100vw - 36px))",
        maxHeight: "min(560px, calc(100vh - 36px))",
        display: "flex", flexDirection: "column",
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 14, boxShadow: "0 10px 34px rgba(0,0,0,.45)",
        marginBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "11px 14px", borderBottom: "1px solid var(--border)",
      }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: ".88rem", color: "var(--text)" }}>Dúvidas</div>
          <div style={{ fontSize: ".7rem", color: "var(--muted)" }}>como usar o sistema</div>
        </div>
        <button
          type="button" onClick={() => setAberto(false)} aria-label="Fechar ajuda"
          style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: "1.1rem", lineHeight: 1 }}
        >
          ✕
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        {msgs.length === 0 && (
          <>
            <div style={{ fontSize: ".82rem", color: "var(--text)", lineHeight: 1.5 }}>
              Pergunte o que quiser sobre o sistema. Por exemplo:
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {sugestoes.map((t) => (
                <button
                  key={t.id} type="button" className="btn btn-ghost btn-xs"
                  style={{ textAlign: "left", justifyContent: "flex-start", whiteSpace: "normal", lineHeight: 1.4 }}
                  onClick={() => perguntar(t.pergunta)}
                >
                  {t.pergunta}
                </button>
              ))}
            </div>
          </>
        )}

        {msgs.map((m, i) => (
          <div key={i} style={{ alignSelf: m.de === "voce" ? "flex-end" : "flex-start", maxWidth: m.de === "voce" ? "85%" : "100%" }}>
            {m.texto && (
              <div style={{
                padding: "8px 11px", borderRadius: 11, fontSize: ".82rem", lineHeight: 1.5,
                background: m.de === "voce" ? "var(--brand)" : "var(--surface2)",
                color: m.de === "voce" ? "#10100E" : "var(--text)",
                fontWeight: m.de === "voce" ? 600 : 400,
              }}>
                {m.texto}
              </div>
            )}
            {m.topicos?.map((t) => (
              <div
                key={t.id}
                style={{
                  marginTop: 6, padding: "10px 12px", borderRadius: 10,
                  background: "var(--surface2)", borderLeft: "3px solid var(--brand)",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: ".8rem", color: "var(--text)", marginBottom: 5 }}>
                  {t.pergunta}
                </div>
                {/* whiteSpace preserva os passos numerados da resposta. */}
                <div style={{ fontSize: ".8rem", lineHeight: 1.6, color: "var(--muted)", whiteSpace: "pre-line" }}>
                  {t.resposta}
                </div>
              </div>
            ))}
          </div>
        ))}
        <div ref={fimRef} />
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); perguntar(texto); }}
        style={{ display: "flex", gap: 6, padding: 12, borderTop: "1px solid var(--border)" }}
      >
        <input
          className="inp"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Ex: como altero o custo de entrada?"
          aria-label="Sua dúvida"
          style={{ fontSize: 16 }}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={!texto.trim()}>
          Enviar
        </button>
      </form>
    </div>
  );
}
