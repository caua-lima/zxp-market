import type { Cost } from "./types";
import { COST_CATEGORIA_LABEL } from "./types";
import { contribuicaoNoPeriodo, janelaDeVigencia } from "./vigencia-custo";
import { parseBRNumber, normalizeCostDate, diasNoMes } from "./calc";

/**
 * A lista de custos: buscar, filtrar, ordenar — e separar o que JÁ SAIU do
 * que ainda vai sair.
 *
 * ─── A DISTINÇÃO QUE NÃO EXISTIA ─────────────────────────────────────────
 *
 * A aba mostrava um número só, "pesa no mês", e ele era o mês INTEIRO. No dia
 * 8 de setembro, um pró-labore de R$ 4.000 aparecia como se já tivesse saído.
 *
 * São duas coisas:
 *
 *   ACUMULADO — o que já aconteceu, do dia 1 até hoje. É o que se compara com
 *               o extrato.
 *   PROJEÇÃO  — o que o mês inteiro vai custar se nada mudar. É o que se usa
 *               pra decidir preço.
 *
 * Mostrar só a projeção e chamar de "pesa no mês" faz o mês em curso parecer
 * pior do que está; mostrar só o acumulado faz parecer melhor. As duas juntas,
 * nomeadas, não enganam em direção nenhuma.
 *
 * A conta é a mesma dos dois lados — `contribuicaoNoPeriodo`, a definição que
 * a DRE e o Dashboard usam. O que muda é só onde a janela termina.
 */

export type ImpactoNoMes = {
  /** Do dia 1 até hoje. */
  acumulado: number;
  /** O mês inteiro, se nada mudar. */
  projetado: number;
  /** O mês já terminou? Aí os dois são o mesmo número e a tela mostra um só. */
  mesFechado: boolean;
};

function paraVigencia(c: Cost) {
  return {
    valor: parseBRNumber(c.valor),
    freq: c.freq,
    data: normalizeCostDate(c.data) ?? c.data,
    vigenteDe: c.vigenteDe,
    vigenteAte: c.vigenteAte,
    ativo: c.ativo,
  };
}

/**
 * O impacto de UM custo já salvo no mês de competência: quanto já saiu e
 * quanto o mês inteiro vai custar.
 *
 * ─── NÃO CONFUNDIR COM `impactoNoMes` DE `custo-form` ───────────────────
 *
 * Esta função já se chamou `impactoNoMes`, e o nome era uma armadilha: em
 * `custo-form` existe outra `impactoNoMes`, que responde coisa diferente —
 * "em qual mês este RASCUNHO vai pesar pela primeira vez, e quanto". Um
 * custo mensal cadastrado no dia 14 só pesa no mês SEGUINTE, e é isso que
 * aquela responde.
 *
 * Esta aqui recebe um custo JÁ SALVO e um mês, e divide aquele mês em dois:
 * o que já aconteceu e o total. As duas são necessárias e nenhuma substitui
 * a outra — o que não podia continuar é as duas se chamarem igual, na mesma
 * pasta, esperando que ninguém importasse a errada.
 */
export function acumuladoEProjetado(c: Cost, mes: string, hojeISO: string): ImpactoNoMes {
  const de = `${mes}-01`;
  const fim = `${mes}-${String(diasNoMes(mes)).padStart(2, "0")}`;
  const v = paraVigencia(c);

  const projetado = contribuicaoNoPeriodo(v, { de, ate: fim }, hojeISO);

  // Mês passado: não há nada a projetar, e "até hoje" seria o mês todo mesmo.
  // Mês futuro: nada aconteceu ainda, e o acumulado é zero.
  if (hojeISO > fim) return { acumulado: projetado, projetado, mesFechado: true };
  if (hojeISO < de) return { acumulado: 0, projetado, mesFechado: false };

  const acumulado = contribuicaoNoPeriodo(v, { de, ate: hojeISO }, hojeISO);
  return { acumulado, projetado, mesFechado: hojeISO >= fim };
}

