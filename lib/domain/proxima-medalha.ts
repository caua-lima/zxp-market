import {
  baseDaMetrica,
  dentroDoLimite,
  folgaEmCasos,
  lerMetrica,
  periodoDaMetrica,
  TETOS,
  type ChaveMetrica,
  type MetricaML,
} from "@/lib/domain/limites-reputacao";

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
 * A tabela apareceu (ver `mercadolider-metas.ts`, lida em 07/09/2026), e com
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
  /**
   * A janela que o ML usou NESTA metrica, como ele mesmo devolve ("60 days",
   * "365 days"). A tela dizia "ultimos 60 dias" fixo; no MLB o periodo vira
   * 365 dias pra quem teve menos de 60 vendas em 60 dias — justamente a conta
   * em recuperacao, que mais precisa ler o numero certo.
   */
  periodo: string | null;
  /**
   * Vendedor protegido: o `rate`/`value` visivel vem zerado e os numeros
   * reais ficam em `excluded`. Mostrar o zero e confortavel e falso — a
   * protecao termina numa data, e ai o real aparece de uma vez.
   */
  protegida: boolean;
  /** Taxa real sob protecao, quando houver. */
  taxaReal: number | null;
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
    claims?: MetricaML;
    cancellations?: MetricaML;
    delayed_handling_time?: MetricaML;
    /** `metrics.sales` da API — o denominador oficial de claims e cancellations. */
    sales?: { period?: string | null; completed?: number | null } | null;
  } | null | undefined,
  vendasNaJanela: number,
): MetricaQualidade[] {
  /**
   * O denominador oficial e `metrics.sales.completed`, nao a contagem de
   * pedidos do app: a taxa vem da janela do ML (60 ou 365 dias, conforme o
   * volume) e a contagem do app e feita sobre a janela da tela. Quando a API
   * nao traz, cai na contagem do app como ultima opcao.
   */
  const vendasOficiais = Number(m?.sales?.completed);
  const vendas = Number.isFinite(vendasOficiais) && vendasOficiais > 0
    ? vendasOficiais
    : Math.max(Number(vendasNaJanela) || 0, 0);

  const montar = (
    id: string, label: string, chave: ChaveMetrica, entrada: MetricaML,
  ): MetricaQualidade => {
    const limite = TETOS[chave].mercadoLider;
    const lida = lerMetrica(entrada);

    // Sob protecao, o numero que importa e o real: e ele que volta a valer
    // quando a protecao acabar.
    const taxa = lida.protegida ? (lida.taxaReal ?? lida.taxa) : lida.taxa;
    const casos = lida.protegida ? (lida.casosReais ?? lida.casos) : lida.casos;

    /**
     * O MESMO comparador do ReputacaoPanel. Aqui era `taxa < limite` e la era
     * `pct > limite`: com a taxa exatamente no teto, os dois paineis lado a
     * lado davam respostas opostas. A tabela oficial do MLB marca o vermelho
     * como "> 8%", entao o teto e inclusivo.
     */
    const ok = taxa == null ? null : dentroDoLimite(taxa, limite);

    /**
     * A folga e DERIVADA do comparador, nao calculada em paralelo com ele —
     * era essa separacao que deixava a tela prometer "cabem mais 1" e reprovar
     * esse mesmo 1.
     *
     * E a base sai de `baseDaMetrica`, que respeita o denominador de CADA
     * metrica: reclamacoes e cancelamentos dividem por vendas totais, mas
     * atraso no envio divide por "vendas enviadas com ME2" — outro numero, que
     * nem vem na resposta. Antes as tres usavam o total de vendas.
     */
    const base = baseDaMetrica(chave, entrada, vendas);
    const folga = base != null && casos != null ? folgaEmCasos(casos, base, limite) : null;

    return {
      id, label, taxa, limite, casos, ok,
      folgaEmCasos: folga,
      periodo: periodoDaMetrica(entrada),
      protegida: lida.protegida,
      taxaReal: lida.taxaReal,
    };
  };

  return [
    montar("reclamacoes", "Reclamações", "claims", m?.claims),
    montar("cancelamentos", "Canceladas por você", "cancellations", m?.cancellations),
    montar("envios", "Envios com atraso", "delayed_handling_time", m?.delayed_handling_time),
  ];
}
