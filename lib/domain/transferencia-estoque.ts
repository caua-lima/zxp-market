/**
 * Transferência de estoque entre dois cadastros do MESMO produto — "enviar o
 * estoque pro mesmo produto, em outro anúncio".
 *
 * Com o estoque separado por tipo de anúncio ("Limão Caipira" e "Limão Caipira
 * Agências"), mover unidades de um pro outro é rotina: sobrou nas agências,
 * falta no Full, e o galpão é o mesmo. A transferência é o que torna isso um
 * lançamento só, em vez de dois à mão (um ajuste negativo num, uma entrada no
 * outro, com o custo digitado de cabeça).
 *
 * ─── COMO ENTRA NO LIVRO ────────────────────────────────────────────────
 *
 * Sem tipo novo — o livro já sabe fazer as duas pernas, e o replay do custo
 * médio (custo-medio.ts) segue valendo sem mudança:
 *
 *   origem   → `ajuste` NEGATIVO: sai pela média, e saída pela média não move a média.
 *   destino  → `entrada` ao CUSTO MÉDIO DA ORIGEM: mistura contra o estoque do
 *              destino, que é o que o custo real pede (a unidade já tinha custo).
 *
 * As duas pernas levam o mesmo `transferenciaId` e `transferenciaCom`, pra
 * histórico mostrar "Transferência" e as duas poderem ser achadas juntas.
 * Ids determinísticos: gravar de novo (retry) cai nos mesmos documentos.
 *
 * ─── O QUE NÃO PODE ─────────────────────────────────────────────────────
 *
 * Passar do que há em casa. Transferir 100 de quem tem 40 deixaria a origem em
 * −60: não é estoque, é sintoma de compra por lançar (ver a coluna "Em casa").
 *
 * Puro e autossuficiente (sem `@/`).
 */

export type LadoDaTransferencia = {
  id: string;
  nome: string;
  /** O que o livro diz que está em casa (qtdLocal). Só a ORIGEM precisa dele. */
  emCasa?: number;
  /** Estoque total no instante (Full + fora do Full) — o denominador do custo médio. */
  estoqueTotal: number;
  /** Custo médio atual (0/ausente = sem custo). */
  custoMedio?: number;
};

export type PernaDoLivro = {
  id: string;
  productId: string;
  tipo: "ajuste" | "entrada";
  quantidade: number;
  custoUnit?: number;
  data: string;
  obs: string;
  estoqueAntes: number;
  custoMedioAntes: number;
  transferenciaId: string;
  transferenciaCom: string;
};

export type PlanoDaTransferencia =
  | {
      ok: true;
      saida: PernaDoLivro;
      entrada: PernaDoLivro;
      /** Custo por unidade que viaja (o médio da origem). `null` = a origem não tem custo. */
      custoUnit: number | null;
      /** O custo médio do destino depois de receber. */
      novoCustoDestino: number;
      /** Quanto sobra em casa na origem. */
      sobraNaOrigem: number;
    }
  | { ok: false; motivo: string };

const DATA = /^\d{4}-\d{2}-\d{2}$/;

const arred4 = (v: number) => Math.round(v * 10_000) / 10_000;

/** Média ponderada: (estoque × média + q × custo) / (estoque + q). */
export function custoDestinoAposReceber(estoqueDestino: number, mediaDestino: number, q: number, custoUnit: number): number {
  const base = Math.max(estoqueDestino, 0);
  const total = base + q;
  if (total <= 0) return arred4(custoUnit);
  // Destino sem estoque ou sem custo: a média passa a ser o custo de quem chegou.
  if (base <= 0 || !(mediaDestino > 0)) return arred4(custoUnit);
  return arred4((base * mediaDestino + q * custoUnit) / total);
}

export function planejarTransferencia(e: {
  de: LadoDaTransferencia;
  para: LadoDaTransferencia;
  quantidade: number;
  data: string;
  obs?: string;
  /** Identifica a transferência (estável por abertura da tela). */
  idBase: string;
}): PlanoDaTransferencia {
  const { de, para } = e;
  if (!de.id || !para.id) return { ok: false, motivo: "Escolha o produto de destino." };
  if (de.id === para.id) return { ok: false, motivo: "A origem e o destino são o mesmo produto." };
  if (!Number.isInteger(e.quantidade) || e.quantidade <= 0) {
    return { ok: false, motivo: "A quantidade precisa ser um número inteiro maior que zero." };
  }
  if (!DATA.test(e.data) || new Date(`${e.data}T00:00:00Z`).toISOString().slice(0, 10) !== e.data) {
    return { ok: false, motivo: "Informe uma data válida." };
  }
  const emCasa = Math.max(Number(de.emCasa) || 0, 0);
  if (e.quantidade > emCasa) {
    return {
      ok: false,
      motivo: emCasa > 0
        ? `Só há ${emCasa} un em casa em “${de.nome}” — não dá pra transferir ${e.quantidade}.`
        : `Não há estoque em casa em “${de.nome}” pra transferir.`,
    };
  }
  if (!String(e.idBase ?? "").trim()) return { ok: false, motivo: "Transferência sem identificação." };

  const custo = Number(de.custoMedio) > 0 ? Number(de.custoMedio) : null;
  const motivo = String(e.obs ?? "").trim();
  const comum = { data: e.data, transferenciaId: e.idBase };

  const saida: PernaDoLivro = {
    ...comum,
    id: `tr-${e.idBase}-s`,
    productId: de.id,
    tipo: "ajuste",
    quantidade: -e.quantidade,
    obs: `Transferência para ${para.nome}${motivo ? ` — ${motivo}` : ""}`.slice(0, 500),
    estoqueAntes: Math.max(de.estoqueTotal, 0),
    custoMedioAntes: Number(de.custoMedio) || 0,
    transferenciaCom: para.id,
  };
  const entrada: PernaDoLivro = {
    ...comum,
    id: `tr-${e.idBase}-e`,
    productId: para.id,
    tipo: "entrada",
    quantidade: e.quantidade,
    ...(custo != null ? { custoUnit: custo } : {}),
    obs: `Transferência de ${de.nome}${motivo ? ` — ${motivo}` : ""}`.slice(0, 500),
    estoqueAntes: Math.max(para.estoqueTotal, 0),
    custoMedioAntes: Number(para.custoMedio) || 0,
    transferenciaCom: de.id,
  };

  return {
    ok: true,
    saida,
    entrada,
    custoUnit: custo,
    novoCustoDestino: custo != null
      ? custoDestinoAposReceber(para.estoqueTotal, Number(para.custoMedio) || 0, e.quantidade, custo)
      : Number(para.custoMedio) || 0,
    sobraNaOrigem: emCasa - e.quantidade,
  };
}
