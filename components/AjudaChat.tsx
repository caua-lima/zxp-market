"use client";

import { useRef, useState } from "react";
import { buscarTopicos, relacionadosDe, sugestoesPara, type Topico } from "@/lib/domain/ajuda";
import ChatFlutuante from "@/components/ChatFlutuante";

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

  return (
    <ChatFlutuante
      titulo="Dúvidas"
      subtitulo="como usar o sistema"
      rotuloBotao="Abrir ajuda"
      icone="?"
      aberto={aberto}
      onAberto={setAberto}
      corpo={<>
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

                {/* O próximo passo. Quem pergunta como informar o custo da
                    coleta quase sempre pergunta depois por que o resultado
                    está otimista — é a mesma dúvida em dois momentos. */}
                {relacionadosDe(t).length > 0 && (
                  <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {relacionadosDe(t).map((r) => (
                      <button
                        key={r.id} type="button" className="btn btn-ghost btn-xs"
                        style={{ fontSize: ".68rem", whiteSpace: "normal", textAlign: "left", lineHeight: 1.35 }}
                        onClick={() => perguntar(r.pergunta)}
                      >
                        {r.pergunta}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
        <div ref={fimRef} />
      </>}
      rodape={
        <form
          onSubmit={(e) => { e.preventDefault(); perguntar(texto); }}
          style={{ display: "flex", gap: 6 }}
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
      }
    />
  );
}
