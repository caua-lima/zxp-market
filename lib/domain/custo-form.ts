/**
 * O formulário de custo — a parte que decide, sem tela nenhuma.
 *
 * ─── O QUE ESTAVA ERRADO NA ABA ─────────────────────────────────────────
 *
 * 1. "＋ Adicionar Custo" gravava um custo VAZIO no banco na hora do clique.
 *    Quem desistia deixava para trás um custo diário sem nome e sem valor.
 * 2. Não havia botão de salvar: cada tecla disparava uma gravação 350 ms
 *    depois, sem aviso nenhum. E o erro era engolido (`.catch(() => {})`) —
 *    se a gravação falhasse, o valor digitado continuava na tela e parecia
 *    salvo. É o pior jeito de falhar: em silêncio, com cara de sucesso.
 * 3. O campo de valor era `type="number"`, que no teclado brasileiro recusa
 *    a vírgula. "12,50" não entrava.
 *
 * Aqui mora o que corrige isso sem depender de React: ler o valor como um
 * brasileiro digita, validar antes de gravar, e montar o documento final.
 *
 * ─── O FORMATO GRAVADO É SEMPRE "1234.56" ───────────────────────────────
 *
 * A rota de métricas lê o custo com `Number(valor)`. `Number("12,50")` é NaN,
 * e um NaN somado a `custosOp` contamina o lucro do Dashboard inteiro — não
 * só o daquele custo. Então o que se digita ("1.234,56") é interpretado aqui
 * e gravado no formato que os DOIS leitores entendem: `Number` no servidor e
 * `parseBRNumber` na tela.
 */

import { totalCustosMes } from "./calc";
import type { Cost, CostCategoria } from "./types";

export type Frequencia = Cost["freq"];
export type Escopo = NonNullable<Cost["escopo"]>;

/** O que a pessoa está preenchendo — ainda texto, ainda não é um custo. */
export type RascunhoCusto = {
  /** `null` = custo novo. */
  id: string | null;
  nome: string;
  /** Exatamente o que foi digitado: "1.234,56", "R$ 50", "12.5". */
  valorTexto: string;
  freq: Frequencia;
  /** yyyy-mm-dd. Só significa algo pro custo avulso. */
  data: string;
  escopo: Escopo;
  categoria: CostCategoria | "";
  centroCusto: string;
  observacao: string;
};

export const FREQUENCIA_META: Record<Frequencia, { rotulo: string; explica: string }> = {
  diario: { rotulo: "Todo dia", explica: "Desconta o valor em cada dia do mês. Ex.: diária de ajudante." },
  mensal: { rotulo: "Todo mês", explica: "Desconta uma vez por mês. Ex.: aluguel, sistema, contador." },
  avulso: { rotulo: "Uma vez", explica: "Desconta só na data escolhida. Ex.: conserto, compra pontual." },
};

export const ESCOPO_META: Record<Escopo, { rotulo: string; explica: string }> = {
  dash: {
    rotulo: "Custo da operação",
    explica: "Entra no lucro do Dashboard e na DRE. Ex.: embalagem, fita, frete extra.",
  },
  dre: {
    rotulo: "Despesa da empresa",
    explica: "Só aparece na DRE, sem mexer no lucro do dia a dia. Ex.: pró-labore, contador.",
  },
};

/** Teto do nome — cabe numa linha da lista e numa linha da DRE. */
export const NOME_MAX = 80;

/**
 * Lê um valor em reais do jeito que se digita no Brasil.
 *
 * ─── AS REGRAS, E POR QUE CADA UMA ──────────────────────────────────────
 *
 *   "1.234,56"  → 1234.56   vírgula por último: ela é o decimal
 *   "1,234.56"  → 1234.56   ponto por último: ele é o decimal
 *   "12,5"      → 12.5      só vírgula: decimal
 *   "1.234"     → 1234      ponto + exatamente 3 dígitos: MILHAR
 *   "12.50"     → 12.5      ponto + 1 ou 2 dígitos: decimal
 *   "1.234.567" → 1234567   vários pontos: todos são milhar
 *   "R$ 50"     → 50        símbolo e espaço saem
 *
 * O caso "1.234" é o que decide: num campo de dinheiro, um brasileiro que
 * digita isso quer dizer mil duzentos e trinta e quatro. A leitura antiga
 * (`parseFloat`) dava 1,234 — um custo mil vezes menor, e ninguém veria.
 * A prévia do formulário ("vai pesar R$ 1.234,00") existe justamente pra
 * qualquer leitura errada ficar à vista antes de salvar.
 *
 * @returns `null` quando não dá pra ler um número com segurança. Nunca chuta.
 */
