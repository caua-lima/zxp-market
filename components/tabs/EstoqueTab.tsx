"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CUSTO_FAIXA_SENTINELA, custoNaData, impostoNaData, TIPO_MOVIMENTO_LABEL, type EstoqueMovimento, type MovimentoTipo, type Product } from "@/lib/domain/types";
import { addMovimento, deleteMovimento, deleteProduct, logAudit, upsertProduct, watchMovimentos, watchRemessasIgnoradas } from "@/lib/firebase/data";
import { unidadesPendentesPorProduto, type Remessa } from "@/lib/domain/remessas";
import { fmtBRL } from "@/lib/domain/calc";
import { getCoverageStatus, COVERAGE_STATUS_LABEL, consolidarEstoqueAnuncios, ehFullLogistic, estoqueForaDoFull, type CoverageStatus } from "@/lib/domain/estoque";
import { calcularEntradaMassa, custoMedioAposEntrada, type LinhaEntrada, type ProdutoParaEntrada } from "@/lib/domain/entrada-massa";
import { montarPlanoReposicao, type ProdutoReposicao } from "@/lib/domain/reposicao";
import { calcularLucroEstoque, medirTaxas, type FinanceiroProduto, type LucroEstoque } from "@/lib/domain/estoque-lucro";
import Modal from "@/components/Modal";
import EditarMovimentoModal from "@/components/tabs/estoque/EditarMovimentoModal";
import type { UserData } from "@/components/useUserData";
import { authedFetch } from "@/lib/api/authed-fetch";
import { useAccess } from "@/components/tabs/AccessGuard";
import { gravarChaveApp, lerChaveApp } from "@/lib/storage";

type MlItem = { available: number; sold: number; status: string; price: number; regularPrice: number; hasPromo: boolean; logistic: string; inventoryId?: string };
type EstoqueML = Record<string, MlItem>;
type Forecast = {
  vendas: Record<string, number>;
  dias: number;
  /** Realizado por produto — base das taxas medidas (ver lib/domain/estoque-lucro.ts). */
  financeiro?: Record<string, FinanceiroProduto>;
};

// dias-alvo de cobertura pra sugestão de reposição
const DIAS_ALVO = 30;

