/**
 * MARGEM DE UMA PROMOÇÃO, na página de promoções do ML.
 *
 * Puro (sem chrome.* nem DOM): testado em lib/domain/margem-promocao-extensao.test.ts.
 * O content script (promocoes.js) só lê os números da tela e chama isto.
 *
 * ─── A CONTA ────────────────────────────────────────────────────────────
 *
 * A mesma do simulador de preço do Dash (lib/domain/preco-simulacao.ts):
 *
 *   lucro  = repasse − custo − imposto
 *   margem = lucro ÷ preço final
 *
 * O "Você recebe" que o ML mostra em cada promoção JÁ É o repasse: preço em
 * promoção menos tarifa de venda e custo de envio do Full, com a redução de
 * tarifa da campanha aplicada (medido em 22/11/2026: R$ 21,31 − 0,64 − 2,40 =
 * R$ 18,27). Usar esse número em vez de recalcular a tarifa é o que faz a
 * margem bater com a promoção que o ML está oferecendo, e não com uma tabela.
 *
 * Imposto incide sobre o PREÇO FINAL (a venda), como no resto do app. O custo
 * é o custo médio VIGENTE HOJE (custoNaData), que vem do Dash.
 */

/** "R$ 1.234,56" / "-R$ 2,40" / "R$ 18,27 Preço*…" → 1234.56 / -2.4 / 18.27 (o PRIMEIRO valor do texto). */
export function lerReais(texto) {
  const m = String(texto || "").match(/(-?)\s*R\$\s*(-?)([\d.]+(?:,\d{1,2})?)/);
  if (!m) return null;
  const n = Number(m[3].replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return (m[1] || m[2]) ? -n : n;
}

/** "#4662183905" no texto da linha → "MLB4662183905". */
export function mlbDaLinha(texto) {
  const m = String(texto || "").match(/#(\d{6,})/);
  return m ? `MLB${m[1]}` : null;
}

/**
 * @param {{ recebe: number, precoFinal: number, custo: number, impostoPct: number }} e
 * @returns {{ lucro: number, margem: number, imposto: number } | null}
 */
export function margemDaPromocao(e) {
  const recebe = Number(e.recebe);
  const preco = Number(e.precoFinal);
  const custo = Number(e.custo);
  if (!(preco > 0) || !Number.isFinite(recebe) || !(custo > 0)) return null;
  const imposto = preco * (Math.max(Number(e.impostoPct) || 0, 0) / 100);
  const lucro = recebe - custo - imposto;
  return { lucro, margem: (lucro / preco) * 100, imposto };
}

/** Mesmas faixas do Dash (lib/domain/calc.ts › getMarginStatus). */
export function statusDaMargem(margem, meta = 10) {
  if (margem < 0) return "prejuizo";
  if (margem >= meta) return "saudavel";
  return "atencao";
}

/**
 * Repasse necessário pra bater a meta, no mesmo preço — quanto o "você
 * recebe" teria de ser. Serve pra dizer, numa promoção vermelha, o tamanho
 * do buraco em reais e não só em %.
 */
export function repasseParaMeta(precoFinal, custo, impostoPct, meta) {
  const preco = Number(precoFinal);
  if (!(preco > 0)) return null;
  return custo + preco * (Math.max(Number(impostoPct) || 0, 0) / 100) + preco * (meta / 100);
}

const brl = (n) => `R$ ${Math.abs(n).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
export const reais = (n) => `${n < 0 ? "−" : ""}${brl(n)}`;
export const pct = (n) => `${n < 0 ? "−" : ""}${Math.abs(n).toFixed(1).replace(".", ",")}%`;

/**
 * OPORTUNIDADE DE MARGEM (pedido do dono, 23/11/2026).
 *
 * Num anúncio com uma promoção ATIVA, outra promoção oferecida pelo ML (as de
 * "Participar") é oportunidade quando:
 *   - o preço final é PARECIDO com o da ativa (até `tolerancia`, 8% por padrão
 *     — trocar 19,90 por 19,30 é a mesma faixa pro comprador; trocar por 15,00
 *     não é a mesma decisão), e
 *   - o lucro por venda SOBE pelo menos `minimo` (R$ 0,05).
 *
 * Exemplo do dono: ativa a R$ 19,90 recebendo R$ 16,17; outra a R$ 19,30
 * recebendo R$ 16,98 → +R$ 0,81 de repasse, imposto até cai: oportunidade.
 *
 * A diferença de lucro NÃO depende do custo (é o mesmo produto): Δlucro =
 * Δ"você recebe" − Δimposto. Por isso funciona até em anúncio sem custo no Dash.
 *
 * @param {{ precoFinal: number, recebe: number }} ativa
 * @param {{ precoFinal: number, recebe: number }} candidata
 * @returns {{ ganho: number, difPreco: number, difPrecoPct: number } | null}
 */
export function oportunidadeDeMargem(ativa, candidata, impostoPct = 0, { tolerancia = 0.08, minimo = 0.05 } = {}) {
  const pa = Number(ativa?.precoFinal), ra = Number(ativa?.recebe);
  const pc = Number(candidata?.precoFinal), rc = Number(candidata?.recebe);
  if (!(pa > 0) || !(pc > 0) || !Number.isFinite(ra) || !Number.isFinite(rc)) return null;
  const difPreco = pc - pa;
  const difPrecoPct = difPreco / pa;
  if (Math.abs(difPrecoPct) > tolerancia + 1e-9) return null;
  const taxa = Math.max(Number(impostoPct) || 0, 0) / 100;
  const ganho = (rc - ra) - difPreco * taxa;
  if (ganho < minimo - 1e-9) return null;
  return { ganho, difPreco, difPrecoPct: difPrecoPct * 100 };
}

/**
 * Situação de uma promoção pelo texto do cabeçalho dela: "ATIVA", "PROGRAMADA"
 * ou "oferecida" (as de "Participar", que o ML propõe).
 */
export function situacaoDaPromocao(cabecalho, botoes = "") {
  const t = String(cabecalho || "").toUpperCase();
  if (/\bATIVA\b/.test(t)) return "ativa";
  if (/\bPROGRAMADA\b/.test(t)) return "programada";
  if (/participar/i.test(String(botoes)) && !/deixar de participar/i.test(String(botoes))) return "oferecida";
  return "outra";
}
