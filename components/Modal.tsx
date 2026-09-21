"use client";

import { useCallback, useEffect, useId, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

/**
 * A pilha de modais abertos, do mais antigo ao mais novo.
 *
 * O Escape e o Tab são ouvidos no `document`, e cada modal aberto registra o
 * seu ouvinte. Com um modal aberto por cima de outro (o formulário de custo e,
 * por cima, uma confirmação), o mesmo Escape fechava OS DOIS, e o Tab era
 * disputado por duas contenções de foco. Só o do topo responde.
 */
const pilhaDeModais: symbol[] = [];

/**
 * Diz ao resto da página que há um diálogo aberto: `data-modal-aberto` no <body>.
 * Quem não pode cobrir um formulário (os toasts de venda) escuta isso e se
 * recolhe — ver SaleNotificationProvider. Um atributo, e não um contexto React,
 * porque quem escuta vive fora da árvore do Modal.
 */
function sinalizarModalAberto() {
  if (typeof document === "undefined") return;
  if (pilhaDeModais.length > 0) document.body.setAttribute("data-modal-aberto", "true");
  else document.body.removeAttribute("data-modal-aberto");
}

/** O que o teclado consegue alcançar dentro do diálogo. */
const FOCAVEIS = [
  "a[href]", "button:not([disabled])", "input:not([disabled])",
  "select:not([disabled])", "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

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
   * errado — e não havia como voltar, porque nada tinha sido gravado.
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
  /** A identidade deste modal na pilha. */
  const meuId = useRef<symbol>(Symbol("modal"));
  /** Quem tinha o foco antes de abrir — é pra cá que ele volta. */
  const focoAnterior = useRef<HTMLElement | null>(null);
  const tituloId = useId();

  const fechar = useCallback(() => {
    if (confirmarDescarte && !confirm("Descartar as alterações não salvas?")) return;
    onClose();
  }, [confirmarDescarte, onClose]);

  // Listener global, não local: preso ao onKeyDown do overlay, o Escape só
  // funcionava se o foco já estivesse DENTRO do modal — mas ao abrir por
  // clique, o foco costuma continuar no botão que abriu (fora do modal), e
  // Escape não fazia nada. Mesmo padrão do CommandPalette/DateRangePicker.
  // Entra na pilha ao abrir e sai ao fechar/desmontar.
  useEffect(() => {
    if (!open) return;
    const id = meuId.current;
    pilhaDeModais.push(id);
    sinalizarModalAberto();
    return () => {
      const i = pilhaDeModais.indexOf(id);
      if (i >= 0) pilhaDeModais.splice(i, 1);
      sinalizarModalAberto();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      // Só o modal do topo da pilha responde: os de baixo estão inertes.
      if (pilhaDeModais[pilhaDeModais.length - 1] !== meuId.current) return;
      if (e.key === "Escape") { fechar(); return; }

      /**
       * Contenção do foco.
       *
       * Sem isto, Tab sai do diálogo e passeia pela página ATRÁS dele — que
       * está visualmente coberta. Quem navega por teclado perde a referência
       * de onde está, e quem usa leitor de tela é levado a ler conteúdo que
       * não deveria estar disponível.
       */
      if (e.key !== "Tab") return;
      const caixa = caixaRef.current;
      if (!caixa) return;

      const alvos = Array.from(caixa.querySelectorAll<HTMLElement>(FOCAVEIS))
        .filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (alvos.length === 0) { e.preventDefault(); return; }

      const primeiro = alvos[0];
      const ultimo = alvos[alvos.length - 1];
      const ativo = document.activeElement as HTMLElement | null;

      if (e.shiftKey && (ativo === primeiro || !caixa.contains(ativo))) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && ativo === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, fechar]);

  /**
   * Foco inicial ao abrir, e devolução ao fechar.
   *
   * Abrir sem mover o foco deixa quem navega por teclado preso no botão que
   * abriu, tendo que tabular a página inteira pra chegar no diálogo. E fechar
   * sem devolver joga o foco pro começo do documento — a pessoa perde o lugar
   * onde estava.
   */
  useEffect(() => {
    if (!open) return;
    focoAnterior.current = document.activeElement as HTMLElement | null;

    // Depois da pintura: o conteúdo do diálogo ainda não existe no mesmo tique.
    const id = requestAnimationFrame(() => {
      const caixa = caixaRef.current;
      if (!caixa) return;
      const primeiro = caixa.querySelector<HTMLElement>(FOCAVEIS);
      (primeiro ?? caixa).focus();
    });

    return () => {
      cancelAnimationFrame(id);
      // Só devolve se o elemento ainda existir na página.
      const volta = focoAnterior.current;
      if (volta && document.contains(volta)) volta.focus();
    };
  }, [open]);

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
   * Torna o fundo indisponível de verdade, não só visualmente.
   *
   * O overlay cobre a página, mas leitor de tela e navegação por teclado
   * atravessam o que é apenas coberto. `inert` remove os irmãos do portal da
   * árvore de acessibilidade E do foco — é a única forma de o diálogo ser
   * realmente modal pra quem não enxerga o overlay.
   */
  useEffect(() => {
    if (!open) return;
    const irmaos = Array.from(document.body.children)
      .filter((el): el is HTMLElement => el instanceof HTMLElement && !el.contains(caixaRef.current));

    const antes = irmaos.map((el) => el.hasAttribute("inert"));
    irmaos.forEach((el) => el.setAttribute("inert", ""));

    return () => {
      irmaos.forEach((el, i) => { if (!antes[i]) el.removeAttribute("inert"); });
    };
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
        /**
         * Sem nome, o leitor de tela anuncia só "diálogo" — e a pessoa não
         * sabe o que abriu. Prefere o `titulo` explícito; senão, aponta pro
         * `.modal-title` que quase todo modal deste app já renderiza.
         */
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
