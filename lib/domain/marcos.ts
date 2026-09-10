/**
 * Marcos comemorativos — faturamento do mês, do dia e reputação no ML.
 *
 * ─── POR QUE UM AVISO SÓ DE COMEMORAÇÃO ─────────────────────────────────
 *
 * Quase todo aviso que este app manda é problema: venda com margem baixa,
 * prejuízo, cancelamento, estoque acabando. Quem vive olhando o painel só
 * recebe notícia ruim, e passar dos R$ 30 mil num mês — resultado de meses de
 * trabalho — não gerava nada.
 *
 * ─── A REGRA QUE IMPORTA: AVISAR UMA VEZ SÓ ─────────────────────────────
 *
 * Um marco é um EVENTO, não um estado. O faturamento passa dos R$ 10 mil uma
 * vez no mês, mas fica acima dele pelos 20 dias seguintes — e a verificação
 * roda a cada sync. Sem chave estável, seriam centenas de notificações do
 * mesmo marco, e o usuário desligaria as notificações inteiras no primeiro
 * dia.
 *
 * Por isso cada marco tem uma `chave` que já carrega o mês (ou o dia, ou o
 * nível), e ela vira o `dedupeKey` do evento — o Firestore garante criação
 * única com `create()`, do mesmo jeito que garante um push por venda.
 *
 * Puro: decide QUAIS marcos foram cruzados. Persistir e enviar fica fora.
 */

/**
 * Degraus de faturamento do MÊS, em reais.
 *
 * ─── POR QUE DE 5 EM 5 MIL ──────────────────────────────────────────────
 *
 * Era de 10 em 10 mil, e numa operação que fatura ~45 mil isso dava quatro
 * avisos por mês — quase nada, e nenhum deles no meio do mês, quando ainda dá
 * pra reagir. De 5 em 5 mil dá cerca de nove: um a cada três dias, que
 * acompanha o ritmo sem virar ruído.
 *
 * Acima de 150 mil o passo abre pra 25 mil. A mesma distância que é conquista
 * hoje vira rotina depois, e comemorar cada 5 mil em quem fatura 300 mil
 * transformaria a comemoração em barulho de fundo. Se a operação chegar lá, é
 * aqui que se reajusta.
 */
export const DEGRAUS_FATURAMENTO: number[] = [
  ...Array.from({ length: 30 }, (_, i) => (i + 1) * 5_000),      // 5k … 150k
  ...Array.from({ length: 14 }, (_, i) => 150_000 + (i + 1) * 25_000), // 175k … 500k
  600_000, 700_000, 800_000, 900_000, 1_000_000,
];

/**
 * Degraus de faturamento do DIA, em reais.
 *
 * Um dia bom nesta operação passa de R$ 1.500; de 1 em 1 mil, um dia forte
 * rende dois ou três avisos e um dia comum rende um. É o passo que faz o aviso
 * chegar enquanto o dia ainda está acontecendo.
 */
export const DEGRAUS_DIA: number[] = [
  ...Array.from({ length: 20 }, (_, i) => (i + 1) * 1_000),      // 1k … 20k
  25_000, 30_000, 40_000, 50_000,
];

export type Marco = {
  /** Id estável — vira o dedupeKey do evento. */
  chave: string;
  titulo: string;
  corpo: string;
};

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brl2 = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

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

export function labelDoNivel(status: string | null | undefined): string | null {
  const k = String(status ?? "").trim().toLowerCase();
  return NIVEIS[k]?.label ?? null;
}

/**
 * A assinatura que fecha toda notificação de conquista.
 *
 * ─── POR QUE ELA EXISTE ─────────────────────────────────────────────────
 *
 * O selo de MercadoLíder é a coisa mais positiva que a conta tem, e vivia
 * escondido numa aba. Fechar a comemoração com ele liga o resultado do dia à
 * posição que ele constrói — e o texto muda com o nível real do ML, então
 * subir de degrau aparece sozinho em toda notificação seguinte.
 *
 * Sem selo ainda, vira o alvo em vez de sumir: quem não é MercadoLíder está a
 * caminho de ser, e dizer isso é mais útil que uma linha em branco.
 */
