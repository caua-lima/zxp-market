/**
 * O livro do Financeiro (exclusivo do owner): contas, movimentos e obrigações.
 *
 * ─── AS REGRAS QUE MAIS ERRAM EM PLANILHA ───────────────────────────────
 *
 *  · Transferência entre contas NÃO é receita nem despesa: tira de uma, põe
 *    na outra, resultado zero. Duas pernas com o mesmo `transferenciaId`.
 *  · Saldo de conta só existe com SALDO DE ABERTURA comprovado (valor + data):
 *    abertura + movimentos desde ela. Sem abertura, o que se mostra é a
 *    "movimentação do período" — nunca um saldo inventado.
 *  · Obrigação (conta a pagar) prevista NÃO é saída: só a BAIXA gera
 *    movimento. Baixa parcial reduz o devido; não passa do que falta.
 *  · Recorrência gera uma obrigação por competência, com chave única
 *    (`recorrenciaId:AAAA-MM`): gerar de novo não duplica.
 *  · Compra de estoque e retirada do dono saem do caixa mas não são despesa
 *    do resultado (estoque vira CMV quando vende; retirada é do sócio).
 *
 * Puro e autossuficiente (sem `@/`).
 */

import type { Centavos } from "./dinheiro";

export type TipoConta = "mercado_pago" | "banco" | "caixa";

export type Conta = {
  id: string;
  nome: string;
  tipo: TipoConta;
  /** Saldo comprovado numa data (extrato, print). Sem isto não há "saldo", só movimentação. */
  abertura?: { centavos: Centavos; data: string; comprovacao: string };
  ativa: boolean;
};

export type Natureza =
  | "receita"         // entra no resultado
  | "despesa"         // entra no resultado
  | "compra_estoque"  // sai do caixa, vira estoque (não é despesa do resultado)
  | "retirada"        // retirada do dono (não é despesa do resultado)
  | "transferencia"   // entre contas próprias (resultado zero)
  | "ajuste";         // correção de saldo, com motivo

export type Movimento = {
  id: string;
  contaId: string;
  /** Com sinal: entrada positiva, saída negativa. */
  centavos: Centavos;
  natureza: Natureza;
  /** AAAA-MM-DD em que o dinheiro mexeu. */
  data: string;
  descricao: string;
  categoria: string;
  origem: "manual" | "importacao" | "mercado_pago";
  /** Identificador estável da origem (id do MP, linha do extrato) — deduplicação. */
  refExterna?: string;
  obrigacaoId?: string;
  transferenciaId?: string;
};

export type Baixa = { movimentoId: string; centavos: Centavos; data: string };

export type Obrigacao = {
  id: string;
  descricao: string;
  categoria: string;
  favorecido: string;
  /** AAAA-MM a que a despesa se refere (DRE). */
  competencia: string;
  /** AAAA-MM-DD. */
  vencimento: string;
  /** Valor previsto, positivo. */
  centavos: Centavos;
  natureza: Exclude<Natureza, "receita" | "transferencia" | "ajuste">;
  parcela?: { numero: number; de: number };
  recorrenciaId?: string;
  baixas: Baixa[];
  cancelada?: boolean;
};

export type Recorrencia = {
  id: string;
  descricao: string;
  categoria: string;
  favorecido: string;
  centavos: Centavos;
  natureza: Obrigacao["natureza"];
  /** Dia do vencimento (1–31; meses curtos usam o último dia). */
  diaVencimento: number;
  /** AAAA-MM da primeira competência. */
  desde: string;
  /** AAAA-MM da última (inclusive); ausente = sem fim. */
  ate?: string;
};

// ── Obrigações ───────────────────────────────────────────────────────────

export const pagoDe = (o: Obrigacao): Centavos => o.baixas.reduce((s, b) => s + b.centavos, 0);
export const devidoDe = (o: Obrigacao): Centavos => (o.cancelada ? 0 : Math.max(o.centavos - pagoDe(o), 0));

export type SituacaoObrigacao = "paga" | "parcial" | "vencida" | "a_vencer" | "cancelada";

export function situacaoDe(o: Obrigacao, hoje: string): SituacaoObrigacao {
  if (o.cancelada) return "cancelada";
  const devido = devidoDe(o);
  if (devido === 0) return "paga";
  if (o.vencimento < hoje) return "vencida";
  return pagoDe(o) > 0 ? "parcial" : "a_vencer";
}

export type ResultadoBaixa =
  | { ok: true; obrigacao: Obrigacao; movimento: Movimento }
  | { ok: false; motivo: string };

/**
 * Registrar pagamento (anotação interna — não move dinheiro de verdade).
 * Gera o movimento de saída na conta e a baixa na obrigação. Não passa do
 * devido; repetir com o mesmo `movimentoId` não duplica.
 */
export function registrarBaixa(o: Obrigacao, e: { contaId: string; centavos: Centavos; data: string; movimentoId: string }): ResultadoBaixa {
  if (o.cancelada) return { ok: false, motivo: "obrigação cancelada" };
  if (!(e.centavos > 0) || !Number.isInteger(e.centavos)) return { ok: false, motivo: "valor precisa ser maior que zero" };
  if (o.baixas.some((b) => b.movimentoId === e.movimentoId)) return { ok: false, motivo: "esse pagamento já foi registrado" };
  const devido = devidoDe(o);
  if (e.centavos > devido) return { ok: false, motivo: `passa do que falta pagar (${devido} centavos)` };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.data)) return { ok: false, motivo: "data inválida" };
  const movimento: Movimento = {
    id: e.movimentoId, contaId: e.contaId, centavos: -e.centavos, natureza: o.natureza, data: e.data,
    descricao: o.parcela ? `${o.descricao} (${o.parcela.numero}/${o.parcela.de})` : o.descricao,
    categoria: o.categoria, origem: "manual", obrigacaoId: o.id,
  };
  return { ok: true, movimento, obrigacao: { ...o, baixas: [...o.baixas, { movimentoId: e.movimentoId, centavos: e.centavos, data: e.data }] } };
}

