"use client";

import { useEffect } from "react";
import { ajusteDoViewport } from "@/lib/domain/viewport-teclado";

/**
 * Publica no <html> a área VISÍVEL quando o teclado virtual está cobrindo a página:
 *
 *   --vv-altura   altura da área visível          (ex.: 544px)
 *   --vv-topo     o quanto ela foi empurrada       (ex.: 0px)
 *   --vv-fundo    "auto" — solta o `bottom` dos overlays pra a altura mandar
 *   --teclado     altura do teclado                (ex.: 300px), pro que fica colado embaixo
 *
 * O CSS (globals.css) usa as variáveis COM fallback: sem elas — desktop, Android que já
 * redimensiona o layout, qualquer navegador sem `visualViewport` — nada muda. Ver
 * `lib/domain/viewport-teclado` pra decisão de quando agir e por quê.
 *
 * Não renderiza nada. O cleanup remove as variáveis: sem isso, sair da tela com o teclado
 * aberto deixaria os diálogos do próximo uso presos numa altura velha.
 */
const VARIAVEIS = ["--vv-altura", "--vv-topo", "--vv-fundo", "--teclado"] as const;

export default function ViewportVisivel() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const raiz = document.documentElement;

    const limpar = () => VARIAVEIS.forEach((v) => raiz.style.removeProperty(v));
    const atualizar = () => {
      const r = ajusteDoViewport({
        alturaDaJanela: window.innerHeight, alturaVisivel: vv.height, topoVisivel: vv.offsetTop, escala: vv.scale,
      });
      if (!r.ativo) { limpar(); return; }
      raiz.style.setProperty("--vv-altura", `${r.altura}px`);
      raiz.style.setProperty("--vv-topo", `${r.topo}px`);
      raiz.style.setProperty("--vv-fundo", "auto");
      raiz.style.setProperty("--teclado", `${r.teclado}px`);
    };

    atualizar();
    vv.addEventListener("resize", atualizar);
    vv.addEventListener("scroll", atualizar);
    return () => {
      vv.removeEventListener("resize", atualizar);
      vv.removeEventListener("scroll", atualizar);
      limpar();
    };
  }, []);

  return null;
}
