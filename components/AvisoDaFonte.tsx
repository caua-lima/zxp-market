"use client";

/**
 * O aviso compacto de uma fonte de dados que não está em ordem.
 *
 * Cinco estados que a tela precisa distinguir, e que "sumir o painel" ou "mostrar
 * zero" confundiam:
 *
 *   carregando   — ainda não respondeu. Não é vazio nem erro.
 *   vazio        — respondeu e não há nada. (Quem desenha o vazio é a própria tela.)
 *   sem-resultado — há dado, mas o filtro escondeu tudo. (Idem.)
 *   erro         — falhou e não há dado nenhum pra mostrar.
 *   desatualizado — falhou agora, mas há um dado ANTERIOR na tela; ele segue visível
 *                   e este aviso diz que pode estar velho.
 *
 * Este componente cuida dos três que são AVISO (carregando, erro, desatualizado):
 * uma linha, com o que aconteceu, o que isso NÃO significa e, quando dá, um botão
 * pra tentar de novo. Sem stack trace. O vazio e o filtro-sem-resultado são de cada
 * tela, porque a saída de cada um é diferente ("cadastrar", "limpar filtro", "ver todos").
 */
export type EstadoDaFonteAviso = "carregando" | "erro" | "desatualizado";

export default function AvisoDaFonte({
  estado, fonte, naoSignifica, aoTentar, tentando, quando,
}: {
  estado: EstadoDaFonteAviso;
  /** Nome da fonte no plural ou coletivo: "o estoque retido no Full". */
  fonte: string;
  /** O que o erro NÃO quer dizer — o que a pessoa poderia concluir errado. */
  naoSignifica?: string;
  aoTentar?: () => void;
  tentando?: boolean;
  /** Quando veio o dado que está na tela (só pro estado "desatualizado"). */
  quando?: string;
}) {
  if (estado === "carregando") {
    return <div className="note" role="status">◌ Carregando {fonte}…</div>;
  }
  return (
    <div className={`note ${estado === "erro" ? "note-danger" : "note-warn"}`} role={estado === "erro" ? "alert" : "status"}>
      {estado === "erro"
        ? <><b>Não consegui carregar {fonte} agora.</b></>
        : <><b>Não consegui atualizar {fonte}.</b> O que está na tela é o último dado que chegou{quando ? ` (${quando})` : ""} e pode estar velho.</>}
      {naoSignifica && <> {naoSignifica}</>}
      {aoTentar && (
        <>
          {" "}
          <button type="button" className="btn btn-ghost btn-xs" onClick={aoTentar} disabled={tentando}>
            {tentando ? "Tentando…" : "Tentar de novo"}
          </button>
        </>
      )}
    </div>
  );
}
