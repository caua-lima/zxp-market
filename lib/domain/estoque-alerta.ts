/**
 * Aviso de estoque no Full baixo — "hora de agendar coleta".
 *
 * ─── POR QUE SÓ O FULL, E NÃO FULL + CASA ───────────────────────────────
 *
 * A pergunta que este aviso responde é "preciso MANDAR mais pro Full?", não
 * "preciso comprar mais?". São perguntas diferentes e a resposta certa vem de
 * bases diferentes:
 *
 *   · comprar    → o que existe no mundo (Full + casa)
 *   · reabastecer→ só o que está no Full
 *
 * Somar o que está em casa seria o inverso do necessário: ter 300 unidades na
 * prateleira é exatamente o que PERMITE agendar a coleta. Contá-las
 * silenciaria o aviso justo no caso em que dá pra resolver hoje.
 *
 * ─── A REGRA QUE IMPORTA: AVISAR NA TRAVESSIA, NÃO NO ESTADO ────────────
 *
 * Estoque baixo é um ESTADO que dura dias; o aviso é um EVENTO. Se a regra
 * fosse "Full <= 25 manda push", um produto parado em 20 unidades geraria um
 * push a cada rodada do cron — a cada 15 minutos, por dias. O vendedor
 * desligaria as notificações inteiras no primeiro dia, e perderia junto os
 * avisos de venda.
 *
 * Então avisa quando CRUZA o limite pra baixo, e só volta a avisar depois de
 * ter subido acima dele de novo (coleta chegou). Mesma lógica de `marcos.ts`,
 * pelo mesmo motivo.
 *
 * Puro: decide QUEM avisar. Persistir e enviar fica fora.
 */

/**
 * Unidade mínima no Full: abaixo disto o giro normal fura o estoque antes de a
 * coleta ser processada. É o número que o operador usa.
 */
export const ESTOQUE_MINIMO_PADRAO = 25;

export type ProdutoEstoque = {
  /** Id estável do produto — vira parte da chave de dedupe. */
  id: string;
  nome: string;
  /** Unidades no Full. É ISTO que dispara o aviso. */
  full: number;
  /** Unidades em casa — não entra no limite, mas diz se dá pra coletar agora. */
  casa: number;
  /**
   * O produto está no Full? Só faz sentido falar em coleta pra quem está.
   * Produto que só vende do galpão próprio nunca gera este aviso.
   */
  ehFull: boolean;
  /** Média de venda por dia, quando conhecida — vira "dura X dias". */
  mediaDiaria?: number | null;
  /** Limite próprio deste produto. Ausente = usa o padrão. */
  minimo?: number | null;
};

export type AvisoEstoque = {
  /** Id estável — vira o dedupeKey do evento, garantindo um push só. */
  chave: string;
  produtoId: string;
  titulo: string;
  corpo: string;
  /** Unidades no Full que dispararam o aviso. */
  full: number;
  /** Unidades em casa disponíveis pra enviar. */
  casa: number;
  minimo: number;
  /** Dias de cobertura restantes no Full, quando dá pra estimar. */
  diasRestantes: number | null;
  /** false = sem estoque em casa; a ação vira comprar, não coletar. */
  podeColetar: boolean;
};

export type ResultadoDeteccao = {
  /** Produtos que acabaram de cruzar pra baixo — avisar agora. */
  avisar: AvisoEstoque[];
  /** Ids que voltaram a ficar acima do limite — liberar pra avisar de novo. */
  rearmar: string[];
};

/**
 * Quantos dias o Full ainda cobre no ritmo atual. null quando não há venda
 * conhecida — e nesse caso o aviso não inventa prazo.
 */
export function diasDeCobertura(total: number, mediaDiaria: number | null | undefined): number | null {
  if (!mediaDiaria || mediaDiaria <= 0) return null;
  return Math.floor(total / mediaDiaria);
}

export function detectarEstoqueBaixo(
  produtos: ProdutoEstoque[],
  /** Ids que JÁ receberam aviso e ainda não foram reabastecidos. */
  jaAvisados: ReadonlySet<string>,
  minimoPadrao: number = ESTOQUE_MINIMO_PADRAO,
): ResultadoDeteccao {
  const avisar: AvisoEstoque[] = [];
  const rearmar: string[] = [];

  for (const p of produtos) {
    if (!p.id) continue;
    // Sem Full não há coleta a agendar — o aviso não se aplica.
    if (!p.ehFull) continue;

    const minimo = p.minimo ?? minimoPadrao;
    const full = Math.max(p.full, 0);
    const casa = Math.max(p.casa, 0);
    const baixo = full <= minimo;
    const jaAvisou = jaAvisados.has(p.id);

    if (!baixo) {
      // Coleta chegou: volta a ficar elegível pro próximo aviso.
      if (jaAvisou) rearmar.push(p.id);
      continue;
    }
    if (jaAvisou) continue; // já avisado nesta travessia — não repete

    const dias = diasDeCobertura(full, p.mediaDiaria);
    const nome = p.nome || p.id;
    const podeColetar = casa > 0;

    avisar.push({
      // O id sozinho basta: a dedupe de verdade é o `jaAvisados`, que só
      // libera depois do reabastecimento. Incluir a data faria voltar a
      // avisar todo dia, que é exatamente o que se quer evitar.
      chave: `stock_low:${p.id}`,
      produtoId: p.id,
      titulo: full === 0 ? `${nome} ZEROU no Full` : `${nome}: ${full} un no Full`,
      corpo:
        `Full em ${full} un (mínimo ${minimo})`
        + (dias != null ? `, dura ~${dias} dia(s)` : "")
        + ". "
        + (podeColetar
          ? `Você tem ${casa} un em casa — agende a coleta.`
          : "Sem estoque em casa pra enviar: precisa comprar antes."),
      full,
      casa,
      minimo,
      diasRestantes: dias,
      podeColetar,
    });
  }

  // Mais crítico primeiro: quem zerou antes de quem está perto do limite.
  avisar.sort((a, b) => a.full - b.full);
  return { avisar, rearmar };
}
