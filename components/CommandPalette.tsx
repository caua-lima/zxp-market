"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useDialogo } from "@/components/useDialogo";
import { filtrarComandos } from "@/lib/domain/busca-rapida";

export type CommandItem = { id: string; label: string; icon?: React.ReactNode };

/**
 * Busca rápida (Ctrl/Cmd+K) pra pular direto pra uma aba sem clicar na
 * sidebar. Overlay global — abre/fecha por teclado de qualquer lugar do app.
 *
 * Sem prop `open`: quem chama só monta este componente quando a busca está
 * aberta (`{paletteOpen && <CommandPalette ... />}`) — assim query/activeIdx
 * já nascem zerados a cada abertura, sem precisar de um efeito só pra
 * resetar estado.
 *
 * ─── O QUE MUDOU ──────────────────────────────────────────────────────
 *
 * Era um overlay solto: o foco escapava pra página coberta por Tab, o fundo
 * continuava navegável por leitor de tela, o foco não voltava pro lugar de onde
 * a pessoa veio, e o Enter era ouvido no `document` (com outro diálogo por
 * cima, ele escolhia um atalho por trás). Agora é um diálogo como os outros
 * (`useDialogo`: portal, foco preso e devolvido, fundo inerte, só o do topo
 * responde), o combobox anuncia o número de resultados, e a busca ignora acento
 * — quem digita "precificacao" acha "Precificação".
 */
export default function CommandPalette({
  onClose,
  items,
  onSelect,
}: {
  onClose: () => void;
  items: CommandItem[];
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const painelRef = useRef<HTMLDivElement | null>(null);
  const listaRef = useRef<HTMLUListElement | null>(null);
  const uid = useId();
  const listaId = `${uid}-lista`;
  const opcaoId = (id: string) => `${uid}-opt-${id}`;

  const filtered = filtrarComandos(items, query);
  // O índice pode ter ficado além do fim quando a lista encolheu.
  const ativo = Math.min(activeIdx, Math.max(0, filtered.length - 1));

  useDialogo(true, painelRef, onClose);

  // A opção ativa acompanha o teclado: sem rolar, ela sumia para além da borda da lista.
  useEffect(() => {
    listaRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [ativo, query]);

  const montado = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!montado) return null;

  function aoTeclar(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx(Math.min(ativo + 1, filtered.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx(Math.max(ativo - 1, 0)); return; }
    if (e.key === "Home" && filtered.length) { e.preventDefault(); setActiveIdx(0); return; }
    if (e.key === "End" && filtered.length) { e.preventDefault(); setActiveIdx(filtered.length - 1); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const chosen = filtered[ativo];
      if (chosen) { onSelect(chosen.id); onClose(); }
    }
  }

  return createPortal(
    <div className="cmdk-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={painelRef} className="cmdk-panel" role="dialog" aria-modal="true" aria-label="Busca rápida" tabIndex={-1} onKeyDown={aoTeclar}>
        <input
          type="text"
          className="search-inp cmdk-input"
          placeholder="Ir para… (ex: pedidos, custos, dre)"
          aria-label="Ir para uma tela"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
          role="combobox"
          aria-expanded={filtered.length > 0}
          aria-controls={listaId}
          aria-autocomplete="list"
          aria-activedescendant={filtered[ativo] ? opcaoId(filtered[ativo].id) : undefined}
        />
        {/* Quantos resultados — dito quando muda; a lista sozinha não avisa quem não enxerga. */}
        <div className="sr-only" role="status" aria-live="polite">
          {filtered.length === 0 ? "Nada encontrado." : `${filtered.length} ${filtered.length === 1 ? "resultado" : "resultados"}.`}
        </div>
        <ul ref={listaRef} className="cmdk-list" role="listbox" id={listaId} aria-label="Telas">
          {filtered.length === 0 ? (
            <li className="cmdk-empty" role="presentation">Nada encontrado.</li>
          ) : (
            filtered.map((it, i) => (
              <li
                key={it.id}
                id={opcaoId(it.id)}
                role="option"
                aria-selected={i === ativo}
                className={`cmdk-item${i === ativo ? " is-active" : ""}`}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => { onSelect(it.id); onClose(); }}
              >
                {it.icon && <span className="cmdk-item-icon" aria-hidden="true">{it.icon}</span>}
                <span>{it.label}</span>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
