"use client";

import { useState } from "react";

/** Quantas linhas uma lista longa desenha por vez. */
export const LINHAS_POR_PAGINA = 60;

/**
 * "Mostrar N, e o resto por 'Mostrar mais'" — paginação progressiva de uma lista.
 *
 * ─── POR QUE PAGINAR, E NÃO VIRTUALIZAR ───────────────────────────────────
 *
 * Com 500 produtos a aba de Estoque chegava a ~21 mil nós de DOM. Aqui se PROCURA um
 * produto e se VOLTA a ele: uma lista virtual perde o lugar, a busca do navegador não
 * acha o que não está desenhado e o leitor de tela não conta o total. Paginar mantém
 * o endereço ("60 de 500") e o Ctrl+F dentro do que está na tela.
 *
 * `chave` identifica a LISTA que está sendo vista (vista + busca + filtros): quando ela
 * muda, o limite volta ao começo. É derivado — o estado guarda a chave em que o limite
 * foi aumentado, e outra chave o invalida —, sem efeito que espelhe estado.
 */
export function usePaginacaoProgressiva(chave: string, tamanho = LINHAS_POR_PAGINA) {
  const [estado, setEstado] = useState({ chave: "", limite: tamanho });
  const limite = estado.chave === chave ? estado.limite : tamanho;
  return {
    limite,
    mostrarMais: () => setEstado({ chave, limite: limite + tamanho }),
    mostrarTudo: () => setEstado({ chave, limite: Number.MAX_SAFE_INTEGER }),
    tamanho,
  };
}