// ── Recorrência ──────────────────────────────────────────────────────────

const diasNoMes = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();

/** Chave única da obrigação de uma recorrência numa competência. */
export const chaveDaRecorrencia = (recorrenciaId: string, competencia: string) => `rec_${recorrenciaId}_${competencia}`;

/**
 * As obrigações de uma recorrência até `ateCompetencia`, menos as que já
 * existem (pela chave). Gerar duas vezes não duplica.
 */
export function gerarDaRecorrencia(r: Recorrencia, ateCompetencia: string, existentes: ReadonlySet<string>): Obrigacao[] {
  const fim = r.ate && r.ate < ateCompetencia ? r.ate : ateCompetencia;
  const out: Obrigacao[] = [];
  let [ano, mes] = r.desde.split("-").map(Number);
  for (let guarda = 0; guarda < 240; guarda++) {
    const comp = `${ano}-${String(mes).padStart(2, "0")}`;
    if (comp > fim) break;
    const id = chaveDaRecorrencia(r.id, comp);
    if (!existentes.has(id)) {
      const dia = Math.min(Math.max(r.diaVencimento, 1), diasNoMes(ano, mes));
      out.push({
        id, descricao: r.descricao, categoria: r.categoria, favorecido: r.favorecido, competencia: comp,
        vencimento: `${comp}-${String(dia).padStart(2, "0")}`, centavos: r.centavos, natureza: r.natureza,
        recorrenciaId: r.id, baixas: [],
      });
    }
    mes += 1;
    if (mes > 12) { mes = 1; ano += 1; }
  }
  return out;
}

// ── Transferência ────────────────────────────────────────────────────────

/** As duas pernas de uma transferência entre contas próprias. */
export function transferir(e: { id: string; de: string; para: string; centavos: Centavos; data: string; descricao?: string }): [Movimento, Movimento] | null {
  if (e.de === e.para || !(e.centavos > 0) || !Number.isInteger(e.centavos)) return null;
  const comum = { natureza: "transferencia" as const, data: e.data, categoria: "Transferência", origem: "manual" as const, transferenciaId: e.id };
  return [
    { ...comum, id: `${e.id}-s`, contaId: e.de, centavos: -e.centavos, descricao: e.descricao ?? "Transferência enviada" },
    { ...comum, id: `${e.id}-e`, contaId: e.para, centavos: e.centavos, descricao: e.descricao ?? "Transferência recebida" },
  ];
}

// ── Posição ──────────────────────────────────────────────────────────────

export type PosicaoDaConta =
  | { tipo: "saldo"; contaId: string; centavos: Centavos; desde: string }
  | { tipo: "so_movimentacao"; contaId: string; centavos: Centavos; motivo: string };

/** Saldo SÓ com abertura comprovada; sem ela, a soma dos movimentos — e a tela diz que não é saldo. */
export function posicaoDaConta(conta: Conta, movimentos: readonly Movimento[]): PosicaoDaConta {
  const daConta = movimentos.filter((m) => m.contaId === conta.id);
  if (!conta.abertura) {
    return { tipo: "so_movimentacao", contaId: conta.id, centavos: daConta.reduce((s, m) => s + m.centavos, 0), motivo: "sem saldo de abertura comprovado" };
  }
  const desde = conta.abertura.data;
  const depois = daConta.filter((m) => m.data > desde);
  return { tipo: "saldo", contaId: conta.id, desde, centavos: conta.abertura.centavos + depois.reduce((s, m) => s + m.centavos, 0) };
}

export type Resultado = {
  receitas: Centavos;
  despesas: Centavos;
  /** receitas + despesas (despesas são negativas). Transferência, compra de estoque e retirada fora. */
  resultado: Centavos;
  compraEstoque: Centavos;
  retiradas: Centavos;
};

/** Resultado de caixa do período: só receita e despesa. */
export function resultadoDoPeriodo(movimentos: readonly Movimento[], de: string, ate: string): Resultado {
  const r: Resultado = { receitas: 0, despesas: 0, resultado: 0, compraEstoque: 0, retiradas: 0 };
  for (const m of movimentos) {
    if (m.data < de || m.data > ate) continue;
    if (m.natureza === "receita") r.receitas += m.centavos;
    else if (m.natureza === "despesa") r.despesas += m.centavos;
    else if (m.natureza === "compra_estoque") r.compraEstoque += m.centavos;
    else if (m.natureza === "retirada") r.retiradas += m.centavos;
  }
  r.resultado = r.receitas + r.despesas;
  return r;
}

/**
 * Deduplicação na importação: pela `refExterna` (id estável da origem). Sem
 * ela NÃO deduplica por valor+data — dois cafés de R$ 5 no mesmo dia são dois
 * movimentos; o caso fica pra conciliação manual.
 */
export function novosPelaReferencia(existentes: readonly Movimento[], chegando: readonly Movimento[]): Movimento[] {
  const vistos = new Set(existentes.map((m) => m.refExterna).filter(Boolean));
  const out: Movimento[] = [];
  for (const m of chegando) {
    if (m.refExterna && vistos.has(m.refExterna)) continue;
    if (m.refExterna) vistos.add(m.refExterna);
    out.push(m);
  }
  return out;
}

/** CSV seguro: célula que começa com = + - @ vira texto (planilha não executa fórmula importada). */
export function celulaCsv(v: unknown): string {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
