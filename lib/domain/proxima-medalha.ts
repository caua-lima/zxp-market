/**
 * As métricas de qualidade que o MercadoLíder exige, em unidades que dão pra
 * agir.
 *
 * ─── O QUE SAIU DAQUI ───────────────────────────────────────────────────
 *
 * Este módulo também calculava o progresso de faturamento contra um alvo
 * DIGITADO — porque, na época, a tabela oficial de limiares não tinha sido
 * localizada e chutar seria pior que não ter.
 *
 * A tabela apareceu (ver `mercadolider-metas.ts`, lida em 05/09/2026), e com
 * ela o progresso passou a ser calculado lá: com os dois eixos que o ML de
 * fato exige (vendas E faturamento) e na janela certa (3 meses + mês vigente,
 * não os 60 dias da reputação). Manter as duas contas vivas seria repetir o
 * erro que originou quase todo número errado nesta base — duas definições da
 * mesma coisa, divergindo na primeira correção.
 *
 * Aqui ficou o que não mudou: as três métricas de qualidade, cujos tetos
 * (1% / 0,5% / 6%) são os do critério de MercadoLíder e valem pra qualquer
 * medalha.
 */

export type MetricaQualidade = {
  id: string;
  label: string;
  /** Taxa atual (0,0022 = 0,22%). */
  taxa: number | null;
  /** Teto permitido (0,06 = 6%). */
  limite: number;
  /** Quantas vendas geraram o problema. */
  casos: number | null;
  /** Está dentro do teto. `null` quando não há dado. */
  ok: boolean | null;
  /**
   * Quantos casos ainda cabem antes de estourar o teto — a tradução do
   * percentual em algo acionável. `null` sem base de vendas.
   */
  folgaEmCasos: number | null;
};

/**
 * As métricas de qualidade em unidades que dão pra agir.
 *
 * "0,22% de envios incorretos" não diz se é perto ou longe do limite. "2 de
 * 937, e cabem mais 54 antes de estourar" diz.
 */
export function metricasDeQualidade(
  m: {
    claims?: { rate?: number | null; value?: number | null } | null;
    cancellations?: { rate?: number | null; value?: number | null } | null;
    delayed_handling_time?: { rate?: number | null; value?: number | null } | null;
  } | null | undefined,
  vendasNaJanela: number,
): MetricaQualidade[] {
  const vendas = Math.max(Number(vendasNaJanela) || 0, 0);

  const montar = (
    id: string, label: string, limite: number,
    entrada: { rate?: number | null; value?: number | null } | null | undefined,
  ): MetricaQualidade => {
    const taxa = entrada?.rate == null ? null : Number(entrada.rate);
    const casos = entrada?.value == null ? null : Number(entrada.value);
    const ok = taxa == null ? null : taxa < limite;
    /**
     * Teto em casos = quantos cabem antes de a taxa alcançar o limite.
     * Piso em zero: já estourado não tem folga negativa, tem zero.
     */
    const folgaEmCasos = vendas > 0 && casos != null
      ? Math.max(0, Math.floor(limite * vendas) - casos)
      : null;
    return { id, label, taxa, limite, casos, ok, folgaEmCasos };
  };

  return [
    montar("reclamacoes", "Reclamações", 0.01, m?.claims),
    montar("cancelamentos", "Canceladas por você", 0.005, m?.cancellations),
    montar("envios", "Envios com atraso", 0.06, m?.delayed_handling_time),
  ];
}
