"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import type { Goals } from "@/lib/domain/types";
import {
  fmtBRL,
  formatMesBR,
  formatDateBR,
  formatDateLong,
  mesAtual,
  diaAtualNoMes,
  diasNoMes,
  clamp,
  yesterdayStr,
  daysAgoStr,
  projetarMes,
  todayStr,
  isFullMonth,
  prevPeriod,
} from "@/lib/domain/calc";
import type { UserData } from "@/components/useUserData";
import { useAccess } from "@/components/tabs/AccessGuard";
import ExpensesDoughnut from "./ExpensesDoughnut";
import PerformanceGauge from "./PerformanceGauge";
import DateRangePicker from "./DateRangePicker";
import AvisoRemessasFull from "./AvisoRemessasFull";
import { authedFetch } from "@/lib/api/authed-fetch";
import { getGaugeStatus, getGaugeStatusLabel, getGoalInsight, getRevenuePaceLabel, getRevenuePaceStatus, rawGoalPercent, selectActiveGoal } from "@/lib/domain/gauge";
import ActionCenter from "./ActionCenter";
import ExecutiveKpis, { Delta } from "./ExecutiveKpis";
import RevenueLineChart from "./RevenueLineChart";
import DayDetailModal from "./DayDetailModal";
import ProdutosEmRisco from "./ProdutosEmRisco";
import { findProdutosEmRisco } from "@/lib/domain/risk";
import { isTaskAtrasada, type Task } from "@/lib/domain/types";
import { watchTasks } from "@/lib/firebase/data";

type Props = { data: UserData; onVerEstoque?: () => void; onVerMetas?: () => void; onNavigate?: (tab: string) => void };

type AnuncioResult = {
  item_id:      string;
  title:        string;
  retorno:      number;
  custoProduto: number;
  envioFull:    number;
  imposto:      number;
  taxaML:       number;
  ads:          number;
  lucroBruto:   number;
  lucro:        number;
  margem:       number;
  qty:          number;
  vendas:       number;
  semVenda?:    boolean;
};

type HojeBreakdown = {
  faturamentoBruto: number;
  faturamentoLiquido: number;
  vendasCanceladas: number;
  vendasDevolvidas: number;
  totalCMV:         number;
  totalAds:         number;
  totalEnvio:       number;
  totalTaxasML:     number;
  totalImposto:     number;
  lucroLiquido:     number;
  pedidos:          number;
  /** Receita das vendas por CLIQUE no anúncio pago (sem assistida). */
  vendaDiretaAds?:  number;
};

type MlMetrics = {
  faturamentoBruto:   number;
  faturamentoLiquido: number;
  vendasCanceladas:   number;
  vendasDevolvidas:   number;
  totalRetorno:       number;
  faturamentoHoje:    number;
  pedidosHoje:        number;
  ordersCount:        number;
  devolucoes:         number;
  totalCMV:           number;
  totalAds:           number;
  adsNaoVinculado:    number;
  totalEnvio:         number;
  totalImposto:       number;
  totalTaxasML:       number;
  custosOperacionais: number;
  lucroSemCustos:     number;
  lucroComCustos:     number;
  margemSemCustos:    number;
  margemComCustos:    number;
  anuncios:           AnuncioResult[];
  pedidosSemVinculo:  number;
  hoje:               HojeBreakdown;
  serieDiaria:        { data: string; faturamento: number }[];
  reconc?:            { count: number; nosso: number; real: number };
  devolucoesEmAndamento?: number;
  devolucoesDetalhe?: Devolucao[];
  adsDiag?:           unknown;
  adsFalhou?:         boolean;
  conciliacao?:       Conciliacao;
  from:               string;
  to:                 string;
};

/** Espelho das métricas do Seller Center — ver o bloco `conciliacao` em app/api/ml/metrics/route.ts. */
type Conciliacao = {
  vendasBrutas:          number;
  quantidadeVendas:      number;
  unidadesVendidas:      number;
  precoMedioPorVenda:    number;
  precoMedioPorUnidade:  number;
  canceladasQuantidade:  number;
  canceladasValor:       number;
  descartadosForaDaJanela: number;
  resgatadosDoCache?:    number;
  substituidasQuantidade?: number;
  substituidasValor?:    number;
  substituidasUnidades?: number;
  canceladasDetalhe?:    { orderId: string; valor: number; dia: string; status: string; origem: string; packId: string }[];
  pedidosSemFrete?:      number;
  valorSemFrete?:        number;
};

type Devolucao = {
  order_id: string;
  valor:    number;
  data:     string;
  motivo:   string;
  produto:  string;
  tipo:     string;
  status?:      string;
  emAndamento?: boolean;
};

/**
 * Cores da composição de custos (batem com o doughnut). Paleta Zênite, com
 * uma matiz distinta por fatia — o remap automático tinha deixado violeta
 * repetido em duas fatias, que ficavam indistinguíveis lado a lado.
 */
const COST_COLORS = {
  cmv:  "#F4B942", // custo da mercadoria — ouro, é o maior bloco (série principal)
  full: "#5B8DEF", // frete/Full — azul aço
  taxa: "#C98218", // taxas do ML — âmbar queimado
  imp:  "#B9B5A6", // impostos — marfim apagado
  ads:  "#9B6BCE", // investimento em anúncios — roxo ameixa
  op:   "#D65A4A", // despesas operacionais — terracota
};

// throttle da sincronização automática (compartilhado entre montagens)
let lastAutoSync = 0;