export function lerValorEmReais(texto: string | null | undefined): number | null {
  let s = String(texto ?? "").replace(/R\$/gi, "").replace(/\s+/g, "");
  if (!s) return null;
  // Custo negativo não existe; sinal de menos é erro de digitação, não intenção.
  if (s.includes("-")) return null;

  const temVirgula = s.includes(",");
  const temPonto = s.includes(".");

  if (temVirgula && temPonto) {
    const decimalEhVirgula = s.lastIndexOf(",") > s.lastIndexOf(".");
    s = decimalEhVirgula
      ? s.replace(/\./g, "").replace(",", ".")
      : s.replace(/,/g, "");
  } else if (temVirgula) {
    // Duas vírgulas não é formato brasileiro nem americano — não adivinha.
    if ((s.match(/,/g) ?? []).length > 1) return null;
    s = s.replace(",", ".");
  } else if (temPonto) {
    const pontos = (s.match(/\./g) ?? []).length;
    if (pontos > 1) {
      s = s.replace(/\./g, "");
    } else {
      const [inteiro, fracao] = s.split(".");
      const pareceMilhar = fracao.length === 3 && inteiro.length >= 1 && inteiro !== "0";
      if (pareceMilhar) s = inteiro + fracao;
    }
  }

  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

export function rascunhoVazio(padrao: { hojeISO: string; escopo?: Escopo }): RascunhoCusto {
  return {
    id: null,
    nome: "",
    valorTexto: "",
    /**
     * Mensal como padrão, não diário.
     *
     * O padrão antigo era diário, e é o que mais estraga um número por
     * descuido: R$ 250 esquecido em "diário" vira R$ 7.500 no mês. As
     * despesas que se cadastram de verdade — contador, sistema, aluguel —
     * são mensais.
     */
    freq: "mensal",
    data: String(padrao.hojeISO).slice(0, 10),
    escopo: padrao.escopo ?? "dash",
    categoria: "",
    centroCusto: "",
    observacao: "",
  };
}

/**
 * Um custo já gravado, de volta pra rascunho — pra editar.
 *
 * O valor volta formatado em pt-BR ("250,00"), não como foi gravado
 * ("250.00"): quem abre pra editar lê do jeito que digitaria.
 */
export function rascunhoDe(c: Cost, hojeISO: string): RascunhoCusto {
  const n = lerValorEmReais(c.valor);
  return {
    id: c.id,
    nome: c.nome ?? "",
    valorTexto: n == null ? String(c.valor ?? "") : n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    freq: c.freq,
    data: c.data || String(hojeISO).slice(0, 10),
    escopo: c.escopo ?? "dash",
    categoria: c.categoria ?? "",
    centroCusto: c.centroCusto ?? "",
    observacao: c.observacao ?? "",
  };
}

export type ErrosCusto = Partial<Record<"nome" | "valor" | "data", string>>;

/** O que impede salvar. Objeto vazio = pode salvar. */
export function validarCusto(r: RascunhoCusto): ErrosCusto {
  const erros: ErrosCusto = {};

  const nome = r.nome.trim();
  if (!nome) erros.nome = "Dê um nome pra saber depois o que é esse custo.";
  else if (nome.length > NOME_MAX) erros.nome = `Nome muito longo — até ${NOME_MAX} caracteres.`;

  const valor = lerValorEmReais(r.valorTexto);
  if (!r.valorTexto.trim()) erros.valor = "Informe o valor. Ex.: 250 ou 1.234,56.";
  else if (valor == null) erros.valor = "Não consegui ler esse valor. Use o formato 1.234,56.";
  else if (valor <= 0) erros.valor = "O valor precisa ser maior que zero.";

  if (r.freq === "avulso" && !/^\d{4}-\d{2}-\d{2}$/.test(r.data)) {
    erros.data = "Escolha a data em que esse custo aconteceu.";
  }

  return erros;
}

export function podeSalvar(r: RascunhoCusto): boolean {
  return Object.keys(validarCusto(r)).length === 0;
}

/**
 * O documento final, pronto pra gravar.
 *
 * @param existente o custo que está sendo editado, se houver. Campos que o
 *   formulário não conhece (como `ativo`) são preservados: editar um custo
 *   arquivado não pode desarquivá-lo por tabela.
 * @throws se o rascunho não passar na validação — quem chama deve validar
 *   antes, e gravar um valor ilegível é exatamente o bug que isto evita.
 */
export function custoDe(r: RascunhoCusto, id: string, existente?: Cost): Cost {
  const valor = lerValorEmReais(r.valorTexto);
  if (valor == null || valor <= 0 || !r.nome.trim()) {
    throw new Error("custoDe: rascunho inválido — valide antes de gravar");
  }
  const custo: Cost = {
    ...(existente ?? {}),
    id,
    nome: r.nome.trim(),
    // Sempre "1234.56": o formato que `Number` e `parseBRNumber` leem igual.
    valor: valor.toFixed(2),
    freq: r.freq,
    data: r.data,
    escopo: r.escopo,
  };
  // Opcional vazio sai do documento, em vez de virar string vazia gravada.
  if (r.categoria) custo.categoria = r.categoria; else delete custo.categoria;
  if (r.centroCusto.trim()) custo.centroCusto = r.centroCusto.trim(); else delete custo.centroCusto;
  if (r.observacao.trim()) custo.observacao = r.observacao.trim(); else delete custo.observacao;
  return custo;
}

/**
 * O mês em que faz sentido mostrar o peso do custo.
 *
 * Diário e mensal pesam no mês corrente. Avulso pesa no mês da própria data —
 * mostrar "R$ 0 em setembro" pra um conserto de agosto seria verdade e não
 * serviria pra nada.
 */
export function mesDeReferencia(r: RascunhoCusto, hojeISO: string): string {
  if (r.freq === "avulso" && /^\d{4}-\d{2}/.test(r.data)) return r.data.slice(0, 7);
  return String(hojeISO).slice(0, 7);
}

/**
 * Quanto o custo vai pesar no mês — a prévia antes de salvar.
 *
 * Usa `totalCustosMes`, a MESMA conta dos totais da aba de Custos. Uma prévia
 * com conta própria poderia prometer um número e a tela mostrar outro depois
 * de salvo, que é a origem conhecida de quase todo número errado nesta base.
 *
 * @returns `null` enquanto o valor não for legível.
 */
export function impactoNoMes(r: RascunhoCusto, mes: string): number | null {
  const valor = lerValorEmReais(r.valorTexto);
  if (valor == null || valor <= 0) return null;
  const provisorio: Cost = {
    id: "previa", nome: r.nome || "previa", valor: valor.toFixed(2),
    freq: r.freq, data: r.data, escopo: r.escopo,
  };
  return totalCustosMes([provisorio], mes);
}
