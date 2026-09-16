import type { EstadoFonte } from "./estado-fonte";
import type { Pendencia } from "./apuracao-financeira";

/**
 * O estado dos dados de UMA TELA, numa frase.
 *
 * ─── POR QUE UM TERCEIRO VOCABULÁRIO NÃO SERIA ACEITÁVEL ─────────────────
 *
 * Já existem dois, e os dois estão certos no que fazem:
 *
 *   `estado-fonte`         — o estado de CADA fonte de dado (carregando,
 *                            carregada, sem acesso, falhou).
 *   `apuracao-financeira`  — se um NÚMERO pode ser chamado de fechado, e o
 *                            que falta pra isso.
 *
 * O cabeçalho de tela precisa de uma coisa que nenhum dos dois dá: o resumo
 * de tudo isso em um rótulo que cabe ao lado do título. Este módulo não
 * inventa vocabulário novo — ele LÊ os dois e resume. Se ele tivesse a
 * própria noção de "parcial", passaríamos a ter duas definições de parcial, e
 * definição duplicada foi a origem de quase todo número errado nesta base.
 *
 * ─── O QUE O CABEÇALHO PRECISA RESPONDER ─────────────────────────────────
 *
 * Uma pergunta só, e é sempre a mesma: **posso confiar no que estou vendo
 * agora?** Não "o app está ocupado" — isso o spinner já diz.
 */

export type SituacaoDaTela =
  /** Ainda buscando o essencial: não há o que ler. */
  | "carregando"
  /** Tudo que a tela precisa chegou e está apurado. */
  | "completo"
  /** Dá pra usar, com ressalva declarada. */
  | "parcial"
  /** O papel não alcança parte do que a tela mostra. */
  | "sem_acesso"
  /** Falhou o que a tela precisa pra dizer qualquer coisa. */
  | "erro";

export type EstadoDaTela = {
  situacao: SituacaoDaTela;
  /** Rótulo curto, pro selo ao lado do título. */
  rotulo: string;
  /** Uma frase, pro tooltip ou pra linha abaixo do título. */
  detalhe: string;
  /** Cor semântica, nos tokens do tema. */
  cor: string;
  /** Quantas ressalvas existem — o cabeçalho mostra o número, a tela lista. */
  pendencias: number;
};

/**
 * Resume o estado da tela.
 *
 * ─── A ORDEM DAS PERGUNTAS É A PARTE QUE IMPORTA ─────────────────────────
 *
 * Erro ganha de tudo: uma tela que falhou não é "parcial", é uma tela que não
 * dá pra ler. Depois vem carregando — se ainda está vindo, não há o que
 * ressalvar. Só então sem-acesso e parcial.
 *
 * Sem-acesso vem ANTES de parcial de propósito: pro `member`, duas fontes são
 * negadas por definição, e chamar isso de "parcial" sugere um problema a
 * resolver quando é uma resposta — aquele papel não vê aquele dado, e nunca
 * vai ver.
 */
export function resumirEstadoDaTela(args: {
  fontes?: Record<string, EstadoFonte>;
  /** Fontes sem as quais a tela não diz nada. As demais só geram ressalva. */
  essenciais?: readonly string[];
  pendencias?: readonly Pendencia[];
  /** Quando os números foram lidos. */
  atualizadoEm?: Date | null;
}): EstadoDaTela {
  const fontes = args.fontes ?? {};
  const essenciais = args.essenciais ?? Object.keys(fontes);
  const pendencias = args.pendencias ?? [];

  const doEssencial = essenciais.map((n) => fontes[n]).filter(Boolean);
  const todas = Object.values(fontes);

  if (doEssencial.some((f) => f.situacao === "falhou")) {
    return {
      situacao: "erro",
      rotulo: "Não carregou",
      detalhe: "O dado principal desta tela não chegou. Os números abaixo não podem ser lidos como o estado atual.",
      cor: "var(--red)",
      pendencias: pendencias.length,
    };
  }

  if (doEssencial.some((f) => f.situacao === "carregando")) {
    return {
      situacao: "carregando",
      rotulo: "Carregando",
      detalhe: "Buscando os dados desta tela.",
      cor: "var(--muted)",
      pendencias: 0,
    };
  }

  const negadas = todas.filter((f) => f.situacao === "sem_acesso").length;
  if (negadas > 0) {
    return {
      situacao: "sem_acesso",
      rotulo: "Acesso parcial",
      detalhe:
        `Seu acesso não inclui ${negadas === 1 ? "uma parte" : `${negadas} partes`} desta tela. ` +
        "O que falta não é zero — simplesmente não é mostrado.",
      cor: "var(--muted)",
      pendencias: pendencias.length,
    };
  }

  const falhasSecundarias = todas.filter((f) => f.situacao === "falhou").length;
  if (pendencias.length > 0 || falhasSecundarias > 0) {
    const total = pendencias.length + falhasSecundarias;
    return {
      situacao: "parcial",
      rotulo: `Parcial · ${total}`,
      detalhe:
        falhasSecundarias > 0 && pendencias.length === 0
          ? "Parte dos dados não chegou. A tela funciona com o que veio, e o que falta está indicado."
          : "Falta informação pra fechar estes números. As ressalvas estão listadas na tela.",
      cor: "var(--yellow)",
      pendencias: total,
    };
  }

  return {
    situacao: "completo",
    rotulo: "Atualizado",
    detalhe: args.atualizadoEm
      ? `Dados lidos em ${args.atualizadoEm.toLocaleString("pt-BR")}.`
      : "Tudo que esta tela precisa chegou.",
    cor: "var(--green)",
    pendencias: 0,
  };
}

/**
 * "julho de 2026" quando o período é um mês inteiro; senão "01/07 – 22/07".
 *
 * ─── POR QUE ISTO MUDOU DE LUGAR ─────────────────────────────────────────
 *
 * Esta função estava dentro de DreTab, e cada outra tela que mostrava período
 * formatava do seu jeito — uma com "01/07 a 22/07", outra com "1 jul - 22
 * jul". Num app onde a mesma pessoa compara duas abas, três formatos de data
 * fazem parecer que são períodos diferentes.
 */
const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export function rotuloDoPeriodo(de: string, ate: string): string {
  if (!de || !ate) return "";
  const [fy, fm, fd] = de.split("-").map(Number);
  const [ty, tm, td] = ate.split("-").map(Number);
  if (!fy || !ty) return `${de} – ${ate}`;

  const ultimoDia = new Date(fy, fm, 0).getDate();
  if (fy === ty && fm === tm && fd === 1 && td === ultimoDia) {
    return `${MESES[fm - 1]} de ${fy}`;
  }
  // Mesmo ano: o ano aparece uma vez só, no fim. Repetir "/2026" dos dois
  // lados gasta a largura que o celular não tem.
  const curto = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
  if (fy === ty) return `${curto(de)} – ${curto(ate)}/${fy}`;
  return `${curto(de)}/${fy} – ${curto(ate)}/${ty}`;
}
