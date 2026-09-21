/**
 * O cartão de indicador (KPI) — rótulo, valor, o que ele mede.
 *
 * Um KPI só é legível se responde: o QUÊ (rótulo), QUANTO (valor, com unidade), de QUANDO
 * ou sobre QUÊ (`base`), e quão confiável é (`sub`, a ressalva ao lado do número). Cada
 * tela escrevia esse markup à mão — `<div className="kpi k-neg"><div className="k-lbl">…` —
 * e as ressalvas iam parar em lugares diferentes. Aqui há um formato só.
 *
 * `tom` só escolhe a cor da barra lateral (`k-neg`, `k-pos`, `k-warn`, `k-acc`); a cor do
 * VALOR é do chamador (`corValor`) e deve ser um token de TEXTO (`--red-text`, não `--red`).
 * Sem valor confiável, passe `valor="—"` e diga o motivo em `sub`: zero é um resultado, não
 * um substituto de "não sei".
 */
export type TomDoCartao = "neg" | "pos" | "warn" | "acc";

export default function MetricCard({
  rotulo, valor, corValor, sub, tom, larguraTotal, acao,
}: {
  rotulo: string;
  valor: React.ReactNode;
  corValor?: string;
  /** A base, o período ou a ressalva — vem junto do número, não num aviso separado. */
  sub?: React.ReactNode;
  tom?: TomDoCartao;
  /** Ocupa a linha inteira da grade (um cartão que substitui dois). */
  larguraTotal?: boolean;
  /**
   * O que fazer com o número: um botão de verdade ("Ver 4 produtos →") que leva ao filtro
   * correspondente. É um botão DENTRO do cartão, e não o cartão inteiro clicável — o cartão
   * é conteúdo, e um cartão-botão com texto longo dentro vira um nome de botão ilegível.
   */
  acao?: { rotulo: string; onClick: () => void };
}) {
  return (
    <div className={`kpi${tom ? ` k-${tom}` : ""}`} style={larguraTotal ? { gridColumn: "1 / -1" } : undefined}>
      <div className="k-lbl">{rotulo}</div>
      <div className="k-val" style={corValor ? { color: corValor } : undefined}>{valor}</div>
      {sub != null && sub !== false && <div className="k-sub">{sub}</div>}
      {acao && <button type="button" className="k-acao" onClick={acao.onClick}>{acao.rotulo}</button>}
    </div>
  );
}
