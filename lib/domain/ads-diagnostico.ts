/**
 * Onde o funil está furando, e o que arrumar primeiro.
 *
 * ─── POR QUE COMPARAR COM A PRÓPRIA CONTA, E NÃO COM "O MERCADO" ────────
 *
 * A tentação é cravar "CTR bom é acima de 0,5%". Esse número não existe: ele
 * muda por categoria, preço, época do ano e concorrência. Publicar um limiar
 * inventado faria a tela acusar de ruim um anúncio que está normal pro nicho
 * — e o vendedor mexeria no lugar errado com a confiança que o número deu.
 *
 * Então a régua é a MEDIANA DOS SEUS PRÓPRIOS ANÚNCIOS. "Este converte menos
 * da metade do que os seus outros convertem" é uma frase verdadeira, útil e
 * que não depende de eu saber o benchmark do seu mercado.
 *
 * Mediana e não média de propósito: um anúncio com CTR absurdo (ou zerado)
 * puxa a média e faz todo o resto parecer ruim (ou ótimo).
 *
 * ─── A ORDEM DA INVESTIGAÇÃO ────────────────────────────────────────────
 *
 * Conversão primeiro, depois CTR, depois CPC. É a ordem do custo: você já
 * pagou o clique quando a conversão falha, então perder ali é o mais caro.
 * Diagnóstico que começa pelo CPC manda economizar centavos enquanto o funil
 * sangra reais.
 */

export type DadosFunil = {
  titulo: string;
  impressoes: number;
  cliques: number;
  /** Vendas atribuídas (pedidos), não unidades. */
  vendas: number;
  custo: number;
  /** Receita atribuída no mesmo recorte de `vendas`. */
  receita: number;
};

export type Referencia = {
  /** Mediana de CTR (%) entre os anúncios com impressão. null = sem base. */
  ctrMediano: number | null;
  /** Mediana de conversão (%) entre os anúncios com clique. */
  conversaoMediana: number | null;
  /** Mediana de CPC (R$) entre os anúncios com clique. */
  cpcMediano: number | null;
};

export type Etapa = "sem-dados" | "impressao" | "clique" | "conversao" | "cpc" | "ok";

export type Diagnostico = {
  etapa: Etapa;
  titulo: string;
  detalhe: string;
  tone: "pos" | "warn" | "critical" | "info";
};

/** Mediana de uma lista. null quando não há amostra. */
export function mediana(valores: number[]): number | null {
  const v = valores.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const meio = Math.floor(v.length / 2);
  return v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
}

export function calcularReferencia(anuncios: DadosFunil[]): Referencia {
  const ctrs = anuncios.filter((a) => a.impressoes > 0).map((a) => (a.cliques / a.impressoes) * 100);
  const convs = anuncios.filter((a) => a.cliques > 0).map((a) => (a.vendas / a.cliques) * 100);
  const cpcs = anuncios.filter((a) => a.cliques > 0).map((a) => a.custo / a.cliques);
  return {
    ctrMediano: mediana(ctrs),
    conversaoMediana: mediana(convs),
    cpcMediano: mediana(cpcs),
  };
}

/** Abaixo disto de amostra, qualquer taxa é ruído. */
const CLIQUES_MIN = 15;
const IMPRESSOES_MIN = 300;
/** Quanto abaixo da mediana da conta já é um desvio que merece nome. */
const FATOR_RUIM = 0.6;

