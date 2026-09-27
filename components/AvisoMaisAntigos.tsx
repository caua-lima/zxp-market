"use client";

/**
 * O aviso de lista cortada, agora com saída (S22): antes dizia "pode haver
 * mais" e parava aí; agora carrega a próxima página. Some quando não há o que
 * mostrar; vira "carregado até o começo" quando a última página chegou.
 */
export default function AvisoMaisAntigos({
  total, rotulo, nota, temMais, carregando, erro, extras, onCarregar,
}: {
  /** Quantos itens a tela mostra agora. */
  total: number;
  /** "movimentações", "tarefas". */
  rotulo: string;
  nota?: string;
  temMais: boolean;
  carregando: boolean;
  erro: boolean;
  /** Quantos vieram de páginas extras — >0 com !temMais = chegou ao começo. */
  extras: number;
  onCarregar: () => void;
}) {
  if (!temMais && extras === 0) return null;
  return (
    <div
      role="status"
      style={{
        marginBottom: 12, padding: "8px 14px", borderRadius: 8, fontSize: ".8rem", color: "var(--text)",
        background: temMais ? "rgba(212,165,74,.12)" : "var(--surface2)",
        border: `1px solid ${temMais ? "var(--warning)" : "var(--border)"}`,
        display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10,
      }}
    >
      <span style={{ flex: "1 1 240px" }}>
        {temMais
          ? <>Mostrando as {total.toLocaleString("pt-BR")} {rotulo} mais recentes — há {rotulo} mais antigas.</>
          : <>Todas as {total.toLocaleString("pt-BR")} {rotulo} carregadas, até a mais antiga.</>}
        {nota ? <> {nota}</> : null}
        {erro && <span style={{ display: "block", color: "var(--red-text)" }}>Não consegui carregar agora — tente de novo.</span>}
      </span>
      {temMais && (
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCarregar} disabled={carregando} style={{ minHeight: 44 }}>
          {carregando ? "Carregando…" : "Carregar mais antigas"}
        </button>
      )}
    </div>
  );
}
