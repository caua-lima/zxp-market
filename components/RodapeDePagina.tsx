"use client";

/**
 * O rodapé de uma lista paginada: "Mostrando 60 de 500" e como ver mais.
 * Some quando tudo já está na tela. Ver `usePaginacaoProgressiva`.
 */
export default function RodapeDePagina({ limite, total, tamanho, aoMostrarMais, aoMostrarTudo, rotulo = "itens" }: {
  limite: number;
  total: number;
  tamanho: number;
  aoMostrarMais: () => void;
  aoMostrarTudo: () => void;
  /** O que a lista lista, no plural: "produtos", "linhas". */
  rotulo?: string;
}) {
  if (total <= limite) return null;
  return (
    <div style={{ padding: "12px 4px 4px", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "center" }}>
      <span role="status" style={{ fontSize: ".82rem", color: "var(--muted)" }}>
        Mostrando <b>{limite}</b> de <b>{total}</b> {rotulo}
      </span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={aoMostrarMais}>
        Mostrar mais {Math.min(tamanho, total - limite)}
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={aoMostrarTudo}>Mostrar todos</button>
    </div>
  );
}
