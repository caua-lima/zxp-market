import {
  TITULO_ALTO_VALOR,
  TITULO_VENDA_PADRAO,
  type NotificationEventType,
  type SalePushPayload,
} from "@/lib/domain/notifications";
import type { NotificationPreferences } from "@/lib/domain/notification-preferences";

/**
 * O tipo que ESTA pessoa enxerga, e o aviso ajustado a ele.
 *
 * ─── O LIMIAR DE ALTO VALOR É DA PESSOA ─────────────────────────────────
 *
 * `highValueThreshold` era gravado, mostrado na tela e ignorado: a
 * classificação usava a constante 250 pra todo mundo, uma vez, ao criar o
 * evento. A tela é individual ("Venda de alto valor a partir de R$ ..."), então
 * a regra é individual — mas SÓ na apresentação:
 *
 *  - o evento, a Central e o histórico guardam a classificação da OPERAÇÃO
 *    (a verdade financeira não muda conforme quem olha);
 *  - na hora de enviar, o mesmo evento é lido contra o limiar de cada pessoa:
 *    quem quer "alto valor" só a partir de R$ 1.000 recebe uma venda de R$ 300
 *    como venda comum (e pelo toggle de venda comum), e quem quer a partir de
 *    R$ 100 a recebe como alto valor (e pelo toggle de alto valor).
 *
 * Só as duas classes de "venda saudável" trocam entre si. Margem baixa e
 * prejuízo são classificações de RISCO da operação, não de valor — não dependem
 * de limiar pessoal e passam intactas.
 */
export function tipoEfetivoParaDestinatario(
  payload: Pick<SalePushPayload, "type" | "grossAmount" | "financialState">,
  prefs: Pick<NotificationPreferences, "highValueThreshold">,
): NotificationEventType {
  if (payload.type !== "sale_paid" && payload.type !== "sale_high_value") return payload.type;
  // Sem lucro calculável o evento nem foi classificado por valor (ver classifySale):
  // inventar uma classificação de valor aqui seria decidir sem os dados.
  if (payload.financialState === "unavailable") return payload.type;

  const gross = Number(payload.grossAmount);
  if (!payload.grossAmount || !Number.isFinite(gross)) return payload.type;

  return gross >= prefs.highValueThreshold ? "sale_high_value" : "sale_paid";
}

/**
 * O aviso ajustado ao tipo efetivo. Só troca o TÍTULO padrão de um pelo do
 * outro; um título especial ("sem cadastro", "margem sai quando o ML publicar
 * o frete") carrega um aviso operacional que nenhum limiar pode apagar.
 */
export function personalizarPayload(payload: SalePushPayload, tipo: NotificationEventType): SalePushPayload {
  if (tipo === payload.type) return payload;
  const tituloPadrao = payload.type === "sale_high_value" ? TITULO_ALTO_VALOR : TITULO_VENDA_PADRAO;
  if (payload.title !== tituloPadrao) return { ...payload, type: tipo };
  return { ...payload, type: tipo, title: tipo === "sale_high_value" ? TITULO_ALTO_VALOR : TITULO_VENDA_PADRAO };
}