function newId() {
  return "p" + Date.now() + Math.random().toString(36).slice(2, 6);
}
function newMovId() {
  return "mov" + Date.now() + Math.random().toString(36).slice(2, 6);
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseNum(s: string): number {
  const n = parseFloat(String(s).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function mlbsDe(p: Product): string[] {
  if (p.mlbs && p.mlbs.length) return p.mlbs;
  return p.mlb ? [p.mlb] : [];
}

function normMlb(s: string) {
  const up = s.trim().toUpperCase();
  return up.startsWith("MLB") ? up : up ? `MLB${up}` : "";
}

function custoMedioDe(p: Product): number {
  return p.custoMedio ?? parseNum(p.custo);
}

// Anúncios (MLBs) do produto com os dados do ML de cada um.
type AnuncioML = { mlb: string; item: MlItem | null };
function anunciosDe(p: Product, estoqueML: EstoqueML): AnuncioML[] {
  return mlbsDe(p).map((m) => ({ mlb: normMlb(m), item: estoqueML[normMlb(m)] ?? null }));
}

/**
 * Estoque do ML por logística, com cada pool físico contado UMA vez —
 * a regra e o porquê de cada armadilha estão em lib/domain/estoque.ts
 * (consolidarEstoqueAnuncios), que é puro e tem os testes.
 */
function fullDe(p: Product, estoqueML: EstoqueML): { qtd: number; proprio: number; ehFull: boolean; temDado: boolean; fullCompartilhado: boolean; proprioCompartilhado: boolean } {
  const c = consolidarEstoqueAnuncios(
    anunciosDe(p, estoqueML)
      .filter(({ item }) => item)
      .map(({ item }) => ({ available: item!.available, logistic: item!.logistic, inventoryId: item!.inventoryId })),
  );
  return { qtd: c.full, proprio: c.proprio, ehFull: c.ehFull, temDado: c.temDado, fullCompartilhado: c.fullCompartilhado, proprioCompartilhado: c.proprioCompartilhado };
}

// Full considerado "baixo" sugere reabastecer com o estoque de casa.
const FULL_BAIXO = 5;

// Faixa de preços dos anúncios (por anúncio, sem média). Retorna min/max/único.
function precosDe(p: Product, estoqueML: EstoqueML): { min: number; max: number; temPromo: boolean; count: number } {
  const precos: number[] = [];
  let temPromo = false;
  for (const { item } of anunciosDe(p, estoqueML)) {
    if (!item || !item.price) continue;
    precos.push(item.price);
    if (item.hasPromo) temPromo = true;
  }
  if (!precos.length) return { min: 0, max: 0, temPromo: false, count: 0 };
  return { min: Math.min(...precos), max: Math.max(...precos), temPromo, count: precos.length };
}

type PrevisaoProduto = {
  precoMin: number;
  precoMax: number;
  casa: number;
  full: number;
  proprio: number;
  ehFull: boolean;
  total: number;
  mediaDiaria: number;
  cobertura: number;    // dias até acabar o total (Infinity = sem vendas ou sem estoque)
  valorPotencial: number;
  reporQtd: number;     // unidades pra levar o Full a cobrir DIAS_ALVO (só produtos no Full)
  /**
   * Lucro que este estoque ainda pode render, com comissão e frete MEDIDOS
   * nas vendas do período. `null` quando não há base (produto sem venda ou
   * sem preço de anúncio) — a tela mostra "—", nunca R$ 0,00.
   */
  lucro: LucroEstoque | null;
};

function previsaoDe(p: Product, estoqueML: EstoqueML, forecast: Forecast): PrevisaoProduto {
  const casa = Math.max(p.qtdLocal ?? 0, 0);
  const { qtd: full, proprio, ehFull } = fullDe(p, estoqueML);
  const foraFull = estoqueForaDoFull(casa, proprio, ehFull);
  const total = full + foraFull;
  const { min: precoMin, max: precoMax } = precosDe(p, estoqueML);
  // Venda potencial: `full` já vem deduplicado por pool (fullDe) — precifica
  // pelo MELHOR preço entre os anúncios Full, em vez de somar available×price
  // de CADA anúncio (isso multiplicava o mesmo pool compartilhado pelo preço
  // de cada listagem, dobrando o valor exatamente como dobrava a unidade).
  // Fora do Full: mesma ideia, uma vez só, pelo melhor preço entre os próprios.
  let precoFullMax = 0;
  let precoProprioMax = 0;
  for (const { item } of anunciosDe(p, estoqueML)) {
    if (!item) continue;
    if (ehFullLogistic(item.logistic)) precoFullMax = Math.max(precoFullMax, item.price);
    else precoProprioMax = Math.max(precoProprioMax, item.price);
  }
  const valorPotencial = full * (precoFullMax || precoMax || precoMin) + foraFull * (precoProprioMax || precoMax || precoMin);
  const mediaDiaria = forecast.dias > 0 ? (forecast.vendas[p.id] ?? 0) / forecast.dias : 0;
  const cobertura = mediaDiaria > 0 && total > 0 ? total / mediaDiaria : Infinity;
  // Reposição só faz sentido pra quem está no Full.
  const reporQtd = ehFull && mediaDiaria > 0 ? Math.max(0, Math.ceil(mediaDiaria * DIAS_ALVO) - full) : 0;

  /**
   * Lucro projetado do que está parado. Precifica pelo MENOR preço entre os
   * anúncios (precoMin), não o maior: o comprador escolhe o mais barato, então
   * projetar pelo topo prometeria um lucro que a venda real não entrega.
   * Imposto e custo saem da vigência de HOJE — é a decisão de hoje que está
   * em jogo, não o histórico.
   */
  const lucro = calcularLucroEstoque({
    preco: precoMin || precoMax,
    custo: custoMedioDe(p),
    impostoPct: impostoNaData(p, todayISO()),
    unidades: total,
    taxas: medirTaxas(forecast.financeiro?.[p.id]),
  });

  return { precoMin, precoMax, casa, full, proprio, ehFull, total, mediaDiaria, cobertura, valorPotencial, reporQtd, lucro };
}

export default function EstoqueTab({ uid, data }: { uid: string; data: UserData }) {
  const { canEditTab } = useAccess();
  const canEdit = canEditTab("estoque");
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [search, setSearch] = useState("");
  const [estoqueML, setEstoqueML] = useState<EstoqueML>({});
  const [forecast, setForecast] = useState<Forecast>({ vendas: {}, dias: DIAS_ALVO });
  const [loadingML, setLoadingML] = useState(false);
  const [movimentos, setMovimentos] = useState<EstoqueMovimento[]>([]);
  const [remessas, setRemessas] = useState<Remessa[]>([]);
  const [remessasIgnoradas, setRemessasIgnoradas] = useState<Set<string>>(new Set());
  const [movModal, setMovModal] = useState<{ product: Product; tipo: MovimentoTipo } | null>(null);
  const [entradaMassa, setEntradaMassa] = useState(false);
  const [agenciasProduct, setAgenciasProduct] = useState<Product | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setExpanded(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded]);
  const [impostoMassa, setImpostoMassa] = useState(false);
  const [vincularSku, setVincularSku] = useState(false);

  const carregarEstoque = useCallback(async () => {
    setLoadingML(true);
    try {
      const [rMl, rFc, rFull] = await Promise.all([
        authedFetch("/api/ml/estoque-ml", { cache: "no-store" }),
        authedFetch(`/api/ml/estoque-forecast?dias=${DIAS_ALVO}`, { cache: "no-store" }),
        /**
         * Remessas pro Full. Sem isto, um envio que chegou no centro mas
         * ainda não teve a baixa lançada fica contado NOS DOIS lados — o
         * livro do galpão não desceu e o Full já subiu — e o total aparece
         * inflado sem nada explicando. A rota tem cache de 5 min do lado do
         * servidor, então não é uma chamada cara. Best-effort: sem ela a aba
         * funciona igual, só sem o aviso.
         */
        authedFetch("/api/ml/gestao-full", { cache: "no-store" }).catch(() => null),
      ]);
      if (rMl.ok) setEstoqueML((await rMl.json()).estoque ?? {});
      if (rFc.ok) { const j = await rFc.json(); setForecast({ vendas: j.vendas ?? {}, dias: j.dias ?? DIAS_ALVO, financeiro: j.financeiro ?? {} }); }
      if (rFull?.ok) { const j = await rFull.json(); setRemessas(j.remessas ?? []); }
    } catch { /* ignora */ } finally { setLoadingML(false); }
  }, []);

  useEffect(() => { carregarEstoque(); }, [carregarEstoque]);
  useEffect(() => watchMovimentos(setMovimentos), []);
  useEffect(() => watchRemessasIgnoradas(setRemessasIgnoradas), []);

  /**
   * Unidades contadas duas vezes: já no Full e ainda no livro do galpão,
   * porque a baixa da remessa nunca foi lançada (ver
   * unidadesPendentesPorProduto). É o que fazia o total aparecer inflado sem
   * explicação — 23 "em casa" que já não existiam somadas às 22 do Full.
   */
  const duplicadasPorProduto = useMemo(
    () => unidadesPendentesPorProduto(remessas, movimentos, remessasIgnoradas),
    [remessas, movimentos, remessasIgnoradas],
  );

  const movsPorProduto = useMemo(() => {
    const map = new Map<string, EstoqueMovimento[]>();
    for (const m of movimentos) {
      const arr = map.get(m.productId) ?? [];
      arr.push(m);
      map.set(m.productId, arr);
    }
    return map;
  }, [movimentos]);

  const filtered = data.products.filter((p) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      (p.sku ?? "").toLowerCase().includes(q) ||
      mlbsDe(p).some((m) => m.toLowerCase().includes(q))
    );
  });

  const total = data.products.length;
  const ativos = data.products.filter((p) => p.ativo).length;
  // Sem Full, "em casa" é o mesmo estoque do anúncio (ver estoqueForaDoFull) — soma
  // o valor exibido de cada produto, não o livro de movimentações cru.
  const unCasa = data.products.reduce((s, p) => {
    const { proprio, ehFull } = fullDe(p, estoqueML);
    return s + (ehFull ? Math.max(p.qtdLocal ?? 0, 0) : proprio);
  }, 0);
  // Soma o Full JÁ deduplicado por produto (fullDe/consolidarEstoqueAnuncios)
  // — somar direto do mapa bruto do ML (Object.values(estoqueML)) reproduziria
  // o mesmo bug do pool compartilhado aqui no card do topo, mesmo com a linha
  // da tabela já certa.
  const unFull = data.products.reduce((s, p) => s + fullDe(p, estoqueML).qtd, 0);
  // Valor parado = (Full + estoque fora do Full) × custo médio. O próprio não
  // soma com casa: é o mesmo estoque exposto no anúncio.
  const valorEstoque = data.products.reduce((s, p) => {
    const casa = Math.max(p.qtdLocal ?? 0, 0);
    const { qtd: full, proprio, ehFull } = fullDe(p, estoqueML);
    return s + (full + estoqueForaDoFull(casa, proprio, ehFull)) * custoMedioDe(p);
  }, 0);
  // Produto ativo sem nenhum MLB ligado: a venda dele nunca casa com o
  // cadastro, então entra no lucro com CMV zero (ver metrics/route.ts).
  const semAnuncio = data.products.filter((p) => p.ativo && mlbsDe(p).filter(Boolean).length === 0);
  // Produtos NO FULL com estoque baixo E unidades em casa pra reabastecer.
  const reabastecer = data.products.filter((p) => {
    const f = fullDe(p, estoqueML);
    return f.ehFull && f.qtd <= FULL_BAIXO && (p.qtdLocal ?? 0) > 0;
  });
  // Venda potencial = todo o estoque × preço de venda atual do ML.
  const valorPotencialVenda = data.products.reduce((s, p) => s + previsaoDe(p, estoqueML, forecast).valorPotencial, 0);

  // Indicadores de reposição (Fase 5) — cobertura real via forecast, só
  // produtos ativos (produto descontinuado não precisa de alerta de compra).
  const resumoCobertura = useMemo(() => {
    let ruptura = 0, critico = 0, repor = 0, encalhado = 0, valorEmRisco = 0;
    for (const p of data.products) {
      if (!p.ativo) continue;
      const f = previsaoDe(p, estoqueML, forecast);
      const vendasPeriodo = forecast.vendas[p.id] ?? 0;
      const coberturaDias = Number.isFinite(f.cobertura) ? f.cobertura : null;
      const status = getCoverageStatus(coberturaDias, f.total, vendasPeriodo);
      if (f.total <= 0) ruptura++;
      if (status === "critico") { critico++; valorEmRisco += f.total * custoMedioDe(p); }
      else if (status === "repor") repor++;
      else if (status === "encalhado") { encalhado++; valorEmRisco += f.total * custoMedioDe(p); }
    }
    return { ruptura, critico, repor, encalhado, valorEmRisco };
  }, [data.products, estoqueML, forecast]);

  /**
   * Total de produtos que pedem alguma ação. `ruptura` fica FORA da soma
   * porque todo produto sem estoque já é contado em `critico` ou `encalhado`
   * pelo getCoverageStatus — somar os quatro contaria o mesmo produto duas
   * vezes e o cartão mostraria mais produtos em risco do que existem.
   */
  const precisamAtencao = resumoCobertura.critico + resumoCobertura.repor + resumoCobertura.encalhado;

  function onAdd() {
    setEditProduct({ id: newId(), name: "", custo: "", sku: "", imposto: "", mlbs: [""], ativo: true });
  }

  return (
    <div className="dash">
      {/* Header */}
      <div className="tab-head">
        <div className="tab-head-left">
          <h2 className="tab-title">Estoque de Produtos</h2>
          <button type="button" className="btn btn-sm btn-ghost" onClick={carregarEstoque} disabled={loadingML}>
            {loadingML ? "Atualizando..." : "⟳ Atualizar Full (ML)"}
          </button>
        </div>
        {canEdit && (
          <div className="tab-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVincularSku(true)}>
              Vincular por SKU
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setImpostoMassa(true)}>
              Imposto em massa
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEntradaMassa(true)}>
              ＋ Entrada em massa
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={onAdd}>＋ Novo Produto</button>
          </div>
        )}
      </div>

      {/*
        Resumo — 5 cartões em vez dos 10 de antes. Eram tantos que nenhum se
        destacava: quatro deles ("Em ruptura", "Cobertura crítica", "Cobertura
        baixa", "Capital parado") são o MESMO assunto (produto que precisa de
        ação) fatiado, e "Em casa"/"No Full" são as duas metades do estoque que
        o cartão de valor já resume. Agora cada cartão responde uma pergunta
        distinta, e o detalhe das faixas fica no `k-sub`, sem perder informação.
      */}
      <div className="kpi-grid">
        <div className="kpi k-acc">
          <div className="k-lbl">Produtos</div>
          <div className="k-val">{total}</div>
          <div className="k-sub">{ativos} ativos</div>
        </div>
        <div className="kpi k-pos">
          <div className="k-lbl">Valor em estoque</div>
          <div className="k-val" style={{ color: "var(--green)" }}>{fmtBRL(valorEstoque)}</div>
          <div className="k-sub">(casa + Full) × custo médio</div>
        </div>
        {/* "produtos cadastrados" explícito: a aba Full mostra o Full da CONTA
            INTEIRA (inclui anúncio sem cadastro aqui), então o número de lá é
            maior. Os dois estão certos — o rótulo é que precisa dizer qual é
            qual, senão parece divergência. */}
        <div className="kpi k-acc">
          <div className="k-lbl">Unidades</div>
          <div className="k-val">{unCasa + unFull}</div>
          <div className="k-sub" title="Conta apenas os produtos cadastrados nesta aba. A aba Full mostra o total da conta no Mercado Livre, incluindo anúncios ainda não cadastrados aqui.">
            {unCasa} em casa · {unFull} no Full · só cadastrados
          </div>
        </div>
        <div className="kpi k-acc">
          <div className="k-lbl">Venda potencial</div>
          <div className="k-val">{fmtBRL(valorPotencialVenda)}</div>
          <div className="k-sub">estoque × preço ML atual</div>
        </div>
        <div className={precisamAtencao > 0 ? "kpi k-neg" : "kpi k-pos"}>
          <div className="k-lbl">Precisam de atenção</div>
          <div className="k-val" style={{ color: precisamAtencao > 0 ? "var(--red)" : "var(--green)" }}>{precisamAtencao}</div>
          <div className="k-sub">
            {precisamAtencao === 0
              ? "nenhum produto em risco"
              : `${resumoCobertura.ruptura} sem estoque · ${resumoCobertura.critico} crítico · ${resumoCobertura.repor} repor · ${resumoCobertura.encalhado} parado · ${fmtBRL(resumoCobertura.valorEmRisco)} em risco`}
          </div>
        </div>
      </div>

      {/* Antes da lista de produtos: e decisao de COMPRA, e vem antes de
          qualquer ajuste fino de cadastro. */}
      <ReposicaoPanel produtos={data.products} estoqueML={estoqueML} forecast={forecast} />

      {/* Produto cadastrado sem nenhum anúncio ligado nunca recebe venda no
          cálculo de lucro — o pedido chega, não acha o produto e o CMV entra
          como zero. Detectado localmente (sem custo de API) pra o atalho de
          vincular por SKU aparecer sozinho em vez de ficar escondido no botão. */}
      {semAnuncio.length > 0 && canEdit && (
        <div className="note note-warn" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
          <span>
            <b>{semAnuncio.length} produto(s) sem anúncio vinculado</b> — as vendas deles entram com custo zero
            e inflam o lucro: {semAnuncio.slice(0, 4).map((p) => p.name || "sem nome").join(", ")}{semAnuncio.length > 4 ? "…" : ""}
          </span>
          <button type="button" className="btn btn-warning btn-sm" onClick={() => setVincularSku(true)}>
            Vincular por SKU
          </button>
        </div>
      )}

      {/* Vinculacao automatica: so casamento EXATO de SKU, que nao tem
          ambiguidade. Aproximado continua exigindo seu aval no modal. */}
      {canEdit && <AutoVincularSku uid={uid} produtos={data.products} />}

      {/* Busca */}
      <input
        className="search-inp" type="search" placeholder="Buscar por nome, SKU ou código MLB…" value={search}
        onChange={(e) => setSearch(e.target.value)} aria-label="Buscar produto"
      />

      {/* Aviso no topo porque a causa do total inflado não está na linha de um
          produto só — está numa remessa que ninguém baixou. Sem isto, o número
          errado aparece e a explicação fica escondida num tooltip. */}
      {duplicadasPorProduto.size > 0 && (
        <div className="note note-warn">
          <b>Estoque contado duas vezes</b> em {duplicadasPorProduto.size} produto(s):{" "}
          {Array.from(duplicadasPorProduto.values()).reduce((s, n) => s + n, 0)} unidade(s) já chegaram
          no Full mas a saída do galpão nunca foi lançada, então seguem contadas nos dois lugares e o
          total fica maior do que o real. A baixa mexe no custo médio, por isso não é aplicada sozinha
          — resolva em <b>Full › Remessas pro Full</b>.
        </div>
      )}

      {reabastecer.length > 0 && (
        <div className="note note-warn">
          <b>Full baixo</b> em {reabastecer.length} produto(s) — você tem unidades em casa pra enviar:{" "}
          {reabastecer.slice(0, 6).map((p) => p.name || "sem nome").join(", ")}{reabastecer.length > 6 ? "…" : ""}
        </div>
      )}

      {/* Lista */}
      <div className="panel">
        {filtered.length === 0 ? (
          <div className="empty-state">
            <span className="empty-ico">📦</span>
            {search ? "Nenhum produto encontrado." : (<>Nenhum produto cadastrado.<br />Clique em <strong>＋ Novo Produto</strong>.</>)}
          </div>
        ) : (
          <div className="table-wrapper" style={{ border: "none" }}>
            <table className="tbl-modern tbl-cards">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Produto</th>
                  <th style={{ textAlign: "right" }}>Em casa</th>
                  <th style={{ textAlign: "right" }}>Full (ML)</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                  <th style={{ textAlign: "right" }}>Custo médio</th>
                  <th style={{ textAlign: "right" }}>Preço venda</th>
                  <th style={{ textAlign: "right" }}>Imposto</th>
                  <th style={{ textAlign: "center" }}>Movimentar</th>
                  <th style={{ textAlign: "right" }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <ProductRow
                    key={p.id}
                    product={p}
                    uid={uid}
                    estoqueML={estoqueML}
                    expanded={expanded === p.id}
                    onToggle={() => setExpanded((cur) => (cur === p.id ? null : p.id))}
                    onEdit={() => setEditProduct({ ...p, mlbs: mlbsDe(p) })}
                    onMov={(tipo) => setMovModal({ product: p, tipo })}
                    onAgencias={() => setAgenciasProduct(p)}
                    duplicadas={duplicadasPorProduto.get(p.id) ?? 0}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <PrevisaoPanel products={filtered} estoqueML={estoqueML} forecast={forecast} />

      {impostoMassa && (
        <ImpostoMassaModal
          uid={uid}
          produtos={filtered}
          escopoBusca={search.trim()}
          onClose={() => setImpostoMassa(false)}
        />
      )}

      {vincularSku && (
        <VincularSkuModal uid={uid} produtos={data.products} onClose={() => setVincularSku(false)} />
      )}

      {editProduct && (
        <ProductModal
          product={editProduct}
          isNew={!data.products.some((p) => p.id === editProduct.id)}
          onClose={() => setEditProduct(null)}
          onSave={async (prod) => {
            const ehNovo = !data.products.some((p) => p.id === prod.id);
            try {
              await upsertProduct(uid, prod);
              // Trilha de auditoria: mexer no custo médio de um produto muda a
              // margem de vendas passadas (ver custoNaData) — precisa de rastro.
              logAudit({
                acao: ehNovo ? "criar" : "editar",
                entidade: "produto",
                entidadeId: prod.id,
                entidadeLabel: prod.name || "(sem nome)",
                detalhe: `custo ${fmtBRL(prod.custoMedio ?? parseNum(prod.custo))} · imposto ${prod.imposto ?? 0}%`,
              }).catch(() => {});
            } catch (err: unknown) {
              alert("Erro ao salvar produto: " + (err instanceof Error ? err.message : String(err)));
            } finally {
              setEditProduct(null);
            }
          }}
        />
      )}

      {/* Todos os produtos, não só os filtrados na aba: o modal tem busca
          própria, e a nota de compra costuma trazer item fora do filtro. */}
      {entradaMassa && (
        <EntradaMassaModal
          produtos={data.products}
          estoqueML={estoqueML}
          onClose={() => setEntradaMassa(false)}
          onSaved={() => setEntradaMassa(false)}
        />
      )}

      {movModal && (
        <MovimentoModal
          product={movModal.product}
          tipo={movModal.tipo}
          estoqueML={estoqueML}
          onClose={() => setMovModal(null)}
          onSaved={() => setMovModal(null)}
        />
      )}

      {agenciasProduct && (
        <AgenciasModal
          product={agenciasProduct}
          estoqueML={estoqueML}
          onClose={() => setAgenciasProduct(null)}
        />
      )}

      {expanded && (() => {
        const p = data.products.find((x) => x.id === expanded);
        if (!p) return null;
        return (
          <div className="drawer-overlay" onClick={() => setExpanded(null)}>
            <div className="drawer-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Movimentações de ${p.name || "produto"}`}>
              <div className="drawer-head">
                <div>
                  <div className="drawer-title">{p.name || "Sem nome"}</div>
                  <div className="drawer-sub">custo médio {fmtBRL(custoMedioDe(p))} · {p.qtdLocal ?? 0} un. em casa</div>
                </div>
                <button type="button" className="drawer-close" onClick={() => setExpanded(null)} aria-label="Fechar histórico">✕</button>
              </div>
              <div className="drawer-body" style={{ padding: "12px 16px" }}>
                <MovimentosHistorico product={p} movs={movsPorProduto.get(p.id) ?? []} onMov={(tipo) => setMovModal({ product: p, tipo })} />
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function ProductRow({
  product, estoqueML, expanded, onToggle, onEdit, onMov, onAgencias, duplicadas = 0,
}: {
  product: Product;
  uid: string;
  estoqueML: EstoqueML;
  /** Unidades já no Full que ainda não saíram do livro do galpão (0 = nenhuma). */
  duplicadas?: number;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onMov: (tipo: MovimentoTipo) => void;
  onAgencias: () => void;
}) {
  const imposto = parseNum(product.imposto ?? "0");
  const anuncios = anunciosDe(product, estoqueML);
  const { qtd: full, proprio, ehFull, fullCompartilhado, proprioCompartilhado } = fullDe(product, estoqueML);
  const casa = product.qtdLocal ?? 0;
  // Sem Full, "em casa" e "no anúncio" são o mesmo estoque físico (ver
  // estoqueForaDoFull) — mostra o valor do anúncio, que é o que reflete vendas
  // de verdade, em vez do livro de movimentações (que só sobe, nunca desce
  // sozinho quando vende).
  const casaExibida = ehFull ? casa : proprio;
  const custoMedio = custoMedioDe(product);
  const totalUn = full + estoqueForaDoFull(casa, proprio, ehFull);
  const fullBaixo = ehFull && full <= FULL_BAIXO;
  const { min: precoMin, max: precoMax, temPromo } = precosDe(product, estoqueML);

  return (
    <>
      <tr style={{ opacity: product.ativo ? 1 : 0.5 }}>
        <td style={{ textAlign: "left" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button type="button" onClick={onToggle} title="Ver movimentações" aria-label="Ver movimentações" aria-expanded={expanded} style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: ".8rem", transform: expanded ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▶</button>
            <div>
              <div style={{ fontWeight: 600 }}>{product.name || <em style={{ color: "var(--muted)" }}>Sem nome</em>}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 3 }}>
                {product.sku
                  ? <span style={{ background: "rgba(233,169,45,.12)", color: "#E9A92D", padding: "1px 7px", borderRadius: 6, fontWeight: 700, fontSize: ".7rem" }}>SKU {product.sku}</span>
                  : <span style={{ color: "var(--red)", fontSize: ".7rem" }}>sem SKU</span>}
                {anuncios.map(({ mlb, item }) => (
                  <span key={mlb} style={{ fontSize: ".7rem", background: "var(--surface2)", border: "1px solid var(--border)", padding: "1px 6px", borderRadius: 5, color: "var(--muted)" }}>
                    {mlb}
                    {item && item.price > 0 && <b style={{ color: "var(--green)", marginLeft: 4 }}>{fmtBRL(item.price)}</b>}
                    {item && item.hasPromo && <span style={{ marginLeft: 4, fontSize: ".62rem", color: "#F4B942", fontWeight: 700 }}>promo</span>}
                    {item && <span style={{ marginLeft: 4, color: ehFullLogistic(item.logistic) ? "#E9A92D" : "var(--muted)" }}>{ehFullLogistic(item.logistic) ? "Full" : "próprio"}</span>}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </td>
        <td data-label="Em casa" style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap", color: casaExibida > 0 ? "var(--yellow)" : "var(--muted)" }}>
          {casaExibida} un
          {/* Sem Full, "Em casa" vem do maior anúncio próprio — e com dois
              anúncios sobre o mesmo galpão o número parece "faltar" se ninguém
              explicar de onde ele saiu. */}
          {/* O livro do galpão só desce quando a saída pro Full é lançada. Até
              lá as MESMAS unidades contam aqui e no Full — o total infla e
              parece erro de cálculo. Mostramos o tamanho exato da diferença em
              vez de descontar na tela: a baixa é lançamento de verdade (mexe no
              custo médio), e corrigir só aqui faria o painel discordar do livro. */}
          {duplicadas > 0 && (
            <span
              title={`${duplicadas} unidade(s) já chegaram no Full mas a baixa não foi lançada, então continuam contadas aqui TAMBÉM. O total deste produto está inflado nessas unidades. Resolva na aba Full › Remessas pro Full.`}
              style={{ display: "block", fontSize: ".62rem", color: "var(--warning)", fontWeight: 700, cursor: "help" }}
            >
              ⚠ {duplicadas} un já no Full
            </span>
          )}
          {proprioCompartilhado && !ehFull && (
            <span
              title="Este produto está em mais de um anúncio fora do Full, e os dois vendem do MESMO estoque de casa. O total usa o maior declarado, não a soma: anunciar 18 e 18 é a mesma pilha de 18 unidades, não 36."
              style={{ display: "block", fontSize: ".62rem", color: "var(--muted)", fontWeight: 400, cursor: "help" }}
            >
              mesmo estoque em {anuncios.filter(({ item }) => item && !ehFullLogistic(item.logistic)).length} anúncios
            </span>
          )}
        </td>
        <td data-label="Full (ML)" style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap", color: !ehFull ? "var(--muted)" : fullBaixo ? "var(--red)" : "var(--green)" }}>
          {ehFull ? `${full} un` : "—"}
          {fullBaixo && casa > 0 && <span title="Envie de casa pro Full" style={{ display: "block", fontSize: ".62rem", color: "var(--warning)" }}>reabastecer</span>}
          {fullCompartilhado && <span title="Mais de um anúncio compartilha o mesmo estoque no Full. As unidades são contadas UMA vez — cada anúncio sozinho mostra o pool inteiro, e somá-los dobraria o número." style={{ display: "block", fontSize: ".62rem", color: "var(--muted)", fontWeight: 400 }}>pool compartilhado</span>}
          {proprio > 0 && <span title="Unidades expostas no(s) anúncio(s) fora do Full (envio por sua conta/agência). Saem do MESMO estoque de casa, então NÃO somam no Total — já estão contadas em 'Em casa'." style={{ display: "block", fontSize: ".62rem", color: "var(--muted)", fontWeight: 400 }}>{proprio} no anúncio</span>}
        </td>
        <td data-label="Total" style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{totalUn} un</td>
        <td data-label="Custo médio" style={{ textAlign: "right", whiteSpace: "nowrap", color: custoMedio > 0 ? "var(--text)" : "var(--muted)", fontWeight: 600 }}>
          {custoMedio > 0 ? fmtBRL(custoMedio) : "—"}
          {product.custoMedio == null && custoMedio > 0 && <span style={{ display: "block", fontSize: ".62rem", color: "var(--muted)" }}>manual</span>}
        </td>
        <td data-label="Preço venda" style={{ textAlign: "right", color: precoMax > 0 ? "var(--green)" : "var(--muted)", fontWeight: 600, whiteSpace: "nowrap" }}>
          {precoMax > 0 ? (precoMin === precoMax ? fmtBRL(precoMax) : `${fmtBRL(precoMin)}–${fmtBRL(precoMax)}`) : "—"}
          {temPromo && <span style={{ display: "block", fontSize: ".62rem", color: "#F4B942" }}>promoção</span>}
        </td>
        <td data-label="Imposto" style={{ textAlign: "right", whiteSpace: "nowrap", color: imposto > 0 ? "var(--red)" : "var(--muted)" }}>{imposto > 0 ? `${imposto.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : "—"}</td>
        <td data-label="Movimentar" data-cell="acoes">
          <div className="row-actions" style={{ justifyContent: "center" }}>
            <button type="button" className="btn btn-success btn-xs" title="Entrada (compra)" onClick={() => onMov("entrada")}>＋ Entrada</button>
            <button type="button" className="btn btn-ghost btn-xs" title="Enviar de casa pro Full (baixa, não é venda)" onClick={() => onMov("saida_full")}>Enviar Full</button>
            {ehFull && full > 0 && (
              <button
                type="button"
                className={custoMedio > 0 ? "btn btn-ghost btn-xs" : "btn btn-warning btn-xs"}
                title="Informar o custo das unidades que já estão no Full, pra o lucro sair certo"
                onClick={() => onMov("saldo_inicial")}
              >
                {custoMedio > 0 ? "Custo Full" : "Custear Full"}
              </button>
            )}
          </div>
        </td>
        <td data-label="Ações" data-cell="acoes">
          <div className="row-actions" style={{ justifyContent: "flex-end" }}>
            {proprio > 0 && (
              <button type="button" className="btn btn-ghost btn-xs" title="Ver o estoque de cada anúncio fora do Full (envio por conta sua/agência)" onClick={onAgencias}>Agências</button>
            )}
            <button type="button" className="btn btn-warning btn-xs" title="Editar produto" onClick={onEdit}>Editar</button>
            <button type="button" className="btn btn-danger btn-xs" title="Remover produto" onClick={() => {
              if (!confirm(`Remover "${product.name}"?`)) return;
              deleteProduct("", product.id).catch(() => {});
              logAudit({ acao: "excluir", entidade: "produto", entidadeId: product.id, entidadeLabel: product.name || "(sem nome)" }).catch(() => {});
            }}>Excluir</button>
          </div>
        </td>
      </tr>
    </>
  );
}

/**
 * Detalhamento dos anúncios fora do Full (envio por conta sua/agência) — só
 * leitura, o número já vem certo do próprio anúncio no ML (fullDe/anunciosDe
 * já leem isso pro "no anúncio" da linha); aqui é só abrir a quebra por MLB
 * pra quem trabalha com vários anúncios do mesmo produto via agência.
 */
function AgenciasModal({ product, estoqueML, onClose }: { product: Product; estoqueML: EstoqueML; onClose: () => void }) {
  const anuncios = anunciosDe(product, estoqueML).filter(({ item }) => item && !ehFullLogistic(item.logistic));
  const total = anuncios.reduce((s, { item }) => s + (item?.available ?? 0), 0);

  return (
    <Modal open onClose={onClose}>
      <div className="modal-title">Agências — {product.name || "Sem nome"}</div>
      <div className="modal-sub">Estoque de cada anúncio fora do Full · vem direto do Mercado Livre</div>

      {anuncios.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: ".85rem", margin: "12px 0" }}>
          Nenhum anúncio fora do Full pra este produto agora.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "12px 0" }}>
          {anuncios.map(({ mlb, item }) => (
            <div key={mlb} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 12px", background: "var(--surface2)", borderRadius: 8 }}>
              <div>
                <div style={{ fontFamily: "ui-monospace, monospace", fontSize: ".8rem", fontWeight: 700 }}>{mlb}</div>
                {!!item?.price && (
                  <div style={{ fontSize: ".76rem", color: "var(--green)" }}>
                    {fmtBRL(item.price)}{item.hasPromo && <span style={{ color: "#F4B942" }}> · promoção</span>}
                  </div>
                )}
              </div>
              <div style={{ fontSize: "1.05rem", fontWeight: 800 }}>{item?.available ?? 0} un</div>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, marginTop: 4, borderTop: "1px solid var(--border)", fontWeight: 700 }}>
            <span>Total nas agências</span>
            <span>{total} un</span>
          </div>
        </div>
      )}

      <div style={{ fontSize: ".72rem", color: "var(--muted)", marginBottom: 12, lineHeight: 1.5 }}>
        Atualize a quantidade direto no anúncio do Mercado Livre — este número acompanha sozinho, sem
        controle manual pra manter.
      </div>

      <div className="modal-btns">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Fechar</button>
      </div>
    </Modal>
  );
}

function MovimentosHistorico({ product, movs, onMov }: { product: Product; movs: EstoqueMovimento[]; onMov: (tipo: MovimentoTipo) => void }) {
  const ordenados = [...movs].sort((a, b) => (b.data ?? "").localeCompare(a.data ?? "") || (b.createdAt ?? 0) - (a.createdAt ?? 0));
  // Movimentação sendo corrigida. Excluir e relançar perdia o histórico de
  // quem lançou — ver EditarMovimentoModal.
  const [editando, setEditando] = useState<EstoqueMovimento | null>(null);
  return (
    <div>
      {editando && (
        <EditarMovimentoModal
          product={product}
          mov={editando}
          onClose={() => setEditando(null)}
          onSaved={() => setEditando(null)}
        />
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: ".74rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".05em" }}>Movimentações</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => onMov("saldo_inicial")}>Custo do Full</button>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => onMov("ajuste")}>Ajuste / perda</button>
        </div>
      </div>
      {ordenados.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: ".8rem", padding: "6px 0" }}>Nenhuma movimentação ainda. Use <b>＋ Entrada</b> para lançar a primeira compra.</div>
      ) : (
        <div className="table-wrapper" style={{ border: "1px solid var(--border)" }}>
          <table className="tbl-modern tbl-cards">
            <thead>
              <tr><th>Data</th><th style={{ textAlign: "left" }}>Tipo</th><th>Qtd</th><th>Custo un.</th><th style={{ textAlign: "left" }}>Obs</th><th></th></tr>
            </thead>
            <tbody>
              {ordenados.map((m) => {
                const isCompra = m.tipo === "entrada" || m.tipo === "saldo_inicial";
                const sign = isCompra ? "+" : m.tipo === "saida_full" ? "−" : (m.quantidade >= 0 ? "+" : "−");
                const cor = isCompra ? "var(--green)" : m.tipo === "saida_full" ? "var(--yellow)" : (m.quantidade >= 0 ? "var(--green)" : "var(--red)");
                return (
                  <tr key={m.id}>
                    <td style={{ color: "var(--muted)" }}>{m.data}</td>
                    <td data-label="Tipo" style={{ textAlign: "left" }}><span style={{ color: cor, fontWeight: 700 }}>{TIPO_MOVIMENTO_LABEL[m.tipo]}</span></td>
                    <td data-label="Qtd" style={{ color: cor, fontWeight: 700 }}>{sign}{Math.abs(m.quantidade)}</td>
                    <td data-label="Custo un.">{(m.tipo === "entrada" || m.tipo === "saldo_inicial") && m.custoUnit != null ? fmtBRL(m.custoUnit) : "—"}</td>
                    <td data-label="Obs" style={{ textAlign: "left", color: "var(--muted)", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.obs || "—"}</td>
                    <td data-cell="acoes" style={{ whiteSpace: "nowrap" }}>
                      <button
                        type="button" className="btn btn-ghost btn-xs" style={{ marginRight: 6 }}
                        title="Corrigir esta movimentação (mantém quem lançou e quando)"
                        onClick={() => setEditando(m)}
                      >
                        Editar
                      </button>
                      <button type="button" className="btn btn-danger btn-xs" title="Excluir movimentação" onClick={() => {
                        if (!confirm("Excluir esta movimentação? O custo médio será recalculado.")) return;
                        deleteMovimento(m.id, product.id).catch(() => {});
                        logAudit({
                          acao: "excluir", entidade: "movimento", entidadeId: m.id,
                          entidadeLabel: `${product.name || "(sem nome)"} · ${TIPO_MOVIMENTO_LABEL[m.tipo]}`,
                          detalhe: `${m.quantidade} un em ${m.data}`,
                        }).catch(() => {});
                      }}>Excluir</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MovimentoModal({ product, tipo, estoqueML, onClose, onSaved }: { product: Product; tipo: MovimentoTipo; estoqueML: EstoqueML; onClose: () => void; onSaved: () => void }) {
  const isEntrada = tipo === "entrada";
  const isSaldo = tipo === "saldo_inicial";
  const isAjuste = tipo === "ajuste";
  const precisaCusto = isEntrada || isSaldo;

  const { qtd: full, proprio, ehFull } = fullDe(product, estoqueML);
  const casa = product.qtdLocal ?? 0;
  const avgAtual = custoMedioDe(product);

  // Saldo inicial serve pra custear o que JÁ ESTÁ no Full: pré-preenche com a
  // quantidade que o ML mostra no Full, pra você só confirmar o custo.
  const [qtd, setQtd] = useState(isSaldo && full > 0 ? String(full) : "");
  const [custo, setCusto] = useState(precisaCusto ? (product.custoMedio ? String(product.custoMedio) : product.custo || "") : "");
  const [data, setData] = useState(todayISO());
  const [obs, setObs] = useState("");
  const [saving, setSaving] = useState(false);

  const titulo = isEntrada ? "＋ Entrada (compra)" : isSaldo ? "Custo do que está no Full" : tipo === "saida_full" ? "Envio pro Full" : "Ajuste de estoque";

  const qNum = parseNum(qtd);
  const cNum = parseNum(custo);

  // ENTRADA: blenda a compra nova contra tudo que você tem (Full + fora do
  // Full — ver estoqueForaDoFull pra como "fora do Full" é contado sem
  // duplicar casa e anúncio próprio).
  const estoqueAtual = full + estoqueForaDoFull(casa, proprio, ehFull);
  /**
   * A média ponderada saiu daqui e virou função pura (custoMedioAposEntrada),
   * porque a entrada em massa precisa do MESMO cálculo. Duas cópias da
   * fórmula do custo médio seriam duas definições do mesmo número — que é,
   * pelo histórico desta base, a origem de quase todo valor errado que
   * apareceu aqui.
   */
  const novoAvgEntrada = custoMedioAposEntrada(estoqueAtual, avgAtual, qNum, cNum);

  // SALDO INICIAL (Full): as unidades do Full ainda não têm custo. Blenda elas,
  // ao custo informado, contra o que está FORA do Full, que já reflete o custo
  // médio atual. Sem estoque fora do Full, o custo do Full vira o próprio
  // custo médio. Antes o saldo SOBRESCREVIA o custo médio — errado quando já
  // havia estoque em casa com custo.
  const foraDoFull = estoqueForaDoFull(casa, proprio, ehFull);
  const novoAvgSaldo = qNum > 0
    ? (avgAtual > 0 && foraDoFull > 0
        ? (foraDoFull * avgAtual + qNum * cNum) / (foraDoFull + qNum)
        : cNum)
    : avgAtual;

  const novoAvg = isEntrada ? novoAvgEntrada : novoAvgSaldo;

  async function handleSave() {
    if (!qNum || (!isAjuste && qNum <= 0)) { alert("Informe a quantidade."); return; }
    if (precisaCusto && cNum <= 0) { alert("Informe o custo unitário."); return; }
    if (!obs.trim()) { alert("Informe o motivo desta movimentação — fica registrado no histórico do produto."); return; }
    // Ajuste negativo tira estoque sem ser nem venda nem envio — a confirmação
    // extra existe pra não zerar produto por engano digitando o sinal errado.
    if (isAjuste && qNum < 0 && !confirm(`Confirma a baixa de ${Math.abs(qNum)} unidade(s) de "${product.name || "produto"}"?\n\nMotivo: ${obs.trim()}`)) {
      return;
    }
    setSaving(true);
    const movId = newMovId();
    try {
      await addMovimento({
        id: movId,
        productId: product.id,
        tipo,
        quantidade: isAjuste ? qNum : Math.abs(qNum),
        custoUnit: precisaCusto ? cNum : undefined,
        data,
        obs: obs.trim() || undefined,
        // Entrada e saldo do Full gravam o custo médio recalculado.
      }, precisaCusto ? novoAvg : undefined);
      // Entrada muda o custo médio a partir desta data (ver custoNaData) —
      // registra na trilha o custo informado e o novo médio resultante.
      logAudit({
        acao: "criar", entidade: "movimento", entidadeId: movId,
        entidadeLabel: `${product.name || "(sem nome)"} · ${titulo}`,
        detalhe: precisaCusto
          ? `${qNum} un a ${fmtBRL(cNum)} · custo médio ${fmtBRL(avgAtual)} → ${fmtBRL(novoAvg)}`
          : `${qNum} un em ${data}`,
      }).catch(() => {});
      onSaved();
    } catch (err: unknown) {
      alert("Erro ao salvar movimentação: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose}>
      <div className="modal-title">{titulo}</div>
      <div className="modal-sub">{product.name || "Produto"} · estoque atual: <b>{estoqueAtual} un</b>{avgAtual > 0 && <> · custo médio {fmtBRL(avgAtual)}</>}</div>

      <div className="config-field">
        <label>{isAjuste ? "Quantidade (use − para baixa)" : "Quantidade (unidades)"}</label>
        <input type="number" step="1" placeholder={isAjuste ? "Ex: -3" : "Ex: 40"} value={qtd} onChange={(e) => setQtd(e.target.value)} />
      </div>

      {precisaCusto && (
        <div className="config-field">
          <label>Custo unitário {isSaldo ? "das unidades no Full" : "desta compra"} (R$)</label>
          <input type="number" min="0" step="0.01" placeholder="Ex: 11.50" value={custo} onChange={(e) => setCusto(e.target.value)} />
          {qNum > 0 && cNum > 0 && (
            <div className="hint">
              Custo médio {isSaldo ? "depois de custear o Full" : "após esta entrada"}: <b style={{ color: "var(--green)" }}>{fmtBRL(novoAvg)}</b>
              {avgAtual > 0 && Math.abs(novoAvg - avgAtual) > 0.001 && <> (era {fmtBRL(avgAtual)})</>}
            </div>
          )}
        </div>
      )}

      {isSaldo && (
        <div style={{ margin: "4px 0 12px", padding: "8px 12px", borderRadius: 8, background: "rgba(233,169,45,.08)", border: "1px solid rgba(233,169,45,.2)", fontSize: ".78rem", color: "var(--muted)" }}>
          {full > 0
            ? <>O ML mostra <b>{full} un</b> deste produto no Full sem custo lançado. Informe quanto você pagou por unidade — isso <b>entra no custo médio</b> pra o lucro sair certo quando elas venderem. Não soma no “em casa” (já estão fora).</>
            : <>Use pra custear unidades que <b>já estavam no estoque</b> antes de você começar a lançar (ex.: o que está no Full). Entra na média do custo, mas <b>não soma no “em casa”</b>.</>}
        </div>
      )}

      {tipo === "saida_full" && (
        <div style={{ margin: "4px 0 12px", padding: "8px 12px", borderRadius: 8, background: "rgba(244,185,66,.08)", border: "1px solid rgba(244,185,66,.25)", fontSize: ".78rem", color: "var(--muted)" }}>
          Baixa por <b>envio ao Full</b> — sai de casa e vai pro Full, mas <b>não é venda</b>. Não afeta o lucro; o custo só entra quando o produto vende.
        </div>
      )}

      <div className="config-field">
        <label>Data</label>
        <input type="date" value={data} onChange={(e) => setData(e.target.value)} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: ".9rem", outline: "none" }} />
      </div>

      <div className="config-field">
        <label>Motivo</label>
        <input type="text" placeholder="Ex: fornecedor João, NF 123 / quebra no transporte / contagem física" value={obs} onChange={(e) => setObs(e.target.value)} />
      </div>

      <div className="modal-btns">
        <button type="button" className="btn btn-success" onClick={handleSave} disabled={saving || !obs.trim()}>{saving ? "Salvando…" : "Lançar"}</button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
      </div>
    </Modal>
  );
}

function coberturaFmt(dias: number): { txt: string; cor: string } {
  if (!Number.isFinite(dias)) return { txt: "—", cor: "var(--muted)" };
  const d = Math.round(dias);
  const cor = d <= 7 ? "var(--red)" : d <= 15 ? "var(--warning)" : "var(--green)";
  return { txt: `${d}d`, cor };
}

const STATUS_COBERTURA_COR: Record<CoverageStatus, string> = {
  critico: "var(--red)", repor: "var(--warning)", saudavel: "var(--green)",
  encalhado: "var(--warning)", "sem-giro": "var(--muted)",
};

// Planejamento da lista de reposição — só um "marcar como já resolvido",
// fica no navegador (localStorage), não precisa de Firestore/rule nova.
const PLANEJADOS_KEY = "estoque:planejados";
function lerPlanejados(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = lerChaveApp(PLANEJADOS_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch { return new Set(); }
}
function gravarPlanejados(ids: Set<string>) {
  gravarChaveApp(PLANEJADOS_KEY, JSON.stringify(Array.from(ids)));
}

const STATUS_PESO: Record<CoverageStatus, number> = { critico: 0, repor: 1, "sem-giro": 2, encalhado: 3, saudavel: 4 };

function PrevisaoPanel({ products, estoqueML, forecast }: { products: Product[]; estoqueML: EstoqueML; forecast: Forecast }) {
  const [planejados, setPlanejados] = useState<Set<string>>(new Set());
  useEffect(() => { setPlanejados(lerPlanejados()); }, []);
  function togglePlanejado(id: string) {
    setPlanejados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      gravarPlanejados(next);
      return next;
    });
  }

  /**
   * Sem filtro: produto recém-criado não tem estoque, venda nem preço, e
   * sumir da lista dava a impressão de que o cadastro não funcionou. Quem
   * ainda não tem dado cai no fim e diz o que está faltando.
   */
  const linhas = products
    .map((p) => {
      const f = previsaoDe(p, estoqueML, forecast);
      const vendasPeriodo = forecast.vendas[p.id] ?? 0;
      const coberturaDias = Number.isFinite(f.cobertura) ? f.cobertura : null;
      const status = getCoverageStatus(coberturaDias, f.total, vendasPeriodo);
      return { p, f, status };
    })
    .sort((a, b) =>
      STATUS_PESO[a.status] - STATUS_PESO[b.status]
      || b.f.valorPotencial - a.f.valorPotencial
      || b.f.total - a.f.total
      || (a.p.name || "").localeCompare(b.p.name || ""),
    );

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 6 }}>
        <span className="panel-title">Previsão de vendas e reposição</span>
        <span className="panel-sub">
          preço atual do ML · média dos últimos {forecast.dias} dias · repor p/ cobrir {DIAS_ALVO} dias ·
          lucro projetado com comissão e frete MEDIDOS nas vendas do período
        </span>
      </div>
      {linhas.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: ".82rem", padding: "8px 0" }}>Nenhum produto cadastrado ainda.</div>
      ) : (
        <div className="table-wrapper" style={{ border: "none" }}>
          <table className="tbl-modern tbl-cards">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Produto</th>
                <th style={{ textAlign: "left" }}>Status</th>
                <th style={{ textAlign: "right" }}>Preço ML</th>
                <th style={{ textAlign: "right" }}>Estoque total</th>
                <th style={{ textAlign: "right" }}>Vendas/dia</th>
                <th style={{ textAlign: "right" }}>Cobertura</th>
                <th style={{ textAlign: "right" }}>Repor (Full)</th>
                <th style={{ textAlign: "right" }}>Custo estimado</th>
                <th style={{ textAlign: "right" }}>Venda potencial</th>
                <th style={{ textAlign: "right" }}>Lucro projetado</th>
                <th style={{ textAlign: "center" }}>Planejado</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map(({ p, f, status }) => {
                const cob = coberturaFmt(f.cobertura);
                const emCasa = Math.min(f.reporQtd, f.casa);
                const comprar = Math.max(0, f.reporQtd - emCasa);
                const custoEstimado = comprar * custoMedioDe(p);
                const planejado = planejados.has(p.id);
                return (
                  <tr key={p.id} style={{ opacity: planejado ? 0.55 : 1 }}>
                    <td style={{ textAlign: "left", fontWeight: 600 }}>
                      {p.name || "Sem nome"}
                      {mlbsDe(p).length === 0 ? (
                        <span style={{ display: "block", fontSize: ".66rem", fontWeight: 400, color: "var(--warning)" }}>
                          sem anúncio vinculado — use “Vincular por SKU”
                        </span>
                      ) : f.total === 0 && f.mediaDiaria === 0 ? (
                        <span style={{ display: "block", fontSize: ".66rem", fontWeight: 400, color: "var(--muted)" }}>
                          sem estoque nem venda ainda
                        </span>
                      ) : null}
                    </td>
                    <td data-label="Status" style={{ textAlign: "left", whiteSpace: "nowrap" }}>
                      <span className="severity-chip" style={{ color: STATUS_COBERTURA_COR[status], background: "transparent", border: `1px solid ${STATUS_COBERTURA_COR[status]}` }}>
                        {COVERAGE_STATUS_LABEL[status]}
                      </span>
                    </td>
                    <td data-label="Preço ML" style={{ textAlign: "right", whiteSpace: "nowrap" }}>{f.precoMax > 0 ? (f.precoMin === f.precoMax ? fmtBRL(f.precoMax) : `${fmtBRL(f.precoMin)}–${fmtBRL(f.precoMax)}`) : "—"}</td>
                    <td data-label="Estoque total" style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{f.total} un</td>
                    <td data-label="Vendas/dia" style={{ textAlign: "right", color: f.mediaDiaria > 0 ? "var(--text)" : "var(--muted)" }}>{f.mediaDiaria > 0 ? f.mediaDiaria.toFixed(1) : "—"}</td>
                    <td data-label="Cobertura" style={{ textAlign: "right", color: cob.cor, fontWeight: 700 }}>{cob.txt}</td>
                    <td data-label="Repor (Full)" style={{ textAlign: "right" }}>
                      {f.reporQtd > 0 ? (
                        <span style={{ color: "var(--yellow)", fontWeight: 700 }}>
                          {f.reporQtd} un
                          {emCasa > 0 && (
                            <span style={{ display: "block", fontSize: ".64rem", color: "var(--muted)", fontWeight: 400 }}>
                              {emCasa} em casa{comprar > 0 ? ` · comprar ${comprar}` : ""}
                            </span>
                          )}
                        </span>
                      ) : <span style={{ color: "var(--muted)" }}>ok</span>}
                    </td>
                    <td data-label="Custo estimado" style={{ textAlign: "right", color: custoEstimado > 0 ? "var(--red)" : "var(--muted)", whiteSpace: "nowrap" }} title="Unidades a comprar (descontando o que já tem em casa) × custo médio">
                      {custoEstimado > 0 ? fmtBRL(custoEstimado) : "—"}
                    </td>
                    <td data-label="Venda potencial" style={{ textAlign: "right", color: "var(--green)", fontWeight: 700, whiteSpace: "nowrap" }}>{fmtBRL(f.valorPotencial)}</td>
                    {/* Lucro projetado: o que a venda potencial vira DEPOIS de
                        comissão, frete, custo e imposto. É a coluna que separa
                        "estoque valioso" de "estoque que dá prejuízo girar". */}
                    <td
                      data-label="Lucro projetado"
                      style={{
                        textAlign: "right", fontWeight: 700, whiteSpace: "nowrap",
                        color: f.lucro == null ? "var(--muted)" : f.lucro.lucroTotal >= 0 ? "var(--green)" : "var(--red)",
                      }}
                      title={
                        f.lucro == null
                          ? "Sem venda no período (ou sem preço no anúncio): não dá pra medir a comissão e o frete reais deste produto."
                          : `${fmtBRL(f.lucro.lucroUnitario)} por unidade × ${f.total} un · margem ${f.lucro.margem.toFixed(1)}%`
                      }
                    >
                      {f.lucro == null ? "—" : (
                        <>
                          {fmtBRL(f.lucro.lucroTotal)}
                          <span style={{ display: "block", fontSize: ".64rem", fontWeight: 400, color: "var(--muted)" }}>
                            {fmtBRL(f.lucro.lucroUnitario)}/un · {f.lucro.margem.toFixed(1)}%
                          </span>
                        </>
                      )}
                    </td>
                    <td data-label="Planejado" style={{ textAlign: "center" }}>
                      <input type="checkbox" checked={planejado} onChange={() => togglePlanejado(p.id)} aria-label={`Marcar ${p.name || "produto"} como reposição já planejada`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function ProductModal({ product: initial, isNew, onClose, onSave }: { product: Product; isNew: boolean; onClose: () => void; onSave: (p: Product) => Promise<void> }) {
  const [p, setP] = useState<Product>({ ...initial, mlbs: mlbsDe(initial).length ? mlbsDe(initial) : [""] });
  // Custo do estoque atual (custo médio efetivo). É o ponto de partida do blend.
  const [custoStr, setCustoStr] = useState(
    initial.custoMedio != null ? String(Math.round(initial.custoMedio * 100) / 100) : (initial.custo ?? ""),
  );
  const [saving, setSaving] = useState(false);

  function set(patch: Partial<Product>) {
    setP((prev) => ({ ...prev, ...patch }));
  }
  const mlbs = p.mlbs ?? [""];
  function setMlb(i: number, v: string) {
    set({ mlbs: mlbs.map((m, idx) => (idx === i ? v : m)) });
  }
  function addMlb() {
    set({ mlbs: [...mlbs, ""] });
  }
  function removeMlb(i: number) {
    const next = mlbs.filter((_, idx) => idx !== i);
    set({ mlbs: next.length ? next : [""] });
  }

  async function handleSave() {
    if (!p.name.trim()) { alert("Informe o nome do produto."); return; }
    const cleaned = mlbs.map((m) => m.trim()).filter(Boolean);
    // O custo digitado vira o custo médio efetivo (base do estoque atual).
    const saveObj: Product = { ...p, mlbs: cleaned, mlb: cleaned[0] ?? "", custo: custoStr };
    if (custoStr.trim()) saveObj.custoMedio = parseNum(custoStr);
    else delete saveObj.custoMedio;

    /**
     * O cálculo do lucro dá prioridade às faixas de vigência. Se o produto já
     * tem faixas, mexer só no campo `imposto` não teria efeito nenhum — então
     * a alteração vira uma faixa valendo de hoje, sem tocar no passado.
     */
    const pctNovo = parseNum(p.imposto ?? "0");
    const faixasAtuais = p.impostoFaixas ?? [];
    if (faixasAtuais.length && pctNovo !== impostoNaData({ impostoFaixas: faixasAtuais }, todayISO())) {
      const faixas = faixasAtuais.filter((f) => f.desde !== todayISO());
      faixas.push({ desde: todayISO(), pct: pctNovo });
      faixas.sort((a, b) => a.desde.localeCompare(b.desde));
      saveObj.impostoFaixas = faixas;
    }

    // Mesmo padrão acima, pro custo médio: se o produto já tem faixas (já
    // passou por uma entrada), editar o custo à mão também vira uma faixa
    // valendo de hoje — sem isso, corrigir o custo aqui reescreveria a
    // margem de vendas já feitas, o mesmo problema que a entrada tinha.
    const custoNovo = custoStr.trim() ? parseNum(custoStr) : 0;
    const custoFaixasAtuais = p.custoMedioFaixas ?? [];
    if (custoFaixasAtuais.length && custoStr.trim() && custoNovo !== custoNaData({ custoMedio: p.custoMedio, custo: p.custo, custoMedioFaixas: custoFaixasAtuais }, todayISO())) {
      const faixas = custoFaixasAtuais.filter((f) => f.desde !== todayISO());
      faixas.push({ desde: todayISO(), custo: custoNovo });
      faixas.sort((a, b) => a.desde.localeCompare(b.desde));
      saveObj.custoMedioFaixas = faixas;
    }
    setSaving(true);
    try {
      await onSave(saveObj);
    } catch (err: unknown) {
      alert("Erro ao salvar produto: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose}>
      <div className="modal-title">{isNew ? "Novo Produto" : "Editar Produto"}</div>

      <div className="config-field">
        <label>Nome do produto</label>
        <input type="text" placeholder="Ex: Kit Erva Mate Trot's 1,25kg" value={p.name} onChange={(e) => set({ name: e.target.value })} />
      </div>

      <div className="config-field">
        <label>SKU (código interno)</label>
        <input type="text" placeholder="Ex: 250" value={p.sku ?? ""} onChange={(e) => set({ sku: e.target.value })} />
        <div className="hint">Deve ser <strong>idêntico</strong> ao <code>sku</code> que aparece nos pedidos do ML.</div>
      </div>

      <div className="config-field">
        <label>Anúncios / Códigos MLB</label>
        {mlbs.map((m, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <input type="text" placeholder="Ex: MLB1234567890" value={m} onChange={(e) => setMlb(i, e.target.value)} style={{ flex: 1 }} />
            {mlbs.length > 1 && (
              <button type="button" className="btn btn-danger btn-xs" onClick={() => removeMlb(i)} style={{ flexShrink: 0 }}>Remover</button>
            )}
          </div>
        ))}
        <button type="button" className="btn btn-ghost btn-xs" onClick={addMlb} style={{ marginTop: 2 }}>＋ Adicionar anúncio (MLB)</button>
        <div className="hint">Vários anúncios do mesmo produto (preços diferentes, mesmo custo). Todos vinculam as vendas a este produto.</div>
      </div>

      <div className="config-field">
        <label>Custo do estoque atual — R$/unidade (inclui o que já está no Full)</label>
        <input type="number" min="0" step="0.01" placeholder="Ex: 13.80" value={custoStr} onChange={(e) => setCustoStr(e.target.value)} />
        <div className="hint">
          Informe o custo das unidades que você <strong>já tem hoje</strong> (galpão + Full). A cada <strong>＋ Entrada</strong>,
          esse custo é ajustado sozinho pela média, valendo só a partir dali — vendas já feitas continuam com a margem que tinham.
          {!!p.custoMedioFaixas?.filter((f) => f.desde !== CUSTO_FAIXA_SENTINELA).length && (
            <> Vigências: {[...p.custoMedioFaixas]
              .filter((f) => f.desde !== CUSTO_FAIXA_SENTINELA)
              .sort((a, b) => a.desde.localeCompare(b.desde))
              .map((f) => `${fmtBRL(f.custo)} desde ${f.desde.split("-").reverse().join("/")}`)
              .join(" · ")}.</>
          )}
        </div>
      </div>

      <div className="config-field">
        <label>Imposto sobre a venda (%)</label>
        <input type="number" min="0" step="0.01" placeholder="Ex: 8" value={p.imposto ?? ""} onChange={(e) => set({ imposto: e.target.value })} />
        <div className="hint">
          Percentual de imposto pago sobre o valor da venda.
          {!!p.impostoFaixas?.length && (
            <> Vigências: {[...p.impostoFaixas]
              .sort((a, b) => a.desde.localeCompare(b.desde))
              .map((f) => `${f.pct}% desde ${f.desde.split("-").reverse().join("/")}`)
              .join(" · ")}. Alterar aqui cria uma vigência a partir de hoje, sem mexer no passado.</>
          )}
        </div>
      </div>

      <div style={{ margin: "4px 0 12px", padding: "8px 12px", borderRadius: 8, background: "rgba(233,169,45,.08)", border: "1px solid rgba(233,169,45,.2)", fontSize: ".78rem", color: "var(--muted)" }}>
        <strong>Preço de venda</strong> e <strong>retorno</strong>, além de ADS e Envio Full, são puxados automaticamente do Mercado Livre — não precisa cadastrar.
      </div>

      <div className="config-field">
        <label>Status</label>
        <select
          value={p.ativo ? "ativo" : "inativo"}
          onChange={(e) => set({ ativo: e.target.value === "ativo" })}
          style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: ".9rem", outline: "none" }}
        >
          <option value="ativo">Ativo (em estoque)</option>
          <option value="inativo">Inativo (fora de estoque)</option>
        </select>
      </div>

      <div className="modal-btns">
        <button type="button" className="btn btn-success" onClick={handleSave} disabled={saving}>{saving ? "Salvando…" : "Salvar Produto"}</button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
      </div>
    </Modal>
  );
}

// ── Imposto em massa ──────────────────────────────────────────────────────
/**
 * O imposto fica no cadastro do produto e o lucro o aplica na hora de ler.
 * Ou seja, mudar aqui muda também o lucro dos meses já fechados — por isso o
 * aviso é explícito antes de gravar.
 */
// ── Vincular anúncio ao produto pelo SKU ──────────────────────────────────
/**
 * Puxa do ML o SKU de cada anúncio e sugere vincular ao produto de mesmo SKU.
 * Só sugere; a gravação acontece aqui no cliente, com a confirmação do dono,
 * porque é ele quem tem permissão de escrever no Estoque.
 */
type NovoSku = { mlb: string; titulo: string; skuAnuncio: string; exato: boolean };
type PlanoSku = {
  productId: string; name: string; sku: string;
  atuais: { mlb: string; titulo: string }[];
  novos: NovoSku[];
};
type ResumoSku = { produtos: number; anunciosDaConta: number; anunciosLidos: number; semSku: number; semMatch: number; aproximados: number; aVincular: number };

function VincularSkuModal({ uid, produtos, onClose }: { uid: string; produtos: Product[]; onClose: () => void }) {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [plano, setPlano] = useState<PlanoSku[]>([]);
  const [resumo, setResumo] = useState<ResumoSku | null>(null);
  const [aplicando, setAplicando] = useState(false);
  const [feito, setFeito] = useState(0);
  const [concluido, setConcluido] = useState(false);
  // Cada anúncio sugerido é escolhido individualmente: match aproximado pode
  // aproximar SKUs de produtos diferentes, e vincular errado bagunça o lucro.
  const [marcados, setMarcados] = useState<Set<string>>(new Set());

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await authedFetch("/api/ml/vincular-sku", { cache: "no-store" });
        const txt = await r.text();
        if (!vivo) return;
        if (!r.ok) { setErro(`HTTP ${r.status} — ${txt.slice(0, 300)}`); }
        else {
          const j = JSON.parse(txt) as { plano?: PlanoSku[]; resumo?: ResumoSku };
          const lista = j.plano ?? [];
          setPlano(lista);
          setResumo(j.resumo ?? null);
          // Exato já vem marcado; aproximado exige o seu aval.
          const iniciais = new Set<string>();
          for (const item of lista) {
            for (const n of item.novos) if (n.exato) iniciais.add(`${item.productId}|${n.mlb}`);
          }
          setMarcados(iniciais);
        }
      } catch (e) {
        if (vivo) setErro(`Falhou: ${String(e).slice(0, 200)}`);
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
  }, []);

  const alterna = (chave: string) => setMarcados((s) => {
    const novo = new Set(s);
    if (novo.has(chave)) novo.delete(chave); else novo.add(chave);
    return novo;
  });

  const totalMarcado = marcados.size;

  async function aplicar() {
    setAplicando(true);
    try {
      let n = 0;
      for (const item of plano) {
        const escolhidos = item.novos.filter((x) => marcados.has(`${item.productId}|${x.mlb}`));
        if (!escolhidos.length) continue;
        const prod = produtos.find((p) => p.id === item.productId);
        if (!prod) continue;
        // Une os anúncios atuais com os escolhidos, sem duplicar.
        const atuais = mlbsDe(prod).map(normMlb).filter(Boolean);
        const merged = Array.from(new Set([...atuais, ...escolhidos.map((x) => x.mlb)]));
        await upsertProduct(uid, { ...prod, mlbs: merged, mlb: merged[0] ?? "" });
        n += escolhidos.length;
        setFeito(n);
      }
      setConcluido(true);
    } catch (e) {
      alert("Erro ao vincular: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setAplicando(false);
    }
  }

  return (
    <Modal open onClose={onClose}>
      <div className="modal-title">Vincular anúncios por SKU</div>
      <div className="modal-sub">liga cada produto ao anúncio do ML que tem o mesmo SKU</div>

      {carregando ? (
        <div style={{ padding: "24px 0", textAlign: "center", color: "var(--muted)" }}>
          Lendo os anúncios do Mercado Livre…
        </div>
      ) : erro ? (
        <div style={{
          margin: "12px 0", padding: 10, borderRadius: 8,
          background: "rgba(214,90,74,.12)", border: "1px solid rgba(214,90,74,.4)",
          fontFamily: "ui-monospace, monospace", fontSize: ".72rem", whiteSpace: "pre-wrap",
        }}>{erro}</div>
      ) : concluido ? (
        <div style={{
          margin: "12px 0", padding: "12px 14px", borderRadius: 8,
          background: "rgba(54,179,126,.1)", border: "1px solid rgba(54,179,126,.4)",
          color: "var(--green)", fontSize: ".86rem",
        }}>
          <b>{feito} produto{feito === 1 ? "" : "s"} vinculado{feito === 1 ? "" : "s"}.</b> Os dados do ML
          já passam a bater com esses anúncios.
        </div>
      ) : (
        <>
          {resumo && (
            <div style={{
              display: "flex", flexWrap: "wrap", gap: 8, margin: "12px 0",
              fontSize: ".76rem", color: "var(--muted)",
            }}>
              <span style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 9px" }}>
                {resumo.anunciosLidos} anúncios lidos
              </span>
              <span style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 9px" }}>
                <b style={{ color: "var(--green)" }}>{resumo.aVincular}</b> vínculo(s) a criar
              </span>
              {resumo.semSku > 0 && (
                <span style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 9px" }}>
                  {resumo.semSku} produto(s) sem SKU
                </span>
              )}
              {resumo.semMatch > 0 && (
                <span style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 9px" }}>
                  {resumo.semMatch} sem anúncio de mesmo SKU
                </span>
              )}
              {resumo.aproximados > 0 && (
                <span style={{ background: "var(--warning-soft)", border: "1px solid rgba(255,138,31,.4)", borderRadius: 6, padding: "4px 9px", color: "var(--warning)" }}>
                  {resumo.aproximados} aproximado(s) — confira antes
                </span>
              )}
            </div>
          )}

          {plano.length === 0 ? (
            <div style={{ padding: "16px 0", fontSize: ".86rem", color: "var(--muted)", lineHeight: 1.6 }}>
              Nada a vincular — todo produto com SKU já está ligado ao anúncio correspondente.
              {!!resumo?.semSku && <> Os {resumo.semSku} produto(s) sem SKU precisam do código preenchido na ficha para casar.</>}
            </div>
          ) : (
            <div style={{ maxHeight: 340, overflow: "auto", margin: "4px 0 12px" }}>
              {plano.map((item) => (
                <div key={item.productId} style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                    <span style={{ fontWeight: 600, fontSize: ".86rem" }}>{item.name || "—"}</span>
                    <span style={{ fontSize: ".72rem", color: "var(--muted)", fontFamily: "monospace" }}>SKU {item.sku}</span>
                  </div>

                  {item.atuais.length > 0 && (
                    <div style={{ fontSize: ".72rem", color: "var(--muted)", marginTop: 3 }}>
                      já vinculado: {item.atuais.map((a) => a.mlb).join(", ")}
                    </div>
                  )}

                  {item.novos.map((n) => {
                    const chave = `${item.productId}|${n.mlb}`;
                    const on = marcados.has(chave);
                    return (
                      <label key={n.mlb} style={{
                        display: "flex", gap: 8, alignItems: "flex-start", marginTop: 6,
                        padding: "6px 8px", borderRadius: 6, cursor: "pointer",
                        background: on ? "rgba(54,179,126,.08)" : "var(--surface2)",
                        border: `1px solid ${on ? "rgba(54,179,126,.35)" : "var(--border)"}`,
                      }}>
                        <input
                          type="checkbox" checked={on} onChange={() => alterna(chave)}
                          style={{ marginTop: 3, flexShrink: 0 }}
                        />
                        <span style={{ minWidth: 0 }}>
                          <span style={{ fontFamily: "monospace", fontSize: ".76rem", color: "var(--text)" }}>{n.mlb}</span>
                          {!n.exato && (
                            <span style={{ marginLeft: 6, fontSize: ".64rem", fontWeight: 700, color: "var(--warning)", background: "var(--warning-soft)", padding: "1px 5px", borderRadius: 4 }}>
                              APROXIMADO
                            </span>
                          )}
                          {n.titulo && (
                            <span style={{ display: "block", fontSize: ".73rem", color: "var(--muted)" }}>{n.titulo.slice(0, 52)}</span>
                          )}
                          <span style={{ display: "block", fontSize: ".68rem", color: "var(--muted)", fontFamily: "monospace" }}>
                            SKU no ML: {n.skuAnuncio || "—"}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="modal-btns">
        {!concluido && plano.length > 0 && !erro && (
          <button type="button" className="btn btn-success" onClick={aplicar} disabled={aplicando || carregando || totalMarcado === 0}>
            {aplicando ? `Vinculando… ${feito}` : `Vincular ${totalMarcado} anúncio(s)`}
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={aplicando}>
          {concluido ? "Fechar" : "Cancelar"}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Entrada de compra em VÁRIOS produtos de uma vez.
 *
 * ─── POR QUE ESTA TELA EXISTE ───────────────────────────────────────────
 *
 * A compra real chega numa nota com vários itens. Um por um eram: abrir o
 * modal, digitar, salvar, esperar, repetir — e sem nenhuma forma de conferir
 * o total da nota antes de gravar. Aqui a nota inteira é digitada, conferida
 * e gravada de uma vez.
 *
 * ─── O QUE ESTA TELA NÃO FAZ ────────────────────────────────────────────
 *
 * Só ENTRADA (compra). Ajuste e envio pro Full continuam um a um: são
 * operações avulsas por natureza, e trazê-las pra cá daria a esta tela o
 * poder de ZERAR estoque em massa — exatamente o erro caro de se cometer
 * rápido.
 */

/**
 * Plano de reposição: quanto pedir pro estoque durar X dias.
 *
 * ─── A FOLGA NÃO É ENFEITE ──────────────────────────────────────────────
 *
 * Comprar `média × dias` faz o estoque bater ZERO exatamente no dia do
 * alvo. E média é média: metade dos dias vende acima dela, então uma semana
 * boa antecipa a ruptura. No Full isso não custa só a venda do dia — o
 * anúncio perde posição e demora pra voltar.
 *
 * Por isso a folga vem preenchida. Dá pra zerar o campo, e a tela avisa o
 * que isso significa em vez de deixar acontecer calado.
 */
function ReposicaoPanel({ produtos, estoqueML, forecast }: {
  produtos: Product[];
  estoqueML: EstoqueML;
  forecast: Forecast;
}) {
  const [dias, setDias] = useState("30");
  const [folga, setFolga] = useState("7");
  const [aberto, setAberto] = useState(false);

  const diasN = Math.max(0, Math.round(parseNum(dias) || 0));
  const folgaN = Math.max(0, Math.round(parseNum(folga) || 0));

  const paraDominio: ProdutoReposicao[] = useMemo(() => produtos.map((p) => {
    const f = previsaoDe(p, estoqueML, forecast);
    return {
      id: p.id,
      nome: p.name || p.id,
      estoqueTotal: f.total,
      emCasa: f.casa,
      mediaDiaria: f.mediaDiaria,
      custoUnitario: custoMedioDe(p),
      ativo: Boolean(p.ativo),
    };
  }), [produtos, estoqueML, forecast]);

  const plano = useMemo(
    () => montarPlanoReposicao(paraDominio, diasN, folgaN),
    [paraDominio, diasN, folgaN],
  );

  const csv = () => {
    const linhas = [
      ["Produto", "Vendas/dia", "Estoque hoje", "Dura (dias)", "Faltam (dias)", "Precisa ter", "PEDIR", "Ja em casa", "Investimento"],
      ...plano.itens.map((i) => [
        i.nome,
        i.mediaDiaria.toFixed(2).replace(".", ","),
        String(i.estoqueTotal),
        String(i.duraDias),
        String(i.faltamDias),
        String(i.necessario),
        String(i.comprar),
        String(i.jaTemEmCasa),
        i.investimento.toFixed(2).replace(".", ","),
      ]),
    ];
    const txt = linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob([`﻿${txt}`], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `pedido-${diasN}dias.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const visiveis = aberto ? plano.itens : plano.itens.slice(0, 10);

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-head">
        <span className="panel-title">
          Reposição
          <span className="panel-sub"> · o que pedir ao fornecedor hoje</span>
        </span>
        {plano.itens.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={csv}>Baixar CSV</button>
        )}
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 12 }}>
        <div className="config-field" style={{ margin: 0, maxWidth: 200 }}>
          <label>Estoque deve durar</label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input inputMode="numeric" value={dias} onChange={(e) => setDias(e.target.value)} style={{ width: 90 }} />
            <span style={{ color: "var(--muted)", fontSize: ".85rem" }}>dias</span>
          </div>
        </div>
        <div className="config-field" style={{ margin: 0, maxWidth: 230 }}>
          <label>Folga de segurança</label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input inputMode="numeric" value={folga} onChange={(e) => setFolga(e.target.value)} style={{ width: 90 }} />
            <span style={{ color: "var(--muted)", fontSize: ".85rem" }}>dias a mais</span>
          </div>
          <div className="hint">Pra não raspar o zero num dia de venda forte.</div>
        </div>
        <div style={{ fontSize: ".82rem", color: "var(--muted)", paddingTop: 26 }}>
          Pedindo para <b style={{ color: "var(--text)" }}>{plano.diasACobrir} dias</b>
          {folgaN > 0 ? ` (${diasN} + ${folgaN} de folga)` : ""}
        </div>
      </div>

      {folgaN === 0 && diasN > 0 && (
        <div className="note note-warn" style={{ marginBottom: 12 }}>
          <b>Sem folga, o estoque chega a zero exatamente no dia {diasN}.</b> Como metade dos
          dias vende acima da média, uma semana boa antecipa a ruptura — e no Full ficar sem
          estoque derruba a posição do anúncio.
        </div>
      )}

      {plano.vaoZerar.length > 0 && (
        <div className="note note-danger" style={{ marginBottom: 12 }}>
          <b>{plano.vaoZerar.length} produto(s) zeram antes dos {diasN} dias</b> com o estoque
          de hoje. Estão no topo da lista, com quantos dias faltam em cada um.
        </div>
      )}

      <div className="kpi-grid" style={{ marginBottom: 12 }}>
        <div className="kpi"><div className="k-lbl">Produtos a pedir</div><div className="k-val">{plano.itens.length}</div></div>
        <div className="kpi"><div className="k-lbl">Unidades</div><div className="k-val">{plano.totalUnidades}</div></div>
        <div className="kpi"><div className="k-lbl">Investimento</div><div className="k-val">{fmtBRL(plano.totalInvestimento)}</div></div>
        <div className={plano.vaoZerar.length ? "kpi k-neg" : "kpi k-pos"}>
          <div className="k-lbl">Zeram antes</div>
          <div className="k-val" style={{ color: plano.vaoZerar.length ? "var(--red)" : "var(--green)" }}>{plano.vaoZerar.length}</div>
        </div>
      </div>

      {plano.itens.length === 0 ? (
        <div className="empty-state">
          <span className="empty-ico">✅</span>
          Nenhum produto precisa de pedido para cobrir {plano.diasACobrir} dias.
        </div>
      ) : (
        <>
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Produto</th>
                  <th style={{ textAlign: "right" }}>Vendas/dia</th>
                  <th style={{ textAlign: "right" }}>Tenho</th>
                  <th style={{ textAlign: "right" }}>Dura</th>
                  <th style={{ textAlign: "right" }}>Faltam</th>
                  <th style={{ textAlign: "right" }}>Preciso ter</th>
                  <th style={{ textAlign: "right" }}>PEDIR</th>
                  <th style={{ textAlign: "right" }}>Investimento</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((i) => (
                  <tr key={i.produtoId}>
                    <td style={{ textAlign: "left" }}>
                      {i.vaiZerarAntes && (
                        <span
                          className="chip chip-red"
                          style={{ marginRight: 6 }}
                          title={`Dura ${i.duraDias} dia(s) e o alvo é ${diasN}. Zera antes.`}
                        >
                          zera antes
                        </span>
                      )}
                      {i.nome}
                      {i.jaTemEmCasa > 0 && (
                        <span
                          style={{ color: "var(--muted)", fontSize: ".72rem" }}
                          title="Já está no galpão: mandar pro Full resolve essa parte sem esperar o fornecedor."
                        >
                          {" "}· {i.jaTemEmCasa} un já em casa
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>{i.mediaDiaria.toFixed(1)}</td>
                    <td style={{ textAlign: "right" }}>{i.estoqueTotal} un</td>
                    <td style={{ textAlign: "right", color: i.vaiZerarAntes ? "var(--red)" : "var(--muted)" }}>
                      {i.duraDias}d
                    </td>
                    <td style={{ textAlign: "right", fontWeight: i.faltamDias > 0 ? 700 : 400, color: i.faltamDias > 0 ? "var(--red)" : "var(--muted)" }}>
                      {i.faltamDias > 0 ? `${i.faltamDias}d` : "—"}
                    </td>
                    <td style={{ textAlign: "right", color: "var(--muted)" }}>{i.necessario}</td>
                    <td style={{ textAlign: "right", fontWeight: 800 }}>{i.comprar} un</td>
                    <td style={{ textAlign: "right" }}>{fmtBRL(i.investimento)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {plano.itens.length > 10 && (
            <button
              type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }}
              onClick={() => setAberto((v) => !v)}
            >
              {aberto ? "Mostrar menos" : `Ver todos os ${plano.itens.length}`}
            </button>
          )}
        </>
      )}

      <div className="hint" style={{ marginTop: 10 }}>
        Vendas/dia vem dos últimos {forecast.dias} dias. &quot;Tenho&quot; é Full + o que está fora do Full.
        {plano.suficientes > 0 && ` ${plano.suficientes} produto(s) já cobrem o período.`}
        {plano.semHistorico > 0 && ` ${plano.semHistorico} sem venda no período ficaram de fora — sem ritmo, a projeção seria chute.`}
      </div>
    </div>
  );
}

function EntradaMassaModal({ produtos, estoqueML, onClose, onSaved }: {
  produtos: Product[];
  estoqueML: EstoqueML;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [data, setData] = useState(todayISO());
  const [obs, setObs] = useState("");
  const [busca, setBusca] = useState("");
  const [linhas, setLinhas] = useState<Record<string, { qtd: string; custo: string }>>({});
  const [salvando, setSalvando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [falhas, setFalhas] = useState<string[]>([]);

  /**
   * Os produtos no formato que o domínio entende. O estoque vem do MESMO
   * `fullDe`/`estoqueForaDoFull` que o modal individual usa — sem isso o
   * blend aqui partiria de um estoque diferente, e os dois caminhos dariam
   * custos médios distintos pra mesma compra.
   */
  const paraDominio: ProdutoParaEntrada[] = useMemo(() => produtos.map((p) => {
    const { qtd: full, proprio, ehFull } = fullDe(p, estoqueML);
    return {
      id: p.id, nome: p.name || p.id, custoMedio: custoMedioDe(p),
      full, casa: p.qtdLocal ?? 0, proprio, ehFull,
    };
  }), [produtos, estoqueML]);

  const linhasEntrada: LinhaEntrada[] = useMemo(() => Object.entries(linhas).map(([produtoId, v]) => ({
    produtoId,
    quantidade: v.qtd.trim() === "" ? null : parseNum(v.qtd),
    custoUnitario: v.custo.trim() === "" ? null : parseNum(v.custo),
  })), [linhas]);

  const resultado = useMemo(
    () => calcularEntradaMassa(paraDominio, linhasEntrada),
    [paraDominio, linhasEntrada],
  );

  const termo = busca.trim().toLowerCase();
  const visiveis = termo
    ? produtos.filter((p) => (p.name || "").toLowerCase().includes(termo) || (p.sku || "").toLowerCase().includes(termo))
    : produtos;

  const set = (id: string, campo: "qtd" | "custo", valor: string) =>
    setLinhas((s) => ({ ...s, [id]: { qtd: s[id]?.qtd ?? "", custo: s[id]?.custo ?? "", [campo]: valor } }));

  /**
   * Último custo digitado, pra repetir no próximo campo. Numa nota do mesmo
   * fornecedor o custo costuma se repetir, e redigitar é onde nasce o erro.
   */
  const ultimoCusto = useMemo(() => {
    const preenchidos = Object.values(linhas).map((v) => v.custo).filter((c) => c.trim() !== "");
    return preenchidos[preenchidos.length - 1] ?? "";
  }, [linhas]);

  async function salvar() {
    if (resultado.erros.length) { alert(resultado.erros.join("\n")); return; }
    if (!resultado.linhas.length) { alert("Preencha ao menos um produto."); return; }
    if (!obs.trim()) { alert("Informe o motivo/nota desta compra — fica no histórico de cada produto."); return; }
    if (!data) { alert("Informe a data da compra."); return; }
    if (!confirm(
      `Dar entrada em ${resultado.linhas.length} produto(s), `
      + `${resultado.unidadesTotais} unidade(s), total de ${fmtBRL(resultado.totalGeral)}?`
    )) return;

    setSalvando(true);
    setFalhas([]);
    const errosAoSalvar: string[] = [];
    let n = 0;
    /**
     * Sequencial, e não Promise.all: cada gravação recalcula o produto
     * (recomputeProduto) e invalida cache. Em paralelo, duas entradas do
     * mesmo produto poderiam ler o estoque antes de a outra gravar.
     *
     * Cada produto é independente: se um falhar, os outros seguem, e a tela
     * DIZ quais falharam — parar no primeiro erro deixaria a nota metade
     * lançada sem o usuário saber quais entraram.
     */
    for (const l of resultado.linhas) {
      try {
        await addMovimento({
          id: `${Date.now()}-${l.produtoId}-${Math.random().toString(36).slice(2, 8)}`,
          productId: l.produtoId,
          tipo: "entrada",
          quantidade: l.quantidade,
          custoUnit: l.custoUnitario,
          data,
          obs: obs.trim(),
        }, l.custoMedioNovo);
      } catch (e) {
        errosAoSalvar.push(`${l.nome}: ${e instanceof Error ? e.message : String(e)}`);
      }
      setProgresso(++n);
    }
    setSalvando(false);
    if (errosAoSalvar.length) { setFalhas(errosAoSalvar); return; }
    onSaved();
  }

  return (
    <Modal open onClose={salvando ? () => {} : onClose}>
      <div className="modal-head">
        <h3>Entrada em massa (compra)</h3>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={salvando}>Fechar</button>
      </div>

      <div className="form-grid" style={{ marginBottom: 10 }}>
        <div className="config-field" style={{ margin: 0 }}>
          <label>Data da compra</label>
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} disabled={salvando} />
          <div className="hint">Vale pra todas as linhas. O custo novo passa a valer desta data em diante.</div>
        </div>
        <div className="config-field" style={{ margin: 0 }}>
          <label>Nota / motivo</label>
          <input
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            placeholder="Ex.: NF 1234 - Fornecedor X"
            disabled={salvando}
          />
          <div className="hint">Fica no histórico de cada produto lançado.</div>
        </div>
      </div>

      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Filtrar produto por nome ou SKU..."
        style={{ width: "100%", marginBottom: 8 }}
        disabled={salvando}
      />

      <div style={{ maxHeight: "42vh", overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
        <table className="table" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Produto</th>
              <th style={{ width: 78 }}>Qtd</th>
              <th style={{ width: 104 }}>Custo un.</th>
              <th style={{ width: 92, textAlign: "right" }}>Total</th>
              <th style={{ width: 132, textAlign: "right" }}>Custo médio</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((p) => {
              const l = linhas[p.id] ?? { qtd: "", custo: "" };
              const calc = resultado.linhas.find((c) => c.produtoId === p.id);
              return (
                <tr key={p.id}>
                  <td style={{ textAlign: "left" }}>
                    {p.name || p.id}
                    {p.sku && <span style={{ color: "var(--muted)", fontSize: ".72rem" }}> · {p.sku}</span>}
                  </td>
                  <td>
                    <input
                      inputMode="decimal" value={l.qtd} disabled={salvando}
                      onChange={(e) => set(p.id, "qtd", e.target.value)}
                      style={{ width: "100%" }} placeholder="—"
                    />
                  </td>
                  <td>
                    <input
                      inputMode="decimal" value={l.custo} disabled={salvando}
                      onChange={(e) => set(p.id, "custo", e.target.value)}
                      onFocus={() => { if (!l.custo && ultimoCusto) set(p.id, "custo", ultimoCusto); }}
                      style={{ width: "100%" }} placeholder="—"
                    />
                  </td>
                  <td style={{ textAlign: "right" }}>{calc ? fmtBRL(calc.total) : "—"}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {calc ? (
                      <span style={{ color: calc.encarece ? "var(--yellow)" : "var(--muted)" }}>
                        {fmtBRL(calc.custoMedioAtual)} → <b>{fmtBRL(calc.custoMedioNovo)}</b>
                        {calc.encarece && (
                          <span title="Esta compra sobe o custo médio — a margem de todas as vendas futuras cai."> ▲</span>
                        )}
                      </span>
                    ) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {resultado.erros.length > 0 && (
        <div className="hint" style={{ color: "var(--red)", marginTop: 8 }}>
          {resultado.erros.map((e) => <div key={e}>• {e}</div>)}
        </div>
      )}
      {falhas.length > 0 && (
        <div className="hint" style={{ color: "var(--red)", marginTop: 8 }}>
          <b>Estes NÃO foram lançados (os demais entraram):</b>
          {falhas.map((e) => <div key={e}>• {e}</div>)}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: ".84rem" }}>
          <b>{resultado.linhas.length}</b> produto(s) · <b>{resultado.unidadesTotais}</b> un ·{" "}
          total <b style={{ color: "var(--text)" }}>{fmtBRL(resultado.totalGeral)}</b>
        </div>
        <button
          type="button" className="btn btn-primary"
          onClick={salvar}
          disabled={salvando || resultado.erros.length > 0 || resultado.linhas.length === 0}
        >
          {salvando ? `Lançando ${progresso}/${resultado.linhas.length}...` : "Lançar entradas"}
        </button>
      </div>
    </Modal>
  );
}

function ImpostoMassaModal({ uid, produtos, escopoBusca, onClose }: {
  uid: string; produtos: Product[]; escopoBusca: string; onClose: () => void;
}) {
  const [valor, setValor] = useState("4");
  const [desde, setDesde] = useState(todayISO());
  const [salvando, setSalvando] = useState(false);
  const [feito, setFeito] = useState(0);
  // Todos marcados de início: o caso comum é aplicar em tudo, e desmarcar é
  // mais rápido do que marcar produto por produto.
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set(produtos.map((p) => p.id)));

  const pct = parseNum(valor);
  const alvos = produtos.filter((p) => marcados.has(p.id));
  const jaTem = alvos.filter((p) => parseNum(p.imposto ?? "0") > 0);

  const alterna = (id: string) => setMarcados((s) => {
    const novo = new Set(s);
    if (novo.has(id)) novo.delete(id); else novo.add(id);
    return novo;
  });

  async function aplicar() {
    if (!Number.isFinite(pct) || pct < 0) { alert("Informe um percentual válido."); return; }
    if (!desde) { alert("Informe a data de início."); return; }
    if (!alvos.length) { alert("Selecione ao menos um produto."); return; }
    setSalvando(true);
    try {
      let n = 0;
      for (const p of alvos) {
        /**
         * Substitui a faixa da mesma data e mantém as demais: assim dá pra
         * corrigir a alíquota sem perder o histórico de vigências.
         */
        const faixas = (p.impostoFaixas ?? []).filter((f) => f.desde !== desde);
        faixas.push({ desde, pct });
        faixas.sort((a, b) => a.desde.localeCompare(b.desde));
        await upsertProduct(uid, {
          ...p,
          impostoFaixas: faixas,
          // `imposto` segue como a alíquota vigente hoje (compat e exibição).
          imposto: String(impostoNaData({ imposto: p.imposto, impostoFaixas: faixas }, todayISO())),
        });
        n += 1;
        setFeito(n);
      }
      onClose();
    } catch (e) {
      alert("Erro ao aplicar imposto: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal open onClose={onClose}>
      <div className="modal-title">Imposto em massa</div>
      <div className="modal-sub">aplica o mesmo percentual em vários produtos de uma vez</div>

      <div className="config-field">
        <label>Imposto (%)</label>
        <input
          type="number" min="0" step="0.01" value={valor}
          onChange={(e) => setValor(e.target.value)}
          style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 16, outline: "none" }}
        />
      </div>

      <div className="config-field">
        <label>Vale a partir de</label>
        <input
          type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
          style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 16, outline: "none" }}
        />
      </div>

      <div className="config-field" style={{ marginTop: 4 }}>
        <label style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
          <span>Produtos ({alvos.length} de {produtos.length})</span>
          <span style={{ display: "flex", gap: 8 }}>
            <button
              type="button" className="btn btn-ghost btn-xs"
              onClick={() => setMarcados(new Set(produtos.map((p) => p.id)))}
            >
              todos
            </button>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setMarcados(new Set())}>
              nenhum
            </button>
          </span>
        </label>
        <div style={{
          maxHeight: 220, overflow: "auto", borderRadius: 8,
          border: "1px solid var(--border)", background: "var(--surface2)", padding: 6,
        }}>
          {produtos.map((p) => {
            const on = marcados.has(p.id);
            const atual = parseNum(p.imposto ?? "0");
            return (
              <label key={p.id} style={{
                display: "flex", gap: 8, alignItems: "center", padding: "6px 8px",
                borderRadius: 6, cursor: "pointer", background: on ? "rgba(233,169,45,.1)" : undefined,
              }}>
                <input type="checkbox" checked={on} onChange={() => alterna(p.id)} style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: ".84rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.name || "Sem nome"}
                </span>
                <span style={{ fontSize: ".74rem", color: atual > 0 ? "#F4B942" : "var(--muted)", whiteSpace: "nowrap" }}>
                  {atual > 0 ? `hoje ${atual}%` : "sem imposto"}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <div style={{
        marginTop: 12, padding: "10px 12px", borderRadius: 8, fontSize: ".82rem", lineHeight: 1.55,
        background: "var(--surface2)", border: "1px solid var(--border)",
      }}>
        Vai aplicar <b>{pct}%</b> em <b>{alvos.length} produto{alvos.length === 1 ? "" : "s"}</b>
        {escopoBusca ? <> — a lista mostra só os da busca “{escopoBusca}”.</> : <>.</>}
        {jaTem.length > 0 && (
          <div style={{ marginTop: 6, color: "var(--warning)" }}>
            {jaTem.length === 1
              ? "1 deles já tem imposto e será sobrescrito."
              : `${jaTem.length} deles já têm imposto e serão sobrescritos.`}
          </div>
        )}
      </div>

      <div style={{
        marginTop: 10, padding: "10px 12px", borderRadius: 8, fontSize: ".82rem", lineHeight: 1.55,
        background: "rgba(54,179,126,.1)", border: "1px solid rgba(54,179,126,.35)", color: "var(--green)",
      }}>
        Vendas <b>antes de {desde.split("-").reverse().join("/")}</b> continuam sem esse imposto —
        o lucro dos meses já fechados não muda.
      </div>

      <div className="modal-btns">
        <button type="button" className="btn btn-success" onClick={aplicar} disabled={salvando || alvos.length === 0}>
          {salvando ? `Aplicando… ${feito}/${alvos.length}` : `Aplicar em ${alvos.length}`}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={salvando}>Cancelar</button>
      </div>
    </Modal>
  );
}

/**
 * Vinculação automática produto → anúncio por SKU.
 *
 * A rota /api/ml/vincular-sku já separava casamento EXATO de APROXIMADO — o
 * exato já vinha pré-marcado no modal, e a única coisa que faltava era
 * alguém abrir a tela e confirmar. Isso significava que produto novo ficava
 * sem anúncio por dias sem ninguém perceber, e venda de produto sem vínculo
 * entra no lucro com CMV zero (infla a margem).
 *
 * Agora o exato é aplicado sozinho. O APROXIMADO continua exigindo aval no
 * modal, de propósito: ele casa SKU depois de remover acento, prefixo e
 * separador, então pode aproximar produtos que na verdade são distintos —
 * vincular errado bagunça o lucro dos dois lados.
 *
 * Roda uma vez por montagem da aba e só quando há produto sem anúncio: a rota
 * lê TODOS os anúncios da conta, e não vale pagar isso a cada render.
 */
function AutoVincularSku({ uid, produtos }: { uid: string; produtos: Product[] }) {
  const [resultado, setResultado] = useState<{ produtos: number; anuncios: number } | null>(null);
  const jaRodou = useRef(false);

  const temPendente = produtos.some((p) => p.ativo && mlbsDe(p).filter(Boolean).length === 0);

  useEffect(() => {
    if (!temPendente || jaRodou.current) return;
    jaRodou.current = true;

    (async () => {
      try {
        const r = await authedFetch("/api/ml/vincular-sku", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { plano?: PlanoSku[] };
        let nProdutos = 0;
        let nAnuncios = 0;

        for (const item of j.plano ?? []) {
          // SÓ os exatos. O aproximado é decisão de quem confere.
          const exatos = item.novos.filter((n) => n.exato);
          if (!exatos.length) continue;
          const prod = produtos.find((p) => p.id === item.productId);
          if (!prod) continue;
          const atuais = mlbsDe(prod).map(normMlb).filter(Boolean);
          const merged = Array.from(new Set([...atuais, ...exatos.map((n) => n.mlb)]));
          // Nada novo de fato: não escreve à toa (cada escrita conta na cota).
          if (merged.length === atuais.length) continue;
          await upsertProduct(uid, { ...prod, mlbs: merged, mlb: merged[0] ?? "" });
          nProdutos += 1;
          nAnuncios += exatos.length;
        }

        if (nProdutos > 0) setResultado({ produtos: nProdutos, anuncios: nAnuncios });
      } catch {
        // Silencioso: é um extra em cima do botão manual, que continua ali.
      }
    })();
  }, [temPendente, produtos, uid]);

  if (!resultado) return null;
  return (
    <div className="note note-accent">
      <b>{resultado.anuncios} anúncio(s) vinculado(s) automaticamente</b> em {resultado.produtos} produto(s),
      por SKU idêntico. Casamento aproximado (acento/prefixo diferente) continua exigindo sua conferência —
      use <b>Vincular por SKU</b> pra revisar.
    </div>
  );
}
