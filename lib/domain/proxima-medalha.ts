/**
 * Quanto falta pra próxima medalha de MercadoLíder.
 *
 * ─── POR QUE O ALVO É DIGITADO, E NÃO CHUTADO ───────────────────────────
 *
 * A API do ML (`seller_reputation`) devolve o nível atual e as métricas de
 * qualidade, mas NÃO devolve os limiares de faturamento e volume que
 * separam Silver de Gold. A documentação oficial bloqueia leitura
 * automatizada, e as fontes de terceiros divergem entre si.
 *
 * Foi tentado deduzir do próprio painel: ele mostra "R$ 76.490 faturado em
 * vendas concluídas" na tela do Gold, e a leitura óbvia seria tratar isso
 * como alvo. Medido contra a conta, porém, R$ 76.490 é praticamente o
 * faturamento acumulado em ~120 dias (R$ 77.218 na medição, 1% de diferença
 * explicada pela borda da janela) — ou seja, é PROGRESSO, não meta.
 *
 * Inventar um limiar aqui seria pior que não ter: o vendedor planejaria
 * compra e verba de anúncio em cima de um número que ninguém conferiu. Então
 * o alvo vem do painel do ML, digitado uma vez, e o app faz o que sabe fazer
 * com precisão — medir o que já existe e projetar o ritmo.
 */

export type ProgressoMedalha = {
  /** Faturamento já acumulado na janela. */
  atual: number;
  /** Alvo informado pelo usuário. */
  alvo: number;
  /** Quanto falta. Zero quando já alcançou. */
  falta: number;
  /** Percentual do alvo já alcançado (limitado a 100 na exibição). */
  pct: number;
  alcancado: boolean;
  /** Ritmo atual, por dia, medido na janela. */
  porDia: number;
  /** Dias no ritmo atual pra fechar o que falta. `null` sem ritmo. */
  diasNoRitmo: number | null;
  /** Data estimada de chegada no alvo, yyyy-mm-dd. `null` sem ritmo. */
  chegaEm: string | null;
};

/**
 * @param diasDaJanela  período em que `atual` foi acumulado — é o que
 *   transforma o total em ritmo diário.
 * @param hojeISO  entra como parâmetro pra função continuar pura: a data
 *   projetada depende de hoje, e sem isso o teste dependeria do relógio.
 */
export function progressoDaMedalha(
  atual: number,
  alvo: number,
  diasDaJanela: number,
  hojeISO: string,
): ProgressoMedalha {
  const a = Math.max(Number(atual) || 0, 0);
  const meta = Math.max(Number(alvo) || 0, 0);
  const dias = Math.max(Number(diasDaJanela) || 0, 0);

  const falta = Math.max(0, meta - a);
  const alcancado = meta > 0 && a >= meta;
  const pct = meta > 0 ? (a / meta) * 100 : 0;
  const porDia = dias > 0 ? a / dias : 0;

  /**
   * Sem ritmo não há previsão — e `null` aqui é diferente de "hoje". Dizer
   * que chega hoje quando não se vende nada seria a pior forma de errar.
   */
  const diasNoRitmo = alcancado ? 0 : porDia > 0 ? Math.ceil(falta / porDia) : null;

  let chegaEm: string | null = null;
  if (diasNoRitmo != null) {
    const m = String(hojeISO).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + diasNoRitmo);
      chegaEm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
  }

  return { atual: a, alvo: meta, falta, pct, alcancado, porDia, diasNoRitmo, chegaEm };
}

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
