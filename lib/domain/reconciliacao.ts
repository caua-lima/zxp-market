/**
 * Quando voltar a conferir um pedido que já "terminou".
 *
 * ─── TERMINAL NA LOGÍSTICA ≠ FECHADO NO FINANCEIRO ──────────────────────
 *
 * `terminalShipmentIds` montava o conjunto de envios que NÃO precisam mais ser
 * buscados: `delivered`, `not_delivered`, `cancelled`. A partir daí o pedido
 * nunca mais era consultado.
 *
 * Mas o que congela ali é o STATUS, não o dinheiro. O Mercado Livre ajusta
 * custo de frete DEPOIS da entrega — repesagem do pacote, sobretaxa, estorno,
 * correção de tarifa. O valor capturado na primeira leitura ficava gravado
 * para sempre, e o CMV daquele pedido junto.
 *
 * Pior: um pedido cujo `/costs` falhou na hora ficava com o frete ausente E
 * com status terminal. Nunca mais era tentado. O custo de envio daquela venda
 * simplesmente não existia, permanentemente.
 *
 * O mesmo vale pro líquido do Mercado Pago: `net_received` era buscado uma vez
 * e nunca revisto, mas ele muda com reembolso, chargeback e ajuste.
 *
 * ─── FOME POR LIMITE FIXO ───────────────────────────────────────────────
 *
 * A busca do líquido fazia:
 *
 *   const buscarMP = orderIds.filter((id) => !jaTemNet.has(id)).slice(0, 250);
 *
 * Um teto sem cursor e sem rotação. Com mais de 250 pendentes, a rodada pega
 * SEMPRE os mesmos primeiros 250 — na mesma ordem, toda vez. Se alguns deles
 * falham de forma persistente, os demais nunca são alcançados. Não é lentidão:
 * é fome permanente, e ninguém percebe porque o job "roda com sucesso".
 */

export type CandidatoReconciliacao = {
  orderId: string;
  /** Status logístico gravado. */
  statusEnvio?: string | null;
  /** O dado financeiro já existe? Ausente força reconferência. */
  temDadoFinanceiro?: boolean;
  /** Quando foi entregue/finalizado, ISO. Base da janela de ajuste. */
  finalizadoEm?: string | null;
  /** Última vez que tentamos reconciliar este pedido, em ms. */
  ultimaTentativa?: number | null;
};

/** Status logísticos que o ML considera fim de linha. */
export const STATUS_TERMINAIS = new Set(["delivered", "not_delivered", "cancelled"]);

/**
 * Por quantos dias após a finalização ainda vale reconferir o dinheiro.
 *
 * Trinta dias cobre repesagem, sobretaxa e estorno de frete, que é onde os
 * ajustes acontecem. Depois disso o ML não mexe mais, e continuar perguntando
 * seria gastar chamada à toa — o oposto do problema, mas também um problema.
 */
export const JANELA_AJUSTE_DIAS = 30;

/** Intervalo mínimo entre duas reconferências do mesmo pedido. */
export const INTERVALO_RECONFERENCIA_MS = 24 * 3600 * 1000;

export function ehTerminal(status: unknown): boolean {
  return STATUS_TERMINAIS.has(String(status ?? "").trim().toLowerCase());
}

/**
 * Este pedido precisa ser conferido agora?
 *
 * @param agora ms, parâmetro pra a função continuar pura.
 */
export function precisaReconferir(c: CandidatoReconciliacao, agora: number): boolean {
  // Ainda em trânsito: segue no fluxo normal, não é assunto deste módulo.
  if (!ehTerminal(c.statusEnvio)) return true;

  /**
   * Falta o número. Isso não é "já conferi e deu zero" — é buraco, e buraco
   * em custo de frete vira margem inflada. Tenta sempre, independente de
   * janela: sem o dado, não há o que preservar.
   */
  if (c.temDadoFinanceiro === false) return true;

  const fim = Date.parse(String(c.finalizadoEm ?? ""));
  if (Number.isFinite(fim)) {
    const forcaDaJanela = agora - fim > JANELA_AJUSTE_DIAS * 86400000;
    // Passou a janela de ajuste: o ML não mexe mais, parar de perguntar é o certo.
    if (forcaDaJanela) return false;
  }

  // Dentro da janela: reconfere, mas não mais que uma vez por dia.
  const ultima = Number(c.ultimaTentativa);
  if (!Number.isFinite(ultima) || ultima <= 0) return true;
  return agora - ultima >= INTERVALO_RECONFERENCIA_MS;
}

/**
 * Escolhe quem entra nesta rodada, sem deixar ninguém pra trás.
 *
 * Ordena pela tentativa MAIS ANTIGA primeiro (nunca tentado vem antes de
 * todos). Com isso o teto continua existindo — ele protege a quota da API —
 * mas vira uma fila que gira, em vez de uma janela fixa sobre os mesmos
 * primeiros registros.
 */
export function escolherLote<T extends CandidatoReconciliacao>(
  candidatos: T[],
  limite: number,
): T[] {
  const teto = Math.max(0, Math.floor(Number(limite) || 0));
  if (teto === 0) return [];

  return [...(candidatos ?? [])]
    .sort((a, b) => {
      const ta = Number(a?.ultimaTentativa);
      const tb = Number(b?.ultimaTentativa);
      const va = Number.isFinite(ta) && ta > 0 ? ta : 0; // nunca tentado = mais antigo
      const vb = Number.isFinite(tb) && tb > 0 ? tb : 0;
      if (va !== vb) return va - vb;
      // Desempate estável: sem ele a ordem varia entre rodadas e a fila não gira.
      return String(a?.orderId ?? "").localeCompare(String(b?.orderId ?? ""));
    })
    .slice(0, teto);
}

/**
 * Um evento mais VELHO não pode sobrescrever um estado mais novo.
 *
 * Webhook e sync correm juntos, e a ordem de chegada não é garantida: uma
 * resposta atrasada do ML pode trazer o estado de dez minutos atrás. Gravar
 * assim mesmo faz o pedido REGREDIR — de entregue pra a caminho, de estornado
 * pra pago.
 */
export function eventoEhMaisNovo(
  gravadoEm: unknown,
  chegandoEm: unknown,
): boolean {
  const atual = Date.parse(String(gravadoEm ?? ""));
  const novo = Date.parse(String(chegandoEm ?? ""));
  // Sem carimbo no que chega, não dá pra afirmar que é mais novo — e na dúvida
  // não se regride.
  if (!Number.isFinite(novo)) return false;
  // Sem carimbo no que está gravado, qualquer coisa datada é progresso.
  if (!Number.isFinite(atual)) return true;
  return novo >= atual;
}
