"use client";

import { useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useDialogo } from "@/components/useDialogo";

/**
 * O painel lateral (drawer) do app — a Central de Notificações, o detalhe de um
 * pedido, o detalhe de um anúncio.
 *
 * Cada um tinha o seu: `role="dialog"` escrito à mão, contenção de foco pela
 * metade (ou nenhuma), fundo ainda navegável por Tab e por leitor de tela, e
 * renderizado dentro do próprio componente — onde um contêiner com `overflow` (a
 * barra do topo, no celular) faz o iOS recortar o `position:fixed`. Aqui tudo isso
 * vem do mesmo lugar que o Modal (`useDialogo`), e o painel vai pro <body> por
 * portal.
 *
 * O CONTEÚDO (cabeçalho, botão de fechar, corpo) continua sendo de quem usa — cada
 * drawer tem o seu. O que este componente exige é o `titulo`: é o nome que o leitor
 * de tela anuncia ("Detalhe do pedido 123", "Central de notificações").
 */
export default function Drawer({
  open, onClose, titulo, children, className = "drawer-panel", painelStyle,
}: {
  open: boolean;
  onClose: () => void;
  /** O nome do diálogo pra leitor de tela. */
  titulo: string;
  children: React.ReactNode;
  className?: string;
  painelStyle?: React.CSSProperties;
}) {
  const painelRef = useRef<HTMLDivElement | null>(null);
  useDialogo(open, painelRef, onClose);

  const montado = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!open || !montado) return null;

  return createPortal(
    <div className="drawer-overlay" onClick={onClose} role="presentation">
      <div
        ref={painelRef}
        className={className}
        style={painelStyle}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
