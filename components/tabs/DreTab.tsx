"use client";

import { useCallback, useEffect, useState } from "react";
import { fmtBRL, isFullMonth, prevPeriod, todayStr, fmtPct } from "@/lib/domain/calc";
import { authedFetch } from "@/lib/api/authed-fetch";
import DateRangePicker from "@/components/dashboard/DateRangePicker";
import { Delta } from "@/components/dashboard/ExecutiveKpis";
import CustosColetaFull, { type RemessaCusto } from "@/components/tabs/full/CustosColetaFull";
import ApresentacaoDre from "@/components/tabs/dre/ApresentacaoDre";
import CustoForm from "@/components/custos/CustoForm";
import Modal from "@/components/Modal";
import { useAccess } from "@/components/tabs/AccessGuard";
import type { DadosDre } from "@/lib/domain/dre-apresentacao";
import {
  lerConferencia, pendenciasDaColetaFull, pendenciaDeProjecao, estadoGeral,
  rotuloDoEstado, explicarEstado, corDoEstado, rotuloDoResultado,
  cabecalhoDeExportacao, type Pendencia,
} from "@/lib/domain/apuracao-financeira";

type CustoDre = { nome: string; valor: number; freq: string };

type Metrics = {
  faturamentoBruto: number;
  faturamentoLiquido: number;
  vendasCanceladas: number;
  vendasDevolvidas: number;
  totalRetorno: number;
  totalCMV: number;
  totalAds: number;
  totalEnvio: number;
  totalImposto: number;
  totalTaxasML: number;
  custosOperacionais: number;
  custosDre: number;
  custosDreDetalhe: CustoDre[];
  lucroComCustos: number;
  adsFalhou?: boolean;
  ordersCount: number;
  /** Conferência contra o líquido do Mercado Pago — repasse estimado × recebido. */
  reconc?: { count: number; nosso: number; real: number };
};

