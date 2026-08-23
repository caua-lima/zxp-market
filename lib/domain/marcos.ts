/**
 * Marcos comemorativos — faturamento do mês e reputação no Mercado Livre.
 *
 * ─── POR QUE UM AVISO SÓ DE COMEMORAÇÃO ─────────────────────────────────
 *
 * Todo aviso que este app manda hoje é problema: venda com margem baixa,
 * prejuízo, cancelamento, estoque acabando. Quem vive olhando o painel só
 * recebe notícia ruim, e passar dos R$ 30 mil num mês — que é resultado de
 * meses de trabalho — não gera nada. Chegar a MercadoLíder, menos ainda.
 *
 * ─── A REGRA QUE IMPORTA: AVISAR UMA VEZ SÓ ─────────────────────────────
 *
 * Um marco é um EVENTO, não um estado. O faturamento passa dos R$ 10 mil uma
 * vez no mês, mas fica acima dele pelos 20 dias seguintes — e o sync roda a
 * cada 15 minutos. Sem chave estável, seriam ~1.900 notificações do mesmo
 * marco, e o usuário desligaria as notificações inteiras no primeiro dia.
 *
 * Por isso cada marco tem uma `chave` que já carrega o mês (ou o nível), e ela
 * vira o `dedupeKey` do evento — o Firestore garante criação única com
 * `create()`, do mesmo jeito que garante um push por venda.
 *
 * Puro: decide QUAIS marcos foram cruzados. Persistir e enviar fica fora.
 */

/**
 * Degraus de faturamento do mês, em reais.
 *
 * Começam em 10 mil e sobem de 10 em 10 até 100 mil, depois de 50 em 50.
 * O espaçamento cresce de propósito: a mesma distância que é conquista no
 * começo vira rotina depois, e comemorar cada 10 mil em quem fatura 300 mil
 * transformaria a comemoração em ruído.
 */
export const DEGRAUS_FATURAMENTO: number[] = [
  10_000, 20_000, 30_000, 40_000, 50_000, 60_000, 70_000, 80_000, 90_000, 100_000,
  150_000, 200_000, 250_000, 300_000, 400_000, 500_000, 750_000, 1_000_000,
];

export type Marco = {
  /** Id estável — vira o dedupeKey do evento. */
  chave: string;
  titulo: string;
  corpo: string;
};

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/**
 * Marcos de faturamento cruzados no mês.
 *
 * `mes` entra na chave (formato "2026-08") porque o marco se repete todo mês —
 * passar de 10 mil em setembro é conquista nova, não repetição de agosto.
 *
 * Devolve TODOS os degraus abaixo do faturamento atual, não só o mais alto: a
 * dedupe cuida dos já avisados, e assim um salto grande entre dois syncs
 * (venda alta, ou primeiro sync do dia) não pula degrau nenhum.
 */
export function marcosDeFaturamento(faturamentoMes: number, mes: string): Marco[] {
  if (!(faturamentoMes > 0) || !mes) return [];
  return DEGRAUS_FATURAMENTO
    .filter((d) => faturamentoMes >= d)
    .map((d) => ({
      chave: `marco_faturamento:${mes}:${d}`,
      titulo: `${brl(d)} no mês!`,
      corpo:
        `Você passou de ${brl(d)} de faturamento em ${mes}. `
        + `Está em ${brl(faturamentoMes)}.`,
    }));
}

/**
 * Níveis de MercadoLíder, do menor pro maior. `power_seller_status` do ML
 * devolve exatamente estas strings (ou null pra quem ainda não é).
 */
const NIVEIS: Record<string, { label: string; ordem: number }> = {
  silver: { label: "MercadoLíder", ordem: 1 },
  gold: { label: "MercadoLíder Gold", ordem: 2 },
  platinum: { label: "MercadoLíder Platinum", ordem: 3 },
};

export function ordemDoNivel(status: string | null | undefined): number {
  const k = String(status ?? "").trim().toLowerCase();
  return NIVEIS[k]?.ordem ?? 0;
}

/**
 * Marco de reputação, comparando o nível de agora com o último conhecido.
 *
 * Só SOBE gera aviso. Perder o nível é notícia ruim e não pertence a um canal
 * de comemoração — misturar as duas coisas faria o usuário associar o aviso a
 * ansiedade em vez de conquista. (Perda merece aviso próprio, e é decisão
 * separada.)
 *
 * `anterior` desconhecido (primeira execução) NÃO comemora: sem saber de onde
 * veio, avisar seria dar parabéns por algo que talvez tenha acontecido meses
 * atrás.
 */
export function marcoDeReputacao(
  atual: string | null | undefined,
  anterior: string | null | undefined,
  anteriorConhecido: boolean,
): Marco | null {
  const agora = ordemDoNivel(atual);
  if (agora === 0) return null;
  if (!anteriorConhecido) return null;
  if (agora <= ordemDoNivel(anterior)) return null;

  const k = String(atual).trim().toLowerCase();
  const label = NIVEIS[k]?.label ?? "MercadoLíder";
  return {
    // Sem mês: subir de nível é conquista única, não mensal.
    chave: `marco_reputacao:${k}`,
    titulo: `Você chegou a ${label}!`,
    corpo:
      `A sua conta agora é ${label} no Mercado Livre. `
      + `Isso melhora sua exposição nos anúncios e a confiança de quem compra.`,
  };
}

/**
 * Quanto falta pro próximo degrau — pra tela poder mostrar o alvo, não só o
 * que já passou. null quando não há degrau acima (ou sem faturamento).
 */
export function proximoDegrau(faturamentoMes: number): { alvo: number; falta: number } | null {
  const alvo = DEGRAUS_FATURAMENTO.find((d) => d > faturamentoMes);
  if (alvo == null) return null;
  return { alvo, falta: alvo - Math.max(faturamentoMes, 0) };
}
