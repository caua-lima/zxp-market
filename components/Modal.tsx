"use client";

import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

export default function Modal({
  open,
  onClose,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  // Listener global, não local: preso ao onKeyDown do overlay, o Escape só
  // funcionava se o foco já estivesse DENTRO do modal — mas ao abrir por
  // clique, o foco costuma continuar no botão que abriu (fora do modal), e
  // Escape não fazia nada. Mesmo padrão do CommandPalette/DateRangePicker.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  /**
   * Trava o scroll do fundo enquanto o modal está aberto.
   *
   * Sem isso, no celular o dedo arrasta a PÁGINA atrás do modal em vez do
   * conteúdo dele — e o modal parece travado, mesmo funcionando.
   */
  useEffect(() => {
    if (!open) return;
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = antes; };
  }, [open]);

  /**
   * ─── POR QUE PORTAL, E NÃO RENDER NO LUGAR ──────────────────────────────
   *
   * Renderizado onde é chamado, o modal herda o contexto de recorte dos pais.
   * O botão de notificações vive dentro de `.topbar-actions`, que no mobile
   * recebe `overflow-x:auto` + `-webkit-overflow-scrolling:touch`
   * (app/globals.css) pra a barra rolar lateralmente.
   *
   * Essa combinação QUEBRA `position:fixed` de qualquer descendente no Safari
   * do iOS: o elemento passa a ser posicionado e recortado pelo contêiner que
   * rola, não pela viewport. Resultado relatado num iPhone 13 — o menu de
   * notificações simplesmente não abria, sem erro no console, porque ele
   * abria fora da área visível do contêiner.
   *
   * `createPortal` pro `document.body` tira o modal de qualquer ancestral com
   * overflow ou transform. Vale pra TODOS os modais do app de uma vez, não só
   * o de notificações.
   *
   * `montado` existe porque `document` não existe no servidor: renderizar o
   * portal direto quebraria o SSR.
   */
  const montado = useSyncExternalStore(
    // Nunca muda depois da hidratação, então o subscribe é um no-op.
    () => () => {},
    () => true,   // no cliente
    () => false,  // no servidor
  );

  if (!open || !montado) return null;

  return createPortal(
    <div
      className="modal-overlay active"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div className={`modal-box ${wide ? "modal-box-wide" : ""}`} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>,
    document.body,
  );
}