function monthRange() {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return { from: `${d.getFullYear()}-${mm}-01`, to: `${d.getFullYear()}-${mm}-${String(last).padStart(2, "0")}` };
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const num = (n: number, d = 2) => n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

/** "julho de 2026" quando o período é um mês inteiro; senão "01/07 – 22/07". */
function fmtPeriodo(from: string, to: string): string {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const ultimoDia = new Date(fy, fm, 0).getDate();
  if (fy === ty && fm === tm && fd === 1 && td === ultimoDia) {
    return `${MESES[fm - 1]} de ${fy}`;
  }
  const br = (s: string) => s.slice(8, 10) + "/" + s.slice(5, 7);
  return `${br(from)} – ${br(to)}`;
}

type LinhaProps = {
  rotulo: string;
  valor: number;
  nota?: string;
  /** deducao = sai do resultado; subtotal = fechamento; resultado = linha final */
  tipo?: "deducao" | "subtotal" | "resultado";
  base?: number;
  /** Explica o que compõe este subtotal/resultado — mesmo padrão ⓘ + hover usado nos KPIs do Dashboard (ExecutiveKpis/PerformanceGauge). */
  tooltip?: string;
  /** Dado que não temos: mostra "—" em vez de R$ 0,00, que seria um número errado. */
  indisponivel?: boolean;
};

function Linha({ rotulo, valor, nota, tipo, base, tooltip, indisponivel }: LinhaProps) {
  const ehResultado = tipo === "resultado";
  const ehSub = tipo === "subtotal" || ehResultado;
  const ehDed = tipo === "deducao";
  const cor = ehResultado
    ? (valor >= 0 ? "var(--green)" : "var(--red)")
    : ehDed ? "var(--red)" : "var(--text)";
  // % sobre a receita: é o que torna a DRE comparável entre meses de tamanhos
  // diferentes — R$ 3 mil de taxa significa coisas distintas em 20k e em 60k.
  const pct = indisponivel ? null : base && base !== 0 ? (valor / base) * 100 : null;
  const larguraBarra = pct === null ? 0 : Math.min(Math.abs(pct), 100);

  return (
    <div
      className={`dre-line${ehSub ? "" : " is-nested"}`}
      style={{
        padding: ehSub ? "11px 12px" : "7px 12px 7px 26px",
        marginTop: ehSub ? 4 : 0,
        background: ehResultado
          ? (valor >= 0 ? "rgba(54,179,126,.1)" : "rgba(214,90,74,.1)")
          : tipo === "subtotal" ? "var(--surface2)" : undefined,
        border: ehResultado
          ? `1px solid ${valor >= 0 ? "rgba(54,179,126,.4)" : "rgba(214,90,74,.4)"}`
          : undefined,
      }}
    >
      <div className="dre-lbl" style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
        {ehDed && <span style={{ color: "var(--muted)", fontSize: ".8rem", flexShrink: 0 }}>−</span>}
        <div style={{ minWidth: 0 }}>
          <span style={{
            fontSize: ehSub ? ".9rem" : ".84rem",
            fontWeight: ehResultado ? 800 : ehSub ? 700 : 500,
            color: ehSub ? "var(--text)" : "var(--muted)",
            textTransform: ehResultado ? "uppercase" : undefined,
            letterSpacing: ehResultado ? ".04em" : undefined,
          }}>
            {rotulo}
          </span>
          {tooltip && (
            <span className="pg-info" tabIndex={0} style={{ marginLeft: 5 }}>
              ⓘ
              <span role="tooltip" className="pg-tooltip">{tooltip}</span>
            </span>
          )}
          {nota && <div style={{ fontSize: ".75rem", color: "var(--muted)", marginTop: 1 }}>{nota}</div>}
        </div>
      </div>

      <span className="dre-val" style={{
        fontSize: ehResultado ? "1.05rem" : ehSub ? ".95rem" : ".86rem",
        fontWeight: ehSub ? 800 : 600,
        whiteSpace: "nowrap", color: indisponivel ? "var(--muted)" : cor, fontVariantNumeric: "tabular-nums",
      }}>
        {indisponivel ? "—" : <>{ehDed ? "−" : ""}{fmtBRL(Math.abs(valor))}</>}
      </span>

      {/* % sobre a receita, com mini-barra para leitura rápida */}
      <div className="dre-pct" style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
        <span style={{
          fontSize: ".75rem", color: ehSub ? "var(--text)" : "var(--muted)",
          whiteSpace: "nowrap", textAlign: "right", fontVariantNumeric: "tabular-nums",
          fontWeight: ehSub ? 700 : 400,
        }}>
          {pct === null ? "" : `${fmtPct(pct, 1)}`}
        </span>
        {pct !== null && !ehResultado && (
          <div style={{ height: 3, borderRadius: 2, background: "var(--border)", overflow: "hidden", minWidth: 54 }}>
            <div style={{
              width: `${larguraBarra}%`, height: "100%", borderRadius: 2,
              background: ehDed ? "var(--red)" : "var(--green)", opacity: ehDed ? .55 : .7,
            }} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Cabeçalho de grupo dentro do demonstrativo, para separar os blocos. */
function GrupoDre({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: ".75rem", fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase",
      color: "var(--muted)", padding: "16px 12px 4px",
    }}>
      {children}
    </div>
  );
}

/**
 * Custo das coletas pro Full no período — a taxa que o ML cobra pra levar seu
 * estoque de casa até o centro de distribuição. NÃO é o mesmo que `totalEnvio`
 * (aquele é o frete de SAÍDA, do centro até o comprador, cobrado por pedido).
 * Até agora esse custo não entrava em conta nenhuma do app, então o resultado
 * saía otimista pelo valor dele.
 *
 * `parcial` = alguma remessa do período veio sem custo da API do ML; o total
 * abaixo é só do que veio, então é PISO, não o valor fechado.
 * `foraDaJanela` = o período pedido é mais antigo do que a janela que a rota
 * de gestão do Full consegue buscar (limite do próprio ML) — nesse caso não
 * temos como afirmar nada, e a linha aparece como indisponível em vez de R$ 0.
 */
type CustoColetaFull = {
  total: number; parcial: boolean; foraDaJanela: boolean; remessas: number;
  /**
   * TODAS as remessas do período, com custo ou sem. Antes guardava só as sem
   * custo, e por isso não havia como rever nem corrigir um valor já informado
   * — que entra direto no Resultado líquido.
   */
  todas: RemessaCusto[];
  /** Quantas ainda estão sem custo — só pro alerta do cabeçalho. */
  pendentes: number;
};

const JANELA_MAX_DIAS_FULL = 55; // teto do ML na busca de operações de estoque

export default function DreTab() {
  const [range, setRange] = useState(() => monthRange());
  /**
   * ─── CADA RESPOSTA CARREGA O PERÍODO A QUE ELA PERTENCE ──────────────
   *
   * Eram quatro estados soltos e um `setLoading(true)` no começo de `load`,
   * que roda DEPOIS da pintura. Trocar o período no seletor pintava o
   * cabeçalho novo com os números do período ANTERIOR, e só no quadro
   * seguinte aparecia "Carregando DRE…".
   *
   * Isso é alcançável com um clique: o DateRangePicker muda `range` sem
   * remontar a aba. E o que aparece nesse quadro não é um esqueleto cinza —
   * é uma DRE inteira, com valores, sob o nome do mês errado.
   *
   * Guardando o período junto da resposta, resposta de outro período
   * simplesmente não é a resposta deste. A decisão acontece no render, sem
   * setState e sem quadro intermediário.
   */
  type Periodo = { from: string; to: string };
  const mesmoPeriodo = (a: Periodo | undefined, b: Periodo) => a?.from === b.from && a?.to === b.to;

  const [resp, setResp] = useState<{ periodo: Periodo; m: Metrics | null } | null>(null);
  const [respPrev, setRespPrev] = useState<{ periodo: Periodo; m: Metrics | null } | null>(null);
  const [respColeta, setRespColeta] = useState<{ periodo: Periodo; c: CustoColetaFull | null } | null>(null);

  const daVez = resp && mesmoPeriodo(resp.periodo, range) ? resp : null;
  const loading = daVez === null;
  const m = daVez?.m ?? null;
  const mPrev = respPrev && mesmoPeriodo(respPrev.periodo, range) ? respPrev.m : null;
  const coletaFull = respColeta && mesmoPeriodo(respColeta.periodo, range) ? respColeta.c : null;
  const [apresentando, setApresentando] = useState(false);
  /**
   * Cadastro de custo sem sair da DRE. É onde a falta de uma despesa aparece
   * — o resultado líquido parece bom demais — e mandar a pessoa pra outra aba
   * pra corrigir era o jeito mais certo de ela não corrigir.
   *
   * Mesma permissão da aba de Custos: quem não edita custo lá não edita aqui.
   */
  const [novoCusto, setNovoCusto] = useState(false);
  const { canEditTab } = useAccess();
  const podeCadastrarCusto = canEditTab("custos");

  const load = useCallback(async (forcar = false) => {
    // Sem `setLoading`: `loading` é derivado de a resposta ser deste período.
    // O período de partida é capturado aqui pra carimbar o resultado — se o
    // seletor mudar no meio da busca, a resposta chega carimbada com o período
    // ANTIGO e o render a descarta sozinho.
    const pedido: Periodo = { from: range.from, to: range.to };
    try {
      /**
       * `forcar` fura o cache de 60s da rota de metricas. Sem isso, um custo
       * recem-cadastrado nao aparecia na DRE por ate um minuto depois de
       * salvo — e na tela isso e indistinguivel de "nao salvou".
       */
      const r = await authedFetch(`/api/ml/metrics?from=${range.from}&to=${range.to}${forcar ? "&fresh=1" : ""}`, { cache: "no-store" });
      setResp({ periodo: pedido, m: r.ok ? await r.json() : null });
    } catch {
      setResp({ periodo: pedido, m: null });
    } finally {
      // nada a fazer: `loading` sai do render.
    }

    // Coleta pro Full: best-effort, nunca trava a DRE. Só as remessas que
    // caem DENTRO do período é que entram — a rota devolve uma janela em dias
    // corridos a partir de hoje, então filtramos pela data de cada remessa.
    try {
      const hoje = todayStr();
      const diasAte = Math.ceil((Date.parse(`${hoje}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86400000) + 1;
      if (!Number.isFinite(diasAte) || diasAte > JANELA_MAX_DIAS_FULL) {
        setRespColeta({ periodo: pedido, c: { total: 0, parcial: false, foraDaJanela: true, remessas: 0, todas: [], pendentes: 0 } });
      } else {
        const rf = await authedFetch(
          `/api/ml/gestao-full?dias=${Math.max(diasAte, 1)}${forcar ? "&forcar=1" : ""}`,
          { cache: "no-store" },
        );
        if (!rf.ok) setRespColeta({ periodo: pedido, c: null });
        else {
          const j = (await rf.json()) as {
            remessas?: { remessa: string; data: string; recebido?: number; custo?: number | null; ehTransferencia?: boolean; custoEstimado?: boolean }[];
          };
          // Transferência entre centros do ML não é coleta sua — não tem taxa sua.
          const noPeriodo = (j.remessas ?? []).filter(
            (x) => !x.ehTransferencia && x.data >= range.from && x.data <= range.to,
          );
          const total = noPeriodo.reduce((s, x) => s + (x.custo ?? 0), 0);
          setRespColeta({ periodo: pedido, c: {
            total,
            parcial: noPeriodo.some((x) => x.custo == null),
            foraDaJanela: false,
            remessas: noPeriodo.length,
            todas: noPeriodo.map((x) => ({
              remessa: x.remessa,
              data: x.data,
              recebido: Number(x.recebido ?? 0),
              custo: x.custo ?? null,
              custoEstimado: x.custoEstimado === true,
            })),
            pendentes: noPeriodo.filter((x) => x.custo == null).length,
          } });
        }
      }
    } catch {
      setRespColeta({ periodo: pedido, c: null });
    }
    // Período anterior equivalente — mesma lógica do Dashboard (mês cheio vs
    // mês anterior; mês em andamento vs mesmo dia do mês anterior). Falha
    // silenciosa: comparação é um extra, não pode travar a DRE em si.
    try {
      const prev = prevPeriod(range.from, range.to);
      const rp = await authedFetch(`/api/ml/metrics?from=${prev.from}&to=${prev.to}`, { cache: "no-store" });
      setRespPrev({ periodo: pedido, m: rp.ok ? await rp.json() : null });
    } catch {
      setRespPrev({ periodo: pedido, m: null });
    }
  }, [range]);

  useEffect(() => {
    // Dentro de um callback async: chamar `load()` direto no corpo do efeito
    // faz a regra tratar a funcao inteira como sincrona, mesmo com todo o
    // setState depois de um `await`. Mesmo padrao ja usado em CustosTab.
    void (async () => { await load(); })();
  }, [load]);

  const prevLabel = !isFullMonth(range.from, range.to)
    ? "vs período anterior"
    : range.to > todayStr() ? "vs mesmo dia do mês anterior" : "vs mês anterior";

  if (loading) {
    return <div className="dash"><div className="panel" style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Carregando DRE…</div></div>;
  }
  if (!m) {
    return <div className="dash"><div className="panel" style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Não consegui carregar os dados do período.</div></div>;
  }

  // Cópia com tipo já estreitado pra "não-nulo" — funções aninhadas abaixo
  // (exportarCsv) não herdam a checagem `if (!m) return` acima, então usam
  // esta constante em vez de `m` direto.
  const metrics = m;
  const receitaBruta = metrics.faturamentoBruto;
  const canceladas = m.vendasCanceladas + m.vendasDevolvidas;
  const receitaLiquida = m.faturamentoLiquido;
  /**
   * ─── AS DEDUÇÕES APARECIAM E NÃO ERAM SUBTRAÍDAS ─────────────────────
   *
   * Era `m.totalRetorno`, com o comentário "já é líquida de taxa e frete".
   * Não é: `totalRetorno` soma `unit_price × quantidade` (ver a rota de
   * métricas) — receita BRUTA do item, antes de qualquer dedução.
   *
   * O efeito na tela era uma DRE que não fecha consigo mesma:
   *
   *     Receita líquida              14.676,52
   *     − Taxas do Mercado Livre      1.682,64   ← mostrado
   *     − Frete                       1.345,30   ← mostrado
   *     = Receita operacional líquida 14.676,52  ← inalterada
   *
   * E essa linha se chama "o que o ML de fato te repassa". Ela dizia que o
   * ML repassa a receita inteira, com as duas deduções logo acima dela.
   *
   * ─── O QUE PROVA QUE A CORREÇÃO É ESTA ───────────────────────────────
   *
   * `resultadoOperacional` vem de `lucroComCustos`, que na rota JÁ desconta
   * taxa e frete — e por isso estava certo. Com o subtotal errado, a cadeia
   * não fechava: lucro bruto − imposto − Ads dava 4.516,51, e a linha de
   * resultado mostrava 1.488,57. A diferença era exatamente 3.027,94, que é
   * taxas + frete.
   *
   * Descontando aqui, a conta fecha ponta a ponta e bate com o número que
   * já estava certo — que é a confirmação de que o erro era só no meio.
   */
  const receitaOperacional = m.totalRetorno - m.totalTaxasML - m.totalEnvio;
  const lucroBruto = receitaOperacional - m.totalCMV;
  const resultadoOperacional = m.lucroComCustos; // o mesmo do Dashboard
  /**
   * Coleta pro Full entra ABAIXO do resultado operacional de propósito: o
   * Dashboard não conhece esse custo, e a linha "Resultado operacional" tem
   * a promessa explícita de bater com ele. Descontar aqui embaixo mantém as
   * duas telas coerentes E deixa o Resultado líquido correto — mesmo
   * tratamento que já é dado a pró-labore/contador (custosDre).
   */
  const custoColetaFull = coletaFull && !coletaFull.foraDaJanela ? coletaFull.total : 0;
  const resultadoLiquido = resultadoOperacional - m.custosDre - custoColetaFull;

  /**
   * ─── O ESTADO DA APURAÇÃO (FIN-03) ───────────────────────────────────
   *
   * A linha final se chamava "Resultado líquido" em todos os casos: com a
   * coleta pro Full fora da janela, com remessa sem custo informado, com o
   * mês pela metade, com o gasto de Ads que não veio do ML. O número mudava
   * de significado e o rótulo não, e um rótulo que afirma fechamento é
   * exatamente o que faz alguém mandar o CSV pro contador como fechado.
   *
   * As pendências são coletadas UMA VEZ aqui e usadas em três lugares: o
   * cabeçalho do demonstrativo, o painel de pendências e o CSV. Se cada um
   * montasse a sua, voltaríamos ao problema de sempre — a mesma informação
   * dita de três jeitos divergentes.
   */
  const conferencia = lerConferencia({
    conferidos: metrics.reconc?.count ?? 0,
    total: metrics.ordersCount,
    estimado: metrics.reconc?.nosso ?? 0,
    recebido: metrics.reconc?.real ?? 0,
  });

  const pendencias: Pendencia[] = [
    ...pendenciaDeProjecao(range.to, todayStr()),
    ...(coletaFull ? pendenciasDaColetaFull(coletaFull) : [{
      chave: "coleta-nao-carregou",
      titulo: "Não consegui carregar os custos de coleta pro Full",
      detalhe:
        "A busca das remessas falhou. O custo de levar estoque até o centro não está descontado aqui, e o resultado sai otimista por esse valor.",
      efeito: "otimista" as const,
    }]),
    ...(metrics.adsFalhou ? [{
      chave: "ads-indisponivel",
      titulo: "O gasto com ADS não veio do Mercado Livre",
      detalhe:
        "A verba de anúncios do período não pôde ser lida, e entra como zero no cálculo. O resultado está otimista pelo valor investido.",
      efeito: "otimista" as const,
    }] : []),
    ...conferencia.pendencias,
  ];

  const estado = estadoGeral(pendencias, conferencia.estado);

  const base = receitaLiquida;
  const margem = (v: number) => (base ? (v / base) * 100 : 0);

  const receitaLiquidaPrev = mPrev?.faturamentoLiquido ?? null;
  // Mesma correção no período anterior — senão a comparação mediria uma
  // base contra outra, e a seta de variação viraria ficção.
  const lucroBrutoPrev = mPrev
    ? mPrev.totalRetorno - mPrev.totalTaxasML - mPrev.totalEnvio - mPrev.totalCMV
    : null;
  const resultadoOperacionalPrev = mPrev?.lucroComCustos ?? null;
  const resultadoLiquidoPrev = mPrev ? mPrev.lucroComCustos - mPrev.custosDre : null;

  /**
   * Os dados da apresentação saem EXATAMENTE dos valores já calculados acima.
   *
   * A tentação era recalcular lá dentro a partir das métricas cruas, e é assim
   * que duas telas passam a mostrar números diferentes do mesmo mês. O PDF é
   * uma VISTA da DRE, não um segundo cálculo dela.
   */
  const dadosApres: DadosDre = {
    pedidos: metrics.ordersCount,
    receitaBruta,
    canceladas,
    receitaLiquida,
    taxasML: metrics.totalTaxasML,
    frete: metrics.totalEnvio,
    receitaOperacional,
    cmv: metrics.totalCMV,
    lucroBruto,
    imposto: metrics.totalImposto,
    ads: metrics.totalAds,
    despesasOperacionais: metrics.custosOperacionais,
    resultadoOperacional,
    despesasEmpresa: metrics.custosDreDetalhe.map((c) => ({ nome: c.nome, valor: c.valor })),
    coletaFull: custoColetaFull,
    resultadoLiquido,
  };

  /**
   * O período anterior, pras comparações. `coletaFull` entra como 0 porque a
   * aba só busca a coleta do período ATUAL — a janela do ML pra operações de
   * estoque tem teto de 55 dias e uma segunda busca dobraria o tempo de carga
   * por uma linha que costuma valer pouco. O efeito é a comparação sair
   * levemente otimista pro mês anterior; é dito no rodapé da apresentação.
   */
  const anteriorApres: DadosDre | null = mPrev ? {
    pedidos: mPrev.ordersCount,
    receitaBruta: mPrev.faturamentoBruto,
    canceladas: mPrev.vendasCanceladas + mPrev.vendasDevolvidas,
    receitaLiquida: mPrev.faturamentoLiquido,
    taxasML: mPrev.totalTaxasML,
    frete: mPrev.totalEnvio,
    receitaOperacional: mPrev.totalRetorno - mPrev.totalTaxasML - mPrev.totalEnvio,
    cmv: mPrev.totalCMV,
    lucroBruto: mPrev.totalRetorno - mPrev.totalTaxasML - mPrev.totalEnvio - mPrev.totalCMV,
    imposto: mPrev.totalImposto,
    ads: mPrev.totalAds,
    despesasOperacionais: mPrev.custosOperacionais,
    resultadoOperacional: mPrev.lucroComCustos,
    despesasEmpresa: mPrev.custosDreDetalhe.map((c) => ({ nome: c.nome, valor: c.valor })),
    coletaFull: 0,
    resultadoLiquido: mPrev.lucroComCustos - mPrev.custosDre,
  } : null;

  function exportarCsv() {
    const linhas: { rotulo: string; valor: number; ded?: boolean }[] = [
      { rotulo: "Receita bruta de vendas", valor: receitaBruta },
      { rotulo: "Cancelamentos e devoluções", valor: canceladas, ded: true },
      { rotulo: "Receita líquida", valor: receitaLiquida },
      { rotulo: "Taxas do Mercado Livre", valor: metrics.totalTaxasML, ded: true },
      { rotulo: "Frete", valor: metrics.totalEnvio, ded: true },
      { rotulo: "Receita operacional líquida", valor: receitaOperacional },
      { rotulo: "Custo da mercadoria vendida", valor: metrics.totalCMV, ded: true },
      { rotulo: "Lucro bruto", valor: lucroBruto },
      { rotulo: "Impostos sobre vendas", valor: metrics.totalImposto, ded: true },
      { rotulo: "Marketing (ADS)", valor: metrics.totalAds, ded: true },
      { rotulo: "Despesas operacionais", valor: metrics.custosOperacionais, ded: true },
      { rotulo: "Resultado operacional", valor: resultadoOperacional },
      ...metrics.custosDreDetalhe.map((c) => ({ rotulo: `Despesa da empresa: ${c.nome}`, valor: c.valor, ded: true })),
      { rotulo: "Coleta pro Full (taxa de envio ao centro)", valor: custoColetaFull, ded: true },
      { rotulo: "Resultado líquido", valor: resultadoLiquido },
    ];
    const header = ["Linha", "Valor (R$)", "% receita líquida"];
    const linhasCsv = linhas.map((l) => [l.rotulo, `${l.ded ? "-" : ""}${num(l.valor)}`, num(margem(l.valor), 1)]);

    /**
     * O contexto vai ANTES dos números, não em rodapé.
     *
     * Este arquivo sai do app e vira anexo de e-mail — a partir daí ninguém
     * sabe de que período é, de quando são os números nem o que faltava
     * apurar quando foram tirados. Em rodapé, rola-se por cima; no topo,
     * não tem como abrir a planilha sem ver.
     */
    const contexto = cabecalhoDeExportacao({
      de: range.from,
      ate: range.to,
      apuradoEm: new Date().toLocaleString("pt-BR"),
      // A DRE não tem filtro além do período; declarado explicitamente pra
      // que a ausência seja uma afirmação e não um esquecimento.
      filtros: [],
      estado,
      pendencias,
    });

    /**
     * As duas leituras do repasse, separadas — é o núcleo do FIN-03. Nunca
     * somadas com as linhas do demonstrativo acima: aquelas são REGIME DE
     * COMPETÊNCIA (a venda do período), estas são CAIXA (o que o MP liberou).
     * Somar as duas seria contar a mesma venda duas vezes.
     */
    const repasse: string[][] = metrics.reconc && metrics.reconc.count > 0 ? [
      [""],
      ["Repasse (caixa) — não somar com as linhas acima, é a mesma venda vista pelo dinheiro"],
      ["Pedidos com repasse liberado", `${metrics.reconc.count} de ${metrics.ordersCount}`],
      ["Repasse estimado (nossa conta)", num(metrics.reconc.nosso)],
      ["Valor efetivamente recebido (Mercado Pago)", num(metrics.reconc.real)],
      ["Diferença", num(conferencia.diferenca)],
    ] : [
      [""],
      ["Repasse (caixa)", "nenhum pedido do período teve repasse liberado até agora"],
    ];

    const csv = [...contexto, header, ...linhasCsv, ...repasse]
      .map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";"))
      .join("\r\n");
    const blob = new Blob([String.fromCharCode(0xfeff) + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dre-${range.from}_a_${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="dash">
      <div className="tab-head">
        <div className="tab-head-left">
          <h2 className="tab-title">DRE</h2>
          <span className="tab-head-sub" style={{ textTransform: "capitalize" }}>
            {fmtPeriodo(range.from, range.to)} · {m.ordersCount} pedido(s)
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button" className="btn btn-primary btn-sm"
            onClick={() => setApresentando(true)}
            title="Monta uma apresentação de 4 páginas do fechamento do período, pronta pra salvar em PDF e mandar pro sócio"
          >
            Apresentação em PDF
          </button>
          <DateRangePicker from={range.from} to={range.to} onApply={(from, to) => setRange({ from, to })} />
        </div>
      </div>

      {m.adsFalhou && (
        <div className="note note-warn">
          O gasto com ADS não veio do Mercado Livre neste período. O resultado abaixo está
          <b> otimista</b> — falta descontar a verba de anúncios.
        </div>
      )}

      {/*
        ─── O PAINEL DE PENDÊNCIAS ──────────────────────────────────────────

        Cada pendência já existia como notinha cinza espalhada pela tela, ao
        lado da linha a que pertencia. Espalhadas, elas nunca somam: dava pra
        ler a DRE inteira sem perceber que TRÊS coisas faltavam ao mesmo tempo.

        Juntas e no topo, com a direção do erro em cada uma, viram a resposta
        pra única pergunta que importa: "posso mandar este número pra fora?"
      */}
      <div className="panel" style={{ borderLeft: `3px solid ${corDoEstado(estado)}` }}>
        <div className="panel-head" style={{ marginBottom: pendencias.length ? 8 : 0 }}>
          <span className="panel-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            Estado da apuração
            <span style={{
              fontSize: ".75rem", fontWeight: 700, letterSpacing: ".03em", textTransform: "uppercase",
              color: corDoEstado(estado), border: `1px solid ${corDoEstado(estado)}`,
              borderRadius: 999, padding: "1px 8px",
            }}>
              {rotuloDoEstado(estado)}
            </span>
          </span>
          <span className="panel-sub">apurado em {new Date().toLocaleString("pt-BR")}</span>
        </div>
        <div style={{ fontSize: ".82rem", color: "var(--muted)", lineHeight: 1.6 }}>
          {explicarEstado(estado)}
        </div>
        {pendencias.length > 0 && (
          <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
            {pendencias.map((p) => (
              <li key={p.chave} style={{
                padding: "8px 10px", borderRadius: 8, background: "var(--surface2)",
                border: "1px solid var(--border)",
              }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ fontSize: ".82rem", fontWeight: 700 }}>{p.titulo}</span>
                  {/*
                    A direção do erro é o que torna a pendência acionável:
                    saber que o resultado está OTIMISTA dá o que fazer; "há
                    uma pendência" não dá.
                  */}
                  <span style={{
                    fontSize: ".75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em",
                    color: p.efeito === "otimista" ? "var(--red)" : p.efeito === "pessimista" ? "var(--green)" : "var(--muted)",
                  }}>
                    {p.efeito === "indefinido" ? "efeito desconhecido" : `resultado ${p.efeito}`}
                  </span>
                </div>
                <div style={{ fontSize: ".8rem", color: "var(--muted)", lineHeight: 1.55, marginTop: 2 }}>
                  {p.detalhe}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/*
        Repasse estimado × recebido: as MESMAS vendas, vistas pelo dinheiro em
        vez de pela competência. Fica fora do demonstrativo de propósito —
        somar as duas visões contaria cada venda duas vezes.
      */}
      {metrics.reconc && metrics.reconc.count > 0 && (
        <div className="panel">
          <div className="panel-head" style={{ marginBottom: 8 }}>
            <span className="panel-title">Repasse do Mercado Pago</span>
            <span className="panel-sub">
              {metrics.reconc.count} de {metrics.ordersCount} pedidos com repasse liberado
              {conferencia.cobertura !== null && ` · ${fmtPct((conferencia.cobertura * 100), 0)} do período`}
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
            <div>
              <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>Repasse estimado</div>
              <div style={{ fontSize: "1.05rem", fontWeight: 800 }}>{fmtBRL(metrics.reconc.nosso)}</div>
              <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>nossa conta: total − taxa ML − frete</div>
            </div>
            <div>
              <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>Valor efetivamente recebido</div>
              <div style={{ fontSize: "1.05rem", fontWeight: 800 }}>{fmtBRL(metrics.reconc.real)}</div>
              <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>o que o Mercado Pago liberou</div>
            </div>
            <div>
              <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>Diferença</div>
              <div style={{
                fontSize: "1.05rem", fontWeight: 800,
                color: conferencia.dentroDaTolerancia ? "var(--green)" : "var(--red)",
              }}>
                {fmtBRL(Math.abs(conferencia.diferenca))}
              </div>
              <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>
                {conferencia.podeAfirmarQueBate ? "confere no período" : "vale só nos pedidos já liberados"}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="kpi-grid">
        <div className="kpi k-acc">
          <div className="k-lbl">Receita líquida</div>
          <div className="k-val">{fmtBRL(receitaLiquida)}</div>
          <div className="k-sub">sem cancelados e devolvidos</div>
          <Delta current={receitaLiquida} previous={receitaLiquidaPrev} mode="pct" label={prevLabel} />
        </div>
        <div className="kpi k-pos">
          <div className="k-lbl">Lucro bruto</div>
          <div className="k-val" style={{ color: "var(--green)" }}>{fmtBRL(lucroBruto)}</div>
          <div className="k-sub">margem de {fmtPct(margem(lucroBruto), 1)}</div>
          <Delta current={lucroBruto} previous={lucroBrutoPrev} mode="pct" label={prevLabel} />
        </div>
        <div className="kpi k-warn">
          <div className="k-lbl">Resultado operacional</div>
          <div className="k-val" style={{ color: resultadoOperacional >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(resultadoOperacional)}</div>
          <div className="k-sub">é o lucro do Dashboard</div>
          <Delta current={resultadoOperacional} previous={resultadoOperacionalPrev} mode="pct" label={prevLabel} />
        </div>
        <div className="kpi k-neg">
          <div className="k-lbl">{rotuloDoResultado(estado)}</div>
          <div className="k-val" style={{ color: resultadoLiquido >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(resultadoLiquido)}</div>
          <div className="k-sub">margem de {fmtPct(margem(resultadoLiquido), 1)}</div>
          <Delta current={resultadoLiquido} previous={resultadoLiquidoPrev} mode="pct" label={prevLabel} />
        </div>
      </div>

      <div className="panel">
        <div className="panel-head" style={{ marginBottom: 2 }}>
          <span className="panel-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            Demonstrativo de resultado
            <button type="button" className="btn btn-xs btn-ghost" onClick={exportarCsv} title="Exporta todas as linhas do demonstrativo em CSV">
              ⬇ Exportar CSV
            </button>
          </span>
          <span className="panel-sub">{fmtPeriodo(range.from, range.to)}</span>
        </div>

        {/* Cabeçalho das colunas de valor (no celular some: cada linha já se explica) */}
        <div className="dre-head">
          <span />
          <span style={{ textAlign: "right" }}>Valor</span>
          <span style={{ textAlign: "right" }}>% receita</span>
        </div>

        <GrupoDre>Receita</GrupoDre>
        <Linha rotulo="Receita bruta de vendas" valor={receitaBruta} nota="tudo que entrou, inclusive o que caiu depois" />
        <Linha rotulo="Cancelamentos e devoluções" valor={canceladas} tipo="deducao" base={base} />
        <Linha
          rotulo="Receita líquida"
          valor={receitaLiquida}
          tipo="subtotal"
          tooltip="Receita bruta de vendas menos cancelamentos e devoluções concluídas no período."
        />

        <GrupoDre>Custos de venda no Mercado Livre</GrupoDre>
        <Linha rotulo="Taxas do Mercado Livre" valor={m.totalTaxasML} tipo="deducao" base={base} />
        <Linha rotulo="Frete" valor={m.totalEnvio} tipo="deducao" base={base} />
        <Linha
          rotulo="Receita operacional líquida"
          valor={receitaOperacional}
          tipo="subtotal"
          nota="o que o ML de fato te repassa"
          tooltip="Receita líquida menos taxas do Mercado Livre e frete — é o valor que efetivamente cai na conta, antes de descontar o custo da mercadoria."
        />

        <GrupoDre>Mercadoria</GrupoDre>
        <Linha rotulo="Custo da mercadoria vendida" valor={m.totalCMV} tipo="deducao" base={base} nota="custo médio × unidades vendidas" />
        <Linha
          rotulo="Lucro bruto"
          valor={lucroBruto}
          tipo="subtotal"
          tooltip="Receita operacional líquida menos o custo da mercadoria vendida (custo médio × unidades). Ainda não descontou imposto, ADS nem despesas operacionais."
        />

        <GrupoDre>Impostos e despesas operacionais</GrupoDre>
        <Linha rotulo="Impostos sobre vendas" valor={m.totalImposto} tipo="deducao" base={base} />
        <Linha rotulo="Marketing (ADS)" valor={m.totalAds} tipo="deducao" base={base} />
        <Linha rotulo="Despesas operacionais" valor={m.custosOperacionais} tipo="deducao" base={base} nota="custos da aba Custos que descontam no Dashboard" />
        <Linha
          rotulo="Resultado operacional"
          valor={resultadoOperacional}
          tipo="subtotal"
          nota="daqui pra cima é exatamente o lucro líquido do Dashboard"
          tooltip="Lucro bruto menos impostos sobre vendas, ADS e despesas operacionais (as da aba Custos com escopo 'Dash'). Não inclui pró-labore, contador nem retirada — essas só entram no Resultado líquido, abaixo."
        />

        <GrupoDre>Despesas da empresa</GrupoDre>
        <Linha rotulo="Pró-labore, contador, retirada" valor={m.custosDre} tipo="deducao" base={base} nota="só aparecem aqui, fora do lucro do Dashboard" />
        {coletaFull?.foraDaJanela ? (
          <Linha
            rotulo="Coleta pro Full (taxa de envio ao centro)"
            valor={0}
            tipo="deducao"
            base={base}
            indisponivel
            nota={`o Mercado Livre só devolve as remessas dos últimos ${JANELA_MAX_DIAS_FULL} dias — período antigo demais pra consultar`}
          />
        ) : coletaFull ? (
          <Linha
            rotulo="Coleta pro Full (taxa de envio ao centro)"
            valor={coletaFull.total}
            tipo="deducao"
            base={base}
            indisponivel={coletaFull.remessas > 0 && coletaFull.total === 0}
            nota={
              coletaFull.remessas === 0
                ? "nenhuma remessa pro Full neste período"
                : coletaFull.total === 0
                  // Zero com remessas no periodo nao e "coleta de graca": e
                  // custo nao informado. Mostrar R$ 0,00 aqui inflaria o
                  // resultado liquido, entao a linha vira "—" com o caminho
                  // exato de onde tirar o numero.
                  ? `${coletaFull.remessas} remessa(s) sem custo informado — o Mercado Livre não expõe esse valor pela API. Pegue em Envios › detalhe do envio › Tarifas › Custo da coleta Full e informe na aba Full.`
                  : coletaFull.parcial
                    ? `${coletaFull.remessas} remessa(s) — parte ainda sem custo informado, então este valor é o mínimo (informe o resto na aba Full)`
                    : `${coletaFull.remessas} remessa(s) enviada(s) no período`
            }
          />
        ) : null}
        {/* Preencher o custo aqui mesmo. A API publica do ML nao expoe a taxa
            da coleta (a doc de Fulfillment e explicita: so estoque e
            operacoes), e sem esse numero o Resultado liquido fica otimista —
            que e exatamente o oposto do que a DRE existe pra mostrar. Obrigar
            a ir ate a aba Full pra digitar tornava provavel ficar sem. */}
        {!!coletaFull?.todas.length && (
          <CustosColetaFull
            remessas={coletaFull.todas}
            onSalvo={() => load(true)}
            iniciarAberto={coletaFull.pendentes > 0}
            titulo="Custos de coleta do Full no período"
          />
        )}

        <div style={{ marginTop: 10 }}>
          {/*
            O rótulo carrega o estado. "Resultado líquido" afirmava fechamento
            mesmo com coleta pro Full fora da janela e Ads faltando — e era o
            rótulo que ia pro CSV e pro PDF mandados pra fora.
          */}
          <Linha
            rotulo={rotuloDoResultado(estado)}
            valor={resultadoLiquido}
            tipo="resultado"
            base={base}
            nota={estado === "conciliado" ? undefined : `${pendencias.length} pendência(s) de informação — veja abaixo`}
            tooltip="Resultado operacional menos as despesas da empresa marcadas 'Só na DRE' (pró-labore, contador, retirada) e a taxa de coleta pro Full. É o número final de tudo que saiu, inclusive o que o Dashboard não desconta."
          />
        </div>
      </div>

      <div className="panel">
        <div className="panel-head" style={{ marginBottom: 8 }}>
          <span className="panel-title" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            Despesas da empresa no período
            {podeCadastrarCusto && (
              <button
                type="button" className="btn btn-xs btn-primary" onClick={() => setNovoCusto(true)}
                title="Cadastra um custo aqui mesmo — pró-labore, contador, aluguel — e a DRE recalcula na hora"
              >
                ＋ Adicionar custo
              </button>
            )}
          </span>
          <span className="panel-sub">cadastre na aba Custos marcando <b>Só na DRE</b></span>
        </div>
        {m.custosDreDetalhe.length === 0 ? (
          <div style={{ fontSize: ".82rem", color: "var(--muted)", lineHeight: 1.6 }}>
            Nenhuma despesa marcada como <b>Só na DRE</b> neste período. {podeCadastrarCusto
              ? <>Use <b>＋ Adicionar custo</b> aqui em cima — pró-labore, contador, retirada — e ele entra na DRE sem mexer no lucro que aparece no Dashboard.</>
              : <>Quem administra os custos pode cadastrar a despesa como <b>Despesa da empresa</b>, e ela passa a aparecer aqui.</>}
            <div style={{ marginTop: 6, fontSize: ".82rem" }}>
              Lembre que custo <b>mensal</b> só entra quando o período é um mês inteiro.
            </div>
          </div>
        ) : (
          <div className="table-wrapper" style={{ border: "none" }}>
            <table className="tbl-modern tbl-cards">
              <thead><tr>
                <th style={{ textAlign: "left" }}>Despesa</th>
                <th style={{ textAlign: "left" }}>Frequência</th>
                <th style={{ textAlign: "right" }}>No período</th>
                <th style={{ textAlign: "right" }}>% da receita</th>
              </tr></thead>
              <tbody>
                {m.custosDreDetalhe.map((c, i) => (
                  <tr key={`${c.nome}-${i}`}>
                    <td style={{ textAlign: "left", fontWeight: 600 }}>{c.nome}</td>
                    <td data-label="Frequência" style={{ textAlign: "left", color: "var(--muted)", fontSize: ".8rem" }}>{c.freq}</td>
                    <td data-label="No período" style={{ textAlign: "right", color: "var(--red)", whiteSpace: "nowrap" }}>−{fmtBRL(c.valor)}</td>
                    <td data-label="% da receita" style={{ textAlign: "right", color: "var(--muted)" }}>{fmtPct(margem(c.valor), 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {novoCusto && (
        <Modal open onClose={() => setNovoCusto(false)}>
          <CustoForm
            inicial={null}
            escopoPadrao="dre"
            onCancelar={() => setNovoCusto(false)}
            onSalvo={() => {
              setNovoCusto(false);
              // true = fura o cache da rota; sem isso o custo novo demorava
              // até um minuto pra aparecer, e parecia não ter salvo.
              load(true);
            }}
          />
        </Modal>
      )}

      {/* A apresentacao se monta num portal direto no body (ver
          ApresentacaoDre.tsx); aqui e so o gatilho. */}
      {apresentando && (
        <ApresentacaoDre
          dados={dadosApres}
          anterior={anteriorApres}
          periodo={fmtPeriodo(range.from, range.to)}
          geradoEm={new Intl.DateTimeFormat("pt-BR", {
            dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo",
          }).format(new Date())}
          onFechar={() => setApresentando(false)}
        />
      )}
    </div>
  );
}

