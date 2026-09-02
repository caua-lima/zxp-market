"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { statusDeEntrega } from "@/lib/domain/entrega-status";

/** Hoje no fuso de Brasilia — base do "chega hoje/amanha" (ver entrega-status). */
function hojeBR(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}
import { fmtBRL, getMarginStatus } from "@/lib/domain/calc";
import { authedFetch } from "@/lib/api/authed-fetch";
import DateRangePicker from "@/components/dashboard/DateRangePicker";
import { gravarChaveApp, lerChaveApp } from "@/lib/storage";

type ItemPedido = {
  produto: string;
  mlb: string;
  qtd: number;
  valor: number;
  retorno: number;
  cmv: number;
  envio: number;
  taxaML: number;
  imposto: number;
  lucro: number;
  vinculado: boolean;
};

type Pedido = {
  order_id: string;
  data: string;
  hora: string;
  status: string;
  produto: string;
  qtd: number;
  valor: number;
  bruto: number;
  retorno: number;      // valor − taxa − frete (o que volta)
  cmv: number;
  envio: number;
  taxaML: number;
  imposto: number;
  lucro: number;
  margem: number;
  vinculado: boolean;
  itens?: ItemPedido[];
  /** >1 quando a venda é um pacote: vários pedidos do ML na mesma compra. */
  pedidosNoPacote?: number;
  cancelado?: boolean;
  devolvido?: boolean;
  shippingStatus?: string;
  logisticType?: string;
  tracking?: string;
  estimatedDelivery?: string;
  /** Substatus do envio — separa "Full processando" de "etiqueta esperando voce". */
  shippingSubstatus?: string;
  /** Fim da faixa de entrega, quando o ML da uma em vez de um dia so. */
  estimatedDeliveryLimit?: string;
  dateDelivered?: string;
  /**
   * Frete que o COMPRADOR pagou. Não entra em nenhuma conta — existe pra
   * tela conseguir explicar a linha "Envios" do painel do ML, que mostra
   * este valor e não o custo do vendedor. Sem isso as duas telas pareciam
   * discordar do frete quando na verdade mediam coisas diferentes.
   */
  freteComprador?: number | null;
  /** Repasse REAL do Mercado Pago quando existe — sem isso, `retorno` acima é a nossa estimativa. */
  netReceived?: number | null;
  moneyReleaseDate?: string | null;
  linkAnuncio?: string | null;
};

type FiltroSalvo = {
  nome: string;
  busca: string;
  filtro: "todos" | "lucro" | "prejuizo" | "semcad" | "canceldevol";
  valorMin: string; valorMax: string;
  margemMin: string; margemMax: string;
  statusFiltro: string; produtoFiltro: string;
  // Opcionais: filtros salvos antes desses dois existirem continuam válidos.
  adsFiltro?: "" | "com" | "sem";
  logisticaFiltro?: string;
};

const FILTROS_SALVOS_KEY = "pedidos:filtros-salvos";

function lerFiltrosSalvos(): FiltroSalvo[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = lerChaveApp(FILTROS_SALVOS_KEY);
    return raw ? (JSON.parse(raw) as FiltroSalvo[]) : [];
  } catch {
    return [];
  }
}

function gravarFiltrosSalvos(lista: FiltroSalvo[]) {
  gravarChaveApp(FILTROS_SALVOS_KEY, JSON.stringify(lista));
}

/** Badge de cancelado/devolvido — mesmo padrão visual usado em "SEM CADASTRO". */
function CancelDevolBadge({ pedido: p }: { pedido: Pedido }) {
  if (!p.cancelado && !p.devolvido) return null;
  const texto = p.devolvido ? "DEVOLVIDO" : "CANCELADO";
  return (
    <span style={{ marginLeft: 6, fontSize: ".6rem", fontWeight: 700, color: "var(--danger,var(--red))", background: "var(--danger-soft,rgba(214,90,74,.12))", padding: "1px 6px", borderRadius: 5, verticalAlign: "middle" }}>
      {texto}
    </span>
  );
}

/** Algum item do pedido teve investimento em Ads no período (mesma fonte que a aba Ads usa). */
function pedidoTemAds(p: Pedido, adsByItem: Record<string, number>): boolean {
  const mlbs = p.itens?.length ? p.itens.map((i) => i.mlb) : [];
  return mlbs.some((m) => m && (adsByItem[m] ?? 0) > 0);
}

function monthRange() {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return { from: `${d.getFullYear()}-${mm}-01`, to: `${d.getFullYear()}-${mm}-${String(last).padStart(2, "0")}` };
}

/**
 * Cascata do pedido, na ordem em que o dinheiro sai: o cliente paga, o ML
 * retém taxa e frete (isso é o retorno), e do retorno saem custo, imposto e
 * o que sobra. Fora da tabela porque o celular não comporta 12 colunas.
 */