/** O impacto de uma lista inteira, somado. */
export function impactoDaLista(custos: readonly Cost[], mes: string, hojeISO: string): ImpactoNoMes {
  let acumulado = 0, projetado = 0, fechado = true;
  for (const c of custos) {
    const i = acumuladoEProjetado(c, mes, hojeISO);
    acumulado += i.acumulado;
    projetado += i.projetado;
    if (!i.mesFechado) fechado = false;
  }
  // Lista vazia não é um mês fechado — é uma lista vazia.
  return { acumulado, projetado, mesFechado: custos.length > 0 && fechado };
}

/**
 * A vigência, em texto.
 *
 * O brief pede essa coluna, e ela não existia na linha: um custo arquivado em
 * março e outro que começa em outubro apareciam iguais. Sem vigência visível,
 * a única forma de saber por que um custo não está somando era abrir o
 * formulário dele.
 */
export function rotuloDaVigencia(c: Cost, hojeISO: string): string {
  const j = janelaDeVigencia(paraVigencia(c), hojeISO);
  const br = (s: string) => (s && s.length >= 10 ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : s);

  if (c.freq === "avulso") {
    const d = normalizeCostDate(c.data) ?? c.data;
    return d ? `em ${br(d)}` : "sem data";
  }
  if (c.ativo === false) {
    return c.vigenteAte ? `até ${br(c.vigenteAte)}` : "arquivado";
  }
  if (c.vigenteDe && c.vigenteDe > hojeISO) return `a partir de ${br(c.vigenteDe)}`;
  if (c.vigenteDe) return `desde ${br(c.vigenteDe)}`;
  return j.de ? `desde ${br(j.de)}` : "sem início definido";
}

export type FiltroCustos = {
  /** Texto livre: nome, categoria, centro de custo, observação. */
  busca: string;
  /** Categorias aceitas. Vazio = todas. */
  categorias: string[];
  /** Frequências aceitas. Vazio = todas. */
  frequencias: string[];
  /** Mostrar também os arquivados. */
  incluirArquivados: boolean;
};

export const FILTRO_VAZIO: FiltroCustos = {
  busca: "", categorias: [], frequencias: [], incluirArquivados: false,
};

/** Normaliza pra busca: sem acento, minúsculo. */
function chave(s: unknown): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Aplica busca e filtros.
 *
 * A busca varre nome, categoria, centro de custo e observação — e ignora
 * acento nos dois lados. Quem digita "agua" tem que achar "Água": exigir o
 * acento certo transforma a busca num quiz de digitação.
 */
export function filtrarCustos(custos: readonly Cost[], f: FiltroCustos): Cost[] {
  const termo = chave(f.busca).trim();
  const cats = new Set(f.categorias);
  const freqs = new Set(f.frequencias);

  return custos.filter((c) => {
    if (!f.incluirArquivados && c.ativo === false) return false;
    if (cats.size && !cats.has(String(c.categoria ?? ""))) return false;
    if (freqs.size && !freqs.has(c.freq)) return false;
    if (!termo) return true;

    const alvo = [
      c.nome,
      c.categoria ? COST_CATEGORIA_LABEL[c.categoria] : "",
      c.categoria,
      c.centroCusto,
      c.observacao,
    ].map(chave).join(" ");

    // Todas as palavras precisam aparecer — "agua galpao" acha o custo de
    // água do galpão e não tudo que tem água OU galpão.
    return termo.split(/\s+/).every((p) => alvo.includes(p));
  });
}

export type OrdemCustos = "impacto" | "nome" | "valor" | "vigencia";

/**
 * Ordena a lista.
 *
 * O padrão é por IMPACTO, decrescente, e não por nome: a pergunta que se faz
 * nesta tela é "o que está me custando mais", e responder isso em ordem
 * alfabética obriga a ler a lista inteira.
 *
 * O desempate é sempre o nome, pra ordem não mudar sozinha entre duas
 * pinturas quando dois custos empatam — lista que se reorganiza sozinha faz
 * a pessoa perder o que estava olhando.
 */
