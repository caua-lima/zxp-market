/**
 * O histórico de mudanças do próprio app, lido do repositório.
 *
 * ─── PRA QUE ISTO EXISTE ────────────────────────────────────────────────
 *
 * A trilha de auditoria mostra o que se mexe NOS DADOS — quem criou um custo,
 * quem trocou um acesso. Não mostra o que se mexe no SISTEMA: as correções, as
 * telas novas, os números que passaram a fechar. Esse trabalho fica invisível
 * pra quem não escreve o código, e é a maior parte dele.
 *
 * Aqui cada commit publicado vira uma linha com data e hora, e o conjunto vira
 * contagem: quantas entregas, em quantos dias, quanto foi correção e quanto foi
 * recurso novo.
 *
 * ─── POR QUE COMMIT, E NÃO "PUSH" ───────────────────────────────────────
 *
 * Um push leva vários commits de uma vez, e o Git não guarda o instante do
 * push — guarda o de cada commit. Contar pushes daria um número menor e
 * arbitrário (depende de quantas vezes se lembrou de enviar); contar commits
 * conta a mudança em si, que é o que interessa. Cada commit no `main` é uma
 * mudança publicada.
 */

/** Um commit como a API do GitHub o entrega, já reduzido ao que se usa. */
export type CommitBruto = {
  sha: string;
  /** ISO com fuso — vem de `commit.author.date`. */
  data: string;
  /** Primeira linha da mensagem. */
  titulo: string;
  /** Corpo, quando houver. */
  corpo?: string;
  autor: string;
  url?: string;
};

export type TipoMudanca =
  | "recurso" | "correcao" | "refino" | "teste" | "documentacao" | "manutencao" | "outro";

export const TIPO_META: Record<TipoMudanca, { label: string; cor: string; explica: string }> = {
  recurso: { label: "Novo", cor: "var(--green)", explica: "Funcionalidade que não existia antes" },
  correcao: { label: "Correção", cor: "var(--red)", explica: "Um número errado, um botão quebrado" },
  refino: { label: "Refino", cor: "var(--accent)", explica: "Mesma função, feita de um jeito melhor" },
  teste: { label: "Teste", cor: "var(--info)", explica: "Trava um comportamento pra não voltar a quebrar" },
  documentacao: { label: "Documentação", cor: "var(--muted)", explica: "Explicação escrita no código" },
  manutencao: { label: "Manutenção", cor: "var(--muted)", explica: "Dependências, configuração, rotina" },
  outro: { label: "Outro", cor: "var(--muted)", explica: "Sem prefixo reconhecido na mensagem" },
};

/**
 * O tipo, a partir do prefixo da mensagem.
 *
 * O projeto escreve no padrão `tipo(escopo): descrição`. Quando o prefixo não
 * está lá, o commit entra como "outro" — chutar pelo texto livre erraria, e
 * uma etiqueta errada é pior que uma etiqueta genérica.
 */
export function tipoDoCommit(titulo: string): TipoMudanca {
  const m = String(titulo ?? "").trim().toLowerCase().match(/^([a-z]+)(\([^)]*\))?!?:/);
  switch (m?.[1]) {
    case "feat": return "recurso";
    case "fix": return "correcao";
    case "perf": return "refino";
    case "refactor": return "refino";
    case "style": return "refino";
    case "test": return "teste";
    case "docs": return "documentacao";
    case "chore": return "manutencao";
    case "build": return "manutencao";
    case "ci": return "manutencao";
    default: return "outro";
  }
}

/**
 * A descrição sem o prefixo técnico, com a primeira letra maiúscula.
 *
 * "fix(ads): margem sumia" vira "Margem sumia". O prefixo já virou etiqueta
 * colorida ao lado; repeti-lo no texto só rouba espaço de quem lê.
 */
export function descricaoLimpa(titulo: string): string {
  const t = String(titulo ?? "").trim();
  const semPrefixo = t.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, "");
  const base = semPrefixo || t;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** O escopo entre parênteses — a área do app que a mudança tocou. */
export function escopoDoCommit(titulo: string): string | null {
  const m = String(titulo ?? "").trim().match(/^[a-z]+\(([^)]+)\)!?:/i);
  return m ? m[1].trim() : null;
}

export type Mudanca = {
  sha: string;
  /** yyyy-mm-dd no fuso de São Paulo — é por ele que se agrupa. */
  dia: string;
  /** "18:42" no fuso de São Paulo. */
  hora: string;
  data: string;
  tipo: TipoMudanca;
  descricao: string;
  escopo: string | null;
  autor: string;
  url?: string;
};