function DetalhePedido({ pedido: p }: { pedido: Pedido }) {
  const linha = (
    rotulo: string, valor: number,
    opts: { sinal?: "menos"; forte?: boolean; cor?: string; nota?: string } = {},
  ) => (
    <div style={{
      display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline",
      padding: "5px 0", borderTop: opts.forte ? "1px solid var(--border)" : undefined,
      marginTop: opts.forte ? 4 : 0,
    }}>
      <span style={{ fontSize: ".8rem", color: opts.forte ? "var(--text)" : "var(--muted)", fontWeight: opts.forte ? 700 : 400 }}>
        {rotulo}
        {opts.nota && <span style={{ display: "block", fontSize: ".68rem", color: "var(--muted)", fontWeight: 400 }}>{opts.nota}</span>}
      </span>
      <span style={{
        fontSize: ".84rem", whiteSpace: "nowrap", fontWeight: opts.forte ? 800 : 600,
        color: opts.cor ?? (opts.sinal === "menos" ? "var(--red)" : "var(--text)"),
      }}>
        {opts.sinal === "menos" ? "−" : ""}{fmtBRL(Math.abs(valor))}
      </span>
    </div>
  );

  const itens = p.itens ?? [];

  // Linha do tempo — best-effort com o que a API do ML de fato devolve. Sem
  // timestamp de "pago" separado, o marco vem do status atual do pedido, não
  // de uma data específica. Isso é informativo, não uma garantia de SLA.
  const statusPago = ["paid", "confirmed"].includes(p.status.toLowerCase());
  const statusEnviado = !!p.shippingStatus && !["pending", "handling"].includes(p.shippingStatus.toLowerCase());
  const marcos: { label: string; feito: boolean; nota?: string }[] = [
    { label: "Criado", feito: true, nota: `${p.data.split("-").reverse().join("/")} ${p.hora}` },
    { label: "Pago", feito: statusPago || !!p.dateDelivered, nota: p.status },
    { label: "Enviado", feito: statusEnviado, nota: p.logisticType || p.shippingStatus || undefined },
    { label: "Entregue", feito: !!p.dateDelivered, nota: p.dateDelivered ? p.dateDelivered.split("-").reverse().join("/") : undefined },
    {
      label: "Repasse liberado",
      feito: !!p.moneyReleaseDate && p.moneyReleaseDate <= new Date().toISOString().slice(0, 10),
      nota: p.moneyReleaseDate ? p.moneyReleaseDate.split("-").reverse().join("/") : undefined,
    },
  ];

  return (
    <div style={{ padding: "12px 16px", display: "grid", gap: 18, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
      <div>
        <div style={{ fontSize: ".72rem", textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted)", marginBottom: 4 }}>
          Da venda até o seu bolso
        </div>
        {linha("Valor da venda", p.valor)}
        {/**
          * As duas notas abaixo existem pra conferência contra o painel do ML,
          * onde os mesmos dois números aparecem DIFERENTES — e conferido item
          * a item no pedido 2000018191968692, os dois lados estão certos:
          *
          *   tarifa · o ML exibe a BRUTA (R$ 2,58) e o estorno (R$ 0,75) em
          *            linhas separadas; a API devolve só a líquida (R$ 1,83),
          *            que é o que de fato sai do bolso. 2,58 − 0,75 = 1,83.
          *   frete  · o ML exibe em "Envios" o que o COMPRADOR pagou
          *            (R$ 17,99); o custo do vendedor é outro (R$ 2,20).
          *
          * Sem dizer isso na tela, a conferência dá a impressão de erro no
          * app — e foi exatamente essa a dúvida que originou estas linhas.
          */}
        {linha("Taxa do Mercado Livre", p.taxaML, { sinal: "menos", nota: "líquida — no ML aparece a bruta, com o estorno à parte" })}
        {linha("Frete", p.envio, {
          sinal: "menos",
          nota: p.freteComprador
            ? `sua parte · no ML, "Envios" mostra ${fmtBRL(p.freteComprador)}`
            : "custo de envio do pedido — sua parte",
        })}
        {linha("Retorno", p.retorno, { forte: true, nota: "o que o ML te repassa" })}
        {linha("Custo do produto", p.cmv, { sinal: "menos", nota: "custo médio × unidades" })}
        {linha("Imposto", p.imposto, { sinal: "menos" })}
        {linha("Lucro líquido", p.lucro, {
          forte: true, cor: p.lucro >= 0 ? "var(--green)" : "var(--red)",
          nota: `margem de ${p.margem.toFixed(1)}% sobre a venda`,
        })}
        {!p.vinculado && (
          <div style={{ marginTop: 8, fontSize: ".74rem", color: "var(--warning)", lineHeight: 1.5 }}>
            Produto sem cadastro no Estoque: o custo entra como zero, então esse
            lucro está <b>maior do que o real</b>.
          </div>
        )}
      </div>

      {itens.length > 1 && (
        <div>
          <div style={{ fontSize: ".72rem", textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted)", marginBottom: 4 }}>
            {itens.length} produtos nesta venda
            {(p.pedidosNoPacote ?? 1) > 1 && ` · pacote de ${p.pedidosNoPacote} pedidos do ML`}
          </div>
          {itens.map((it, i) => {
            // Margem deste PRODUTO, não do pedido inteiro — mesma fórmula
            // (lucro ÷ valor da venda) já usada pro pedido como um todo
            // (p.margem), só que aplicada por item. Sem isso a tela só dava
            // pra ver o lucro em R$ de cada produto, não se ele estava
            // puxando a margem da venda pra baixo ou pra cima.
            const margemItem = it.valor > 0 ? (it.lucro / it.valor) * 100 : 0;
            return (
              <div key={`${it.mlb}-${i}`} style={{ padding: "6px 0", borderTop: i ? "1px solid var(--border)" : undefined }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ fontSize: ".8rem", fontWeight: 600 }}>{it.qtd}× {it.produto || it.mlb}</span>
                  <span style={{ textAlign: "right", flexShrink: 0 }}>
                    <span style={{ display: "block", fontSize: ".8rem", fontWeight: 700, whiteSpace: "nowrap", color: it.lucro >= 0 ? "var(--green)" : "var(--red)" }}>
                      {fmtBRL(it.lucro)}
                    </span>
                    <span style={{ display: "block", fontSize: ".68rem", fontWeight: 600, whiteSpace: "nowrap", color: it.lucro >= 0 ? "var(--green)" : "var(--red)" }}>
                      {margemItem.toFixed(1)}% margem
                    </span>
                  </span>
                </div>
                {!it.vinculado && (
                  <div style={{ fontSize: ".68rem", color: "var(--warning)" }}>sem cadastro no Estoque — custo entra como zero, margem real é menor</div>
                )}
                <div style={{ fontSize: ".7rem", color: "var(--muted)" }}>
                  venda {fmtBRL(it.valor)} · taxa {fmtBRL(it.taxaML)} · frete {fmtBRL(it.envio)} ·
                  custo {fmtBRL(it.cmv)} · imposto {fmtBRL(it.imposto)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div>
        <div style={{ fontSize: ".72rem", textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted)", marginBottom: 4 }}>
          Logística e repasse
        </div>

        {/* Status de entrega em português, como o painel do ML mostra. A
            linha de cima responde "onde está" e a de baixo, "quando chega" —
            que é o que se quer saber ao abrir o pedido. Regra e traducao em
            lib/domain/entrega-status.ts. */}
        {(() => {
          const e = statusDeEntrega({
            status: p.shippingStatus,
            substatus: p.shippingSubstatus,
            logistica: p.logisticType,
            estimadaEm: p.estimatedDelivery,
            estimadaAte: p.estimatedDeliveryLimit,
            entregueEm: p.dateDelivered,
          }, hojeBR());
          const cor = e.tom === "ok" ? "var(--green)"
            : e.tom === "problema" ? "var(--red)"
            : e.tom === "acao" ? "var(--warning)"
            : e.tom === "andamento" ? "var(--text)"
            : "var(--muted)";
          return (
            <div style={{
              padding: "8px 10px", borderRadius: 8, marginBottom: 10,
              background: "var(--surface2)", borderLeft: `3px solid ${cor}`,
            }}>
              <div style={{ fontSize: ".84rem", fontWeight: 700, color: cor }}>
                {e.titulo}
                {e.pedeAcao && (
                  <span className="chip chip-yellow" style={{ marginLeft: 8 }}>precisa de você</span>
                )}
              </div>
              {e.prazo && (
                <div style={{ fontSize: ".76rem", color: "var(--muted)", marginTop: 2 }}>{e.prazo}</div>
              )}
            </div>
          );
        })()}

        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
          {marcos.map((m) => (
            <div key={m.label} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: ".78rem" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: m.feito ? "var(--success,var(--green))" : "var(--border)" }} />
              <span style={{ color: m.feito ? "var(--text-primary,var(--text))" : "var(--text-muted,var(--muted))", fontWeight: m.feito ? 600 : 400 }}>{m.label}</span>
              {m.nota && <span style={{ color: "var(--text-muted,var(--muted))", fontSize: ".72rem" }}>· {m.nota}</span>}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "5px 0", borderTop: "1px solid var(--border)" }}>
          <span style={{ fontSize: ".8rem", color: "var(--muted)" }}>
            Repasse do Mercado Pago
            <span
              style={{
                display: "block", marginTop: 2, fontSize: ".64rem", fontWeight: 700,
                color: p.netReceived ? "var(--success,var(--green))" : "var(--warning,#F4B942)",
              }}
            >
              {p.netReceived ? "CONFIRMADO PELO MP" : "ESTIMADO (retorno calculado)"}
            </span>
          </span>
          <span style={{ fontSize: ".84rem", fontWeight: 700, color: "var(--text)" }}>
            {fmtBRL(p.netReceived || p.retorno)}
          </span>
        </div>

        {p.linkAnuncio && (
          <a href={p.linkAnuncio} target="_blank" rel="noopener noreferrer" className="ac-cta" style={{ display: "inline-block", marginTop: 10 }}>
            Abrir anúncio no Mercado Livre ↗
          </a>
        )}
      </div>
    </div>
  );
}

export default function PedidosTab({ metaMargem = 10, openOrderId }: { metaMargem?: number; openOrderId?: string }) {
  const [range, setRange] = useState(() => monthRange());
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "lucro" | "prejuizo" | "semcad" | "canceldevol">("todos");
  const [modo, setModo] = useState<"pedido" | "produto">("pedido");
  const [detalhe, setDetalhe] = useState<string | null>(null);
  // Deep link de uma notificação de venda (?tab=pedidos&order=...) — abre o
  // drawer assim que o pedido aparecer na lista carregada. Limitação
  // conhecida: só funciona pra pedido dentro do período/range já carregado
  // (por padrão, o mês atual); pedido mais antigo não abre sozinho.
  // setState síncrono no efeito é o mesmo falso positivo já documentado em
  // outros pontos do app (ex.: hidratação de estado a partir de dado
  // assíncrono/externo) — aqui é sincronizar o drawer com um prop que só
  // fica pronto depois da lista de pedidos carregar, não dá pra fazer isso
  // durante o render.
  useEffect(() => {
    if (openOrderId && pedidos.some((p) => p.order_id === openOrderId)) {
      setDetalhe(openOrderId);
    }
  }, [openOrderId, pedidos]);
  const [adsByItem, setAdsByItem] = useState<Record<string, number>>({});
  // Fecha o drawer com Esc — sem isso, teclado só fecha clicando no X ou fora.
  useEffect(() => {
    if (!detalhe) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDetalhe(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [detalhe]);
  // Filtros avançados — texto vazio = sem limite (não força 0).
  const [valorMin, setValorMin] = useState("");
  const [valorMax, setValorMax] = useState("");
  const [margemMin, setMargemMin] = useState("");
  const [margemMax, setMargemMax] = useState("");
  const [statusFiltro, setStatusFiltro] = useState("");
  const [produtoFiltro, setProdutoFiltro] = useState("");
  const [adsFiltro, setAdsFiltro] = useState<"" | "com" | "sem">("");
  const [logisticaFiltro, setLogisticaFiltro] = useState("");
  // Filtros frequentes salvos no navegador (localStorage) — não é modelo
  // global, não precisa de Firestore nem de rule nova.
  const [filtrosSalvos, setFiltrosSalvos] = useState<FiltroSalvo[]>([]);
  useEffect(() => { setFiltrosSalvos(lerFiltrosSalvos()); }, []);

  function salvarFiltroAtual() {
    const nome = window.prompt("Nome para este filtro:")?.trim();
    if (!nome) return;
    const novo: FiltroSalvo = { nome, busca, filtro, valorMin, valorMax, margemMin, margemMax, statusFiltro, produtoFiltro, adsFiltro, logisticaFiltro };
    const lista = [...filtrosSalvos.filter((f) => f.nome !== nome), novo];
    setFiltrosSalvos(lista);
    gravarFiltrosSalvos(lista);
  }

  function aplicarFiltroSalvo(f: FiltroSalvo) {
    setBusca(f.busca); setFiltro(f.filtro);
    setValorMin(f.valorMin); setValorMax(f.valorMax);
    setMargemMin(f.margemMin); setMargemMax(f.margemMax);
    setStatusFiltro(f.statusFiltro); setProdutoFiltro(f.produtoFiltro);
    setAdsFiltro(f.adsFiltro ?? ""); setLogisticaFiltro(f.logisticaFiltro ?? "");
  }

  function excluirFiltroSalvo(nome: string) {
    const lista = filtrosSalvos.filter((f) => f.nome !== nome);
    setFiltrosSalvos(lista);
    gravarFiltrosSalvos(lista);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [resPedidos, resAds] = await Promise.all([
        authedFetch(`/api/ml/pedidos?from=${range.from}&to=${range.to}`, { cache: "no-store" }),
        // Mesma rota que a aba Ads usa — gasto por MLB no período. Best-effort:
        // se falhar, o filtro "com/sem Ads" só some, o resto da tela funciona normal.
        authedFetch(`/api/ml/ads-spend?from=${range.from}&to=${range.to}`, { cache: "no-store" }).catch(() => null),
      ]);
      if (resPedidos.ok) setPedidos((await resPedidos.json()).pedidos ?? []);
      else setPedidos([]);
      setAdsByItem(resAds?.ok ? (await resAds.json()).adsByItem ?? {} : {});
    } catch {
      setPedidos([]);
      setAdsByItem({});
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  async function atualizar() {
    setLoading(true);
    // Re-sincroniza o PERÍODO que está sendo visto, não o mês corrente (sync-all
    // sem from/to cai no mês atual — se o pedido é de um mês anterior, o status
    // do envio nunca era re-buscado e ficava travado em "a caminho"/"ready_to_ship"
    // pra sempre, mesmo já tendo sido entregue de verdade no Mercado Livre).
    try { await authedFetch(`/api/ml/sync-all?from=${range.from}&to=${range.to}`, { method: "POST" }); } catch { /* ignora */ }
    await load();
  }

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const min = valorMin.trim() ? Number(valorMin.replace(",", ".")) : null;
    const max = valorMax.trim() ? Number(valorMax.replace(",", ".")) : null;
    const mMin = margemMin.trim() ? Number(margemMin.replace(",", ".")) : null;
    const mMax = margemMax.trim() ? Number(margemMax.replace(",", ".")) : null;
    return pedidos.filter((p) => {
      if (q && !(p.produto.toLowerCase().includes(q) || p.order_id.includes(q))) return false;
      if (filtro === "lucro" && p.lucro <= 0) return false;
      if (filtro === "prejuizo" && p.lucro >= 0) return false;
      if (filtro === "semcad" && p.vinculado) return false;
      if (filtro === "canceldevol" && !p.cancelado && !p.devolvido) return false;
      if (min != null && !Number.isNaN(min) && p.valor < min) return false;
      if (max != null && !Number.isNaN(max) && p.valor > max) return false;
      if (mMin != null && !Number.isNaN(mMin) && p.margem < mMin) return false;
      if (mMax != null && !Number.isNaN(mMax) && p.margem > mMax) return false;
      if (statusFiltro && p.status !== statusFiltro) return false;
      if (produtoFiltro) {
        const nomes = p.itens?.length ? p.itens.map((i) => i.produto) : [p.produto];
        if (!nomes.includes(produtoFiltro)) return false;
      }
      if (adsFiltro) {
        const temAds = pedidoTemAds(p, adsByItem);
        if (adsFiltro === "com" && !temAds) return false;
        if (adsFiltro === "sem" && temAds) return false;
      }
      if (logisticaFiltro && p.logisticType !== logisticaFiltro) return false;
      return true;
    });
  }, [pedidos, busca, filtro, valorMin, valorMax, margemMin, margemMax, statusFiltro, produtoFiltro, adsFiltro, adsByItem, logisticaFiltro]);

  const statusOptions = useMemo(
    () => Array.from(new Set(pedidos.map((p) => p.status).filter(Boolean))).sort(),
    [pedidos],
  );

  const produtoOptions = useMemo(() => {
    const nomes = pedidos.flatMap((p) => (p.itens?.length ? p.itens.map((i) => i.produto) : [p.produto]));
    return Array.from(new Set(nomes.filter(Boolean))).sort();
  }, [pedidos]);

  const logisticaOptions = useMemo(
    () => Array.from(new Set(pedidos.map((p) => p.logisticType).filter(Boolean))).sort(),
    [pedidos],
  );

  /**
   * Consolida por produto os pedidos que estão no filtro atual.
   * Usa os ITENS (não o pedido inteiro): um pedido com 2 produtos precisa
   * somar cada um na sua linha. 'vendas' conta o pedido uma vez por produto —
   * 3 unidades num pedido só = 1 venda, 3 unidades.
   */
  const porProduto = useMemo(() => {
    const map = new Map<string, {
      produto: string; mlb: string; vendas: Set<string>; qtd: number;
      valor: number; retorno: number; custos: number; lucro: number; semCadastro: boolean;
    }>();
    for (const p of filtrados) {
      // Pedido antigo (sem detalhe por item): entra como uma linha só.
      const itens: ItemPedido[] = p.itens?.length
        ? p.itens
        : [{ produto: p.produto || "—", mlb: "", qtd: p.qtd, valor: p.valor, retorno: p.retorno,
             cmv: p.cmv, envio: p.envio, taxaML: p.taxaML, imposto: p.imposto, lucro: p.lucro,
             vinculado: p.vinculado }];
      for (const it of itens) {
        const chave = it.mlb || it.produto || "—";
        const cur = map.get(chave) ?? {
          produto: it.produto || "—", mlb: it.mlb, vendas: new Set<string>(), qtd: 0,
          valor: 0, retorno: 0, custos: 0, lucro: 0, semCadastro: false,
        };
        cur.vendas.add(p.order_id);
        cur.qtd += it.qtd;
        cur.valor += it.valor;
        cur.retorno += it.retorno;
        cur.custos += it.cmv + it.envio + it.taxaML + it.imposto;
        cur.lucro += it.lucro;
        if (!it.vinculado) cur.semCadastro = true;
        map.set(chave, cur);
      }
    }
    return Array.from(map.values())
      .map((r) => ({ ...r, nVendas: r.vendas.size, margem: r.valor > 0 ? (r.lucro / r.valor) * 100 : 0 }))
      .sort((a, b) => b.qtd - a.qtd);
  }, [filtrados]);

  const prejuizoN = pedidos.filter((p) => p.lucro < 0).length;
  const semCadN = pedidos.filter((p) => !p.vinculado).length;
  const cancelDevolN = pedidos.filter((p) => p.cancelado || p.devolvido).length;

  const totalLucro = filtrados.reduce((s, p) => s + p.lucro, 0);
  const totalValor = filtrados.reduce((s, p) => s + p.valor, 0);
  const totalRetorno = filtrados.reduce((s, p) => s + p.retorno, 0);
  const margemMedia = filtrados.length
    ? filtrados.reduce((s, p) => s + p.margem, 0) / filtrados.length
    : 0;
  // saudável (bateu a meta de margem) / atenção (positiva mas abaixo) / prejuízo (<0)
  const margemTag = (m: number) => {
    const s = getMarginStatus(m, metaMargem);
    return s === "saudavel" ? "tag-g" : s === "atencao" ? "tag-y" : "tag-r";
  };

  return (
    <div className="dash">
      {/* Topo */}
      <div className="dash-top">
        <div className="dash-top-left">
          <h2 style={{ fontSize: "1.15rem", fontWeight: 800 }}>Pedidos</h2>
          <button type="button" className="btn btn-sm btn-ghost" onClick={atualizar} disabled={loading}>
            {loading ? "Atualizando..." : "⟳ Atualizar"}
          </button>
        </div>
        <DateRangePicker from={range.from} to={range.to} onApply={(from, to) => setRange({ from, to })} />
      </div>

      {/* Resumo */}
      <div className="kpi-grid">
        <div className="kpi k-acc"><div className="k-lbl">Pedidos</div><div className="k-val">{filtrados.length}</div></div>
        <div className="kpi k-acc"><div className="k-lbl">Faturamento</div><div className="k-val">{fmtBRL(totalValor)}</div><div className="k-sub">bruto</div></div>
        <div className="kpi k-pos"><div className="k-lbl">Retorno</div><div className="k-val" style={{ color: "var(--green)" }}>{fmtBRL(totalRetorno)}</div><div className="k-sub">líquido — já sem taxa e frete</div></div>
        <div className={`kpi ${totalLucro >= 0 ? "k-pos" : "k-neg"}`}><div className="k-lbl">Lucro líquido</div><div className="k-val" style={{ color: totalLucro >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(totalLucro)}</div><div className="k-sub">retorno − custos</div></div>
        <div className="kpi k-warn"><div className="k-lbl">Margem média</div><div className="k-val" style={{ color: "var(--yellow)" }}>{margemMedia.toFixed(1)}%</div></div>
        <div className="kpi k-acc"><div className="k-lbl">Ticket médio</div><div className="k-val">{fmtBRL(filtrados.length ? totalValor / filtrados.length : 0)}</div><div className="k-sub">por pedido</div></div>
      </div>

      {/* Busca + filtros */}
      <input
        type="text" placeholder="Buscar por produto ou nº do pedido…" value={busca}
        onChange={(e) => setBusca(e.target.value)}
        style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 14px", color: "var(--text)", fontSize: ".9rem", outline: "none", boxSizing: "border-box" }}
      />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {([
          ["todos", `Todos (${pedidos.length})`, "var(--accent)"],
          ["lucro", "Lucrativos", "var(--green)"],
          ["prejuizo", `Prejuízo (${prejuizoN})`, "var(--red)"],
          ["semcad", `Sem cadastro (${semCadN})`, "var(--yellow)"],
          ["canceldevol", `Cancelado/Devolvido (${cancelDevolN})`, "var(--info,var(--accent))"],
        ] as const).map(([id, label, cor]) => (
          <button
            key={id} type="button" onClick={() => setFiltro(id)}
            style={{
              fontSize: ".78rem", fontWeight: 600, padding: "5px 12px", borderRadius: 20, cursor: "pointer",
              background: filtro === id ? cor : "var(--surface2)", color: filtro === id ? "#fff" : "var(--muted)",
              border: `1px solid ${filtro === id ? cor : "var(--border)"}`,
            }}
          >{label}</button>
        ))}
      </div>

      {/* Filtros avançados */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: ".74rem", color: "var(--text-muted,var(--muted))", fontWeight: 600 }}>Valor:</span>
        <input
          type="number" inputMode="decimal" placeholder="mín." value={valorMin}
          onChange={(e) => setValorMin(e.target.value)}
          style={{ width: 90, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", color: "var(--text)", fontSize: ".82rem", outline: "none" }}
        />
        <span style={{ color: "var(--text-muted,var(--muted))" }}>–</span>
        <input
          type="number" inputMode="decimal" placeholder="máx." value={valorMax}
          onChange={(e) => setValorMax(e.target.value)}
          style={{ width: 90, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", color: "var(--text)", fontSize: ".82rem", outline: "none" }}
        />
        {(valorMin || valorMax) && (
          <button type="button" className="btn btn-xs btn-ghost" onClick={() => { setValorMin(""); setValorMax(""); }}>Limpar valor</button>
        )}

        <span style={{ fontSize: ".74rem", color: "var(--text-muted,var(--muted))", fontWeight: 600, marginLeft: 6 }}>Margem %:</span>
        <input
          type="number" inputMode="decimal" placeholder="mín." value={margemMin}
          onChange={(e) => setMargemMin(e.target.value)}
          style={{ width: 70, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", color: "var(--text)", fontSize: ".82rem", outline: "none" }}
        />
        <span style={{ color: "var(--text-muted,var(--muted))" }}>–</span>
        <input
          type="number" inputMode="decimal" placeholder="máx." value={margemMax}
          onChange={(e) => setMargemMax(e.target.value)}
          style={{ width: 70, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", color: "var(--text)", fontSize: ".82rem", outline: "none" }}
        />
        {(margemMin || margemMax) && (
          <button type="button" className="btn btn-xs btn-ghost" onClick={() => { setMargemMin(""); setMargemMax(""); }}>Limpar margem</button>
        )}

        {statusOptions.length > 1 && (
          <>
            <span style={{ fontSize: ".74rem", color: "var(--text-muted,var(--muted))", fontWeight: 600, marginLeft: 6 }}>Status:</span>
            <select
              value={statusFiltro}
              onChange={(e) => setStatusFiltro(e.target.value)}
              aria-label="Filtrar por status do pedido"
              style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", color: "var(--text)", fontSize: ".82rem", outline: "none" }}
            >
              <option value="">Todos</option>
              {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </>
        )}

        {produtoOptions.length > 1 && (
          <>
            <span style={{ fontSize: ".74rem", color: "var(--text-muted,var(--muted))", fontWeight: 600, marginLeft: 6 }}>Produto:</span>
            <select
              value={produtoFiltro}
              onChange={(e) => setProdutoFiltro(e.target.value)}
              aria-label="Filtrar por produto"
              style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", color: "var(--text)", fontSize: ".82rem", outline: "none", maxWidth: 200 }}
            >
              <option value="">Todos</option>
              {produtoOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </>
        )}

        <span style={{ fontSize: ".74rem", color: "var(--text-muted,var(--muted))", fontWeight: 600, marginLeft: 6 }}>Ads:</span>
        <select
          value={adsFiltro}
          onChange={(e) => setAdsFiltro(e.target.value as "" | "com" | "sem")}
          aria-label="Filtrar por investimento em Ads"
          style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", color: "var(--text)", fontSize: ".82rem", outline: "none" }}
        >
          <option value="">Todos</option>
          <option value="com">Com Ads</option>
          <option value="sem">Sem Ads</option>
        </select>

        {logisticaOptions.length > 1 && (
          <>
            <span style={{ fontSize: ".74rem", color: "var(--text-muted,var(--muted))", fontWeight: 600, marginLeft: 6 }}>Logística:</span>
            <select
              value={logisticaFiltro}
              onChange={(e) => setLogisticaFiltro(e.target.value)}
              aria-label="Filtrar por tipo de logística"
              style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", color: "var(--text)", fontSize: ".82rem", outline: "none" }}
            >
              <option value="">Todas</option>
              {logisticaOptions.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </>
        )}

        <button type="button" className="btn btn-xs btn-ghost" style={{ marginLeft: "auto" }} onClick={salvarFiltroAtual}>
          💾 Salvar filtro atual
        </button>
      </div>

      {filtrosSalvos.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: ".72rem", color: "var(--text-muted,var(--muted))" }}>Filtros salvos:</span>
          {filtrosSalvos.map((f) => (
            <span key={f.nome} className="severity-chip severity-info" style={{ cursor: "pointer" }}>
              <button type="button" onClick={() => aplicarFiltroSalvo(f)} style={{ background: "none", border: "none", color: "inherit", font: "inherit", cursor: "pointer", padding: 0 }}>
                {f.nome}
              </button>
              <button type="button" onClick={() => excluirFiltroSalvo(f.nome)} aria-label={`Excluir filtro ${f.nome}`} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, opacity: .7 }}>✕</button>
            </span>
          ))}
        </div>
      )}

      {/* Tabela */}
      <div className="panel">
        {/* Alterna entre a lista de pedidos e o consolidado por produto */}
        <div className="seg" style={{ alignSelf: "flex-start", marginBottom: 12 }}>
          <button type="button" className={`seg-btn ${modo === "pedido" ? "active" : ""}`} onClick={() => setModo("pedido")}>
            Por pedido ({filtrados.length})
          </button>
          <button type="button" className={`seg-btn ${modo === "produto" ? "active" : ""}`} onClick={() => setModo("produto")}>
            Por produto ({porProduto.length})
          </button>
        </div>

        <div style={{ fontSize: ".76rem", color: "var(--muted)", marginBottom: 12 }}>
          {modo === "produto"
            ? <><b>Vendas</b> = nº de pedidos · <b>Un</b> = unidades vendidas · um pedido com 3 unidades conta como 1 venda e 3 unidades</>
            : <>
                <b>Retorno</b> = Valor − Taxa ML − Frete · <b>Custos</b> = CMV + Frete + Taxa + Imposto ·{" "}
                <b>Lucro</b> = Valor − Custos · <b>Margem</b> = Lucro ÷ Valor ·{" "}
                {/* Sem este aviso, a soma das margens daqui nunca fecha com a do
                    Dashboard, e parece erro de cálculo quando é diferença de
                    escopo: publicidade é do dia, não do pedido. */}
                <b style={{ color: "var(--warning)" }}>não inclui ADS</b> (é gasto do dia, não do pedido) ·{" "}
                <b style={{ color: "var(--text)" }}>clique num pedido</b> para ver a conta completa
              </>}
        </div>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Carregando pedidos…</div>
        ) : filtrados.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Nenhum pedido no período.</div>
        ) : modo === "produto" ? (
          <>
          {/* Celular: cartões */}
          <div className="ped-cards">
            {porProduto.map((r) => (
              <div key={r.mlb || r.produto} className={`ped-card ${r.lucro >= 0 ? "pos" : "neg"}`} style={{ cursor: "default" }}>
                <div className="ped-card-top">
                  <span className="ped-card-nome">
                    {r.produto}
                    {r.semCadastro && <span className="ped-badge semcad" style={{ marginLeft: 6 }}>SEM CADASTRO</span>}
                  </span>
                  <span className="ped-card-lucro" style={{ color: r.lucro >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(r.lucro)}</span>
                </div>
                <div className="ped-card-meta">
                  <span><b style={{ color: "var(--accent)" }}>{r.qtd}</b> un · {r.nVendas} venda(s)</span>
                  {r.mlb && <span>{r.mlb}</span>}
                  <span className={`tag ${margemTag(r.margem)}`} style={{ marginLeft: "auto" }}>{r.margem.toFixed(1)}%</span>
                </div>
                <div className="ped-card-grid">
                  <div className="ped-card-cell"><span>Faturamento</span><b>{fmtBRL(r.valor)}</b></div>
                  <div className="ped-card-cell"><span>Retorno</span><b>{fmtBRL(r.retorno)}</b></div>
                  <div className="ped-card-cell"><span>Custos</span><b style={{ color: "var(--red)" }}>−{fmtBRL(r.custos)}</b></div>
                </div>
              </div>
            ))}
          </div>
          {/* Desktop: tabela */}
          <div className="table-wrapper only-desktop" style={{ border: "none" }}>
            <table className="tbl-modern">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Produto</th>
                  <th style={{ textAlign: "right" }}>Vendas</th>
                  <th style={{ textAlign: "right" }}>Un</th>
                  <th style={{ textAlign: "right" }}>Faturamento</th>
                  <th style={{ textAlign: "right" }}>Retorno</th>
                  <th style={{ textAlign: "right" }}>Custos</th>
                  <th style={{ textAlign: "right" }}>Lucro líq.</th>
                  <th>Margem</th>
                </tr>
              </thead>
              <tbody>
                {porProduto.map((r) => (
                  <tr key={r.mlb || r.produto} style={{ boxShadow: `inset 3px 0 0 ${r.lucro >= 0 ? "var(--green)" : "var(--red)"}` }}>
                    <td style={{ textAlign: "left", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <span style={{ fontWeight: 600 }} title={r.produto}>{r.produto}</span>
                      {r.semCadastro && <span style={{ marginLeft: 6, fontSize: ".6rem", fontWeight: 700, color: "var(--warning)", background: "var(--warning-soft)", padding: "1px 6px", borderRadius: 5, verticalAlign: "middle" }}>SEM CADASTRO</span>}
                      {r.mlb && <span style={{ display: "block", fontSize: ".66rem", color: "var(--muted)" }}>{r.mlb}</span>}
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{r.nVendas}</td>
                    <td style={{ textAlign: "right", fontWeight: 700, color: "var(--accent)", whiteSpace: "nowrap" }}>{r.qtd}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{fmtBRL(r.valor)}</td>
                    <td style={{ textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>{fmtBRL(r.retorno)}</td>
                    <td style={{ textAlign: "right", color: "var(--red)", whiteSpace: "nowrap" }}>−{fmtBRL(r.custos)}</td>
                    <td style={{ textAlign: "right", fontWeight: 800, whiteSpace: "nowrap", color: r.lucro >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(r.lucro)}</td>
                    <td><span className={`tag ${margemTag(r.margem)}`}>{r.margem.toFixed(1)}%</span></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ textAlign: "left", fontWeight: 800 }}>Total · {porProduto.length} produto(s)</td>
                  <td style={{ textAlign: "right", fontWeight: 800 }}>{porProduto.reduce((s, r) => s + r.nVendas, 0)}</td>
                  <td style={{ textAlign: "right", fontWeight: 800, color: "var(--accent)" }}>{porProduto.reduce((s, r) => s + r.qtd, 0)}</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtBRL(porProduto.reduce((s, r) => s + r.valor, 0))}</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtBRL(porProduto.reduce((s, r) => s + r.retorno, 0))}</td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: "var(--red)" }}>−{fmtBRL(porProduto.reduce((s, r) => s + r.custos, 0))}</td>
                  <td style={{ textAlign: "right", fontWeight: 800, color: totalLucro >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(porProduto.reduce((s, r) => s + r.lucro, 0))}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          </>
        ) : (
          <>
          {/* Celular: cartões (clicáveis pra abrir o detalhe) */}
          <div className="ped-cards">
            {filtrados.map((p) => {
              const custos = p.cmv + p.envio + p.taxaML + p.imposto;
              return (
                <div key={p.order_id} className={`ped-card ${p.lucro >= 0 ? "pos" : "neg"}`} onClick={() => setDetalhe(p.order_id)}>
                  <div className="ped-card-top">
                    <span className="ped-card-nome">
                      {p.produto || "—"}
                      {!p.vinculado && <span className="ped-badge semcad" style={{ marginLeft: 6 }}>SEM CADASTRO</span>}
                      {(p.itens?.length ?? 0) > 1 && <span className="ped-badge multi" style={{ marginLeft: 6 }}>{p.itens?.length} PRODUTOS</span>}
                      <CancelDevolBadge pedido={p} />
                    </span>
                    <span className="ped-card-lucro" style={{ color: p.lucro >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(p.lucro)}</span>
                  </div>
                  <div className="ped-card-meta">
                    <span>{p.data.split("-").reverse().join("/")} {p.hora}</span>
                    <span>#{p.order_id}</span>
                    <span>{p.qtd} un</span>
                    <span className={`tag ${margemTag(p.margem)}`} style={{ marginLeft: "auto" }}>{p.margem.toFixed(1)}%</span>
                  </div>
                  <div className="ped-card-grid">
                    <div className="ped-card-cell"><span>Valor</span><b>{fmtBRL(p.valor)}</b></div>
                    <div className="ped-card-cell"><span>Retorno</span><b>{fmtBRL(p.retorno)}</b></div>
                    <div className="ped-card-cell"><span>Custos</span><b style={{ color: "var(--red)" }}>−{fmtBRL(custos)}</b></div>
                    <div className="ped-card-cell"><span style={{ color: "var(--accent)" }}>▾ detalhes</span></div>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Desktop: tabela */}
          <div className="table-wrapper only-desktop" style={{ border: "none" }}>
            <table className="tbl-modern">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Data</th>
                  <th style={{ textAlign: "left" }}>Produto</th>
                  <th>Qtd</th>
                  <th style={{ textAlign: "right" }}>Valor</th>
                  <th style={{ textAlign: "right" }}>Retorno</th>
                  <th style={{ textAlign: "right" }}>Custos</th>
                  <th style={{ textAlign: "right" }}>Lucro líq.</th>
                  <th>Margem</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((p) => {
                  const custos = p.cmv + p.envio + p.taxaML + p.imposto;
                  const prej = p.lucro < 0;
                  return (
                    <tr
                      key={p.order_id}
                      onClick={() => setDetalhe(p.order_id)}
                      style={{
                        background: prej ? "rgba(214,90,74,.05)" : undefined,
                        boxShadow: `inset 3px 0 0 ${prej ? "var(--red)" : "var(--green)"}`,
                        cursor: "pointer",
                      }}
                    >
                      <td style={{ textAlign: "left", color: "var(--muted)", whiteSpace: "nowrap", fontSize: ".82rem" }}>
                        {p.data.split("-").reverse().join("/")}<span style={{ fontSize: ".68rem", display: "block", opacity: .7 }}>{p.hora}</span>
                      </td>
                      <td style={{ textAlign: "left", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <span style={{ fontWeight: 600 }} title={p.produto}>{p.produto || "—"}</span>
                        {!p.vinculado && <span style={{ marginLeft: 6, fontSize: ".6rem", fontWeight: 700, color: "var(--warning)", background: "var(--warning-soft)", padding: "1px 6px", borderRadius: 5, verticalAlign: "middle" }}>SEM CADASTRO</span>}
                        {(p.itens?.length ?? 0) > 1 && (
                          <span style={{ marginLeft: 6, fontSize: ".6rem", fontWeight: 700, color: "var(--accent)", background: "rgba(233,169,45,.14)", padding: "1px 6px", borderRadius: 5, verticalAlign: "middle" }}>
                            {p.itens?.length} PRODUTOS
                          </span>
                        )}
                        <CancelDevolBadge pedido={p} />
                        <span style={{ display: "block", fontSize: ".66rem", color: "var(--muted)" }}>#{p.order_id}</span>
                      </td>
                      <td style={{ color: "var(--muted)" }}>{p.qtd}</td>
                      <td style={{ textAlign: "right", color: "var(--text)", whiteSpace: "nowrap" }}>{fmtBRL(p.valor)}</td>
                      <td style={{ textAlign: "right", color: "var(--text)", fontWeight: 600, whiteSpace: "nowrap" }}>{fmtBRL(p.retorno)}</td>
                      <td style={{ textAlign: "right", color: "var(--red)", whiteSpace: "nowrap" }}>
                        −{fmtBRL(custos)}
                        <span style={{ marginLeft: 5, color: "var(--muted)", fontSize: ".7rem" }}>▾</span>
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 800, whiteSpace: "nowrap", color: p.lucro >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(p.lucro)}</td>
                      <td><span className={`tag ${margemTag(p.margem)}`}>{p.margem.toFixed(1)}%</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      {detalhe && (() => {
        const p = pedidos.find((x) => x.order_id === detalhe);
        if (!p) return null;
        return (
          <div className="drawer-overlay" onClick={() => setDetalhe(null)}>
            <div className="drawer-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Detalhe do pedido ${p.order_id}`}>
              <div className="drawer-head">
                <div>
                  <div className="drawer-title">{p.produto || "—"}</div>
                  <div className="drawer-sub">#{p.order_id} · {p.data.split("-").reverse().join("/")} {p.hora}</div>
                </div>
                <button type="button" className="drawer-close" onClick={() => setDetalhe(null)} aria-label="Fechar detalhe do pedido">✕</button>
              </div>
              <div className="drawer-body">
                <DetalhePedido pedido={p} />
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
