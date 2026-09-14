/**
 * O que sai da resposta quando quem pergunta não pode ver o financeiro.
 *
 * ─── POR QUE REDIGIR NO SERVIDOR ────────────────────────────────────────
 *
 * O papel `member` existe pra acompanhar o RESULTADO sem ver o núcleo do
 * negócio: custo do produto, margem, taxa, imposto, lucro. As regras do
 * Firestore já barravam a leitura direta dessas coleções — mas
 * `/api/ml/metrics` devolvia tudo, porque o portão achatava todo papel
 * não-owner num só.
 *
 * Esconder o campo no frontend não corrige: a resposta da API é visível pra
 * quem tem o token, e basta abrir a aba de rede. O dado tem que não sair.
 *
 * ─── POR QUE NÃO BARRAR A ROTA INTEIRA ──────────────────────────────────
 *
 * O member vê o Dashboard — é a única tela dele. Recusar a rota apagaria a
 * tela; devolver tudo e esconder na interface é o que o prompt proíbe. Então
 * a rota responde, sem os campos proibidos, e MARCA que redigiu: o Dashboard
 * mostra "seu acesso não inclui custo e margem" em vez de R$ 0,00, porque
 * ausência de dado não é zero.
 */

/** Campos do período que revelam custo, lucro ou margem. */
export const CAMPOS_FINANCEIROS = [
  "totalCMV",
  "totalAds",
  "adsNaoVinculado",
  "totalEnvio",
  "totalImposto",
  "totalTaxasML",
  "custosOperacionais",
  "custosDre",
  "custosDreDetalhe",
  "lucroSemCustos",
  "lucroComCustos",
  "margemSemCustos",
  "margemComCustos",
  /** Conferência contra o líquido do Mercado Pago — é repasse, é financeiro. */
  "reconc",
  /** Por anúncio: carrega retorno e custo item a item. */
  "anuncios",
  "devolucoesDetalhe",
  "adsDiag",
] as const;

/** Os mesmos campos, dentro do bloco do dia. */
export const CAMPOS_FINANCEIROS_DO_DIA = [
  "totalCMV",
  "totalAds",
  "totalEnvio",
  "totalTaxasML",
  "totalImposto",
  "lucroLiquido",
  "vendaDiretaAds",
] as const;

/**
 * Dentro de `conciliacao`, o que fica: quantidades e preço médio são leitura
 * de VENDA, não de custo. O detalhe de cancelados carrega valor por pedido e
 * some junto — é granularidade que o resumo não precisa.
 */
export const CAMPOS_FINANCEIROS_DA_CONCILIACAO = [
  "canceladasDetalhe",
  "pedidosSemFrete",
  "valorSemFrete",
] as const;

function semCampos(obj: unknown, campos: readonly string[]): unknown {
  if (!obj || typeof obj !== "object") return obj;
  const copia: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
  for (const c of campos) delete copia[c];
  return copia;
}

/**
 * A resposta de métricas sem nada que revele custo, lucro ou margem.
 *
 * Mantém receita, quantidade de pedidos, unidades e a série diária — o que o
 * resumo precisa — e acrescenta `financeiroOculto: true`.
 */
export function redigirFinanceiro(payload: Record<string, unknown>): Record<string, unknown> {
  const limpo = semCampos(payload, CAMPOS_FINANCEIROS) as Record<string, unknown>;

  if (limpo.hoje && typeof limpo.hoje === "object") {
    limpo.hoje = semCampos(limpo.hoje, CAMPOS_FINANCEIROS_DO_DIA);
  }
  if (limpo.conciliacao && typeof limpo.conciliacao === "object") {
    limpo.conciliacao = semCampos(limpo.conciliacao, CAMPOS_FINANCEIROS_DA_CONCILIACAO);
  }

  /**
   * A marca é o que permite a tela dizer "você não vê isto" em vez de
   * desenhar zero. Sem ela, um campo ausente vira `?? 0` no componente e o
   * member leria "Lucro R$ 0,00" como se fosse o resultado do mês.
   */
  limpo.financeiroOculto = true;
  return limpo;
}