function monthRange(mes: string): { from: string; to: string } {
  const [y, m] = mes.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, "0");
  const ld = String(last).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${ld}` };
}


// ── KPI ────────────────────────────────────────────────────────
function Kpi({
  label, value, tone, isPct, sub, delta, indisponivel,
}: {
  label: string;
  value: number;
  tone: "pos" | "neg" | "acc" | "warn";
  isPct?: boolean;
  sub?: string;
  delta?: React.ReactNode;
  indisponivel?: boolean; // dado não veio: mostra "—", nunca 0
}) {
  const color =
    tone === "pos" ? "var(--green)" :
    tone === "neg" ? "var(--red)" :
    tone === "warn" ? "var(--yellow)" : "var(--text)";
  return (
    <div className={`kpi k-${tone}`}>
      <div className="k-lbl">{label}</div>
      <div className="k-val" style={{ color: indisponivel ? "var(--muted)" : color }}>
        {indisponivel ? "—" : isPct ? `${value.toFixed(1)}%` : fmtBRL(value)}
      </div>
      {sub && <div className="k-sub">{sub}</div>}
      {delta}
    </div>
  );
}

// ── Selo "atualizado há X min" ─────────────────────────────────
function LastUpdated({ at }: { at: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  if (!at) return null;
  const mins = Math.floor((now - at) / 60000);
  const txt = mins <= 0 ? "agora" : mins === 1 ? "há 1 min" : `há ${mins} min`;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: ".72rem", color: "var(--muted)", whiteSpace: "nowrap" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--green)", boxShadow: "0 0 0 3px rgba(54,179,126,.15)" }} />
      Atualizado {txt} · auto 15min
    </span>
  );
}

// ── Curva ABC (Pareto de lucro) ────────────────────────────────
function CurvaABC({ anuncios }: { anuncios: AnuncioResult[] }) {
  const vendidos = anuncios.filter((a) => !a.semVenda);
  if (!vendidos.length) return null;
  const sorted = [...vendidos].sort((a, b) => b.lucro - a.lucro);
  const totalPos = sorted.reduce((s, a) => s + Math.max(a.lucro, 0), 0) || 1;
  const shares = sorted.map((a) => (Math.max(a.lucro, 0) / totalPos) * 100);
  const rows = sorted.map((a, i) => {
    const share = shares[i];
    const cum = shares.slice(0, i + 1).reduce((s, v) => s + v, 0);
    const classe = a.lucro < 0 ? "C" : cum <= 80 ? "A" : cum <= 95 ? "B" : "C";
    return { a, share, acc: cum, classe };
  });
  const cor = (c: string) => (c === "A" ? "var(--green)" : c === "B" ? "var(--yellow)" : "var(--red)");

  return (
    <div className="panel">
      <div className="panel-title" style={{ marginBottom: 6 }}>Curva ABC — quem puxa o lucro</div>
      <div style={{ fontSize: ".75rem", color: "var(--muted)", marginBottom: 12 }}>
        A = topo (até 80% do lucro) · B = 80–95% · C = restante / prejuízo
      </div>
      <div className="table-wrapper" style={{ border: "none" }}>
        <table className="tbl-modern tbl-cards tbl-cards-plain">
          <thead><tr><th>Classe</th><th style={{ textAlign: "left" }}>Anúncio</th><th>Lucro</th><th>% do lucro</th><th>Acumulado</th></tr></thead>
          <tbody>
            {rows.map(({ a, share, acc: cum, classe }) => (
              <tr key={a.item_id}>
                <td data-label="Classe"><span className="tag" style={{ background: "transparent", color: cor(classe), border: `1px solid ${cor(classe)}` }}>{classe}</span></td>
                <td data-label="Anúncio" style={{ fontWeight: 600, textAlign: "left" }}>{a.title}</td>
                <td data-label="Lucro" style={{ color: a.lucro >= 0 ? "var(--green)" : "var(--red)", fontWeight: 700 }}>{fmtBRL(a.lucro)}</td>
                <td data-label="% do lucro" style={{ color: "var(--muted)" }}>{share.toFixed(1)}%</td>
                <td data-label="Acumulado">
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 60, height: 6, borderRadius: 99, background: "var(--surface2)", overflow: "hidden" }}>
                      <div style={{ width: `${Math.min(cum, 100)}%`, height: "100%", background: cor(classe) }} />
                    </div>
                    <span style={{ color: "var(--muted)", fontSize: ".78rem" }}>{cum.toFixed(0)}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Conferência da margem com o dinheiro real (Mercado Pago) ────
function ConferenciaMP({ reconc }: { reconc?: { count: number; nosso: number; real: number } }) {
  if (!reconc || reconc.count === 0) return null;

  const gap = reconc.nosso - reconc.real; // >0 = ML tirou mais do que a gente conta
  const pctAbs = reconc.real > 0 ? (Math.abs(gap) / reconc.real) * 100 : 0;
  // Menos de 1% ou R$5 no período é ruído de arredondamento/fuso, não custo oculto.
  const ok = Math.abs(gap) < Math.max(5, reconc.real * 0.01);
  const cor = ok ? "var(--green)" : "var(--red)";
  const media = gap / reconc.count;

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 6 }}>
        <span className="panel-title">Conferência com o dinheiro real</span>
        <span className="panel-sub">nossa conta × líquido do Mercado Pago · {reconc.count} pedido(s)</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>Repasse estimado (nossa conta)</div>
          <div style={{ fontSize: "1.05rem", fontWeight: 800 }}>{fmtBRL(reconc.nosso)}</div>
          <div style={{ fontSize: ".68rem", color: "var(--muted)" }}>total − taxa ML − frete</div>
        </div>
        <div>
          <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>Caiu de verdade (MP)</div>
          <div style={{ fontSize: "1.05rem", fontWeight: 800 }}>{fmtBRL(reconc.real)}</div>
          <div style={{ fontSize: ".68rem", color: "var(--muted)" }}>net_received_amount</div>
        </div>
        <div>
          <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>Diferença</div>
          <div style={{ fontSize: "1.05rem", fontWeight: 800, color: cor }}>
            {gap >= 0 ? "−" : "+"}{fmtBRL(Math.abs(gap))}
          </div>
          <div style={{ fontSize: ".68rem", color: "var(--muted)" }}>{pctAbs.toFixed(1)}% do líquido</div>
        </div>
      </div>

      {ok ? (
        <div style={{
          padding: "10px 12px", borderRadius: 8, fontSize: ".82rem", lineHeight: 1.55,
          background: "rgba(54,179,126,.1)", border: "1px solid rgba(54,179,126,.35)", color: "var(--green)",
        }}>
          <b>Bate.</b> O que a gente calcula como repasse do ML confere com o que o Mercado Pago
          liberou. Não há custo de venda escapando — a margem está confiável.
        </div>
      ) : (
        <div style={{
          padding: "10px 12px", borderRadius: 8, fontSize: ".82rem", lineHeight: 1.55,
          background: "rgba(214,90,74,.1)", border: "1px solid rgba(214,90,74,.4)", color: "#E68B7E",
        }}>
          <b>Há {fmtBRL(Math.abs(gap))} de diferença</b> ({fmtBRL(Math.abs(media))} por pedido).{" "}
          {gap > 0
            ? "O ML repassou MENOS do que a nossa conta previa — existe um custo de venda que não estamos descontando (financiamento, tarifa fixa ou comissão maior). A margem real é mais baixa do que a mostrada nesta diferença."
            : "O MP liberou MAIS do que a nossa conta previa — provável reembolso de frete ou tarifa. A margem real é um pouco melhor."}
          <div style={{ marginTop: 6, color: "var(--muted)" }}>
            Não inclui a taxa mensal de armazenagem do Full, que o ML cobra fora da venda — essa
            entra à mão na aba Custos.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Melhores dias da semana ────────────────────────────────────
const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
// Ordem de exibição: começa na segunda, como a semana comercial.
const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0];

function MelhoresDias({ serie, from, to }: { serie: { data: string; faturamento: number }[]; from?: string; to?: string }) {
  const dados = useMemo(() => {
    if (!from || !to) return null;
    const fat = new Map(serie.map((s) => [s.data, s.faturamento]));

    // Não conta dia futuro do mês corrente: ele tem 0 e afundaria a média do
    // dia da semana em que cai. O limite é hoje (data local).
    const hoje = new Date();
    const hojeISO = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
    const fimReal = to < hojeISO ? to : hojeISO;
    if (fimReal < from) return null;

    const soma = new Array(7).fill(0);
    const dias = new Array(7).fill(0);

    const [fy, fm, fd] = from.split("-").map(Number);
    const [ty, tm, td] = fimReal.split("-").map(Number);
    // Percorre data a data no fuso local (new Date(y,m,d) evita o desvio de UTC).
    const cur = new Date(fy, fm - 1, fd);
    const fim = new Date(ty, tm - 1, td);
    while (cur <= fim) {
      const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
      const wd = cur.getDay();
      soma[wd] += fat.get(iso) ?? 0;
      dias[wd] += 1;
      cur.setDate(cur.getDate() + 1);
    }

    const linhas = ORDEM_DIAS.map((wd) => ({
      wd,
      nome: DIAS_SEMANA[wd],
      media: dias[wd] > 0 ? soma[wd] / dias[wd] : 0,
      total: soma[wd],
      amostras: dias[wd],
    }));
    const totalDias = dias.reduce((s: number, n: number) => s + n, 0);
    const maiorMedia = Math.max(...linhas.map((l) => l.media), 0);
    const melhor = [...linhas].filter((l) => l.amostras > 0).sort((a, b) => b.media - a.media)[0] ?? null;
    return { linhas, maiorMedia, melhor, totalDias };
  }, [serie, from, to]);

  if (!dados || dados.totalDias === 0 || dados.maiorMedia === 0) return null;
  const { linhas, maiorMedia, melhor } = dados;

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 6 }}>
        <span className="panel-title">Melhores dias da semana</span>
        <span className="panel-sub">faturamento médio por dia · {dados.totalDias} dia(s) no período</span>
      </div>

      {melhor && (
        <div style={{ fontSize: ".82rem", color: "var(--muted)", marginBottom: 12 }}>
          Seu dia mais forte é <b style={{ color: "var(--green)" }}>{melhor.nome.toLowerCase()}</b>,
          média de <b style={{ color: "var(--text)" }}>{fmtBRL(melhor.media)}</b> por dia.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {linhas.map((l) => {
          const ehMelhor = melhor?.wd === l.wd;
          const larg = maiorMedia > 0 ? (l.media / maiorMedia) * 100 : 0;
          return (
            <div key={l.wd} style={{ display: "grid", gridTemplateColumns: "78px 1fr auto", gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: ".8rem", fontWeight: ehMelhor ? 700 : 500, color: ehMelhor ? "var(--green)" : "var(--text)" }}>
                {l.nome}
              </span>
              <div style={{ height: 20, borderRadius: 6, background: "var(--surface2)", overflow: "hidden" }}>
                <div style={{
                  width: `${larg}%`, height: "100%", borderRadius: 6,
                  background: ehMelhor ? "var(--green)" : "var(--accent)",
                  opacity: l.amostras > 0 ? (ehMelhor ? 0.9 : 0.55) : 0.2,
                  transition: "width .3s",
                }} />
              </div>
              <span style={{ fontSize: ".8rem", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", color: ehMelhor ? "var(--text)" : "var(--muted)", fontWeight: ehMelhor ? 700 : 400 }}>
                {l.amostras > 0 ? fmtBRL(l.media) : "—"}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 10, fontSize: ".72rem", color: "var(--muted)", lineHeight: 1.5 }}>
        Média por dia, não o total — assim compara justo mesmo quando um dia da semana
        aparece mais vezes no período. Sempre os últimos 30 dias corridos, independente
        do período selecionado no topo do Dashboard.
      </div>
    </div>
  );
}

// ── Devoluções (detalhe com motivo/produto) ────────────────────
function DevolucoesPanel({ total, emAndamento, detalhe }: { total: number; emAndamento?: number; detalhe: Devolucao[] }) {
  const tipoLabel = (t: string) => (t === "devolucao" ? "Devolução" : t === "cancelamento" ? "Cancelamento" : t || "—");
  const nEmAndamento = detalhe.filter((d) => d.emAndamento).length;
  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 10 }}>
        <span className="panel-title">Devoluções</span>
        <span className="panel-sub">Concluídas: <b style={{ color: "var(--red)" }}>{fmtBRL(total)}</b> · {detalhe.length} caso(s)</span>
      </div>

      {(emAndamento ?? 0) > 0 && (
        <div style={{
          marginBottom: 10, padding: "8px 12px", borderRadius: 8, fontSize: ".8rem", lineHeight: 1.5,
          background: "var(--warning-soft)", border: "1px solid rgba(255,138,31,.35)", color: "var(--warning)",
        }}>
          <b>{fmtBRL(emAndamento ?? 0)}</b> em {nEmAndamento} devolução(ões) <b>ainda em disputa</b> —
          seguem contando como venda no lucro até o Mercado Livre concluir. Só desconto quando fecha.
        </div>
      )}

      {detalhe.length ? (
        <div className="table-wrapper" style={{ border: "none" }}>
          <table className="tbl-modern tbl-cards tbl-cards-plain">
            <thead><tr><th>Data</th><th style={{ textAlign: "left" }}>Produto</th><th style={{ textAlign: "left" }}>Motivo</th><th style={{ textAlign: "left" }}>Situação</th><th>Valor</th></tr></thead>
            <tbody>
              {detalhe.map((d, i) => (
                <tr key={d.order_id + i} style={{ opacity: d.emAndamento ? 0.7 : 1 }}>
                  <td data-label="Data" style={{ color: "var(--muted)" }}>{d.data}</td>
                  <td data-label="Produto" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>{d.produto || "—"}</td>
                  <td data-label="Motivo" style={{ color: "var(--muted)", textAlign: "left" }}>{d.motivo || "—"}</td>
                  <td data-label="Situação" style={{ textAlign: "left" }}>
                    {d.emAndamento
                      ? <span style={{ color: "var(--warning)", fontWeight: 600 }}>em disputa</span>
                      : <span style={{ color: "var(--muted)" }}>{tipoLabel(d.tipo)} · concluída</span>}
                    {d.status && <span style={{ display: "block", fontSize: ".64rem", color: "var(--muted)" }}>{d.status}</span>}
                  </td>
                  <td data-label="Valor" style={{ color: d.emAndamento ? "var(--warning)" : "var(--red)", fontWeight: 700 }}>{fmtBRL(d.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ color: "var(--muted)", fontSize: ".82rem" }}>Sem devoluções no período. </div>
      )}
    </div>
  );
}

// ── Hoje vs Ontem (leitura curta em texto) ──────────────────────
function HojeVsOntem({ hoje, ontem }: { hoje?: HojeBreakdown; ontem: MlMetrics | null }) {
  if (!hoje) return null;
  const margemHoje = hoje.faturamentoBruto > 0 ? (hoje.lucroLiquido / hoje.faturamentoBruto) * 100 : 0;

  let diffTxt: React.ReactNode = null;
  if (ontem && ontem.faturamentoLiquido !== 0) {
    const diffPct = ((hoje.faturamentoLiquido - ontem.faturamentoLiquido) / Math.abs(ontem.faturamentoLiquido)) * 100;
    const tone = diffPct >= 0 ? "var(--success)" : "var(--danger)";
    diffTxt = (
      <> Diferença de <b style={{ color: tone }}>{diffPct >= 0 ? "+" : ""}{diffPct.toFixed(1)}%</b> vs ontem ({fmtBRL(ontem.faturamentoLiquido)}).</>
    );
  } else if (ontem) {
    diffTxt = <> Ontem não teve faturamento pra comparar.</>;
  }

  return (
    <div className="panel" style={{ fontSize: ".92rem", lineHeight: 1.6, color: "var(--text-secondary,var(--muted))" }}>
      <b style={{ color: "var(--text-primary,var(--text))" }}>Hoje:</b>{" "}
      {fmtBRL(hoje.faturamentoLiquido)} faturados, {hoje.pedidos} pedido(s), margem de{" "}
      <b style={{ color: margemHoje >= 0 ? "var(--success)" : "var(--danger)" }}>{margemHoje.toFixed(1)}%</b>.
      {diffTxt}
    </div>
  );
}

// ── Vendas do Dia (hero) ───────────────────────────────────────
function VendasDoDiaHero({ hoje }: { hoje?: HojeBreakdown }) {
  const h: HojeBreakdown = hoje ?? {
    faturamentoBruto: 0, faturamentoLiquido: 0, vendasCanceladas: 0, vendasDevolvidas: 0,
    totalCMV: 0, totalAds: 0, totalEnvio: 0,
    totalTaxasML: 0, totalImposto: 0, lucroLiquido: 0, pedidos: 0,
  };
  const margem = h.faturamentoBruto > 0 ? (h.lucroLiquido / h.faturamentoBruto) * 100 : 0;

  /**
   * TACOS — quanto do faturamento do dia foi embora em publicidade.
   *
   * Divide pelo faturamento TOTAL, não pelo que o Ads vendeu: é a pergunta
   * "quanto da minha receita eu paguei de anúncio hoje", e é ela que se
   * compara com a margem. Dividir pela venda de Ads daria ACOS, que responde
   * outra coisa (eficiência da campanha) e já vive na aba Ads.
   */
  const tacos = h.faturamentoBruto > 0 ? (h.totalAds / h.faturamentoBruto) * 100 : null;
  const vendaDiretaAds = h.vendaDiretaAds ?? 0;

  const stats: { label: string; icon: string; value: number; color: string }[] = [
    { label: "Faturamento bruto", icon: "", value: h.faturamentoBruto, color: "var(--green)" },
    { label: "Vendas por ADS",    icon: "", value: vendaDiretaAds,     color: "var(--green)" },
    { label: "CMV (produto)",     icon: "", value: h.totalCMV,         color: "var(--red)" },
    { label: "Frete/Full",        icon: "", value: h.totalEnvio,       color: "var(--red)" },
    { label: "Taxas ML",          icon: "", value: h.totalTaxasML,     color: "var(--red)" },
    { label: "Imposto",           icon: "", value: h.totalImposto,     color: "var(--red)" },
    { label: "Gasto com ADS",     icon: "", value: h.totalAds,         color: "var(--red)" },
    { label: "Lucro líquido",     icon: "", value: h.lucroLiquido,     color: h.lucroLiquido >= 0 ? "var(--green)" : "var(--red)" },
  ];

  return (
    <section className="hero">
      <div className="hero-head">
        <span className="hero-title">Vendas do Dia</span>
        <span className="hero-badge">
          {h.pedidos} pedido(s) · margem <b style={{ color: margem >= 0 ? "var(--green)" : "var(--red)" }}>{margem.toFixed(1)}%</b>
          {tacos != null && (
            <>
              {" · "}ADS{" "}
              {/* Vermelho quando o anúncio come mais que a margem que sobrou:
                  aí cada real de venda a mais está estreitando o resultado. */}
              <b
                style={{ color: tacos > Math.max(margem, 0) ? "var(--red)" : "var(--text)" }}
                title="Quanto do faturamento do dia foi gasto em publicidade (TACOS). Fica vermelho quando passa da margem."
              >
                {tacos.toFixed(1)}%
              </b>
              {" do faturamento"}
            </>
          )}
        </span>
      </div>
      <div className="hero-grid">
        {stats.map((s) => (
          <div key={s.label} className="hero-stat">
            <div className="lbl">{s.icon} {s.label}</div>
            <div className="val" style={{ color: s.color }}>{fmtBRL(s.value)}</div>
          </div>
        ))}
      </div>
      <div className="hero-foot">
        Lucro líquido = retorno − CMV − ADS − Full − taxas ML − imposto ·{" "}
        <span title="Receita das vendas em que o comprador clicou no anúncio pago. Não inclui venda assistida (viu o anúncio e comprou depois por outro caminho), que o painel do ML soma em 'vendas atribuídas'.">
          “Vendas por ADS” conta só o clique direto
        </span>
      </div>
    </section>
  );
}


/**
 * ── Conversão de visitas ──
 *
 * Espelha o painel do Seller Center, com uma diferença que a tela declara em
 * vez de disfarçar: o ML mostra TRÊS degraus (visitas → intenção de compra →
 * vendas) e a "intenção de compra" não existe em nenhum endpoint público —
 * vem de sinais internos deles (carrinho, checkout iniciado).
 *
 * Estimar aquele degrau seria pior que não tê-lo: quem comparasse com o ML
 * acharia o app quebrado, e poderia decidir em cima de um número inventado.
 * Dois degraus honestos valem mais que três com um chutado.
 */
function ConversaoVisitas({ from, to, vendas, receita }: {
  from?: string; to?: string; vendas: number; receita: number;
}) {
  const [dados, setDados] = useState<{ visitas: number | null; observacao?: string; parcial?: boolean; error?: string } | null>(null);

  const chave = from && to ? `${from}|${to}` : "";
  useEffect(() => {
    if (!chave) return;
    let vivo = true;
    authedFetch(`/api/ml/visitas?from=${from}&to=${to}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => { if (vivo) setDados(j); })
      .catch(() => { if (vivo) setDados({ visitas: null, error: "falha" }); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  if (!dados) return null;

  const visitas = dados.visitas;
  // Conversão só existe com visitas > 0. Sem elas o número seria divisão por
  // zero disfarçada de 0%.
  const conversao = visitas != null && visitas > 0 ? (vendas / visitas) * 100 : null;

  return (
    <section className="panel">
      <div className="panel-head" style={{ marginBottom: 10 }}>
        <span className="panel-title">Conversão de visitas</span>
        <span className="panel-sub">
          compare com “Conversão de visitas” do Seller Center
          {dados.parcial ? " · período além do alcance da API: número parcial" : ""}
        </span>
      </div>

      {visitas == null ? (
        <div style={{ fontSize: ".82rem", color: "var(--muted)" }}>
          O Mercado Livre não devolveu as visitas agora. O número não aparece como zero
          de propósito — “ninguém visitou” e “não consegui perguntar” levam a decisões opostas.
        </div>
      ) : (
        <>
          <div className="kpi-grid">
            <div className="kpi">
              <div className="k-lbl">Visitas</div>
              <div className="k-val">{visitas.toLocaleString("pt-BR")}</div>
              <div className="k-sub">nos anúncios da conta</div>
            </div>
            <div className="kpi">
              <div className="k-lbl">Vendas</div>
              <div className="k-val">{vendas.toLocaleString("pt-BR")}</div>
              <div className="k-sub">{fmtBRL(receita)}</div>
            </div>
            <div className="kpi">
              <div className="k-lbl">Conversão</div>
              <div className="k-val" style={{ color: "var(--accent)" }}>
                {conversao != null ? `${conversao.toFixed(1)}%` : "—"}
              </div>
              <div className="k-sub">vendas ÷ visitas</div>
            </div>
          </div>

          <div style={{ marginTop: 10, fontSize: ".72rem", color: "var(--muted)", lineHeight: 1.6 }}>
            O Seller Center mostra um degrau a mais no meio (“intenção de compra”). Ele vem de
            sinais internos do Mercado Livre e <b>nenhum endpoint público devolve</b> — em vez de
            estimar, ele fica de fora. {dados.observacao}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * ── Conferência com o Mercado Livre ──
 *
 * Painel de conciliação: as mesmas métricas do "Resumo de desempenho" do
 * Seller Center, calculadas aqui. Existe porque "o número não bate" é
 * impossível de investigar comparando um total contra outro — a divergência
 * quase sempre está numa DEFINIÇÃO, não num erro de soma.
 *
 * A confusão mais comum, e o motivo deste painel: o "Vendas brutas" do
 * Seller Center NÃO conta pedido cancelado; o "Faturamento bruto" do card
 * acima conta de propósito, pra o cancelamento aparecer como linha própria.
 * Comparar os dois direto sempre vai dar diferença — o número comparável é o
 * "Vendas brutas" daqui.
 */
function ConferenciaML({ c, periodo }: { c: Conciliacao; periodo: string }) {
  // Aberto por padrão: fechado, o painel que existe pra explicar a diferença
  // simplesmente não era encontrado por quem estava com a dúvida.
  const [aberto, setAberto] = useState(true);

  const linhas: { rotulo: string; valor: string; noML: string }[] = [
    { rotulo: "Vendas brutas", valor: fmtBRL(c.vendasBrutas), noML: "Vendas brutas" },
    { rotulo: "Quantidade de vendas", valor: String(c.quantidadeVendas), noML: "Quantidade de vendas" },
    { rotulo: "Unidades vendidas", valor: String(c.unidadesVendidas), noML: "Unidades vendidas" },
    { rotulo: "Preço médio por venda", valor: fmtBRL(c.precoMedioPorVenda), noML: "Preço médio por venda" },
    { rotulo: "Preço médio por unidade", valor: fmtBRL(c.precoMedioPorUnidade), noML: "Preço médio por unidade" },
    { rotulo: "Vendas canceladas", valor: `${c.canceladasQuantidade} · ${fmtBRL(c.canceladasValor)}`, noML: "Quantidade de vendas canceladas" },
  ];

  /**
   * O número comparável ao "Vendas brutas" do ML, somando de volta os pedidos
   * que separamos como substituição de envio.
   *
   * Medido em 22/08: nosso líquido R$ 17.170 + R$ 481 de substituídos =
   * R$ 17.652 contra R$ 17.689 do painel — 0,2%, que é o que vendeu entre uma
   * tela e outra. Sem esta linha a diferença parecia um erro; com ela, é uma
   * escolha de definição visível.
   *
   * Mantemos o número MENOR como principal de propósito: quando o ML cancela
   * um pedido de 2 unidades e cria dois de 1, contar o original E os dois
   * substitutos conta a mesma mercadoria duas vezes. Pra decidir preço e
   * margem, o conservador é o certo.
   */
  const substituidasValor = c.substituidasValor ?? 0;
  const comparavelAoML = c.vendasBrutas + substituidasValor;

  return (
    <section className="panel">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
          width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer",
          color: "inherit", textAlign: "left",
        }}
      >
        <span>
          <span className="panel-title">Conferência com o Mercado Livre</span>
          <span className="panel-sub" style={{ display: "block" }}>
            compare com “Resumo de desempenho” do Seller Center · {periodo}
          </span>
        </span>
        <span style={{ color: "var(--muted)", fontSize: ".8rem" }}>{aberto ? "▲" : "▼"}</span>
      </button>

      {aberto && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {linhas.map((l) => (
              <div
                key={l.rotulo}
                style={{
                  display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10,
                  padding: "8px 10px", borderRadius: 8, background: "var(--surface-raised,var(--surface2))",
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontSize: ".82rem", fontWeight: 600 }}>
                  {l.rotulo}
                  <span style={{ display: "block", fontSize: ".66rem", fontWeight: 400, color: "var(--muted)" }}>
                    no ML: “{l.noML}”
                  </span>
                </span>
                <span className="money" style={{ fontWeight: 700, fontSize: ".95rem" }}>{l.valor}</span>
              </div>
            ))}
          </div>

          {/* A LISTA dos cancelados. Comparar dois totais nunca disse QUAIS
              pedidos divergem — com os ids, dá pra abrir dois no Seller Center
              e saber na hora se é cancelamento real ou separação de envio. */}
          {(c.canceladasDetalhe?.length ?? 0) > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer", color: "var(--muted)", fontSize: ".78rem" }}>
                Ver os {c.canceladasDetalhe!.length} pedido(s) que estamos contando como cancelados
              </summary>
              <div style={{ fontSize: ".72rem", color: "var(--muted)", margin: "8px 0", lineHeight: 1.5 }}>
                Abra um ou dois destes no Mercado Livre. Se lá aparecerem como venda válida,
                é separação de envio (ou cancelamento revertido) e o número daqui está alto.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 300, overflowY: "auto" }}>
                {c.canceladasDetalhe!.map((p) => (
                  <div
                    key={p.orderId}
                    style={{
                      display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap",
                      padding: "6px 10px", borderRadius: 6, background: "var(--surface-raised,var(--surface2))",
                    }}
                  >
                    <span style={{ fontFamily: "ui-monospace, monospace", fontSize: ".72rem" }}>
                      #{p.orderId}
                      <span style={{ color: "var(--muted)", fontFamily: "inherit" }}>
                        {" "}· {formatDateBR(p.dia)} · {p.origem}{p.packId ? ` · pacote ${p.packId}` : ""}
                      </span>
                    </span>
                    <b className="money" style={{ whiteSpace: "nowrap" }}>{fmtBRL(p.valor)}</b>
                  </div>
                ))}
              </div>
            </details>
          )}

          {substituidasValor > 0 && (
            <div style={{
              marginTop: 10, padding: "10px 12px", borderRadius: 8,
              background: "var(--surface-raised,var(--surface2))", borderLeft: "3px solid var(--accent)",
              fontSize: ".78rem", lineHeight: 1.6,
            }}>
              <b>Por que o “Vendas brutas” do ML vem um pouco maior</b>
              <div style={{ marginTop: 6, color: "var(--muted)" }}>
                {fmtBRL(c.vendasBrutas)} (aqui) + {fmtBRL(substituidasValor)} de {c.substituidasQuantidade} pedido(s)
                separados no envio = <b style={{ color: "var(--text)" }}>{fmtBRL(comparavelAoML)}</b> — este é o número
                comparável ao painel.
                {/* A quantidade e as unidades sofrem o MESMO desconto que o valor.
                    Sem estas duas linhas, elas apareciam menores que o painel sem
                    nenhuma explicação, e davam a impressão de que faltava venda. */}
                <div style={{ marginTop: 6 }}>
                  Pelo mesmo motivo, comparáveis ao painel:{" "}
                  <b style={{ color: "var(--text)" }}>
                    {c.quantidadeVendas + (c.substituidasQuantidade ?? 0)}
                  </b>{" "}
                  vendas
                  {(c.substituidasUnidades ?? 0) > 0 && (
                    <>
                      {" "}e{" "}
                      <b style={{ color: "var(--text)" }}>
                        {c.unidadesVendidas + (c.substituidasUnidades ?? 0)}
                      </b>{" "}
                      unidades
                    </>
                  )}
                  .
                </div>
                <br />
                Quando você separa o envio, o ML cancela o pedido e cria outros no lugar. Ele conta o
                original <i>e</i> os substitutos; nós contamos só os substitutos, senão a mesma mercadoria
                entraria duas vezes. Pra decidir preço e margem, o número menor é o certo.
              </div>
            </div>
          )}

          <div style={{ marginTop: 10, fontSize: ".72rem", color: "var(--muted)", lineHeight: 1.6 }}>
            <b>Se “Vendas brutas” bater e o card acima não</b>, está tudo certo: o
            “Faturamento bruto” do card inclui os cancelados de propósito, e o ML não.
            {c.descartadosForaDaJanela > 0 && (
              <>
                {" "}· <b style={{ color: "var(--yellow)" }}>{c.descartadosForaDaJanela} pedido(s)</b> vieram
                do ML com data fora do período e foram descartados — é a borda de fuso
                horário, e sem esse corte eles inflariam o faturamento.
              </>
            )}
            {(c.substituidasQuantidade ?? 0) > 0 && (
              <>
                {" "}· <b style={{ color: "var(--green)" }}>{c.substituidasQuantidade} pedido(s)</b> ({fmtBRL(c.substituidasValor ?? 0)})
                foram cancelados pelo Mercado Livre apenas para virar outros pedidos do mesmo
                pacote — é o que acontece quando você <b>separa o envio</b> na agência. Não são
                venda perdida: o valor já está nos pedidos que os substituíram, então eles não
                entram nem no bruto nem em “Vendas canceladas”.
              </>
            )}
            {(c.pedidosSemFrete ?? 0) > 0 && (
              <>
                {" "}· <b style={{ color: "var(--yellow)" }}>{c.pedidosSemFrete} pedido(s)</b> ({fmtBRL(c.valorSemFrete ?? 0)})
                ainda estão sem o custo de frete confirmado pelo Mercado Livre. Eles entram no
                lucro com frete R$ 0,00 — não dá pra somar um custo que não conhecemos —, então o
                <b> lucro e a margem acima são um teto</b>, não o número final. Use “⟳ Atualizar ML”
                pra buscar esses fretes.
              </>
            )}
            {(c.resgatadosDoCache ?? 0) > 0 && (
              <>
                {" "}· <b style={{ color: "var(--green)" }}>{c.resgatadosDoCache} pedido(s)</b> estavam
                marcados como cancelados no nosso histórico, mas o Mercado Livre os confirma
                como venda — voltaram a contar. Cancelamento revertido fica gravado aqui e
                antes seguia descontado pra sempre.
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// ── Meta Diária (velocímetro) ──────────────────────────────────
function MetaDiariaCard({
  faturamentoHoje, pedidosHoje, metaDiaria, metaPlana, diasRestantes,
}: {
  faturamentoHoje: number;
  pedidosHoje: number;
  metaDiaria: number | null;
  metaPlana: number | null;
  diasRestantes: number | null;
}) {
  const semMeta = metaDiaria == null;
  // metaDiaria == 0 → não falta mais nada: a meta do mês já foi batida.
  const mesBatido = metaDiaria === 0;
  const pct = metaDiaria && metaDiaria > 0 ? clamp((faturamentoHoje / metaDiaria) * 100, 0, 100) : (mesBatido ? 100 : 0);
  const batida = mesBatido || (metaDiaria ? faturamentoHoje >= metaDiaria : false);
  const falta = metaDiaria ? Math.max(metaDiaria - faturamentoHoje, 0) : 0;

  // Quanto a meta de hoje mudou vs o ritmo plano (meta do mês ÷ dias).
  // Acima de 1% de diferença já vale explicar o porquê.
  const ajuste = metaDiaria != null && metaPlana != null && metaPlana > 0
    ? (metaDiaria - metaPlana) / metaPlana
    : 0;
  const atrasado = ajuste > 0.01;
  const adiantado = ajuste < -0.01;

  // Status/label do arco reaproveitam o mesmo `pct` (0-100, já clampado)
  // calculado acima — nenhuma fórmula nova, só a leitura visual dele.
  const tone = getGaugeStatus("revenue", pct);
  const statusLabel = mesBatido
    ? "Meta do mês batida"
    : batida
      ? `Meta batida · ${pedidosHoje} pedido(s)`
      : `Faltam ${fmtBRL(falta)} · ${pedidosHoje} pedido(s)`;

  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
      {semMeta ? (
        <>
          <div className="panel-title" style={{ marginBottom: 8 }}>Meta Diária de Hoje</div>
          <div style={{ fontSize: ".8rem", color: "var(--muted)" }}>Configure uma meta (Meta 1) na aba Metas.</div>
        </>
      ) : (
        <>
          <PerformanceGauge
            title="Meta Diária de Hoje"
            eyebrow="Meta Diária de Hoje"
            compact
            showNeedle={false}
            // Quando o mês já bateu a meta não existe mais "alvo de hoje" (metaDiaria
            // vira 0) — 1/1 é só um valor sintético pra desenhar o arco cheio; os
            // textos ao redor continuam mostrando o faturamento real de hoje.
            value={mesBatido ? 1 : faturamentoHoje}
            max={mesBatido ? 1 : (metaDiaria ?? 0)}
            status={tone}
            valueLabel={mesBatido ? fmtBRL(faturamentoHoje) : `${fmtBRL(faturamentoHoje)} de ${fmtBRL(metaDiaria ?? 0)}`}
            helperText={statusLabel}
            minLabel="R$ 0"
            maxLabel={mesBatido ? undefined : fmtBRL(metaDiaria ?? 0)}
          />
          {/* Por que a meta de hoje não é a meta plana */}
          {!mesBatido && metaPlana != null && diasRestantes != null && (
            <div style={{ marginTop: 10, textAlign: "center", fontSize: ".72rem", lineHeight: 1.5 }}>
              {atrasado && (
                <span style={{ color: "var(--warning)" }}>
                  ↑ subiu de <b>{fmtBRL(metaPlana)}</b> — você está atrás do ritmo
                </span>
              )}
              {adiantado && (
                <span style={{ color: "var(--green)" }}>
                  ↓ caiu de <b>{fmtBRL(metaPlana)}</b> — você está adiantado
                </span>
              )}
              {!atrasado && !adiantado && (
                <span style={{ color: "var(--muted)" }}>no ritmo da meta ({fmtBRL(metaPlana)}/dia)</span>
              )}
              <span style={{ color: "var(--muted)", display: "block" }}>
                o que falta ÷ {diasRestantes} dia(s) restante(s)
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Acompanhamento de Metas (dois velocímetros: faturamento + margem) ──
// Fórmulas de seleção de meta ativa / ritmo / ideal-até-hoje relocadas
// verbatim do antigo MetasGauge.tsx — só a apresentação (PerformanceGauge)
// é nova, nenhum número muda.
function abreviarValor(n: number): string {
  if (n >= 1_000_000) return `R$ ${(n / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (n >= 1_000) return `R$ ${Math.round(n / 1_000)}k`;
  return fmtBRL(n);
}

function MetasOverviewCard({
  fatBruto, meta1, meta2, meta3, projecao, projecaoLucro, diaAtual, totalDias, margemAtual, metaMargem, onVerMetas,
}: {
  fatBruto: number;
  meta1: number;
  meta2: number | null;
  meta3: number | null;
  projecao: number;
  projecaoLucro: number;
  diaAtual: number;
  totalDias: number;
  margemAtual: number;
  metaMargem: number;
  onVerMetas?: () => void;
}) {
  const { activeMeta, metaIndex, metas } = selectActiveGoal(fatBruto, meta1, meta2, meta3);
  const idealDia = activeMeta > 0 ? (activeMeta / totalDias) * diaAtual : 0;
  const deltaIdeal = fatBruto - idealDia;

  const falta = Math.max(activeMeta - fatBruto, 0);
  const diasRestantes = Math.max(totalDias - diaAtual + 1, 1);
  const ritmoDiaNecessario = falta > 0 ? falta / diasRestantes : undefined;

  // Ritmo compara contra o IDEAL até hoje, não contra a meta inteira — ver
  // comentário em getRevenuePaceStatus (era a causa do "Abaixo do ritmo"
  // aparecer sempre no início do mês, mesmo em dia).
  const toneRevenue = getRevenuePaceStatus(fatBruto, activeMeta, idealDia);
  const revenueStatusLabel = getRevenuePaceLabel(fatBruto, activeMeta, toneRevenue);
  const insightRevenue = getGoalInsight("revenue", { falta, ritmoDiaNecessario, projecao, metaLabel: `Meta ${metaIndex}` });

  const pctMargemRaw = rawGoalPercent(margemAtual, metaMargem);
  const toneMargin = getGaugeStatus("margin", pctMargemRaw);
  const marginStatusLabel = getGaugeStatusLabel("margin", pctMargemRaw, toneMargin);
  const insightMargin = getGoalInsight("margin", { margemAtual, metaMargem });

  return (
    <div className="goals-card">
      <div className="goals-card-head">
        <div>
          <div className="goals-card-title">Acompanhamento de metas</div>
          <div className="goals-card-sub">Ritmo, projeção e margem da operação</div>
        </div>
        <div className="goals-card-updated">Projeção de lucro do mês: <b style={{ color: projecaoLucro >= 0 ? "var(--success)" : "var(--danger)" }}>{fmtBRL(projecaoLucro)}</b></div>
      </div>

      {/* Progressão M1→M2→M3: a próxima meta já libera sozinha assim que a
          anterior é batida (ver `activeMeta` acima) — este stepper só torna
          isso visível, não muda o comportamento. */}
      {metas.length > 1 && (
        <div className="goals-tier-stepper" role="list" aria-label="Progressão das metas do mês">
          {metas.map((m, i) => {
            const idx = i + 1;
            const done = fatBruto >= m;
            const current = m === activeMeta;
            return (
              <span key={idx} role="listitem" className={`goals-tier ${done ? "goals-tier-done" : current ? "goals-tier-current" : "goals-tier-locked"}`}>
                <span aria-hidden="true">{done ? "✓" : current ? "●" : "○"}</span> Meta {idx}
                {done && " batida"}
                {current && !done && " (atual)"}
              </span>
            );
          })}
        </div>
      )}

      <div className="pg-row">
        <PerformanceGauge
          title={`Meta do Mês ${metaIndex}`}
          eyebrow={`Meta do Mês ${metaIndex}`}
          value={fatBruto}
          max={activeMeta}
          status={toneRevenue}
          valueLabel={`${fmtBRL(fatBruto)} de ${abreviarValor(activeMeta)}`}
          helperText={revenueStatusLabel}
          insight={insightRevenue}
          comparison={{ label: "Ideal até hoje", value: fmtBRL(idealDia), tone: deltaIdeal >= 0 ? "success" : "danger" }}
          minLabel="R$ 0"
          maxLabel={abreviarValor(activeMeta)}
          tooltip={`Percentual do faturamento líquido em relação à Meta ${metaIndex} selecionada.`}
          ctaLabel={onVerMetas ? "Ver metas" : undefined}
          onClick={onVerMetas}
        />
        <PerformanceGauge
          title="Margem Líquida"
          eyebrow="Margem Líquida"
          value={margemAtual}
          max={metaMargem}
          status={toneMargin}
          valueLabel={`${margemAtual.toFixed(1)}% (meta ${metaMargem.toFixed(1)}%)`}
          helperText={marginStatusLabel}
          insight={insightMargin}
          minLabel="0%"
          maxLabel={`${metaMargem.toFixed(0)}%`}
          tooltip="Lucro líquido operacional dividido pelo retorno (valor da venda − taxa ML − frete) do período. Custos incluídos seguem as regras atuais do Dashboard."
        />
      </div>
    </div>
  );
}

// ── Tabela de Lucro por Anúncio ────────────────────────────────
function fmtRoas(retorno: number, ads: number): { txt: string; color: string } {
  if (ads <= 0) return { txt: "—", color: "var(--muted)" };
  const r = retorno / ads;
  const color = r >= 3 ? "var(--green)" : r >= 1.5 ? "var(--yellow)" : "var(--red)";
  return { txt: `${r.toFixed(2)}x`, color };
}

function TabelaAnuncios({ anuncios }: { anuncios: AnuncioResult[] }) {
  if (!anuncios.length) {
    return (
      <div style={{ color: "var(--muted)", fontSize: ".85rem", padding: "16px 0", textAlign: "center" }}>
        Nenhum anúncio no período. Cadastre os produtos (SKU/MLB) no Estoque.
      </div>
    );
  }
  const sum = (f: (a: AnuncioResult) => number) => anuncios.reduce((s, a) => s + f(a), 0);
  const totalRet = sum((a) => a.retorno);
  const totalBruto = sum((a) => a.lucroBruto);
  const totalLucro = sum((a) => a.lucro);
  const totalAds = sum((a) => a.ads);
  const margemTotal = totalRet > 0 ? (totalLucro / totalRet) * 100 : 0;
  const margemTag = (m: number) => (m >= 20 ? "tag-g" : m >= 10 ? "tag-y" : "tag-r");
  const totalRoas = fmtRoas(totalRet, totalAds);

  return (
    <div className="table-wrapper" style={{ border: "none" }}>
      <table className="tbl-modern tbl-cards">
        <thead>
          <tr>
            <th>Anúncio</th><th>Vendas</th><th>Un</th><th>Retorno</th><th>CMV</th><th>Frete</th>
            <th>Taxa ML</th><th>Imposto</th><th>ADS</th><th>ROAS</th><th>Lucro Bruto</th><th>Lucro Líq.</th><th>Margem</th>
          </tr>
        </thead>
        <tbody>
          {anuncios.map((a) => {
            const roas = fmtRoas(a.retorno, a.ads);
            return (
              <tr key={a.item_id} style={a.semVenda ? { opacity: 0.72 } : undefined}>
                <td>
                  <span title={a.title} style={{ fontWeight: 600 }}>{a.title}</span>
                  {a.semVenda && <span title="Anúncio gastou em ADS mas não vendeu neste período. Se você excluiu o anúncio, o gasto anterior continua aqui porque foi dinheiro real pago ao ML." style={{ marginLeft: 6, fontSize: ".64rem", fontWeight: 700, color: "var(--warning)", background: "var(--warning-soft)", padding: "1px 6px", borderRadius: 5, cursor: "help" }}>SÓ ADS</span>}
                  {a.item_id && <span style={{ display: "block", fontSize: ".7rem", color: "var(--muted)" }}>{a.item_id}</span>}
                </td>
                <td data-label="Vendas" style={{ fontWeight: 700 }}>{a.vendas || "—"}</td>
                <td data-label="Un" style={{ color: "var(--muted)" }}>{a.qty}</td>
                <td data-label="Retorno" style={{ color: "var(--green)", fontWeight: 600 }}>{fmtBRL(a.retorno)}</td>
                <td data-label="CMV" style={{ color: "var(--red)" }}>{fmtBRL(a.custoProduto)}</td>
                <td data-label="Frete" style={{ color: "var(--red)" }}>{fmtBRL(a.envioFull)}</td>
                <td data-label="Taxa ML" style={{ color: "var(--red)" }}>{fmtBRL(a.taxaML)}</td>
                <td data-label="Imposto" style={{ color: "var(--red)" }}>{fmtBRL(a.imposto)}</td>
                <td data-label="ADS" style={{ color: "var(--red)" }}>{fmtBRL(a.ads)}</td>
                <td data-label="ROAS" style={{ color: roas.color, fontWeight: 700 }}>{roas.txt}</td>
                <td data-label="Lucro bruto" style={{ color: a.lucroBruto >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(a.lucroBruto)}</td>
                <td data-label="Lucro líq." style={{ fontWeight: 700, color: a.lucro >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(a.lucro)}</td>
                <td data-label="Margem">{a.semVenda ? <span style={{ color: "var(--muted)" }}>—</span> : <span className={`tag ${margemTag(a.margem)}`}>{a.margem.toFixed(1)}%</span>}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td data-label="">Total</td>
            <td data-label="Vendas" style={{ fontWeight: 700 }}>{sum((a) => a.vendas)}</td>
            <td data-label="Un" style={{ color: "var(--muted)" }}>{sum((a) => a.qty)}</td>
            <td data-label="Retorno" style={{ color: "var(--green)" }}>{fmtBRL(totalRet)}</td>
            <td data-label="CMV" style={{ color: "var(--red)" }}>{fmtBRL(sum((a) => a.custoProduto))}</td>
            <td data-label="Frete" style={{ color: "var(--red)" }}>{fmtBRL(sum((a) => a.envioFull))}</td>
            <td data-label="Taxa ML" style={{ color: "var(--red)" }}>{fmtBRL(sum((a) => a.taxaML))}</td>
            <td data-label="Imposto" style={{ color: "var(--red)" }}>{fmtBRL(sum((a) => a.imposto))}</td>
            <td data-label="ADS" style={{ color: "var(--red)" }}>{fmtBRL(totalAds)}</td>
            <td data-label="ROAS" style={{ color: totalRoas.color }}>{totalRoas.txt}</td>
            <td data-label="Lucro bruto" style={{ color: totalBruto >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(totalBruto)}</td>
            <td data-label="Lucro líq." style={{ color: totalLucro >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(totalLucro)}</td>
            <td data-label="Margem"><span className={`tag ${margemTag(margemTotal)}`}>{margemTotal.toFixed(1)}%</span></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Lucro por anúncio, com filtro de data próprio ──────────────
/**
 * Envolve a tabela de lucro por anúncio com um período independente do
 * dashboard. Por padrão segue o período principal (sem refazer a chamada);
 * ao mudar a data aqui, busca só os anúncios daquele intervalo.
 */
function LucroPorAnuncioPanel({ anuncios, from, to }: { anuncios: AnuncioResult[]; from?: string; to?: string }) {
  const [range, setRange] = useState<{ from: string; to: string }>({ from: from ?? "", to: to ?? "" });
  const [proprio, setProprio] = useState<AnuncioResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState(false);

  const indep = !!proprio && (range.from !== from || range.to !== to);

  // Segue o dashboard enquanto o filtro próprio não estiver ativo.
  useEffect(() => {
    if (!proprio) setRange({ from: from ?? "", to: to ?? "" });
  }, [from, to, proprio]);

  async function aplicar(f: string, t: string) {
    setRange({ from: f, to: t });
    // Voltou ao período do dashboard → usa os dados que já vieram, sem refetch.
    if (f === from && t === to) { setProprio(null); setErro(false); return; }
    setLoading(true); setErro(false);
    try {
      const r = await authedFetch(`/api/ml/metrics?from=${f}&to=${t}`, { cache: "no-store" });
      if (!r.ok) { setErro(true); setProprio([]); }
      else { const j = await r.json(); setProprio(j.anuncios ?? []); }
    } catch {
      setErro(true); setProprio([]);
    } finally {
      setLoading(false);
    }
  }

  const dados = indep ? (proprio ?? []) : anuncios;

  return (
    <section className="panel">
      <div className="panel-head" style={{ marginBottom: 8, gap: 10, flexWrap: "wrap" }}>
        <span className="panel-title">Lucro por Anúncio</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {indep && (
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => aplicar(from ?? "", to ?? "")}>
              voltar ao período do dashboard
            </button>
          )}
          <DateRangePicker from={range.from} to={range.to} onApply={aplicar} />
        </div>
      </div>
      <div style={{ fontSize: ".76rem", color: "var(--muted)", marginBottom: 14 }}>
        {indep
          ? <>Filtro próprio: <b style={{ color: "var(--text)" }}>{formatDateBR(range.from)} a {formatDateBR(range.to)}</b> — independente do dashboard.</>
          : "Lucro líq. = Retorno − CMV − Frete − Taxa ML − Imposto − ADS · o frete é o que você paga no envio (Full ou próprio)"}
      </div>
      {erro ? (
        <div style={{ color: "var(--red)", fontSize: ".82rem", padding: "12px 0" }}>
          Não consegui carregar os anúncios desse período. Tente de novo.
        </div>
      ) : loading ? (
        <div style={{ color: "var(--muted)", fontSize: ".85rem", padding: "16px 0", textAlign: "center" }}>Carregando…</div>
      ) : (
        <TabelaAnuncios anuncios={dados} />
      )}
    </section>
  );
}

// ── Média de vendas por dia ────────────────────────────────────
function diasDoPeriodo(from?: string, to?: string): number {
  if (!from || !to) return 1;
  const a = new Date(from + "T00:00:00Z").getTime();
  const b = new Date(to + "T00:00:00Z").getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

/** Dia civil BR de hoje, deslocado por `offsetDias`. */
function diaBR(offsetDias = 0): string {
  const d = new Date(Date.now() - 3 * 3600 * 1000 + offsetDias * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

type JanelaMedia = "periodo" | "mes" | "30d";

const JANELA_LABEL: Record<JanelaMedia, string> = {
  periodo: "Período selecionado",
  mes: "Este mês",
  "30d": "Últimos 30 dias",
};

/**
 * Janela de datas de cada opção. "Este mês" vai do dia 1º até HOJE, não até o
 * fim do mês: dividir as vendas por 31 dias no dia 5 daria uma média
 * artificialmente baixa, e é essa média que decide reposição.
 */
function janelaDe(j: JanelaMedia, from?: string, to?: string): { from: string; to: string } | null {
  if (j === "periodo") return from && to ? { from, to } : null;
  const hoje = diaBR();
  if (j === "mes") return { from: `${hoje.slice(0, 7)}-01`, to: hoje };
  // 30 dias corridos INCLUINDO hoje — daí o -29.
  return { from: diaBR(-29), to: hoje };
}

/**
 * Agrupa os anúncios por PRODUTO.
 *
 * A lista da API é uma linha por anúncio (MLB), e o mesmo produto costuma ter
 * vários — então "Erva Limão Caipira" aparecia duas vezes, com o giro partido
 * entre as linhas. Partido, ele engana duas vezes: some do topo da lista e faz
 * a média/dia de cada metade parecer baixa demais pra repor.
 *
 * A chave é o TÍTULO normalizado porque, para anúncio vinculado, a API já
 * devolve o nome do produto cadastrado (ver `produto.name` em
 * app/api/ml/metrics/route.ts) — dois anúncios do mesmo produto chegam com o
 * mesmo nome. Anúncio sem cadastro mantém o título do ML e continua sozinho,
 * que é o certo: sem vínculo, não dá pra afirmar que é o mesmo produto.
 */
function agruparPorProduto(anuncios: AnuncioResult[]): { title: string; qty: number; anuncios: number }[] {
  const mapa = new Map<string, { title: string; qty: number; anuncios: number }>();
  for (const a of anuncios) {
    if (a.semVenda || a.qty <= 0) continue;
    const chave = a.title.trim().toLowerCase();
    const atual = mapa.get(chave) ?? { title: a.title.trim(), qty: 0, anuncios: 0 };
    atual.qty += a.qty;
    atual.anuncios += 1;
    mapa.set(chave, atual);
  }
  return Array.from(mapa.values());
}

function MediaVendasDia({ anuncios, from, to }: { anuncios: AnuncioResult[]; from?: string; to?: string }) {
  const [janela, setJanela] = useState<JanelaMedia>("periodo");
  /**
   * Resultado guardado JUNTO com a chave da janela que o produziu. Guardar só
   * os dados obrigaria a limpá-los dentro do efeito ao trocar de janela —
   * setState síncrono em efeito, que dispara render em cascata. Comparando a
   * chave, o resultado velho simplesmente deixa de casar e é ignorado.
   */
  const [cache, setCache] = useState<{ chave: string; dados: AnuncioResult[] } | null>(null);

  const alvo = janelaDe(janela, from, to);
  const chaveAlvo = alvo ? `${janela}|${alvo.from}|${alvo.to}` : "";
  /**
   * Derivado, não estado: "está carregando" é exatamente "a janela pedida não
   * é a do cache". Um `useState` aqui exigiria setState dentro do efeito — a
   * cascata de render que o lint aponta — sem dizer nada que a chave já não diga.
   */
  const carregando = janela !== "periodo" && cache?.chave !== chaveAlvo;

  /**
   * "Este mês" e "Últimos 30 dias" não são recortes do período já carregado —
   * podem cobrir dias que ele nem inclui. Então buscam a MESMA rota de
   * métricas com a própria janela, em vez de recalcular por cima de dados
   * incompletos.
   */
  useEffect(() => {
    if (janela === "periodo" || !alvo) return;
    let vivo = true;
    const chave = chaveAlvo;
    authedFetch(`/api/ml/metrics?from=${alvo.from}&to=${alvo.to}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => { if (vivo) setCache({ chave, dados: j.anuncios ?? [] }); })
      // Falha vira lista vazia COM a chave: sem isso a tela ficaria em
      // "carregando" pra sempre depois de um erro de rede.
      .catch(() => { if (vivo) setCache({ chave, dados: [] }); });
    return () => { vivo = false; };
    // chaveAlvo já cobre janela/from/to; `alvo` é recriado a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveAlvo]);

  const base = janela === "periodo"
    ? anuncios
    : (cache?.chave === chaveAlvo ? cache.dados : []);
  const dias = alvo ? diasDoPeriodo(alvo.from, alvo.to) : diasDoPeriodo(from, to);
  const linhas = agruparPorProduto(base)
    .map((g) => ({ ...g, media: g.qty / dias }))
    .sort((x, y) => y.media - x.media);
  const totalQty = linhas.reduce((s, l) => s + l.qty, 0);

  const seletor = (
    <div className="seg" style={{ marginLeft: "auto" }}>
      {(["periodo", "mes", "30d"] as const).map((j) => (
        <button
          key={j}
          type="button"
          className={`seg-btn ${janela === j ? "active" : ""}`}
          onClick={() => setJanela(j)}
          disabled={j === "periodo" && !(from && to)}
        >
          {JANELA_LABEL[j]}
        </button>
      ))}
    </div>
  );

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 8, alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <span>
          <span className="panel-title">Média de vendas por dia</span>
          <span className="panel-sub" style={{ display: "block" }}>
            {carregando
              ? "carregando…"
              : `${dias} dia(s) · ${totalQty} un vendidas · média ${(totalQty / dias).toFixed(1)}/dia`}
            {alvo && ` · ${formatDateBR(alvo.from)} a ${formatDateBR(alvo.to)}`}
          </span>
        </span>
        {seletor}
      </div>

      {linhas.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: ".82rem", padding: "8px 2px" }}>
          {carregando ? "Buscando as vendas desta janela…" : "Nenhuma venda nesta janela."}
        </div>
      ) : (
        <div className="table-wrapper" style={{ border: "none" }}>
          <table className="tbl-modern tbl-cards">
            <thead><tr><th style={{ textAlign: "left" }}>Produto</th><th>Vendas no período</th><th>Média/dia</th></tr></thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.title}>
                  <td style={{ textAlign: "left", fontWeight: 600 }}>
                    {l.title}
                    {l.anuncios > 1 && (
                      <span
                        style={{ display: "block", fontSize: ".66rem", fontWeight: 400, color: "var(--muted)" }}
                        title="Este produto vende por mais de um anúncio; as vendas dos dois estão somadas aqui."
                      >
                        {l.anuncios} anúncios somados
                      </span>
                    )}
                  </td>
                  <td data-label="Vendas no período" style={{ color: "var(--muted)" }}>{l.qty} un</td>
                  <td data-label="Média/dia" style={{ fontWeight: 700, color: "var(--accent)" }}>{l.media.toFixed(1)}/dia</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Dashboard principal ────────────────────────────────────────
function saudacao(): string {
  const h = new Date().getHours();
  if (h < 5) return "Boa madrugada";
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

export default function Dashboard({ data, onVerEstoque, onVerMetas, onNavigate }: Props) {
  // Nome de exibição vem do registro de acesso (controleAcesso), não do
  // Firebase Auth direto — quem entra por login e-mail/senha (criado pelo
  // owner na aba Acesso) nunca teve um displayName do Google, e a saudação
  // caía pro e-mail inteiro em vez do nome de verdade.
  const { displayName } = useAccess();
  const primeiroNome = displayName.split(/[ @]/)[0];
  const mes = mesAtual();

  const [range, setRange] = useState<{ from: string; to: string }>(() => monthRange(mes));
  const [mlRefreshing, setMlRefreshing] = useState(false);
  const [mlLoading, setMlLoading] = useState(false);
  const [mlMetrics, setMlMetrics] = useState<MlMetrics | null>(null);
  const [prevMetrics, setPrevMetrics] = useState<MlMetrics | null>(null);
  // "Ontem" fixo (independe do período selecionado no DateRangePicker) —
  // alimenta só o bloco "Hoje vs Ontem". Reaproveita a mesma rota de
  // métricas com from=to=ontem, igual ao "hoje" que a rota já calcula
  // sempre — nenhuma mudança na rota, nenhum cálculo novo.
  const [ontemMetrics, setOntemMetrics] = useState<MlMetrics | null>(null);
  // Últimos 30 dias corridos fixos (independe do período selecionado no
  // topo) — alimenta só "Melhores dias da semana". Com o range padrão (mês
  // corrente), começar o mês dava poucas amostras por dia da semana e a
  // "média mais forte" balançava muito; 30 dias fixos garante ~4 semanas
  // completas sempre, não importa que dia do mês seja hoje.
  const [melhoresDiasMetrics, setMelhoresDiasMetrics] = useState<MlMetrics | null>(null);
  const [estoqueForecast, setEstoqueForecast] = useState<{ vendas: Record<string, number>; dias: number } | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  useEffect(() => watchTasks(setTasks), []);
  const tarefasVencidas = useMemo(() => tasks.filter(isTaskAtrasada), [tasks]);
  const [mlAccount, setMlAccount] = useState<{ user?: { nickname?: string; site_id?: string } } | null>(null);
  const [diag, setDiag] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const mountedRef = useRef(true);

  function runDiagAds() {
    const d = mlMetrics?.adsDiag;
    setDiag(d ? JSON.stringify(d, null, 2) : "Sem diagnóstico disponível (ADS pode estar OK ou período sem dados).");
  }

  const periodoRange = range;

  // "Mês atual" ativa o acompanhamento de metas e as projeções de fechamento.
  const isMesAtual = useMemo(() => {
    const m = monthRange(mes);
    return range.from === m.from && range.to === m.to;
  }, [range, mes]);

  const periodoLabel = useMemo(() => {
    const today = todayStr();
    if (range.from === today && range.to === today) return "Hoje";
    if (isMesAtual) return "Mês atual";
    return "Personalizado";
  }, [range, isMesAtual]);

  // Período inclui o dia de hoje ainda em andamento — vendas de hoje podem
  // continuar entrando, então qualquer soma do período pode subir depois.
  // Isso é diferente de "hoje" sozinho, onde o usuário já sabe que é parcial.
  const periodoParcial = useMemo(() => range.to === todayStr() && range.from !== range.to, [range]);

  const prevLabel = useMemo(() => {
    if (!isFullMonth(range.from, range.to)) return "vs período anterior";
    // Mês em andamento compara com o mesmo dia do mês anterior (ver
    // prevPeriod); mês já fechado compara com o mês anterior inteiro.
    return range.to > todayStr() ? "vs mesmo dia do mês anterior" : "vs mês anterior";
  }, [range]);

  const fetchMetrics = useCallback(async (from: string, to: string, silent = false, fresh = false) => {
    if (!silent) setMlLoading(true);
    try {
      const res = await authedFetch(`/api/ml/metrics?from=${from}&to=${to}${fresh ? "&fresh=1" : ""}`, { cache: "no-store" });
      if (!res.ok) { if (!silent) setMlMetrics(null); return; }
      const json = await res.json();
      if (mountedRef.current) { setMlMetrics(json); setLastUpdated(Date.now()); }
    } catch {
      if (!silent && mountedRef.current) setMlMetrics(null);
    } finally {
      if (!silent && mountedRef.current) setMlLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    fetchMetrics(periodoRange.from, periodoRange.to);
  }, [periodoRange, fetchMetrics]);

  // Métricas do período ANTERIOR (mesmo tamanho) para a comparação vs. anterior.
  const prevRange = useMemo(() => prevPeriod(periodoRange.from, periodoRange.to), [periodoRange]);
  useEffect(() => {
    let alive = true;
    setPrevMetrics(null);
    (async () => {
      try {
        const res = await authedFetch(`/api/ml/metrics?from=${prevRange.from}&to=${prevRange.to}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        if (alive && mountedRef.current) setPrevMetrics(json);
      } catch { /* comparação é opcional; silencioso */ }
    })();
    return () => { alive = false; };
  }, [prevRange]);

  useEffect(() => {
    authedFetch("/api/ml/account", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (mountedRef.current) setMlAccount(j); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const ontemISO = yesterdayStr();
    authedFetch(`/api/ml/metrics?from=${ontemISO}&to=${ontemISO}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (mountedRef.current) setOntemMetrics(j); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    authedFetch(`/api/ml/metrics?from=${daysAgoStr(29)}&to=${todayStr()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (mountedRef.current) setMelhoresDiasMetrics(j); })
      .catch(() => {});
  }, []);

  // Cobertura real de estoque pro "Produtos em risco" (Fase 5) — mesma rota
  // que a aba Estoque já usa (cache de 60s no servidor, não pesa duas vezes).
  useEffect(() => {
    authedFetch("/api/ml/estoque-forecast?dias=30", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (mountedRef.current && j) setEstoqueForecast({ vendas: j.vendas ?? {}, dias: j.dias ?? 30 }); })
      .catch(() => {});
  }, []);

  // Sincronização automática ao abrir (mantém "hoje" e o mês sempre atualizados)
  useEffect(() => {
    if (Date.now() - lastAutoSync < 5 * 60 * 1000) return;
    lastAutoSync = Date.now();
    (async () => {
      setMlRefreshing(true);
      try {
        await authedFetch("/api/ml/sync-all", { method: "POST" });
        if (mountedRef.current) await fetchMetrics(periodoRange.from, periodoRange.to, true, true);
      } catch { /* silencioso */ }
      finally { if (mountedRef.current) setMlRefreshing(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Atualização automática a cada 15 minutos (silenciosa) enquanto aberto
  useEffect(() => {
    const id = setInterval(() => {
      (async () => {
        try { await authedFetch("/api/ml/sync-all", { method: "POST" }); } catch { /* ignora */ }
        if (mountedRef.current) fetchMetrics(periodoRange.from, periodoRange.to, true, true);
      })();
    }, 15 * 60 * 1000);
    return () => clearInterval(id);
  }, [periodoRange, fetchMetrics]);

  async function handleRefreshML() {
    setMlRefreshing(true);
    try {
      await authedFetch("/api/ml/sync-all", { method: "POST" });
      await fetchMetrics(periodoRange.from, periodoRange.to, false, true);
    } catch (e) { console.error(e); }
    finally { setMlRefreshing(false); }
  }

  // ── Metas ────────────────────────────────────────────────
  const activeGoalEntry = data.goalEntries.find((e) => e.mes === mes) ?? data.goalEntries[0] ?? null;
  const goals: Goals | null = activeGoalEntry
    ? {
        mes:         activeGoalEntry.mes,
        meta1:       activeGoalEntry.meta1,
        meta2:       activeGoalEntry.meta2 ?? null,
        meta3:       activeGoalEntry.meta3 ?? null,
        metaMargem:  activeGoalEntry.metaMargem ?? 10,
        metaDiaria:  activeGoalEntry.metaDiaria ?? null,
        meta2Diaria: activeGoalEntry.meta2Diaria ?? null,
        meta3Diaria: activeGoalEntry.meta3Diaria ?? null,
        metaLucro:   activeGoalEntry.metaLucro ?? null,
        label:       activeGoalEntry.label,
      }
    : data.goals;

  const fatBruto = mlMetrics?.faturamentoBruto ?? 0;
  // Líquido = bruto − canceladas − devoluções. É a base real das metas.
  const fatLiquido = mlMetrics?.faturamentoLiquido ?? 0;
  const retorno = mlMetrics?.totalRetorno ?? 0;
  const lucroLiquido = mlMetrics?.lucroComCustos ?? 0;

  const projecao = useMemo(() => {
    if (!isMesAtual || !mlMetrics) return 0;
    return projetarMes(fatLiquido, diaAtualNoMes(), diasNoMes(mes));
  }, [isMesAtual, mlMetrics, fatLiquido, mes]);

  // Projeção de LUCRO: escala a parte variável (sem custos op.) e mantém o
  // custo operacional do mês fixo.
  const projecaoLucro = useMemo(() => {
    if (!isMesAtual || !mlMetrics) return 0;
    return projetarMes(mlMetrics.lucroSemCustos, diaAtualNoMes(), diasNoMes(mes)) - (mlMetrics.custosOperacionais ?? 0);
  }, [isMesAtual, mlMetrics, mes]);

  // Meta ativa do mês (1, 2 ou 3) — única fonte, usada pelo resumo executivo,
  // pelo gauge de metas e pela Central de Atenção.
  const { activeMeta, metaIndex } = selectActiveGoal(fatLiquido, goals?.meta1 ?? 0, goals?.meta2 ?? null, goals?.meta3 ?? null);

  // ── Meta diária DINÂMICA ──────────────────────────────────────
  // Plana = meta do mês ÷ dias do mês (só referência de "ritmo ideal").
  const metaDiariaPlana = goals?.meta1 ? goals.meta1 / diasNoMes(mes) : null;

  const diasRestantesMes = isMesAtual ? Math.max(diasNoMes(mes) - diaAtualNoMes() + 1, 1) : null;

  // Meta de HOJE = o que ainda falta pra meta do mês ÷ dias que restam (hoje
  // incluso). Se um dia fica abaixo, o que sobrou se redistribui e a meta dos
  // dias seguintes sobe sozinha.
  //
  // Usa o acumulado até ONTEM de propósito: se usasse o de hoje, o alvo cairia
  // conforme as vendas do dia entrassem — a meta fugiria da própria medição.
  const metaDiariaAtiva = useMemo(() => {
    if (!goals?.meta1) return null;
    if (!isMesAtual || !diasRestantesMes) return metaDiariaPlana; // outro período: plana
    const fatAteOntem = Math.max(fatLiquido - (mlMetrics?.faturamentoHoje ?? 0), 0);
    const falta = Math.max(goals.meta1 - fatAteOntem, 0);
    return falta / diasRestantesMes;
  }, [goals?.meta1, isMesAtual, diasRestantesMes, metaDiariaPlana, fatLiquido, mlMetrics?.faturamentoHoje]);

  const totalCustos =
    (mlMetrics?.totalCMV ?? 0) + (mlMetrics?.totalEnvio ?? 0) + (mlMetrics?.totalTaxasML ?? 0) +
    (mlMetrics?.totalImposto ?? 0) + (mlMetrics?.totalAds ?? 0) + (mlMetrics?.custosOperacionais ?? 0);

  // Quando o ADS não vem, NÃO mostramos 0 — 0 é um número errado (some do custo
  // e infla a margem). A linha vira "indisponível" e a tela avisa.
  const adsFalhou = mlMetrics?.adsFalhou === true;

  const custoRows: { label: string; value: number; prevValue: number | null; color: string; indisponivel?: boolean }[] = [
    { label: "CMV (custo do produto)", value: mlMetrics?.totalCMV ?? 0, prevValue: prevMetrics?.totalCMV ?? null, color: COST_COLORS.cmv },
    { label: "Frete (envio)", value: mlMetrics?.totalEnvio ?? 0, prevValue: prevMetrics?.totalEnvio ?? null, color: COST_COLORS.full },
    { label: "Taxas ML (comissão)", value: mlMetrics?.totalTaxasML ?? 0, prevValue: prevMetrics?.totalTaxasML ?? null, color: COST_COLORS.taxa },
    { label: "Imposto sobre venda", value: mlMetrics?.totalImposto ?? 0, prevValue: prevMetrics?.totalImposto ?? null, color: COST_COLORS.imp },
    { label: "ADS (publicidade)", value: mlMetrics?.totalAds ?? 0, prevValue: adsFalhou ? null : (prevMetrics?.totalAds ?? null), color: COST_COLORS.ads, indisponivel: adsFalhou },
    { label: "Custos operacionais", value: mlMetrics?.custosOperacionais ?? 0, prevValue: prevMetrics?.custosOperacionais ?? null, color: COST_COLORS.op },
  ];

  return (
    <div className="dash">
      {/* ── Barra de contexto ── */}
      <div className="dash-greeting">
        <div>
          <div className="dash-greeting-title">{saudacao()}{primeiroNome ? `, ${primeiroNome}` : ""}</div>
          <div className="dash-greeting-date">{formatDateLong(todayStr())}</div>
        </div>
        {periodoParcial && (
          <span className="dash-parcial-badge" title="O dia de hoje ainda não terminou — vendas continuam entrando e os números deste período podem mudar.">
            ⏳ Período inclui hoje — dados ainda podem mudar
          </span>
        )}
      </div>

      {/* ── Topbar ── */}
      <div className="dash-top">
        <div className="dash-top-left">
          <span className="acct-chip">
            <span className="acct-dot" /> Conta ML <b>{mlAccount?.user?.nickname ?? "—"}</b>
          </span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={handleRefreshML} disabled={mlRefreshing} aria-busy={mlRefreshing} style={{ opacity: mlRefreshing ? 0.7 : 1, cursor: mlRefreshing ? "not-allowed" : "pointer" }}>
            {mlRefreshing ? (<><span className="dash-spinner" aria-hidden="true" /> Sincronizando…</>) : "⟳ Atualizar ML"}
          </button>
          {(mlMetrics && mlMetrics.totalAds === 0) && (
            <button type="button" className="btn btn-xs btn-ghost" onClick={runDiagAds} title="Diagnóstico do ADS">ADS</button>
          )}
          <LastUpdated at={lastUpdated} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <DateRangePicker
            from={range.from}
            to={range.to}
            onApply={(from, to) => setRange({ from, to })}
          />
        </div>
      </div>

      {diag && (
        <pre style={{
          position: "relative", background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 8, padding: "12px 14px", fontSize: ".72rem", maxHeight: 300, overflow: "auto",
          whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--text)",
        }}>
          <button type="button" className="btn btn-xs btn-ghost" onClick={() => setDiag(null)} style={{ position: "absolute", right: 8, top: 8 }}>Fechar</button>
          {diag}
        </pre>
      )}

      <AvisoRemessasFull onVerEstoque={onVerEstoque} />

      {adsFalhou && (
        <div style={{ padding: "10px 14px", background: "var(--warning-soft)", border: "1px solid rgba(255,138,31,.45)", borderRadius: 8, fontSize: ".82rem", color: "var(--warning)" }}>
          <b>Atenção: o gasto com ADS não veio do Mercado Livre neste período.</b>{" "}
          Não estou mostrando R$ 0,00 para não te dar número errado — mas isso significa que o{" "}
          <b>lucro e a margem abaixo estão otimistas</b> (falta descontar o ADS). O resto dos números está correto.
        </div>
      )}

      {mlMetrics && !adsFalhou && mlMetrics.totalAds === 0 && (() => {
        const d = mlMetrics.adsDiag as { advertisersStatus?: number; advertiserId?: unknown } | null;
        const blocked = !!d && (d.advertisersStatus === 401 || d.advertisersStatus === 403 || d.advertiserId == null);
        if (!blocked) return null;
        return (
          <div style={{ padding: "10px 14px", background: "var(--warning-soft)", border: "1px solid rgba(255,138,31,.35)", borderRadius: 8, fontSize: ".82rem", color: "var(--warning)" }}>
            <b>ADS não autorizado (HTTP {d?.advertisersStatus ?? "—"}).</b> O token do Mercado Livre não tem permissão de Publicidade.{" "}
            Reconecte o ML em <b>Trocar conta ML</b> concedendo acesso a <b>Publicidade / Mercado Ads</b> para o gasto com Ads voltar a aparecer.
          </div>
        );
      })()}

      {/* ── Conteúdo ── */}
      {mlLoading ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--muted)" }}>Carregando dados…</div>
      ) : (
        <>
          {/* Resumo executivo — as 4 perguntas "quanto vendi e quanto lucrei", em texto grande */}
          {mlMetrics && (
            <ExecutiveKpis
              items={[
                {
                  key: "fatLiquido",
                  label: "Faturamento líquido",
                  value: fatLiquido,
                  format: "currency",
                  tone: "acc",
                  tooltip: "Faturamento bruto do período menos vendas canceladas e devoluções concluídas.",
                  delta: { current: fatLiquido, previous: prevMetrics?.faturamentoLiquido, mode: "pct", label: prevLabel },
                },
                {
                  key: "lucroLiquido",
                  label: "Lucro líquido operacional",
                  value: lucroLiquido,
                  format: "currency",
                  tone: lucroLiquido >= 0 ? "pos" : "neg",
                  tooltip: "Retorno − CMV (custo médio) − frete − taxas ML − imposto − ADS − custos operacionais do Dashboard.",
                  delta: { current: lucroLiquido, previous: prevMetrics?.lucroComCustos, mode: "pct", label: prevLabel },
                },
                {
                  key: "margemLiquida",
                  label: "Margem líquida",
                  value: mlMetrics.margemComCustos ?? 0,
                  format: "percent",
                  tone: (mlMetrics.margemComCustos ?? 0) >= (goals?.metaMargem ?? 10) ? "pos" : "warn",
                  tooltip: "Lucro líquido dividido pelo retorno (valor da venda − taxa ML − frete) do período — não pelo faturamento bruto nem pelo líquido.",
                  delta: { current: mlMetrics.margemComCustos ?? 0, previous: prevMetrics?.margemComCustos, mode: "points", label: prevLabel },
                },
                {
                  key: "projecaoMes",
                  label: goals?.meta1 ? `Projeção do mês (Meta ${metaIndex})` : "Projeção do mês",
                  value: projecao,
                  format: "currency",
                  tone: !goals?.meta1 ? "acc" : projecao >= activeMeta ? "pos" : "warn",
                  tooltip: "Estimativa de fechamento do mês baseada no ritmo atual (faturamento líquido ÷ dia atual × dias do mês). Não é garantia de resultado.",
                  ctaLabel: onVerMetas ? "Ver metas" : undefined,
                  onClick: onVerMetas,
                  indisponivel: !isMesAtual,
                },
              ]}
            />
          )}

          {/* Acompanhamento das metas (topo, modo mês) */}
          {isMesAtual && (
            <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: ".78rem", color: "var(--text-secondary)" }}>{formatMesBR(mes)}</div>
              {goals?.meta1 ? (
                <MetasOverviewCard
                  fatBruto={fatLiquido}
                  meta1={goals.meta1}
                  meta2={goals.meta2 ?? null}
                  meta3={goals.meta3 ?? null}
                  projecao={projecao}
                  projecaoLucro={projecaoLucro}
                  diaAtual={diaAtualNoMes()}
                  totalDias={diasNoMes(mes)}
                  margemAtual={mlMetrics?.margemComCustos ?? 0}
                  metaMargem={goals.metaMargem ?? 10}
                  onVerMetas={onVerMetas}
                />
              ) : (
                <div className="goals-card" style={{ color: "var(--text-secondary)", fontSize: ".85rem" }}>
                  Nenhuma meta configurada. Configure na aba Metas.
                </div>
              )}
            </section>
          )}

          {/* Hoje vs Ontem — leitura rápida em texto */}
          {mlMetrics && <HojeVsOntem hoje={mlMetrics.hoje} ontem={ontemMetrics} />}

          {/* Fluxo e tendência */}
          <section>
            <div className="panel-head">
              <span className="panel-title">Fluxo e tendência</span>
              <span className="panel-sub">Faturamento líquido por dia no período selecionado</span>
            </div>
            <div className="panel">
              <RevenueLineChart serie={mlMetrics?.serieDiaria ?? []} loading={mlLoading} onSelectDay={setSelectedDay} />
            </div>
          </section>

          {selectedDay && <DayDetailModal date={selectedDay} onClose={() => setSelectedDay(null)} />}

          {/* Vendas do dia */}
          <VendasDoDiaHero hoje={mlMetrics?.hoje} />

          {/* Resultado do período */}
          <section>
            <div className="panel-head">
              <span className="panel-title">Resultado do período</span>
              {mlMetrics && <span className="panel-sub">{formatDateBR(mlMetrics.from)} a {formatDateBR(mlMetrics.to)} · {periodoLabel}{prevMetrics ? ` · setas ${prevLabel}` : ""}</span>}
            </div>
            <div className="kpi-grid">
              <Kpi label="Faturamento bruto" value={fatBruto} tone="acc" sub="tudo, inclui cancelados/devolvidos" />
              <Kpi label="Faturamento líquido" value={fatLiquido} tone="acc" sub="− canceladas − devoluções"
                delta={<Delta current={fatLiquido} previous={prevMetrics?.faturamentoLiquido} mode="pct" />} />
              {/* O número do painel do Mercado Livre, pra conferir sem abrir a
                  Conferência. É o líquido MAIS os pedidos que o ML cancelou só
                  pra recriar na separação de envio: ele conta o original e os
                  substitutos, nós contamos só os substitutos.
                  Fica ao lado, nunca no lugar do líquido — contar os dois é
                  contar a mesma mercadoria duas vezes, e é o líquido que deve
                  mandar em decisão de preço e margem. */}
              {mlMetrics?.conciliacao && (
                <Kpi
                  label="Faturamento do ML"
                  value={fatLiquido + (mlMetrics.conciliacao.substituidasValor ?? 0)}
                  tone="acc"
                  sub={
                    (mlMetrics.conciliacao.substituidasQuantidade ?? 0) > 0
                      ? `líquido + ${mlMetrics.conciliacao.substituidasQuantidade} separação(ões) de envio`
                      : "igual ao líquido — nenhuma separação no período"
                  }
                />
              )}
              <Kpi label="Retorno sobre vendas" value={retorno} tone="acc"
                delta={<Delta current={retorno} previous={prevMetrics?.totalRetorno} mode="pct" />} />
              <Kpi label="Lucro líquido" value={lucroLiquido} tone={lucroLiquido >= 0 ? "pos" : "neg"} sub="já com custos operacionais"
                delta={<Delta current={lucroLiquido} previous={prevMetrics?.lucroComCustos} mode="pct" />} />
              <Kpi label="Margem líquida" value={mlMetrics?.margemComCustos ?? 0} tone="warn" isPct
                delta={<Delta current={mlMetrics?.margemComCustos ?? 0} previous={prevMetrics?.margemComCustos} mode="points" />} />
              <Kpi label="Gasto com ADS" value={mlMetrics?.totalAds ?? 0} tone="neg"
                indisponivel={adsFalhou} sub={adsFalhou ? "ML não retornou — não é zero" : undefined} />
              <Kpi label="Vendas canceladas" value={mlMetrics?.vendasCanceladas ?? 0} tone="neg" sub="não contam no lucro" />
              <Kpi label="Devoluções" value={mlMetrics?.vendasDevolvidas ?? 0} tone="neg" sub="0 a 0 (produto volta ao estoque)" />
            </div>
          </section>

          <ConversaoVisitas
            from={mlMetrics?.from}
            to={mlMetrics?.to}
            vendas={mlMetrics?.ordersCount ?? 0}
            receita={fatLiquido}
          />

          {mlMetrics?.conciliacao && (
            <ConferenciaML
              c={mlMetrics.conciliacao}
              periodo={`${formatDateBR(mlMetrics.from)} a ${formatDateBR(mlMetrics.to)}`}
            />
          )}

          {/* Central de Atenção — abaixo dos KPIs, acima das tabelas secundárias */}
          {mlMetrics && (
            <ActionCenter
              anuncios={mlMetrics.anuncios ?? []}
              margemAtual={mlMetrics.margemComCustos ?? 0}
              metaMargem={goals?.metaMargem ?? 10}
              totalAds={mlMetrics.totalAds ?? 0}
              adsFalhou={adsFalhou}
              vendasCanceladas={mlMetrics.vendasCanceladas ?? 0}
              vendasDevolvidas={mlMetrics.vendasDevolvidas ?? 0}
              faturamentoBruto={fatBruto}
              projecao={projecao}
              activeMeta={activeMeta}
              metaIndex={metaIndex}
              faturamentoHoje={mlMetrics.faturamentoHoje ?? 0}
              metaDiariaAtiva={metaDiariaAtiva}
              pedidosHoje={mlMetrics.pedidosHoje ?? 0}
              produtos={data.products}
              estoqueForecast={estoqueForecast}
              onNavigate={onNavigate}
            />
          )}

          {tarefasVencidas.length > 0 && (
            <div className="panel" style={{ borderLeft: "3px solid var(--danger,var(--red))" }}>
              <div className="panel-head" style={{ marginBottom: 10 }}>
                <span className="panel-title">Tarefas vencidas</span>
                <span className="panel-sub">{tarefasVencidas.length} tarefa(s) passou(aram) do prazo</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {tarefasVencidas.slice(0, 5).map((t) => (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "6px 10px", background: "var(--surface-raised,var(--surface2))", borderRadius: 8, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600, fontSize: ".85rem", color: "var(--text-primary,var(--text))" }}>{t.title}</span>
                    <span style={{ fontSize: ".72rem", color: "var(--danger,var(--red))" }}>
                      prazo {t.dueDate ? t.dueDate.split("-").reverse().join("/") : "—"}{t.assignedToName ? ` · ${t.assignedToName}` : ""}
                    </span>
                  </div>
                ))}
              </div>
              {onNavigate && (
                <button type="button" className="ac-cta" style={{ marginTop: 10 }} onClick={() => onNavigate("tarefas")}>Ver Tarefas →</button>
              )}
            </div>
          )}

          {/* Meta diária de hoje */}
          <MetaDiariaCard
            faturamentoHoje={mlMetrics?.faturamentoHoje ?? 0}
            pedidosHoje={mlMetrics?.pedidosHoje ?? 0}
            metaDiaria={metaDiariaAtiva}
            metaPlana={metaDiariaPlana}
            diasRestantes={diasRestantesMes}
          />

          {(mlMetrics?.pedidosSemVinculo ?? 0) > 0 && (
            <div style={{ padding: "8px 12px", background: "var(--warning-soft)", border: "1px solid rgba(255,138,31,.3)", borderRadius: 8, fontSize: ".78rem", color: "var(--warning)" }}>
              {mlMetrics?.pedidosSemVinculo} pedido(s) sem produto vinculado — cadastre o SKU/MLB no Estoque para o lucro ficar completo.
            </div>
          )}

          {/* Composição de custos + Doughnut */}
          <div className="dash-2col">
            <div className="panel">
              <div className="panel-title" style={{ marginBottom: 14 }}>Composição de Custos</div>
              {custoRows.map((r) => {
                const participacao = totalCustos > 0 ? (r.value / totalCustos) * 100 : 0;
                return (
                  <div key={r.label} className="cost-row" style={{ flexWrap: "wrap" }}>
                    <span className="c-lbl"><span className="cost-dot" style={{ background: r.color }} />{r.label}</span>
                    {r.indisponivel
                      ? <span title="O Mercado Livre não retornou o gasto com ADS. Não mostro R$ 0,00 para não te dar número errado." style={{ color: "var(--warning)", fontWeight: 700, fontSize: ".82rem" }}>indisponível</span>
                      : (
                        <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
                          <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                            <span style={{ fontSize: ".72rem", color: "var(--text-muted,var(--muted))", fontWeight: 600 }}>{participacao.toFixed(0)}%</span>
                            <span style={{ color: "var(--red)", fontWeight: 700 }}>{fmtBRL(r.value)}</span>
                          </span>
                          <Delta current={r.value} previous={r.prevValue} mode="pct" invert />
                        </span>
                      )}
                  </div>
                );
              })}
              <div className="cost-total">
                <span>Total de custos{adsFalhou && <span style={{ color: "var(--warning)", fontWeight: 400, fontSize: ".72rem" }}> (sem ADS)</span>}</span>
                <span style={{ color: "var(--red)" }}>{fmtBRL(totalCustos)}</span>
              </div>
            </div>
            <div className="panel">
              <div className="panel-title" style={{ marginBottom: 14 }}>Distribuição dos Gastos</div>
              <ExpensesDoughnut
                produto={mlMetrics?.totalCMV ?? 0}
                envio={mlMetrics?.totalEnvio ?? 0}
                taxasML={mlMetrics?.totalTaxasML ?? 0}
                imposto={mlMetrics?.totalImposto ?? 0}
                ads={mlMetrics?.totalAds ?? 0}
                operacional={mlMetrics?.custosOperacionais ?? 0}
              />
            </div>
          </div>

          {/* Produtos em risco — estoque baixo e/ou margem abaixo da meta */}
          <ProdutosEmRisco
            produtos={findProdutosEmRisco(data.products, mlMetrics?.anuncios ?? [], goals?.metaMargem ?? 10, estoqueForecast)}
            onVerEstoque={onVerEstoque}
          />

          {/* Lucro por anúncio — com filtro de data próprio */}
          <LucroPorAnuncioPanel anuncios={mlMetrics?.anuncios ?? []} from={mlMetrics?.from} to={mlMetrics?.to} />

          {/* Média de vendas por dia */}
          <MediaVendasDia anuncios={mlMetrics?.anuncios ?? []} from={mlMetrics?.from} to={mlMetrics?.to} />

          {/* Conferência da margem contra o dinheiro real */}
          <ConferenciaMP reconc={mlMetrics?.reconc} />

          {/* Melhores dias da semana */}
          <MelhoresDias serie={melhoresDiasMetrics?.serieDiaria ?? []} from={melhoresDiasMetrics?.from} to={melhoresDiasMetrics?.to} />

          {/* Curva ABC de produtos */}
          <CurvaABC anuncios={mlMetrics?.anuncios ?? []} />

          {/* Devoluções detalhadas */}
          <DevolucoesPanel total={mlMetrics?.devolucoes ?? 0} emAndamento={mlMetrics?.devolucoesEmAndamento} detalhe={mlMetrics?.devolucoesDetalhe ?? []} />
        </>
      )}
    </div>
  );
}