export function ordenarCustos(
  custos: readonly Cost[],
  ordem: OrdemCustos,
  mes: string,
  hojeISO: string,
): Cost[] {
  const porNome = (a: Cost, b: Cost) =>
    String(a.nome ?? "").localeCompare(String(b.nome ?? ""), "pt-BR");

  const lista = [...custos];

  if (ordem === "nome") return lista.sort(porNome);

  if (ordem === "valor") {
    return lista.sort((a, b) => (parseBRNumber(b.valor) - parseBRNumber(a.valor)) || porNome(a, b));
  }

  if (ordem === "vigencia") {
    // Mais recente primeiro: o que mudou por último é o que se quer conferir.
    const ini = (c: Cost) => c.vigenteDe || normalizeCostDate(c.data) || c.data || "";
    return lista.sort((a, b) => String(ini(b)).localeCompare(String(ini(a))) || porNome(a, b));
  }

  return lista.sort((a, b) =>
    (acumuladoEProjetado(b, mes, hojeISO).projetado - acumuladoEProjetado(a, mes, hojeISO).projetado) || porNome(a, b));
}

/** Quantos filtros estão ativos — pro botão dizer "Filtros (2)". */
export function filtrosAtivos(f: FiltroCustos): number {
  return (f.busca.trim() ? 1 : 0)
    + f.categorias.length
    + f.frequencias.length
    + (f.incluirArquivados ? 1 : 0);
}

/**
 * ─── ATIVO, FUTURO E ENCERRADO NÃO SÃO A MESMA COISA ──────────────────────
 *
 * A tela tratava tudo o que não vale hoje como "arquivado". Um custo que só
 * começa em outubro e um que foi encerrado em março apareciam no mesmo saco, e
 * o botão "Mostrar arquivados" só funcionava se existisse ao menos um ativo.
 *
 *   ativo     — vale hoje e não foi arquivado.
 *   futuro    — a vigência ainda não começou. Vai contar; ainda não contou.
 *   encerrado — foi arquivado ou a vigência acabou. Continua no histórico.
 */
export type SituacaoDoCusto = "ativo" | "futuro" | "encerrado";

export function situacaoDoCusto(c: Cost, hojeISO: string): SituacaoDoCusto {
  if (c.ativo === false) return "encerrado";
  const j = janelaDeVigencia(paraVigencia(c), hojeISO);
  if (hojeISO < j.de) return "futuro";
  if (hojeISO > j.ate) return "encerrado";
  return "ativo";
}

/** Quantos custos há em cada situação — pra o botão dizer o que ele revela. */
export function contarPorSituacao(custos: readonly Cost[], hojeISO: string): Record<SituacaoDoCusto, number> {
  const n: Record<SituacaoDoCusto, number> = { ativo: 0, futuro: 0, encerrado: 0 };
  for (const c of custos) n[situacaoDoCusto(c, hojeISO)]++;
  return n;
}

/**
 * O que a lista está dizendo, e por quê. Quatro situações que tinham a mesma
 * mensagem ("nenhum custo cadastrado") e são coisas diferentes:
 *
 *   sem-cadastro — não existe custo nenhum (ou a fonte não carregou: quem chama
 *                  decide o texto a partir do estado da fonte).
 *   sem-ativos   — existem custos, mas nenhum vale hoje e os encerrados/futuros
 *                  estão escondidos. A saída é MOSTRÁ-LOS, não cadastrar outro.
 *   filtro-vazio — busca ou filtro esconderam tudo. A saída é limpar o filtro.
 *   com-itens    — há o que listar.
 */
export type VistaDaLista = "sem-cadastro" | "sem-ativos" | "filtro-vazio" | "com-itens";

export function vistaDaLista(a: {
  totalCadastrado: number;
  visiveis: number;
  incluirArquivados: boolean;
  /** Busca, categoria ou recorrência ativas (não conta "incluir arquivados"). */
  filtroRestritivo: boolean;
}): VistaDaLista {
  if (a.totalCadastrado === 0) return "sem-cadastro";
  if (a.visiveis > 0) return "com-itens";
  if (a.filtroRestritivo) return "filtro-vazio";
  return a.incluirArquivados ? "filtro-vazio" : "sem-ativos";
}

/** Há busca, categoria ou recorrência restringindo a lista? */
export function temFiltroRestritivo(f: FiltroCustos): boolean {
  return f.busca.trim() !== "" || f.categorias.length > 0 || f.frequencias.length > 0;
}
