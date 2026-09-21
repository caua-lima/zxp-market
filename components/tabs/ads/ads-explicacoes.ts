import { fmtBRL } from "@/lib/domain/calc";
import { corDoRoas } from "@/lib/domain/ads-cores";
import { num, type LinhaAds } from "./ads-types";

/**
 * As explicações dos números da tabela de Ads — UMA fonte.
 *
 * ─── POR QUE ISTO NÃO ESTÁ MAIS DENTRO DA TABELA ────────────────────────
 *
 * Cada explicação (de onde vem o ROAS, o que é "Via Ads", por que o lucro é "—")
 * morava num atributo `title` da célula. `title` só aparece com mouse: no celular
 * e no teclado a conta por trás do número não existia. E o drawer de detalhe não
 * repetia o que os tooltips diziam — o ROAS dele até era outro número (o do modo
 * escolhido, enquanto a coluna mostra o do painel do Mercado Ads).
 *
 * Agora a tabela usa estas funções nos `title` (mantém o mouse) e o drawer as
 * mostra como TEXTO (toque, teclado e leitor de tela). Uma só definição: os dois
 * lugares não têm como divergir.
 */

export type Explicacao = { chave: string; titulo: string; texto: string };

export function explicacaoRoasObjetivo(l: LinhaAds): string {
  const metaAbaixoDoIdeal = l.i.roasTarget > 0 && l.roasIdeal != null && l.i.roasTarget < l.roasIdeal;
  if (l.i.roasTarget <= 0) return "Nenhum ROAS Objetivo configurado nesta campanha no painel do Mercado Ads.";
  if (metaAbaixoDoIdeal) {
    return `Sua meta no ML é ${num(l.i.roasTarget, 2)}x, ABAIXO do ROAS que entrega a sua margem alvo (${num(l.roasIdeal!, 2)}x). Bater a meta configurada não fecha a margem — é ela que precisa subir.`;
  }
  return `Meta de ${num(l.i.roasTarget, 2)}x configurada por você na campanha.`
    + (l.roasIdeal != null ? ` Cobre o ROAS ideal (${num(l.roasIdeal, 2)}x).` : "")
    + (l.roasMlAds != null ? ` Hoje a campanha entrega ${num(l.roasMlAds, 2)}x.` : "");
}

export function explicacaoInvestido(l: LinhaAds): string {
  return `${num(l.i.prints)} impressões e ${num(l.i.clicks)} cliques — CTR de ${num(l.ctr, 2)}%. CPC médio ${fmtBRL(l.cpc)}.`;
}

export function explicacaoReceita(l: LinhaAds, pub: boolean): string {
  const acos = l.i.adSales > 0 ? (l.i.cost / l.i.adSales) * 100 : null;
  return `${num(l.i.adUnitsAtribuidas)} venda(s) atribuída(s): ${num(l.i.directUnits)} de clique direto + ${num(l.i.indirectUnits)} assistida(s). `
    + (acos != null ? `ACOS ${num(acos, 1)}% (investido ÷ receita atribuída, a mesma conta do painel do ML). ` : "Sem ACOS: não houve receita atribuída. ")
    + `A receita do modo "${pub ? "Publicidade direta" : "Geral"}" é ${fmtBRL(l.v)}.`;
}

export function explicacaoRoas(l: LinhaAds, pub: boolean): string {
  return `Do painel do Mercado Ads: receita atribuída TOTAL (${fmtBRL(l.i.adSales)}) ÷ investido. `
    + `No modo "${pub ? "Publicidade direta" : "Geral"}", sobre ${fmtBRL(l.v)}, dá ${num(l.r, 2)}x. `
    + (l.breakEven != null
      ? `Equilíbrio (não perder dinheiro): ${num(l.breakEven, 2)}x. `
      // Sem equilíbrio, DIZER por quê: as três causas pedem ações opostas.
      : (l.motivoSemBreakEven ? `${l.motivoSemBreakEven} ` : ""))
    + (l.roasIdeal != null
      ? `Ideal (fechar a margem alvo): ${num(l.roasIdeal, 2)}x. `
      : (l.motivoSemIdeal ? `${l.motivoSemIdeal} ` : ""))
    // A cor precisa se explicar: sem isso ela vira enigma.
    + corDoRoas(l.roasMlAds, l.breakEven, l.roasIdeal).motivo;
}

export function explicacaoLucro(l: LinhaAds): string {
  if (l.lucroAtual == null) return "Sem venda vinculada no período pra calcular — não é prejuízo, é falta de dado.";
  if (l.lucroNoIdeal != null) {
    return `Hoje ${fmtBRL(l.lucroAtual)} → ${fmtBRL(l.lucroNoIdeal)} se atingisse o ROAS ideal, mantendo a receita atual. É teto de comparação entre anúncios, não promessa: cortar verba costuma derrubar a receita junto.`;
  }
  return l.motivoSemIdeal ?? "Sem ROAS ideal calculável — não há lucro alvo pra projetar.";
}

export function explicacaoViaAds(l: LinhaAds): string {
  return l.i.totalSales > 0
    ? `${fmtBRL(l.i.adSales)} de ${fmtBRL(l.i.totalSales)} vendidos neste anúncio foram creditados à campanha (clique direto + venda assistida). Quanto maior, mais a venda depende da verba — pausar derruba o faturamento junto.`
    : "Sem venda registrada neste anúncio no período — não há dependência a medir.";
}

/** Todas, na ordem em que o drawer as mostra. */
export function explicacoesDoAnuncio(l: LinhaAds, pub: boolean): Explicacao[] {
  return [
    { chave: "roas", titulo: "ROAS", texto: explicacaoRoas(l, pub) },
    { chave: "roasobj", titulo: "ROAS objetivo (meta da campanha)", texto: explicacaoRoasObjetivo(l) },
    { chave: "receita", titulo: "Receita atribuída", texto: explicacaoReceita(l, pub) },
    { chave: "investido", titulo: "Investido", texto: explicacaoInvestido(l) },
    { chave: "lucro", titulo: "Lucro após Ads", texto: explicacaoLucro(l) },
    { chave: "viaads", titulo: "Via Ads", texto: explicacaoViaAds(l) },
  ];
}