const pct = (v: number) => `${v.toFixed(2).replace(".", ",")}%`;
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function diagnosticarFunil(a: DadosFunil, ref: Referencia): Diagnostico {
  const ctr = a.impressoes > 0 ? (a.cliques / a.impressoes) * 100 : null;
  const conversao = a.cliques > 0 ? (a.vendas / a.cliques) * 100 : null;
  const cpc = a.cliques > 0 ? a.custo / a.cliques : null;

  // ── Sem amostra pra concluir nada ──
  if (a.impressoes < IMPRESSOES_MIN && a.cliques < CLIQUES_MIN) {
    return {
      etapa: "sem-dados",
      titulo: "Volume baixo demais pra diagnosticar",
      detalhe:
        `${a.impressoes} impressão(ões) e ${a.cliques} clique(s) no período. `
        + "Com essa amostra qualquer taxa é ruído — uma venda a mais mudaria a conclusão.",
      tone: "info",
    };
  }

  /**
   * Impressão de menos: o anúncio nem está sendo mostrado. Vem primeiro
   * porque nada mais no funil importa se o topo está fechado — CTR e
   * conversão de 200 impressões não dizem nada.
   */
  if (a.impressoes < IMPRESSOES_MIN) {
    return {
      etapa: "impressao",
      titulo: "O anúncio quase não está sendo mostrado",
      detalhe:
        `Só ${a.impressoes} impressões no período. O problema está antes do funil: `
        + "orçamento baixo, ROAS alvo apertado demais (o ML deixa de disputar), campanha pausada, "
        + "ou o anúncio perdendo o leilão. Ajuste orçamento e ROAS alvo antes de mexer em foto ou preço.",
      tone: "warn",
    };
  }

  /**
   * Conversão antes de CTR: quando a conversão falha, o clique JÁ FOI PAGO.
   * É o furo mais caro do funil, e o que menos aparece sozinho.
   */
  if (conversao != null && a.cliques >= CLIQUES_MIN && ref.conversaoMediana != null && ref.conversaoMediana > 0) {
    if (conversao < ref.conversaoMediana * FATOR_RUIM) {
      const desperdicio = a.vendas === 0 ? a.custo : null;
      return {
        etapa: "conversao",
        titulo: "Você paga a visita e perde na página",
        detalhe:
          `Converte ${pct(conversao)} dos cliques, contra ${pct(ref.conversaoMediana)} da mediana dos seus anúncios. `
          + `São ${a.cliques} cliques pagos que renderam ${a.vendas} venda(s)`
          + (desperdicio != null ? `, com ${brl(desperdicio)} investidos e nenhum retorno` : "")
          + ". O tráfego chega e não compra: olhe preço contra a concorrência, prazo de entrega, "
          + "fotos, descrição e reputação. É o furo mais caro, porque o clique já foi pago.",
        tone: a.vendas === 0 ? "critical" : "warn",
      };
    }
  }

  // ── CTR: quem vê não clica ──
  if (ctr != null && ref.ctrMediano != null && ref.ctrMediano > 0 && ctr < ref.ctrMediano * FATOR_RUIM) {
    return {
      etapa: "clique",
      titulo: "Aparece, mas não chama o clique",
      detalhe:
        `CTR de ${pct(ctr)} contra ${pct(ref.ctrMediano)} da mediana dos seus anúncios — `
        + `${a.impressoes} pessoas viram e só ${a.cliques} clicaram. `
        + "O que decide o clique é o que aparece na busca: foto principal, título e preço. "
        + "Compare o seu com os três primeiros da busca pelo mesmo termo.",
      tone: "warn",
    };
  }

  // ── CPC: converte e chama clique, mas o clique custa caro ──
  if (cpc != null && ref.cpcMediano != null && ref.cpcMediano > 0 && cpc > ref.cpcMediano / FATOR_RUIM) {
    return {
      etapa: "cpc",
      titulo: "O clique está caro",
      detalhe:
        `CPC de ${brl(cpc)} contra ${brl(ref.cpcMediano)} da mediana dos seus anúncios. `
        + "O funil está saudável — chama clique e converte — mas você está pagando mais caro pela visita. "
        + "Costuma ser disputa alta pela palavra. Vale checar se o ROAS ainda fecha nesse custo.",
      tone: "warn",
    };
  }

  return {
    etapa: "ok",
    titulo: "Funil sem gargalo aparente",
    detalhe:
      `CTR de ${ctr != null ? pct(ctr) : "—"}, conversão de ${conversao != null ? pct(conversao) : "—"} `
      + `e CPC de ${cpc != null ? brl(cpc) : "—"} — todos dentro do padrão dos seus anúncios. `
      + "Se o resultado ainda não fecha, o problema é margem, não funil: olhe preço e custo.",
    tone: "pos",
  };
}

export type AcaoPriorizada = {
  titulo: string;
  /** Quanto se ganha por mês arrumando este — o critério da ordem. */
  ganhoPotencial: number;
  acao: string;
};

/**
 * O que arrumar primeiro, medido em DINHEIRO.
 *
 * Ordenar por "pior margem" ou "menor ROAS" põe na frente o anúncio de R$ 12
 * que perde 40%, e deixa pra trás o de R$ 800 que perde 3% — quando o segundo
 * custa muito mais caro. A pergunta certa é "quanto eu ganho arrumando este?",
 * e ela é respondida em reais, não em percentual.
 */
export function priorizarPorImpacto(
  itens: { titulo: string; lucroAtual: number | null; lucroNoIdeal: number | null; investido: number }[],
): AcaoPriorizada[] {
  const comGanho = itens
    .map((i) => {
      // Anúncio no vermelho: o ganho mínimo garantido é parar de perder.
      const ganhoDoIdeal = i.lucroNoIdeal != null && i.lucroAtual != null ? i.lucroNoIdeal - i.lucroAtual : null;
      const ganhoDeParar = (i.lucroAtual ?? 0) < 0 ? -(i.lucroAtual as number) : 0;
      const ganho = Math.max(ganhoDoIdeal ?? 0, ganhoDeParar);
      const acao = ganhoDoIdeal != null && ganhoDoIdeal >= ganhoDeParar
        ? "ajustar o ROAS alvo"
        : "desligar ou corrigir preço";
      return { titulo: i.titulo, ganhoPotencial: ganho, acao };
    })
    .filter((i) => i.ganhoPotencial > 0);

  return comGanho.sort((a, b) => b.ganhoPotencial - a.ganhoPotencial);
}
