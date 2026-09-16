"use client";

import { janelaDePaginas, rotuloDaPagina, type Pagina } from "@/lib/domain/paginacao";

/**
 * Os controles de página.
 *
 * ─── O QUE ELE FAZ QUE UM PAR DE SETAS NÃO FAZ ──────────────────────────
 *
 * Diz ONDE se está e QUANTO falta: "21–30 de 412". A pergunta que se faz
 * olhando pra uma lista longa não é "que página é esta", é "já vi quanto
 * disso" — e só o intervalo responde.
 *
 * `nav` com `aria-label` porque é navegação de verdade: quem usa leitor de
 * tela pula pra ela pelo atalho de regiões em vez de tabular a lista inteira
 * até o fim.
 */
export default function Paginacao<T>({ pagina, onIr, unidade = "item" }: {
  pagina: Pagina<T>;
  onIr: (n: number) => void;
  unidade?: string;
}) {
  // Uma página só não precisa de controle nenhum — e um controle inerte é
  // pior que nenhum: parece que há mais coisa e não há.
  if (pagina.total <= 1) {
    return pagina.itensNoTotal > 0 ? (
      <div className="paginacao-resumo">{rotuloDaPagina(pagina, unidade)}</div>
    ) : null;
  }

  return (
    <nav className="paginacao" aria-label={`Navegação entre páginas de ${unidade}s`}>
      <div className="paginacao-resumo" aria-live="polite">
        {rotuloDaPagina(pagina, unidade)}
      </div>

      <div className="paginacao-botoes">
        <button
          type="button" className="btn btn-ghost btn-xs"
          onClick={() => onIr(pagina.atual - 1)}
          disabled={!pagina.temAnterior}
          aria-label="Página anterior"
        >
          ‹ Anterior
        </button>

        {janelaDePaginas(pagina.atual, pagina.total).map((n, i) => (
          n === null ? (
            // `aria-hidden` porque "…" não é informação pra quem ouve — o
            // resumo acima já diz de quantas páginas se trata.
            <span key={`corte-${i}`} className="paginacao-corte" aria-hidden="true">…</span>
          ) : (
            <button
              key={n}
              type="button"
              className={`btn btn-xs ${n === pagina.atual ? "btn-primary" : "btn-ghost"}`}
              onClick={() => onIr(n)}
              // `aria-current` é o que faz o leitor de tela anunciar "página
              // atual". Só a cor do botão não tem equivalente sonoro.
              aria-current={n === pagina.atual ? "page" : undefined}
              aria-label={`Página ${n}`}
            >
              {n}
            </button>
          )
        ))}

        <button
          type="button" className="btn btn-ghost btn-xs"
          onClick={() => onIr(pagina.atual + 1)}
          disabled={!pagina.temProxima}
          aria-label="Próxima página"
        >
          Próxima ›
        </button>
      </div>
    </nav>
  );
}
