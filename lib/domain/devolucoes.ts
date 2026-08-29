/**
 * Quais reclamações e devoluções merecem aviso.
 *
 * ─── POR QUE ISTO NÃO EXISTIA ANTES ─────────────────────────────────────
 *
 * Os tipos `return_opened` e `return_completed` estavam declarados no app,
 * apareciam nas preferências e na Central — e NUNCA eram emitidos por
 * ninguém. A rota chamada "returns" buscava `order.status=cancelled`, ou
 * seja, cancelamento, que é outra coisa e já era avisado pelo webhook.
 *
 * Devolução de verdade vive na API de reclamações
 * (`/post-purchase/v1/claims/search`), que exige ao menos um filtro e
 * devolve dois tipos: `returns` (devolução) e `mediations` (reclamação que
 * virou mediação do ML).
 *
 * ─── A REGRA QUE EVITA O ESTOURO DA PRIMEIRA EXECUÇÃO ───────────────────
 *
 * A conta tem reclamações de mais de um ano. Ligar o aviso sem janela
 * dispararia dezenas de notificações de uma vez, todas sobre casos já
 * resolvidos — e o usuário desligaria as notificações inteiras no mesmo dia.
 *
 * Por isso só entra o que é RECENTE. Mesma proteção que o aviso de venda já
 * usa: notificação sobre fato velho não é informação, é ruído com aparência
 * de urgência.
 */

/** Reclamação vinda da API do ML, com só o que importa pra decisão. */
export type Reclamacao = {
  id: string;
  /** "returns" = devolução; "mediations" = reclamação/mediação. */
  tipo: string;
  /** "opened", "closed", etc. */
  status: string;
  /** Pedido a que se refere. */
  pedido: string;
  /** ISO da abertura. */
  criadoEm: string;
  /** ISO da última mudança, quando o ML informa. */
  atualizadoEm?: string | null;
};

export type AvisoDevolucao = {
  /** Vira o dedupeKey — garante um aviso só por reclamação e estado. */
  chave: string;
  tipo: "return_opened" | "return_completed";
  reclamacaoId: string;
  pedido: string;
  titulo: string;
  corpo: string;
};

/**
 * Janela de relevância. Três dias cobre o atraso de um cron diário com folga,
 * e ainda deixa de fora o histórico antigo.
 */
export const JANELA_DIAS = 3;

const DIA = 86400000;

export function ehDevolucao(tipo: string): boolean {
  return String(tipo ?? "").trim().toLowerCase() === "returns";
}

export function estaFechada(status: string): boolean {
  const s = String(status ?? "").trim().toLowerCase();
  return s === "closed" || s === "resolved";
}

/**
 * Decide o que avisar.
 *
 * `agora` entra como parâmetro pra função continuar pura e testável — sem
 * isso, o teste da janela dependeria da data em que roda.
 */
export function avisosDeDevolucao(
  reclamacoes: Reclamacao[],
  agora: number,
  janelaDias: number = JANELA_DIAS,
): AvisoDevolucao[] {
  const avisos: AvisoDevolucao[] = [];
  const limite = agora - janelaDias * DIA;

  for (const r of reclamacoes) {
    if (!r.id || !r.pedido) continue;

    const criado = Date.parse(r.criadoEm ?? "");
    const mexido = Date.parse(r.atualizadoEm ?? "") || criado;
    if (!Number.isFinite(criado)) continue;

    const fechada = estaFechada(r.status);
    const devolucao = ehDevolucao(r.tipo);

    /**
     * Fechada usa a data da MUDANÇA, aberta usa a da criação. Uma devolução
     * de dois meses atrás que foi concluída hoje é notícia de hoje; usar a
     * data de abertura a descartaria justo quando ela importa.
     */
    const quando = fechada ? mexido : criado;
    if (!Number.isFinite(quando) || quando < limite) continue;

    if (fechada) {
      // Só devolução concluída vira aviso de "produto voltou". Mediação
      // encerrada não mexe em estoque nem em faturamento.
      if (!devolucao) continue;
      avisos.push({
        chave: `return_completed:${r.id}`,
        tipo: "return_completed",
        reclamacaoId: r.id,
        pedido: r.pedido,
        titulo: "Devolução concluída",
        corpo:
          `O pedido ${r.pedido} teve a devolução finalizada. `
          + "A venda sai do faturamento e o produto volta pro estoque — confira se a unidade chegou.",
      });
      continue;
    }

    avisos.push({
      chave: `return_opened:${r.id}`,
      tipo: "return_opened",
      reclamacaoId: r.id,
      pedido: r.pedido,
      titulo: devolucao ? "Devolução aberta" : "Reclamação aberta",
      corpo: devolucao
        ? `O comprador abriu devolução no pedido ${r.pedido}. Responder rápido evita virar mediação.`
        : `O comprador abriu uma reclamação no pedido ${r.pedido}. `
          + "Reclamação sem resposta vira mediação e pesa na sua reputação.",
    });
  }

  // Mais recente primeiro: é o que ainda dá pra resolver.
  return avisos.sort((a, b) => b.chave.localeCompare(a.chave));
}
