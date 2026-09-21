"use client";

import { useCallback, useEffect, useId, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useDialogo } from "@/components/useDialogo";

/**
 * O diálogo modal do app.
 *
 * A contenção (foco, Tab, fundo inerte, rolagem, pilha de diálogos) mora em
 * `useDialogo` e é a MESMA dos drawers (Drawer.tsx) — ver o porquê lá. Este
 * componente cuida do que é só dele: o portal, o nome acessível e a confirmação
 * de descarte.
 */
export default function Modal({
  open,
  onClose,
  children,
  wide,
  /**
   * Há edição não salva? Quando true, fechar por Escape ou por clique no fundo
   * pede confirmação.
   *
   * ─── POR QUE ISTO PRECISOU EXISTIR ────────────────────────────────────
   *
   * Clicar fora e Escape fechavam na hora, sempre. Num formulário de custo ou
   * de movimentação, meia dúzia de campos preenchidos sumiam com um clique
   * errado — e não havia como voltar, porque nada tinha sido gravado. Os
   * formulários passam `confirmarDescarte={sujo && !salvando}` (ver
   * `useFormularioSujo`): formulário intacto fecha direto.
   */
  confirmarDescarte,
  /** Rótulo do diálogo pra leitor de tela, quando não houver `.modal-title`. */
  titulo,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  confirmarDescarte?: boolean;
  titulo?: string;
}) {
  const caixaRef = useRef<HTMLDivElement | null>(null);
  const tituloId = useId();

  const fechar = useCallback(() => {
    if (confirmarDescarte && !confirm("Descartar as alterações não salvas?")) return;
    onClose();
  }, [confirmarDescarte, onClose]);

  useDialogo(open, caixaRef, fechar);

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

  /**
   * O nome do diálogo, quando o chamador não passou `titulo`.
   *
   * Antes o leitor de tela anunciava sempre "Diálogo": o `aria-labelledby`
   * apontava pra um <span hidden> com esse texto, e o título de verdade
   * (`.modal-title`, que quase todo modal deste app renderiza) ficava sem
   * ligação. Agora o diálogo passa a apontar pro próprio título visível — o
   * que se lê é o que se vê ("Editar custo", "Novo produto").
   *
   * Imperativo de propósito: o título é conteúdo dos filhos, que este
   * componente não controla. Sem título nenhum, "Diálogo" é melhor que nada.
   */
  useEffect(() => {
    if (!open || titulo) return;
    const caixa = caixaRef.current;
    if (!caixa) return;
    const t = caixa.querySelector<HTMLElement>(".modal-title, [data-modal-title]");
    if (t) {
      if (!t.id) t.id = tituloId;
      caixa.setAttribute("aria-labelledby", t.id);
      caixa.removeAttribute("aria-label");
    } else {
      caixa.removeAttribute("aria-labelledby");
      caixa.setAttribute("aria-label", "Diálogo");
    }
  });

  if (!open || !montado) return null;

  return createPortal(
    <div
      className="modal-overlay active"
      onClick={(e) => {
        if (e.target === e.currentTarget) fechar();
      }}
      role="presentation"
    >
      <div
        ref={caixaRef}
        className={`modal-box ${wide ? "modal-box-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        {...(titulo ? { "aria-label": titulo } : {})}
        // Foco inicial cai aqui quando o diálogo não tem nada focável dentro.
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
