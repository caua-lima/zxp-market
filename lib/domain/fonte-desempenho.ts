/**
 * De onde vêm os números da aba Desempenho, e quanto eles valem agora — S10
 * da auditoria SaaS.
 *
 * ─── O QUE ESTAVA FRAGMENTADO ───────────────────────────────────────────
 *
 * Três rotas, três caches, nenhuma coordenação:
 *
 *  - /api/ml/desempenho guardava 30 min por período — sem saber de QUAL conta.
 *    Reconectar outra conta do ML servia a reputação da anterior até o cache
 *    vencer.
 *  - /api/ml/reputacao-vendas guardava UMA resposta. Os dois painéis pediam
 *    janelas diferentes e expulsavam um ao outro: cada abertura da aba eram
 *    duas buscas ao vivo de até 16 páginas no ML.
 *  - o "⟳ Atualizar" da aba renovava só o pai; os painéis filhos tinham busca
 *    própria e continuavam com o que tinham.
 *
 * E a janela da reputação era 60 dias fixos, quando o próprio ML diz o período
 * em `metrics.*.period` — 365 dias pra quem vendeu pouco. A tela escrevia
 * "365 dias" ao lado de uma base contada em 60.
 */

import type { SourceState } from "@/lib/domain/tenant";

// ── o período oficial ────────────────────────────────────────────────────

export type PeriodoDaReputacao = {
  /** Dias da janela que o ML usa pra julgar a reputação. */
  dias: number;
  /** Veio da resposta do ML (`true`) ou é o padrão de quando ela não diz (`false`). */
  oficial: boolean;
  /** O texto como o ML mandou ("60 days"), pra quem quiser mostrar. */
  texto: string | null;
};

/** O padrão do MLB quando a API não informa: 60 dias (quem vende 60+ nesse prazo). */
export const PERIODO_PADRAO_DIAS = 60;

type ComPeriodo = { period?: string | null } | null | undefined;

/**
 * A janela da reputação como o ML a informa.
 *
 * `metrics.sales.period` primeiro: é o período do denominador. Na falta, o de
 * qualquer outra métrica — elas costumam coincidir. Formato conhecido: "N days".
 * Qualquer outra coisa não é adivinhada: cai no padrão, marcado como não
 * oficial, pra tela poder dizer que é suposição.
 */
export function periodoOficialDaReputacao(
  metrics: {
    sales?: ComPeriodo;
    claims?: ComPeriodo;
    cancellations?: ComPeriodo;
    delayed_handling_time?: ComPeriodo;
  } | null | undefined,
): PeriodoDaReputacao {
  const candidatos = [metrics?.sales, metrics?.claims, metrics?.cancellations, metrics?.delayed_handling_time];
  for (const c of candidatos) {
    const texto = typeof c?.period === "string" ? c.period.trim() : "";
    const m = texto.match(/^(\d{1,3})\s*days?$/i);
    if (!m) continue;
    const dias = Number(m[1]);
    if (dias >= 1 && dias <= 365) return { dias, oficial: true, texto };
  }
  return { dias: PERIODO_PADRAO_DIAS, oficial: false, texto: null };
}

// ── várias janelas numa busca só ─────────────────────────────────────────

export type JanelaNomeada = { nome: string; de: string; ate: string };

const DIA = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_JANELAS = 4;

/**
 * Lê `janela=nome:AAAA-MM-DD:AAAA-MM-DD` (repetível).
 *
 * A aba precisa de duas contagens — a janela da medalha e a da reputação — e
 * elas se sobrepõem. Buscar as duas separadas era pagar duas vezes pelos
 * mesmos pedidos. A rota busca o intervalo que cobre as duas e conta cada uma.
 */
export function lerJanelasNomeadas(
  valores: string[],
  cobertura: { de: string; ate: string },
): { ok: true; janelas: JanelaNomeada[] } | { ok: false; erro: string } {
  if (valores.length > MAX_JANELAS) return { ok: false, erro: `no máximo ${MAX_JANELAS} janelas` };
  const janelas: JanelaNomeada[] = [];
  const nomes = new Set<string>();
  for (const v of valores) {
    const [nome, de, ate, ...resto] = String(v).split(":");
    if (resto.length || !/^[a-z]{1,20}$/.test(nome ?? "") || !DIA.test(de ?? "") || !DIA.test(ate ?? "")) {
      return { ok: false, erro: `janela inválida: ${String(v).slice(0, 60)}` };
    }
    if (de > ate) return { ok: false, erro: `janela ${nome} invertida` };
    // Fora do que foi buscado, a contagem sairia menor sem aviso — recusa.
    if (de < cobertura.de || ate > cobertura.ate) return { ok: false, erro: `janela ${nome} fora do período buscado` };
    if (nomes.has(nome)) return { ok: false, erro: `janela ${nome} repetida` };
    nomes.add(nome);
    janelas.push({ nome, de, ate });
  }
  return { ok: true, janelas };
}

// ── cache que sabe de qual conta é ───────────────────────────────────────

/**
 * Cache em memória com teto de entradas e validade, e a GERAÇÃO da conexão na
 * chave: reconectar outra conta muda a geração e o que era da anterior deixa
 * de ser achado. Teto porque cada janela pedida é uma chave — sem ele, um
 * lambda quente acumularia respostas sem limite.
 */
export class CacheDeFonte<T> {
  private readonly itens = new Map<string, { em: number; valor: T }>();

  constructor(private readonly teto: number, private readonly validadeMs: number) {}

  static chave(geracao: number, ...partes: (string | number | null | undefined)[]): string {
    return [`g${Number(geracao) || 0}`, ...partes.map((p) => String(p ?? ""))].join("|");
  }

  ler(chave: string, agora: number): { valor: T; em: number } | null {
    const i = this.itens.get(chave);
    if (!i) return null;
    if (agora - i.em >= this.validadeMs) {
      this.itens.delete(chave);
      return null;
    }
    return { valor: i.valor, em: i.em };
  }

  gravar(chave: string, valor: T, agora: number): void {
    this.itens.delete(chave); // reinsere no fim: o mais antigo sai primeiro
    this.itens.set(chave, { em: agora, valor });
    while (this.itens.size > this.teto) {
      const maisAntigo = this.itens.keys().next().value as string;
      this.itens.delete(maisAntigo);
    }
  }

  get tamanho(): number {
    return this.itens.size;
  }
}

// ── o estado da fonte ────────────────────────────────────────────────────

/**
 * O `SourceState` de uma resposta: quando foi buscada, de qual geração da
 * conexão, o que cobre e se veio. "Indisponível" e "vazio" são estados
 * diferentes — erro nunca é taxa zero.
 */
export function estadoDaFonte(p: {
  ok: boolean;
  vazio?: boolean;
  buscadoEm: number | null;
  geracao: number;
  cobertura?: { de: string; ate: string; completa: boolean } | null;
  erro?: string | null;
}): SourceState {
  const fetchedAt = p.buscadoEm != null ? new Date(p.buscadoEm).toISOString() : null;
  const status: SourceState["status"] = !p.ok
    ? "unavailable"
    : p.cobertura && !p.cobertura.completa
      ? "partial"
      : p.vazio
        ? "empty"
        : "fresh";
  return {
    status,
    fetchedAt,
    sourceUpdatedAt: null,
    connectionGeneration: Number(p.geracao) || 0,
    coverage: p.cobertura ? { from: p.cobertura.de, to: p.cobertura.ate, complete: p.cobertura.completa } : null,
    lastSuccessAt: p.ok ? fetchedAt : null,
    errorCode: p.ok ? null : (p.erro ?? "desconhecido"),
  };
}
