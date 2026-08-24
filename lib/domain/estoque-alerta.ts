/**
 * Aviso de estoque no mínimo — "precisa repor".
 *
 * ─── A REGRA QUE IMPORTA: AVISAR NA TRAVESSIA, NÃO NO ESTADO ────────────
 *
 * Estoque baixo é um ESTADO que dura dias; o aviso é um EVENTO. Se a regra
 * fosse "estoque <= 25 manda push", um produto parado em 20 unidades geraria
 * um push a cada rodada do cron — a cada 15 minutos, por dias. O vendedor
 * desligaria as notificações inteiras no primeiro dia, e perderia junto os
 * avisos de venda.
 *
 * Então avisa quando CRUZA o limite pra baixo, e só volta a avisar depois de
 * ter subido acima dele de novo (reposição feita). É a mesma lógica de
 * `marcos.ts`, pelo mesmo motivo.
 *
 * ─── POR QUE O TOTAL, E NÃO SÓ O FULL ───────────────────────────────────
 *
 * A pergunta que o aviso responde é "preciso comprar mais?". Quem responde
 * isso é o que existe no MUNDO: o que está no Full mais o que está em casa.
 * Olhar só o Full dispararia aviso pra quem tem 300 unidades na prateleira
 * esperando remessa — barulho pra uma ação que não precisa acontecer.
 *
 * Puro: decide QUEM avisar. Persistir e enviar fica fora.
 */

/**
 * Unidade mínima operacional: abaixo disto o giro normal fura o estoque antes
 * de a reposição chegar. É o número que o operador usa; fica configurável por
 * produto no futuro, mas o padrão precisa ser este.
 */
export const ESTOQUE_MINIMO_PADRAO = 25;

export type ProdutoEstoque = {
  /** Id estável do produto — vira parte da chave de dedupe. */
  id: string;
  nome: string;
  /** Unidades no Full. */
  full: number;
  /** Unidades em casa (fora do Full). */
  casa: number;
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
  total: number;
  minimo: number;
  /** Dias de cobertura restantes, quando dá pra estimar. */
  diasRestantes: number | null;
};

export type ResultadoDeteccao = {
  /** Produtos que acabaram de cruzar pra baixo — avisar agora. */
  avisar: AvisoEstoque[];
  /** Ids que voltaram a ficar acima do limite — liberar pra avisar de novo. */
  rearmar: string[];
};

const totalDe = (p: ProdutoEstoque) => Math.max(p.full, 0) + Math.max(p.casa, 0);

/**
 * Quantos dias o estoque ainda cobre no ritmo atual. null quando não há venda
 * conhecida — e nesse caso o aviso não inventa prazo.
 */
export function diasDeCobertura(total: number, mediaDiaria: number | null | undefined): number | null {
  if (!mediaDiaria || mediaDiaria <= 0) return null;
  return Math.floor(total / mediaDiaria);
}

export function detectarEstoqueBaixo(
  produtos: ProdutoEstoque[],
  /** Ids que JÁ receberam aviso e ainda não repuseram. */
  jaAvisados: ReadonlySet<string>,
  minimoPadrao: number = ESTOQUE_MINIMO_PADRAO,
): ResultadoDeteccao {
  const avisar: AvisoEstoque[] = [];
  const rearmar: string[] = [];

  for (const p of produtos) {
    if (!p.id) continue;
    const minimo = p.minimo ?? minimoPadrao;
    const total = totalDe(p);
    const baixo = total <= minimo;
    const jaAvisou = jaAvisados.has(p.id);

    if (!baixo) {
      // Repôs: volta a ficar elegível pro próximo aviso.
      if (jaAvisou) rearmar.push(p.id);
      continue;
    }
    if (jaAvisou) continue; // já avisado nesta travessia — não repete

    const dias = diasDeCobertura(total, p.mediaDiaria);
    const nome = p.nome || p.id;
    const quanto = total === 0 ? "ZEROU" : `${total} un`;

    avisar.push({
      // O id sozinho basta: a dedupe de verdade é o `jaAvisados`, que só
      // libera depois da reposição. Incluir a data faria voltar a avisar todo
      // dia, que é exatamente o que se quer evitar.
      chave: `stock_low:${p.id}`,
      produtoId: p.id,
      titulo: total === 0 ? `${nome} ZEROU` : `${nome} chegou a ${total} un`,
      corpo:
        `Estoque em ${quanto} (mínimo ${minimo})`
        + (dias != null ? ` — dura ~${dias} dia(s) no ritmo atual.` : ".")
        + " Hora de repor.",
      total,
      minimo,
      diasRestantes: dias,
    });
  }

  // Mais crítico primeiro: quem zerou antes de quem está perto do limite.
  avisar.sort((a, b) => a.total - b.total);
  return { avisar, rearmar };
}
