"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * O que faz um diálogo ser modal de verdade — em UM lugar.
 *
 * O Modal fazia tudo isto; a Central de Notificações, o detalhe de pedido e o de
 * anúncio (todos "drawers") faziam um pedaço cada um: a Central tinha contenção de
 * Tab mas não isolava o fundo nem travava a rolagem, o de pedido só fechava com
 * Escape, o de anúncio nem papel de diálogo tinha. Agora os quatro usam isto.
 *
 * O que o hook garante enquanto `open`:
 *
 *  · PILHA — só o diálogo do TOPO responde a Escape e Tab. Com um formulário aberto
 *    por cima de um drawer, o mesmo Escape fechava os dois.
 *  · FOCO — ao abrir, vai pro primeiro controle (ou pro próprio diálogo); ao fechar,
 *    volta pra quem tinha o foco antes.
 *  · TAB PRESO — não escapa pra página coberta.
 *  · FUNDO INERTE — `inert` nos irmãos do portal: o overlay só cobre, mas leitor de
 *    tela e teclado atravessam o que é apenas coberto.
 *  · ROLAGEM — o fundo não rola atrás (no celular o dedo arrastava a página).
 *  · `data-modal-aberto` no <body> — pra quem precisa se recolher (os toasts).
 *
 * O diálogo precisa estar num PORTAL no <body> (ver Modal e Drawer): dentro de um
 * contêiner com `overflow` o iOS recorta e posiciona `position:fixed` errado.
 */

/** O que o teclado consegue alcançar dentro do diálogo. */
const FOCAVEIS = [
  "a[href]", "button:not([disabled])", "input:not([disabled])", "select:not([disabled])",
  "textarea:not([disabled])", "summary", '[tabindex]:not([tabindex="-1"])',
].join(",");

/** Os diálogos abertos, do mais antigo ao mais novo. */
const pilha: symbol[] = [];

function sinalizar() {
  if (typeof document === "undefined") return;
  if (pilha.length > 0) document.body.setAttribute("data-modal-aberto", "true");
  else document.body.removeAttribute("data-modal-aberto");
}

export function useDialogo(
  open: boolean,
  caixaRef: RefObject<HTMLElement | null>,
  aoEscape: () => void,
) {
  const id = useRef<symbol>(Symbol("dialogo"));
  // O Escape sempre chama a versão MAIS RECENTE do callback, sem reinstalar os ouvintes.
  const escapeRef = useRef(aoEscape);
  useEffect(() => { escapeRef.current = aoEscape; });

  // Entra na pilha ao abrir e sai ao fechar/desmontar.
  useEffect(() => {
    if (!open) return;
    const meu = id.current;
    pilha.push(meu);
    sinalizar();
    return () => {
      const i = pilha.indexOf(meu);
      if (i >= 0) pilha.splice(i, 1);
      sinalizar();
    };
  }, [open]);

  // Escape e contenção do Tab. Ouvinte global: o foco costuma continuar no botão que
  // abriu (fora do diálogo), e um ouvinte local nunca receberia o Escape.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (pilha[pilha.length - 1] !== id.current) return;
      if (e.key === "Escape") { escapeRef.current(); return; }
      if (e.key !== "Tab") return;

      const caixa = caixaRef.current;
      if (!caixa) return;
      const alvos = Array.from(caixa.querySelectorAll<HTMLElement>(FOCAVEIS))
        .filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (alvos.length === 0) { e.preventDefault(); return; }

      const primeiro = alvos[0];
      const ultimo = alvos[alvos.length - 1];
      const ativo = document.activeElement as HTMLElement | null;

      if (e.shiftKey && (ativo === primeiro || ativo === caixa || !caixa.contains(ativo))) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && ativo === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, caixaRef]);

  // Foco inicial ao abrir; devolução ao fechar.
  useEffect(() => {
    if (!open) return;
    const anterior = document.activeElement as HTMLElement | null;
    // Depois da pintura: o conteúdo do diálogo ainda não existe no mesmo tique.
    const raf = requestAnimationFrame(() => {
      const caixa = caixaRef.current;
      if (!caixa) return;
      (caixa.querySelector<HTMLElement>(FOCAVEIS) ?? caixa).focus();
    });
    return () => {
      cancelAnimationFrame(raf);
      // Só devolve se o elemento ainda existir na página.
      if (anterior && document.contains(anterior)) anterior.focus();
    };
  }, [open, caixaRef]);

  // Trava a rolagem do fundo.
  useEffect(() => {
    if (!open) return;
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = antes; };
  }, [open]);

  // Torna o fundo indisponível de verdade (teclado e leitor de tela), não só coberto.
  useEffect(() => {
    if (!open) return;
    const caixa = caixaRef.current;
    const irmaos = Array.from(document.body.children)
      .filter((el): el is HTMLElement => el instanceof HTMLElement && !el.contains(caixa));
    const tinham = irmaos.map((el) => el.hasAttribute("inert"));
    irmaos.forEach((el) => el.setAttribute("inert", ""));
    return () => { irmaos.forEach((el, i) => { if (!tinham[i]) el.removeAttribute("inert"); }); };
  }, [open, caixaRef]);
}