const FUSO = "America/Sao_Paulo";
const fDia = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" });
const fHora = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" });

export function normalizarCommits(brutos: CommitBruto[]): Mudanca[] {
  return (brutos ?? [])
    .filter((c) => c && c.sha && c.data)
    .map((c) => {
      const d = new Date(c.data);
      const valida = Number.isFinite(d.getTime());
      return {
        sha: c.sha,
        // Data inválida não some da lista: viraria uma mudança "que não houve".
        dia: valida ? fDia.format(d) : "",
        hora: valida ? fHora.format(d) : "",
        data: c.data,
        tipo: tipoDoCommit(c.titulo),
        descricao: descricaoLimpa(c.titulo),
        escopo: escopoDoCommit(c.titulo),
        autor: c.autor,
        url: c.url,
      };
    })
    .sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
}

export type DiaDeMudancas = { dia: string; mudancas: Mudanca[] };

/** Agrupado por dia, do mais recente pro mais antigo. */
export function agruparPorDia(mudancas: Mudanca[]): DiaDeMudancas[] {
  const mapa = new Map<string, Mudanca[]>();
  for (const m of mudancas) {
    const lista = mapa.get(m.dia) ?? [];
    lista.push(m);
    mapa.set(m.dia, lista);
  }
  return Array.from(mapa.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([dia, lista]) => ({ dia, mudancas: lista }));
}

export type ResumoMudancas = {
  total: number;
  /** Quantas de cada tipo. */
  porTipo: Record<TipoMudanca, number>;
  /** Dias em que houve pelo menos uma mudança. */
  diasAtivos: number;
  /** Média por dia ATIVO — não por dia corrido. Ver comentário abaixo. */
  mediaPorDiaAtivo: number;
  /** Mudanças nos últimos 30 dias corridos. */
  ultimos30: number;
  /** O dia com mais mudanças, se houver. */
  diaMaisForte: { dia: string; quantas: number } | null;
  primeira: string | null;
  ultima: string | null;
};

const zerado = (): Record<TipoMudanca, number> => ({
  recurso: 0, correcao: 0, refino: 0, teste: 0, documentacao: 0, manutencao: 0, outro: 0,
});

/**
 * @param hojeISO entra como parâmetro pra função continuar pura — a janela de
 *   30 dias depende de hoje, e sem isso o teste dependeria do relógio.
 */
export function resumir(mudancas: Mudanca[], hojeISO: string): ResumoMudancas {
  const porTipo = zerado();
  const porDia = new Map<string, number>();
  for (const m of mudancas) {
    porTipo[m.tipo] += 1;
    if (m.dia) porDia.set(m.dia, (porDia.get(m.dia) ?? 0) + 1);
  }

  const corte = trinta(hojeISO);
  const ultimos30 = mudancas.filter((m) => m.dia && m.dia >= corte).length;

  let diaMaisForte: { dia: string; quantas: number } | null = null;
  for (const [dia, quantas] of porDia) {
    if (!diaMaisForte || quantas > diaMaisForte.quantas) diaMaisForte = { dia, quantas };
  }

  const ordenadas = mudancas.filter((m) => m.dia).map((m) => m.dia).sort();
  const diasAtivos = porDia.size;

  return {
    total: mudancas.length,
    porTipo,
    diasAtivos,
    /**
     * Média por dia ATIVO, e não por dia corrido.
     *
     * Dividir pelo calendário inteiro afogaria o número em fins de semana e
     * meses parados, e diria menos sobre o ritmo de trabalho do que sobre o
     * tamanho da janela. "Nos dias em que mexeu, foram N mudanças" é o que
     * descreve o dia de trabalho.
     */
    mediaPorDiaAtivo: diasAtivos > 0 ? mudancas.length / diasAtivos : 0,
    ultimos30,
    diaMaisForte,
    primeira: ordenadas[0] ?? null,
    ultima: ordenadas[ordenadas.length - 1] ?? null,
  };
}

/** O dia de 29 dias atrás — o começo da janela de 30 dias, incluindo hoje. */
function trinta(hojeISO: string): string {
  const m = String(hojeISO).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - 29));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** "terça, 9 de setembro de 2026" — o cabeçalho de cada dia na lista. */
export function diaPorExtenso(dia: string): string {
  const m = String(dia).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return dia || "sem data";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(d);
}