export function seloMercadoLider(status: string | null | undefined): string {
  const label = labelDoNivel(status);
  if (!label) return "Rumo ao MercadoLíder — cada venda conta pro selo.";
  const ordem = ordemDoNivel(status);
  if (ordem >= 3) return `${label} — o topo do Mercado Livre, com a maior exposição que existe.`;
  if (ordem === 2) return `${label} — seus anúncios têm prioridade alta nas buscas.`;
  return `${label} — seus anúncios já aparecem na frente nas buscas.`;
}

/** Junta o corpo do marco com o selo, sem espaço sobrando quando faltar um. */
function comSelo(corpo: string, status: string | null | undefined): string {
  return `${corpo}\n\n${seloMercadoLider(status)}`;
}

/**
 * Marcos de faturamento cruzados no MÊS.
 *
 * `mes` entra na chave (formato "2026-08") porque o marco se repete todo mês —
 * passar de 10 mil em setembro é conquista nova, não repetição de agosto.
 *
 * Devolve TODOS os degraus abaixo do faturamento atual, não só o mais alto: a
 * dedupe cuida dos já avisados, e assim um salto grande entre duas verificações
 * (venda alta, ou primeira do dia) não pula degrau nenhum.
 */
export function marcosDeFaturamento(
  faturamentoMes: number,
  mes: string,
  nivelML?: string | null,
): Marco[] {
  if (!(faturamentoMes > 0) || !mes) return [];
  return DEGRAUS_FATURAMENTO
    .filter((d) => faturamentoMes >= d)
    .map((d) => ({
      chave: `marco_faturamento:${mes}:${d}`,
      titulo: `${brl(d)} no mês!`,
      corpo: comSelo(
        `Você passou de ${brl(d)} de faturamento em ${mesPorExtenso(mes)}. `
        + `Está em ${brl2(faturamentoMes)}.`,
        nivelML,
      ),
    }));
}

/**
 * Marcos de faturamento cruzados no DIA.
 *
 * ─── POR QUE O DIA MERECE MARCO PRÓPRIO ─────────────────────────────────
 *
 * O marco mensal chega quando o mês já andou bastante e não diz nada sobre
 * hoje. O do dia chega enquanto o dia acontece — é o que transforma "vendi
 * bem" numa informação que dá pra usar (anunciar mais, repor, avisar quem
 * embala).
 */
export function marcosDoDia(
  faturamentoDia: number,
  dia: string,
  nivelML?: string | null,
): Marco[] {
  if (!(faturamentoDia > 0) || !dia) return [];
  return DEGRAUS_DIA
    .filter((d) => faturamentoDia >= d)
    .map((d) => ({
      chave: `marco_dia:${dia}:${d}`,
      titulo: `${brl(d)} hoje!`,
      corpo: comSelo(
        `O dia ${diaBR(dia)} passou de ${brl(d)} em vendas. `
        + `Está em ${brl2(faturamentoDia)}.`,
        nivelML,
      ),
    }));
}

/**
 * Marco de reputação, comparando o nível de agora com o último conhecido.
 *
 * Só SOBE gera aviso. Perder o nível é notícia ruim e não pertence a um canal
 * de comemoração — misturar as duas coisas faria o usuário associar o aviso a
 * ansiedade em vez de conquista.
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

  const label = labelDoNivel(atual) ?? "MercadoLíder";
  return {
    // Sem mês: subir de nível é conquista única, não mensal.
    chave: `marco_reputacao:${String(atual).trim().toLowerCase()}`,
    titulo: `Você chegou a ${label}!`,
    corpo:
      `A sua conta agora é ${label} no Mercado Livre.\n\n`
      + seloMercadoLider(atual),
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

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** "2026-08" → "agosto". O aviso dizia "em 2026-08", que ninguém fala. */
export function mesPorExtenso(mes: string): string {
  const m = String(mes).match(/^(\d{4})-(\d{2})$/);
  if (!m) return mes;
  return MESES[Number(m[2]) - 1] ?? mes;
}

/** "2026-09-08" → "08/09". */
export function diaBR(dia: string): string {
  const m = String(dia).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}` : dia;
}
