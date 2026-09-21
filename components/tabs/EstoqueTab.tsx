"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { explicarFonte } from "@/lib/domain/estado-fonte";
import { CUSTO_FAIXA_SENTINELA, custoNaData, impostoNaData, TIPO_MOVIMENTO_LABEL, type EstoqueMovimento, type MovimentoTipo, type Product } from "@/lib/domain/types";
import { mensagemDeErroDeSalvamento, salvarSemPerder } from "@/lib/domain/salvar-formulario";
import { motivoDaListaVazia } from "@/lib/domain/estoque-vazio";
import { useFormularioSujo } from "@/components/useFormularioSujo";
import { addMovimento, deleteMovimento, deleteProduct, logAudit, upsertProduct, watchMovimentos, watchRemessasIgnoradas, recalcularProduto } from "@/lib/firebase/data";
import { unidadesPendentesPorProduto, type Remessa } from "@/lib/domain/remessas";
import { fmtBRL, fmtPct } from "@/lib/domain/calc";
import { getCoverageStatus, COVERAGE_STATUS_LABEL, ehFullLogistic, estoqueForaDoFull, type CoverageStatus } from "@/lib/domain/estoque";
import { custoMedioAposEntrada } from "@/lib/domain/entrada-massa";
import { fimDaSemanaQueVem, mediaDiariaAjustada, montarPlanoReposicao, planoEnvioAteData, planoEnvioParaFull, situacaoDoEstoque } from "@/lib/domain/reposicao";
import Modal from "@/components/Modal";
import EditarMovimentoModal from "@/components/tabs/estoque/EditarMovimentoModal";
import type { UserData } from "@/components/useUserData";
import { authedFetch } from "@/lib/api/authed-fetch";
import { useAccess } from "@/components/tabs/AccessGuard";
import { gravarChaveApp, lerChaveApp } from "@/lib/storage";
import { composicaoDoEstoque } from "@/lib/domain/full-indisponivel";
import TelaHeader from "@/components/TelaHeader";
import { resumirEstadoDaTela } from "@/lib/domain/estado-da-tela";
import Paginacao from "@/components/Paginacao";
import { paginar } from "@/lib/domain/paginacao";
import EntradaMassaModal from "@/components/tabs/estoque/EntradaMassaModal";
import ImpostoMassaModal from "@/components/tabs/estoque/ImpostoMassaModal";
import VincularSkuModal from "@/components/tabs/estoque/VincularSkuModal";
import { DIAS_ALVO, hojeBR, todayISO, parseNum, mlbsDe, normMlb, custoMedioDe, anunciosDe, fullDe, precosDe, previsaoDe, coberturaFmt } from "@/components/tabs/estoque/estoque-compartilhado";
import type { EstoqueML, Forecast, PlanoSku } from "@/components/tabs/estoque/estoque-compartilhado";
import { filtrarProdutos, precisaDeAcao, proximaAcao, ordenarPorUrgencia, contarSinais, resumoDoEstoque, ROTULO_SINAL, FILTRO_ESTOQUE_VAZIO, type FiltroEstoque, type ProdutoNaLista, type SinalDoProduto, DIAS_COBERTURA_BAIXA } from "@/lib/domain/estoque-situacao";
import DetalheProduto from "@/components/tabs/estoque/DetalheProduto";



function newId() {
  return "p" + Date.now() + Math.random().toString(36).slice(2, 6);
}
function newMovId() {
  return "mov" + Date.now() + Math.random().toString(36).slice(2, 6);
}





/** Unidades retidas no Full por produto, como a rota de gestão devolve. */
type RetencaoPorProduto = {
  productId: string;
  disponivel: number;
  indisponivel: number;
  porStatus: { status: string; qtd: number }[];
};



// Full considerado "baixo" sugere reabastecer com o estoque de casa.
const FULL_BAIXO = 5;




export default function EstoqueTab({ uid, data }: { uid: string; data: UserData }) {
  const { canEditTab } = useAccess();
  const canEdit = canEditTab("estoque");
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [search, setSearch] = useState("");
  const [estoqueML, setEstoqueML] = useState<EstoqueML>({});
  const [retencao, setRetencao] = useState<RetencaoPorProduto[]>([]);
  /**
   * O detalhe CHEGOU? Lista vazia é ambígua: pode ser 'nada retido' ou
   * 'a consulta falhou'. A primeira permite afirmar o plano; a segunda não,
   * e mostrar as duas igual é o mesmo erro de sempre — ausência de dado
   * desenhada como zero.
   */
  const [retencaoVeio, setRetencaoVeio] = useState(false);
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

  /** A vista: o recorte da lista. O padrão é a pergunta que se faz ao abrir. */
  const [vista, setVista] = useState<"acao" | "todos" | "movimentos">("acao");
  /** Página da vista de movimentações. Volta pra 1 quando a busca muda. */
  const [paginaMov, setPaginaMov] = useState(1);
  const [filtroEstoque, setFiltroEstoque] = useState<FiltroEstoque>(FILTRO_ESTOQUE_VAZIO);
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
      if (rFull?.ok) {
        const j = await rFull.json();
        setRemessas(j.remessas ?? []);
        /**
         * ─── ISTO JÁ VINHA NA RESPOSTA E ERA JOGADO FORA ─────────────────
         *
         * A rota consulta /inventories/{id}/stock/fulfillment e devolve, por
         * produto, quantas unidades estão retidas e por quê. A aba lia só as
         * remessas e descartava o resto.
         *
         * Sem esse detalhe, `available_quantity` — o número que a aba chama
         * de Full — era tratado como se fosse o estoque físico. São coisas
         * diferentes, e os dois erros que isso produz andam em direções
         * opostas: unidade em transferência entre centros já foi paga e volta
         * a vender (contá-la de fora faz COMPRAR DUAS VEZES); unidade avariada
         * está lá e não vende nunca (contá-la dentro faz FALTAR PRODUTO).
         */
        const ef = j.estoqueFull as { porProduto?: RetencaoPorProduto[] } | undefined;
        setRetencao(ef?.porProduto ?? []);
        setRetencaoVeio(!!ef);
      }
    } catch { /* ignora */ } finally { setLoadingML(false); }
  }, []);

  useEffect(() => {
    // Dentro de um callback async: chamar direto no corpo do efeito faz a
    // regra tratar a função inteira como síncrona, mesmo com todo o setState
    // depois de um `await`.
    void (async () => { await carregarEstoque(); })();
  }, [carregarEstoque]);
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

  /**
   * ─── O QUE CADA PRODUTO PRECISA, EM VEZ DE TUDO QUE SE SABE DELE ─────
   *
   * A lista mostrava oito colunas de fato — em casa, Full, total, custo,
   * preço, imposto — e deixava a conclusão pra pessoa. Com quarenta
   * produtos, "qual deles precisa de mim hoje?" virava ler quarenta linhas
   * e cruzar seis colunas de cabeça.
   *
   * `estoque-situacao` responde isso, com teste: quais SINAIS cada produto
   * carrega e qual é a PRÓXIMA AÇÃO — uma só, por ordem de urgência.
   *
   * A ordem é a parte que decide: ruptura COM estoque em casa vem antes de
   * ruptura sem, porque a primeira se resolve hoje com uma coleta e sem
   * gastar nada. É a que a pessoa consegue resolver agora.
   */
  const paraSituacao = useMemo<ProdutoNaLista[]>(() => data.products.map((p) => {
    const f = fullDe(p, estoqueML);
    const emCasa = estoqueForaDoFull(Math.max(p.qtdLocal ?? 0, 0), f.proprio, f.ehFull);
    const duplicadas = duplicadasPorProduto.get(p.id) ?? 0;
    return {
      id: p.id,
      nome: p.name || p.id,
      // O mesmo total que a linha mostra, menos o que está contado duas
      // vezes: um sinal calculado sobre número inflado aponta pro produto
      // errado.
      estoqueTotal: Math.max(f.qtd + emCasa - duplicadas, 0),
      emCasa: Math.max(emCasa - duplicadas, 0),
      noFull: f.qtd,
      ehFull: f.ehFull,
      mediaDiaria: mediaDiariaAjustada(
        forecast.vendas[p.id] ?? 0, forecast.dias, forecast.diasAtivos?.[p.id],
      ),
      custoUnitario: custoMedioDe(p),
      ativo: Boolean(p.ativo),
      anuncios: mlbsDe(p).filter(Boolean).length,
      duplicadas,
      // O saldo do livro COMO ESTÁ, sem grampo: negativo e informação, e é o
      // que faz o sinal de inconsistência disparar.
      saldoDoLivro: Number(p.qtdLocal ?? 0),
    };
  }), [data.products, estoqueML, forecast, duplicadasPorProduto]);

  const porId = useMemo(() => new Map(paraSituacao.map((x) => [x.id, x])), [paraSituacao]);


  const sinaisContados = useMemo(() => contarSinais(paraSituacao), [paraSituacao]);
  const resumoSituacao = useMemo(() => resumoDoEstoque(paraSituacao), [paraSituacao]);

  /**
   * O estado dos dados, pro selo do cabeçalho.
   *
   * `produtos` é essencial; o estoque do ML é secundário — sem ele a aba
   * mostra o cadastro e o livro do galpão, que continua servindo. Por isso
   * uma falha nele vira RESSALVA e não erro: dizer "não carregou" numa tela
   * que está mostrando metade do que sabe é alarme falso.
   */
  const estadoDaTela = useMemo(() => resumirEstadoDaTela({
    fontes: { produtos: data.fontes.produtos },
    essenciais: ["produtos"],
    pendencias: [
      ...(duplicadasPorProduto.size > 0 ? [{
        chave: "estoque-duplicado",
        titulo: `${duplicadasPorProduto.size} produto(s) com unidades contadas duas vezes`,
        detalhe: "Remessa que chegou no Full sem a baixa do galpão lançada — o total aparece maior que o real.",
        efeito: "indefinido" as const,
      }] : []),
      ...(sinaisContados.sem_custo > 0 ? [{
        chave: "sem-custo",
        titulo: `${sinaisContados.sem_custo} produto(s) sem custo cadastrado`,
        detalhe: "O capital em estoque está subestimado por eles, e o lucro das vendas deles aparece inteiro.",
        efeito: "otimista" as const,
      }] : []),
    ],
  }), [data.fontes.produtos, duplicadasPorProduto, sinaisContados]);

  /**
   * A lista visível: a vista escolhe o RECORTE, o filtro afina dentro dele.
   *
   * "Precisa de ação" não é mais um filtro entre outros — é a vista padrão,
   * porque é a pergunta que se faz ao abrir esta aba. A lista completa
   * continua a um clique.
   */
  /**
   * ─── QUANTAS LINHAS DESENHAR ─────────────────────────────────────────────────
   *
   * A lista desenhava TODOS os produtos: com 500, medido em build de desenvolvimento,
   * eram ~21 mil nós de DOM, ~680 ms pra trocar de vista e ~200 ms por tecla na busca.
   * Agora mostra 60 e o resto vem por "Mostrar mais" — paginação e não virtualização,
   * porque aqui se procura um produto e se volta pra ele (uma lista virtual perde o
   * lugar e a busca do navegador). O limite volta pra 60 quando busca, filtro ou vista
   * mudam: é derivado da chave abaixo, sem efeito que espelhe estado.
   */
  const chaveDaLista = `${vista}|${search}|${JSON.stringify(filtroEstoque)}`;
  const [pagina, setPagina] = useState({ chave: "", limite: LINHAS_POR_PAGINA });
  const limiteDeLinhas = pagina.chave === chaveDaLista ? pagina.limite : LINHAS_POR_PAGINA;

  const filtered = useMemo(() => {
    const alvo = { ...filtroEstoque, busca: search };
    let ids = filtrarProdutos(paraSituacao, alvo);
    if (vista === "acao") ids = ids.filter(precisaDeAcao);
    ids = ordenarPorUrgencia(ids);

    // Volta pros Product originais, na ordem que a urgência definiu.
    const mapa = new Map(data.products.map((p) => [p.id, p]));
    return ids.map((x) => mapa.get(x.id)).filter((p): p is Product => !!p);
  }, [paraSituacao, data.products, filtroEstoque, search, vista]);

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
  /**
   * O valor parado agora vem de `resumoDoEstoque` (estoque-situacao).
   *
   * A conta daqui somava Full + fora do Full sem descontar a unidade CONTADA
   * DUAS VEZES — a que já chegou no centro e cujo livro do galpão ninguém
   * baixou. A aba avisava dessa duplicação num aviso amarelo no topo e
   * mostrava o capital inflado por ela logo abaixo, no cartão.
   *
   * A definição compartilhada desconta, e ainda diz quantos produtos estão
   * sem custo — porque sem isso o valor parece fechado quando pode faltar
   * metade dele.
   */
  // Produto ativo sem nenhum MLB ligado: a venda dele nunca casa com o
  // cadastro, então entra no lucro com CMV zero (ver metrics/route.ts).
  const semAnuncio = data.products.filter((p) => p.ativo && mlbsDe(p).filter(Boolean).length === 0);
  // Produtos NO FULL com estoque baixo E unidades em casa pra reabastecer.
  const reabastecer = data.products.filter((p) => {
    const f = fullDe(p, estoqueML);
    return f.ehFull && f.qtd <= FULL_BAIXO && (p.qtdLocal ?? 0) > 0;
  });
  // "Venda potencial" saiu do resumo: estoque × preço só vira receita se tudo
  // vender, e o cartão ficava ao lado de números que são fatos. O brief pede
  // quatro indicadores, e esse não é um deles.

  // O resumo de cobertura e o contador de "precisam de atenção" saíram daqui:
  // `resumoDoEstoque` responde o mesmo com uma definição só, e a antiga tinha
  // uma ressalva difícil (ruptura ficava FORA da soma pra não contar o mesmo
  // produto duas vezes) que existia só porque as faixas se sobrepunham.

  function onAdd() {
    setEditProduct({ id: newId(), name: "", custo: "", sku: "", imposto: "", mlbs: [""], ativo: true });
  }

  /**
   * Produtos cujo agregado ficou ATRÁS do livro.
   *
   * Acontece quando a gravação do movimento dá certo e o recálculo do produto
   * não — duas escritas, e a segunda pode falhar. Antes isso ficava invisível,
   * e um custo médio desatualizado vira CMV errado em toda venda do produto.
   *
   * O conserto é rodar o recálculo de novo: ele reexecuta o livro inteiro.
   */
  const [recalculando, setRecalculando] = useState(false);
  const desatualizados = data.products.filter((p) => p.custoDesatualizado === true);

  async function recalcularPendentes() {
    setRecalculando(true);
    try {
      for (const p of desatualizados) await recalcularProduto(p.id);
    } catch { /* o que não curou continua marcado — nada se perde */ }
    finally { setRecalculando(false); }
  }

  return (
    <div className="dash">
      {desatualizados.length > 0 && (
        <div className="note note-accent" style={{ marginBottom: 12, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: ".82rem" }}>
            <b>{desatualizados.length}</b> produto(s) com custo médio atrás do histórico —
            o lançamento entrou mas o recálculo não terminou. Enquanto isso, a margem desses produtos sai errada.
          </span>
          {canEdit && (
            <button type="button" className="btn btn-sm btn-primary" onClick={recalcularPendentes} disabled={recalculando}>
              {recalculando ? "Recalculando…" : "Recalcular agora"}
            </button>
          )}
        </div>
      )}

      {/* Header */}
      {/*
        Quatro botões na mesma altura e com o mesmo peso não são quatro ações,
        são nenhuma: a pessoa lia os quatro toda vez pra achar o que queria.
        Agora é uma principal e as outras atrás do ⋯ — e o botão de recarregar,
        que é controle e não ação, virou `extra`.
      */}
      <TelaHeader
        titulo="Estoque"
        subtitulo={`${ativos} de ${total} ativo(s)`}
        estado={estadoDaTela}
        extra={(
          <button
            type="button" className="btn btn-sm btn-ghost"
            onClick={carregarEstoque} disabled={loadingML}
            title="Rebusca estoque e vendas no Mercado Livre"
          >
            {loadingML ? "Atualizando…" : "⟳ Atualizar"}
          </button>
        )}
        acao={canEdit ? { rotulo: "＋ Novo Produto", onClick: onAdd } : null}
        secundarias={canEdit ? [
          { rotulo: "Vincular por SKU", onClick: () => setVincularSku(true) },
          { rotulo: "Imposto em massa", onClick: () => setImpostoMassa(true) },
          { rotulo: "＋ Entrada em massa", onClick: () => setEntradaMassa(true) },
        ] : []}
      />

      {/*
        Resumo — 5 cartões em vez dos 10 de antes. Eram tantos que nenhum se
        destacava: quatro deles ("Em ruptura", "Cobertura crítica", "Cobertura
        baixa", "Capital parado") são o MESMO assunto (produto que precisa de
        ação) fatiado, e "Em casa"/"No Full" são as duas metades do estoque que
        o cartão de valor já resume. Agora cada cartão responde uma pergunta
        distinta, e o detalhe das faixas fica no `k-sub`, sem perder informação.
      */}
      <div className="kpi-grid">
        {/*
          ─── OS QUATRO NÚMEROS DO RESUMO ──────────────────────────────────

          Eram cinco cartões, e o quinto — Precisam de atenção — espremia
          CINCO números numa linha de subtítulo: ruptura, crítico, repor,
          parado e valor em risco. Cinco números numa linha não são cinco
          números, são um parágrafo que ninguém lê.

          Agora cada cartão responde uma pergunta, e ruptura e cobertura
          baixa ficam separadas porque pedem AÇÕES diferentes: ruptura já
          está perdendo venda, cobertura baixa ainda dá tempo de repor.
        */}
        <div className={resumoSituacao.ruptura > 0 ? "kpi k-neg" : "kpi k-pos"}>
          <div className="k-lbl">Em ruptura</div>
          <div className="k-val" style={{ color: resumoSituacao.ruptura > 0 ? "var(--red)" : "var(--green)" }}>
            {resumoSituacao.ruptura}
          </div>
          <div className="k-sub">
            {resumoSituacao.ruptura === 0
              ? "nenhum produto sem estoque"
              : "sem estoque — o anúncio perde posição a cada hora"}
          </div>
        </div>

        <div className={resumoSituacao.coberturaBaixa > 0 ? "kpi k-warn" : "kpi k-pos"}>
          <div className="k-lbl">Cobertura baixa</div>
          <div className="k-val" style={{ color: resumoSituacao.coberturaBaixa > 0 ? "var(--yellow)" : "var(--green)" }}>
            {resumoSituacao.coberturaBaixa}
          </div>
          <div className="k-sub">duram menos de {DIAS_COBERTURA_BAIXA} dias — ainda dá tempo de repor</div>
        </div>

        <div className="kpi k-pos">
          <div className="k-lbl">Capital em estoque</div>
          <div className="k-val" style={{ color: "var(--green)" }}>{fmtBRL(resumoSituacao.capitalEmEstoque)}</div>
          {/*
            O número de produtos sem custo vem JUNTO, não num aviso separado:
            sem ele, "R$ 32 mil em estoque" parece um fato fechado quando
            pode faltar metade. A ressalva tem que estar ao lado do número
            que ela ressalva.
          */}
          <div className="k-sub">
            {resumoSituacao.semCusto > 0
              ? <>(casa + Full) × custo médio · <b style={{ color: "var(--yellow)" }}>subestimado</b>: {resumoSituacao.semCusto} sem custo</>
              : <>{unCasa} em casa · {unFull} no Full, ao custo médio</>}
          </div>
        </div>

        <div className={resumoSituacao.remessasPendentes > 0 ? "kpi k-warn" : "kpi k-acc"}>
          <div className="k-lbl">Remessas pendentes</div>
          <div className="k-val" style={{ color: resumoSituacao.remessasPendentes > 0 ? "var(--yellow)" : "var(--muted)" }}>
            {resumoSituacao.remessasPendentes}
          </div>
          <div className="k-sub">
            {resumoSituacao.remessasPendentes === 0
              ? "nenhuma baixa em aberto"
              : "chegaram no Full e a saída do galpão não foi lançada"}
          </div>
        </div>
      </div>

      {/* Antes da lista de produtos: e decisao de COMPRA, e vem antes de
          qualquer ajuste fino de cadastro. */}
      <ReposicaoPanel produtos={data.products} estoqueML={estoqueML} forecast={forecast} retencao={retencao} retencaoVeio={retencaoVeio} />

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

      {/*
        ─── VISTAS E FILTROS ───────────────────────────────────────────────

        Havia uma caixa de busca solta e mais nada. Os problemas do estoque —
        ruptura, cobertura baixa, produto sem custo, produto sem vínculo,
        unidade contada duas vezes — só apareciam como avisos soltos no topo,
        cada um com a sua lista de nomes em texto corrido. Ver os produtos em
        si exigia procurar cada nome na tabela abaixo.

        A vista define o recorte; os sinais afinam dentro dele. Cada sinal
        mostra QUANTOS produtos carrega: filtro sem contador obriga a clicar
        pra descobrir que não tem nada ali.
      */}
      <div className="panel" style={{ padding: "10px 12px" }}>
        <div className="seg" style={{ marginBottom: 10 }}>
          <button
            type="button" className={`seg-btn ${vista === "acao" ? "active" : ""}`}
            onClick={() => setVista("acao")}
          >
            Precisa de ação ({paraSituacao.filter(precisaDeAcao).length})
          </button>
          <button
            type="button" className={`seg-btn ${vista === "todos" ? "active" : ""}`}
            onClick={() => setVista("todos")}
          >
            Todos os produtos ({ativos})
          </button>
          {/*
            A terceira vista. Movimentação de estoque só existia DENTRO da
            linha expandida de cada produto — pra ver o que entrou na semana
            passada era preciso abrir produto por produto e lembrar o que
            tinha visto em cada um.
          */}
          <button
            type="button" className={`seg-btn ${vista === "movimentos" ? "active" : ""}`}
            onClick={() => setVista("movimentos")}
          >
            Movimentações ({movimentos.length})
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            className="search-inp" type="search" style={{ flex: "1 1 240px", margin: 0 }}
            placeholder="Buscar por nome, SKU ou código MLB…" value={search}
            onChange={(e) => setSearch(e.target.value)} aria-label="Buscar produto"
          />

          <label
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: ".8rem", color: "var(--muted)" }}
          >
            Logística
            <select
              value={filtroEstoque.logistica ?? ""}
              onChange={(e) => setFiltroEstoque((f) => ({
                ...f, logistica: (e.target.value || null) as FiltroEstoque["logistica"],
              }))}
              aria-label="Filtrar por logística"
            >
              <option value="">Full e próprio</option>
              <option value="full">Só Full</option>
              <option value="proprio">Só próprio</option>
            </select>
          </label>

          <label
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: ".8rem", color: "var(--muted)" }}
          >
            <input
              type="checkbox" checked={filtroEstoque.incluirInativos}
              onChange={(e) => setFiltroEstoque((f) => ({ ...f, incluirInativos: e.target.checked }))}
            />
            Incluir inativos
          </label>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
          {(Object.keys(ROTULO_SINAL) as SinalDoProduto[]).map((sinal) => {
            const n = sinaisContados[sinal];
            const on = filtroEstoque.sinais.includes(sinal);
            return (
              <button
                key={sinal}
                type="button"
                className={`chip chip-btn${on ? " is-on" : ""}`}
                aria-pressed={on}
                // Sinal sem nenhum produto fica desabilitado em vez de sumir:
                // um filtro que aparece e desaparece conforme os dados muda de
                // lugar entre uma visita e outra.
                disabled={n === 0 && !on}
                onClick={() => setFiltroEstoque((f) => ({
                  ...f,
                  sinais: f.sinais.includes(sinal)
                    ? f.sinais.filter((x) => x !== sinal)
                    : [...f.sinais, sinal],
                }))}
              >
                {ROTULO_SINAL[sinal]} ({n})
              </button>
            );
          })}

          {(filtroEstoque.sinais.length > 0 || filtroEstoque.logistica || filtroEstoque.incluirInativos) && (
            <button
              type="button" className="btn btn-ghost btn-xs"
              onClick={() => setFiltroEstoque(FILTRO_ESTOQUE_VAZIO)}
            >
              Limpar filtros
            </button>
          )}
        </div>
      </div>

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

      {/*
        ─── MOVIMENTAÇÕES ──────────────────────────────────────────────────

        Paginada porque a lista cresce pra sempre: cada entrada, ajuste e
        envio pro Full vira uma linha, e nenhuma some. Desenhar quinhentas
        de uma vez trava a aba num celular.

        Página numerada e não rolagem infinita: quem procura aqui procura
        uma entrada específica — "aquela compra de março" — e rolagem
        infinita não tem endereço. Não dá pra voltar pro mesmo ponto nem
        dizer a alguém onde olhar.
      */}
      {vista === "movimentos" ? (
        <MovimentacoesPanel
          movimentos={movimentos}
          produtos={data.products}
          busca={search}
          pagina={paginaMov}
          onPagina={setPaginaMov}
        />
      ) : (
      <>
      {/* Lista */}
      <div className="panel">
        {filtered.length === 0 ? (
          (() => {
            /*
              ─── "VAZIO" TEM CINCO SIGNIFICADOS ─────────────────────────────
              A aba abre em "Precisa de ação". Com tudo saudável, a lista é vazia — e a
              tela dizia "Nenhum produto cadastrado", descrevendo o MELHOR cenário como
              o pior. Cada causa tem a sua mensagem e a sua saída (ver estoque-vazio).
              Lista vazia só afirma que não há produto quando a fonte de fato respondeu:
              assinatura negada (member) ou cota estourada não são "sem cadastro".
            */
            const explicacaoDaFonte = explicarFonte(data.fontes.produtos, "produtos");
            const totalInativos = data.products.filter((p) => p.ativo === false).length;
            const motivo = motivoDaListaVazia({
              totalProdutos: data.products.length, vista, busca: search,
              filtrosRestritivos: filtroEstoque.sinais.length + (filtroEstoque.logistica ? 1 : 0),
              incluirInativos: filtroEstoque.incluirInativos, totalInativos,
              fonteIndisponivel: explicacaoDaFonte != null,
            });
            const limparTudo = () => { setSearch(""); setFiltroEstoque((f) => ({ ...FILTRO_ESTOQUE_VAZIO, incluirInativos: f.incluirInativos })); };
            return (
              <div className="empty-state" role="status">
                {motivo === "fonte-indisponivel" && <><span className="empty-ico">⚠️</span>{explicacaoDaFonte}</>}
                {motivo === "sem-cadastro" && <><span className="empty-ico">📦</span>Nenhum produto cadastrado.<br />Clique em <strong>＋ Novo Produto</strong>.</>}
                {motivo === "sem-pendencia" && (
                  <>
                    <span className="empty-ico">✅</span>
                    Nenhum produto precisa de ação agora — os <b>{data.products.length}</b> cadastrados estão dentro do esperado.
                    <div style={{ marginTop: 10 }}>
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => setVista("todos")}>Ver todos os produtos</button>
                    </div>
                  </>
                )}
                {motivo === "sem-resultado" && (
                  <>
                    <span className="empty-ico">🔎</span>
                    Nenhum produto passa pela busca e pelos filtros. Existem <b>{data.products.length}</b> cadastrados — o que sumiu foi escondido pelo filtro, não apagado.
                    <div style={{ marginTop: 10 }}>
                      <button type="button" className="btn btn-primary btn-sm" onClick={limparTudo}>Limpar busca e filtros</button>
                    </div>
                  </>
                )}
                {motivo === "so-inativos" && (
                  <>
                    <span className="empty-ico">🗄️</span>
                    Todos os <b>{data.products.length}</b> produtos estão inativos e escondidos.
                    <div style={{ marginTop: 10 }}>
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => setFiltroEstoque((f) => ({ ...f, incluirInativos: true }))}>Mostrar inativos</button>
                    </div>
                  </>
                )}
              </div>
            );
          })()
        ) : (
          <div className="table-wrapper" style={{ border: "none" }}>
            <table className="tbl-modern tbl-cards tbl-estoque">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Produto</th>
                  {/*
                    A coluna que faltava, e é a primeira depois do nome de
                    propósito: a lista existe pra responder o que fazer, e a
                    resposta não pode estar na oitava coluna.
                  */}
                  <th style={{ textAlign: "left" }}>Próxima ação</th>
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
                {filtered.slice(0, limiteDeLinhas).map((p) => (
                  <ProductRow
                    key={p.id}
                    product={p}
                    uid={uid}
                    estoqueML={estoqueML}
                    expanded={expanded === p.id}
                    onToggle={() => setExpanded((cur) => (cur === p.id ? null : p.id))}
                    situacao={porId.get(p.id) ?? null}
                    onEdit={() => setEditProduct({ ...p, mlbs: mlbsDe(p) })}
                    onMov={(tipo) => setMovModal({ product: p, tipo })}
                    onAgencias={() => setAgenciasProduct(p)}
                    duplicadas={duplicadasPorProduto.get(p.id) ?? 0}
                  />
                ))}
              </tbody>
            </table>
            {filtered.length > limiteDeLinhas && (
              <div style={{ padding: "12px 4px 4px", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "center" }}>
                <span role="status" style={{ fontSize: ".82rem", color: "var(--muted)" }}>
                  Mostrando <b>{limiteDeLinhas}</b> de <b>{filtered.length}</b> produtos
                </span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPagina({ chave: chaveDaLista, limite: limiteDeLinhas + LINHAS_POR_PAGINA })}>
                  Mostrar mais {Math.min(LINHAS_POR_PAGINA, filtered.length - limiteDeLinhas)}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPagina({ chave: chaveDaLista, limite: filtered.length })}>
                  Mostrar todos
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <PrevisaoPanel products={filtered} estoqueML={estoqueML} forecast={forecast} />
      </>
      )}

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
            // LANÇA se falhar: quem chama (ProductModal) mostra o erro dentro do
            // formulário, com o que foi digitado intacto. O modal só fecha aqui,
            // depois de a gravação principal ter dado certo.
            await upsertProduct(uid, prod);
            // Trilha de auditoria: mexer no custo médio de um produto muda a
            // margem de vendas passadas (ver custoNaData) — precisa de rastro.
            // É secundária: se ela falhar, o produto JÁ foi salvo e a pessoa não
            // deve ser mandada refazer nada.
            logAudit({
              acao: ehNovo ? "criar" : "editar",
              entidade: "produto",
              entidadeId: prod.id,
              entidadeLabel: prod.name || "(sem nome)",
              detalhe: `custo ${fmtBRL(prod.custoMedio ?? parseNum(prod.custo))} · imposto ${prod.imposto ?? 0}%`,
            }).catch(() => {});
            setEditProduct(null);
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
              {/*
                A gaveta ja existia com o historico sozinho dentro. Os MLBs e os
                precos por anuncio viviam num modal separado ("Agencias"), e a
                memoria de calculo nao existia em lugar nenhum — pra entender um
                produto era preciso juntar tres telas.
              */}
              <div className="drawer-body" style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 18 }}>
                <DetalheProduto product={p} estoqueML={estoqueML} />

                <section>
                  <h4 style={{
                    margin: "0 0 8px", fontSize: ".75rem", fontWeight: 700,
                    letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)",
                  }}>
                    Movimentações
                  </h4>
                  <MovimentosHistorico product={p} movs={movsPorProduto.get(p.id) ?? []} onMov={(tipo) => setMovModal({ product: p, tipo })} />
                </section>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/**
 * Todas as movimentações de estoque, do mais recente pro mais antigo.
 *
 * ─── POR QUE ESTA VISTA PRECISAVA EXISTIR ───────────────────────────────
 *
 * Movimentação só aparecia DENTRO da linha expandida de cada produto. Pra
 * responder "o que entrou na semana passada?" era preciso abrir produto por
 * produto e lembrar o que tinha visto em cada um — e a resposta certa é uma
 * lista ordenada por data, que é o que isto é.
 *
 * Paginada porque a lista cresce pra sempre: nenhuma movimentação some, e
 * desenhar quinhentas linhas de uma vez trava a aba num celular.
 */
function MovimentacoesPanel({ movimentos, produtos, busca, pagina, onPagina }: {
  movimentos: EstoqueMovimento[];
  produtos: Product[];
  busca: string;
  pagina: number;
  onPagina: (n: number) => void;
}) {
  const nomePorId = useMemo(
    () => new Map(produtos.map((p) => [p.id, p.name || p.id])),
    [produtos],
  );

  const ordenados = useMemo(() => {
    const chave = (x: unknown) => String(x ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const termo = chave(busca).trim();

    const lista = movimentos.filter((m) => {
      if (!termo) return true;
      const alvo = chave(`${nomePorId.get(m.productId) ?? ""} ${m.obs ?? ""} ${TIPO_MOVIMENTO_LABEL[m.tipo] ?? m.tipo}`);
      return termo.split(/\s+/).every((w) => alvo.includes(w));
    });

    /**
     * Mais recente primeiro, e o desempate é o id.
     *
     * Sem desempate, duas movimentações do MESMO dia — o caso comum, porque
     * a data é só o dia — trocariam de lugar entre duas pinturas, e a linha
     * que a pessoa estava lendo saltaria.
     */
    return [...lista].sort((a, b) =>
      String(b.data ?? "").localeCompare(String(a.data ?? "")) || String(b.id).localeCompare(String(a.id)));
  }, [movimentos, nomePorId, busca]);

  const p = paginar(ordenados, pagina, 25);

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 8 }}>
        <span className="panel-title">Movimentações de estoque</span>
        <span className="panel-sub">entradas, ajustes e envios pro Full — do mais recente pro mais antigo</span>
      </div>

      {ordenados.length === 0 ? (
        <div className="empty-state">
          <span className="empty-ico">📋</span>
          {busca.trim()
            ? <>Nenhuma movimentação bate com <b>{busca.trim()}</b>. Existem {movimentos.length} no total.</>
            : "Nenhuma movimentação lançada ainda."}
        </div>
      ) : (
        <>
          <div className="table-wrapper" style={{ border: "none" }}>
            <table className="tbl-modern tbl-cards">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Data</th>
                  <th style={{ textAlign: "left" }}>Produto</th>
                  <th style={{ textAlign: "left" }}>Tipo</th>
                  <th style={{ textAlign: "right" }}>Qtd</th>
                  <th style={{ textAlign: "right" }}>Custo un.</th>
                  <th style={{ textAlign: "left" }}>Observação</th>
                </tr>
              </thead>
              <tbody>
                {p.itens.map((m) => {
                  /*
                    A cor segue a MESMA regra da linha expandida do produto
                    (ver o histórico dentro de ProductRow): compra é entrada,
                    envio pro Full é transferência, ajuste segue o sinal. Duas
                    regras de cor pro mesmo dado fariam a mesma movimentação
                    aparecer verde num lugar e vermelha no outro.
                  */
                  const ehCompra = m.tipo === "entrada";
                  const ehFullMov = m.tipo === "saida_full";
                  const sinal = ehCompra ? "+" : ehFullMov ? "−" : (m.quantidade >= 0 ? "+" : "−");
                  const cor = ehCompra ? "var(--green)" : ehFullMov ? "var(--yellow)" : (m.quantidade >= 0 ? "var(--green)" : "var(--red)");
                  return (
                    <tr key={m.id}>
                      <td data-label="Data" style={{ whiteSpace: "nowrap" }}>{m.data}</td>
                      <td data-label="Produto" style={{ fontWeight: 600 }}>
                        {nomePorId.get(m.productId) ?? <span style={{ color: "var(--muted)" }}>produto removido</span>}
                      </td>
                      <td data-label="Tipo">{TIPO_MOVIMENTO_LABEL[m.tipo] ?? m.tipo}</td>
                      <td data-label="Qtd" style={{ textAlign: "right", color: cor, fontWeight: 700, whiteSpace: "nowrap" }}>
                        {sinal}{Math.abs(m.quantidade)}
                      </td>
                      <td data-label="Custo un." style={{ textAlign: "right", whiteSpace: "nowrap", color: m.custoUnit ? "var(--text)" : "var(--muted)" }}>
                        {m.custoUnit ? fmtBRL(parseNum(String(m.custoUnit))) : "—"}
                      </td>
                      <td data-label="Observação" style={{ color: "var(--muted)" }}>{m.obs || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Paginacao pagina={p} onIr={onPagina} unidade="movimentação" />
        </>
      )}
    </div>
  );
}
function ProductRow({
  product, estoqueML, expanded, onToggle, onEdit, onMov, onAgencias, duplicadas = 0, situacao = null,
}: {
  product: Product;
  uid: string;
  estoqueML: EstoqueML;
  /** O produto no vocabulário de situação, pra célula de próxima ação. */
  situacao?: ProdutoNaLista | null;
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
  /** Só no celular: custo, preço e imposto ficam atrás de um botão (ver .tbl-estoque em globals.css). */
  const [verFinanceiro, setVerFinanceiro] = useState(false);

  return (
    <>
      <tr style={{ opacity: product.ativo ? 1 : 0.5 }} className={verFinanceiro ? "fin-aberto" : undefined}>
        <td style={{ textAlign: "left" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button type="button" onClick={onToggle} title="Ver movimentações" aria-label="Ver movimentações" aria-expanded={expanded} style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: ".8rem", transform: expanded ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▶</button>
            <div>
              <div style={{ fontWeight: 600 }}>{product.name || <em style={{ color: "var(--muted)" }}>Sem nome</em>}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 3 }}>
                {product.sku
                  ? <span style={{ background: "rgba(233,169,45,.12)", color: "#E9A92D", padding: "1px 7px", borderRadius: 6, fontWeight: 700, fontSize: ".75rem" }}>SKU {product.sku}</span>
                  : <span style={{ color: "var(--red-text)", fontSize: ".75rem" }}>sem SKU</span>}
                {anuncios.map(({ mlb, item }) => (
                  <span key={mlb} style={{ fontSize: ".75rem", background: "var(--surface2)", border: "1px solid var(--border)", padding: "1px 6px", borderRadius: 5, color: "var(--muted)" }}>
                    {mlb}
                    {item && item.price > 0 && <b style={{ color: "var(--green)", marginLeft: 4 }}>{fmtBRL(item.price)}</b>}
                    {item && item.hasPromo && <span style={{ marginLeft: 4, fontSize: ".75rem", color: "var(--accent)", fontWeight: 700 }}>promo</span>}
                    {item && <span style={{ marginLeft: 4, color: ehFullLogistic(item.logistic) ? "#E9A92D" : "var(--muted)" }}>{ehFullLogistic(item.logistic) ? "Full" : "próprio"}</span>}
                  </span>
                ))}
              </div>
              <button
                type="button" className="tr-fin-btn" aria-expanded={verFinanceiro}
                onClick={() => setVerFinanceiro((v) => !v)}
              >
                {verFinanceiro ? "▾ Ocultar custo, preço e imposto" : "▸ Ver custo, preço e imposto"}
              </button>
            </div>
          </div>
        </td>
        {/*
          PRÓXIMA AÇÃO — uma só, e o porquê no tooltip.

          O rótulo vem de `proximaAcao`, com teste. A cor separa o que está
          perdendo venda agora (vermelho) do que estraga número (âmbar) e do
          que só atrapalha a leitura (cinza) — mas o TEXTO carrega a mesma
          informação, porque cor sozinha exclui quem não distingue os tons.
        */}
        <td data-label="Próxima ação" style={{ textAlign: "left", whiteSpace: "nowrap" }}>
          {(() => {
            if (!situacao) return <span style={{ color: "var(--muted)" }}>—</span>;
            const a = proximaAcao(situacao);
            if (a.urgencia === 0) return <span style={{ color: "var(--muted)", fontSize: ".8rem" }}>{a.rotulo}</span>;
            const cor = a.urgencia >= 60 ? "var(--red)" : a.urgencia >= 30 ? "var(--yellow)" : "var(--muted)";
            return (
              <span
                className="chip"
                style={{ color: cor, borderColor: cor, fontWeight: 700 }}
                title={a.porque}
              >
                {a.rotulo}
              </span>
            );
          })()}
        </td>
        {/*
          Saldo NEGATIVO no livro aparecia como "-17 un" em cinza, ao lado de
          um total grampeado em 0 — dois números contraditórios na mesma linha,
          sem nada dizendo qual acreditar.

          Negativo não é quantidade, é sintoma: saiu mais pro Full do que
          entrou, e falta lançar uma compra. Agora ele aparece em vermelho, com
          o motivo no tooltip, e o filtro de Inconsistência o encontra.
        */}
        <td
          data-label="Em casa"
          title={casaExibida < 0
            ? "Saldo negativo: saiu mais pro Full do que entrou no livro. Falta lançar uma compra."
            : undefined}
          style={{
            textAlign: "right", fontWeight: 700, whiteSpace: "nowrap",
            color: casaExibida < 0 ? "var(--red)" : casaExibida > 0 ? "var(--yellow)" : "var(--muted)",
          }}
        >
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
              style={{ display: "block", fontSize: ".75rem", color: "var(--warning)", fontWeight: 700, cursor: "help" }}
            >
              ⚠ {duplicadas} un já no Full
            </span>
          )}
          {proprioCompartilhado && !ehFull && (
            <span
              title="Este produto está em mais de um anúncio fora do Full, e os dois vendem do MESMO estoque de casa. O total usa o maior declarado, não a soma: anunciar 18 e 18 é a mesma pilha de 18 unidades, não 36."
              style={{ display: "block", fontSize: ".75rem", color: "var(--muted)", fontWeight: 400, cursor: "help" }}
            >
              mesmo estoque em {anuncios.filter(({ item }) => item && !ehFullLogistic(item.logistic)).length} anúncios
            </span>
          )}
        </td>
        <td data-label="Full (ML)" style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap", color: !ehFull ? "var(--muted)" : fullBaixo ? "var(--red)" : "var(--green)" }}>
          {ehFull ? `${full} un` : "—"}
          {fullBaixo && casa > 0 && <span title="Envie de casa pro Full" style={{ display: "block", fontSize: ".75rem", color: "var(--warning)" }}>reabastecer</span>}
          {fullCompartilhado && <span title="Mais de um anúncio compartilha o mesmo estoque no Full. As unidades são contadas UMA vez — cada anúncio sozinho mostra o pool inteiro, e somá-los dobraria o número." style={{ display: "block", fontSize: ".75rem", color: "var(--muted)", fontWeight: 400 }}>pool compartilhado</span>}
          {proprio > 0 && <span title="Unidades expostas no(s) anúncio(s) fora do Full (envio por sua conta/agência). Saem do MESMO estoque de casa, então NÃO somam no Total — já estão contadas em 'Em casa'." style={{ display: "block", fontSize: ".75rem", color: "var(--muted)", fontWeight: 400 }}>{proprio} no anúncio</span>}
        </td>
        <td data-label="Total" style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{totalUn} un</td>
        <td data-label="Custo médio" data-sec="fin" style={{ textAlign: "right", whiteSpace: "nowrap", color: custoMedio > 0 ? "var(--text)" : "var(--muted)", fontWeight: 600 }}>
          {custoMedio > 0 ? fmtBRL(custoMedio) : "—"}
          {product.custoMedio == null && custoMedio > 0 && <span style={{ display: "block", fontSize: ".75rem", color: "var(--muted)" }}>manual</span>}
        </td>
        <td data-label="Preço venda" data-sec="fin" style={{ textAlign: "right", color: precoMax > 0 ? "var(--green)" : "var(--muted)", fontWeight: 600, whiteSpace: "nowrap" }}>
          {precoMax > 0 ? (precoMin === precoMax ? fmtBRL(precoMax) : `${fmtBRL(precoMin)}–${fmtBRL(precoMax)}`) : "—"}
          {temPromo && <span style={{ display: "block", fontSize: ".75rem", color: "var(--accent)" }}>promoção</span>}
        </td>
        <td data-label="Imposto" data-sec="fin" style={{ textAlign: "right", whiteSpace: "nowrap", color: imposto > 0 ? "var(--red)" : "var(--muted)" }}>{imposto > 0 ? `${imposto.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : "—"}</td>
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
                  <div style={{ fontSize: ".8rem", color: "var(--green)" }}>
                    {fmtBRL(item.price)}{item.hasPromo && <span style={{ color: "var(--accent)" }}> · promoção</span>}
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

      <div style={{ fontSize: ".75rem", color: "var(--muted)", marginBottom: 12, lineHeight: 1.5 }}>
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
        <span style={{ fontSize: ".75rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".05em" }}>Movimentações</span>
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

  /**
   * Id do lançamento, estável enquanto este modal estiver aberto — é o que
   * torna repetir o salvamento idempotente. Ver handleSave.
   */
  const idDoLancamento = useRef(newMovId());
  /** A mensagem fica no formulário até a próxima tentativa (o `alert` sumia e deixava só a dúvida). */
  const [erro, setErro] = useState<string | null>(null);
  const sujo = useFormularioSujo({ qtd, custo, obs, data });

  async function handleSave() {
    if (saving) return;
    setErro(null);
    if (!qNum || (!isAjuste && qNum <= 0)) { setErro("Informe a quantidade."); return; }
    if (precisaCusto && cNum <= 0) { setErro("Informe o custo unitário."); return; }
    if (!obs.trim()) { setErro("Informe o motivo desta movimentação — fica registrado no histórico do produto."); return; }
    // Ajuste negativo tira estoque sem ser nem venda nem envio — a confirmação
    // extra existe pra não zerar produto por engano digitando o sinal errado.
    if (isAjuste && qNum < 0 && !confirm(`Confirma a baixa de ${Math.abs(qNum)} unidade(s) de "${product.name || "produto"}"?\n\nMotivo: ${obs.trim()}`)) {
      return;
    }
    setSaving(true);
    /**
     * EST-02: o id nasce quando o MODAL abre, não quando o botão é clicado.
     *
     * Era `const movId = newMovId()` aqui dentro. Dois cliques rápidos — ou um
     * retry depois de um timeout, que é o caso comum: nada parece ter
     * acontecido e a pessoa clica de novo — geravam ids DIFERENTES e criavam
     * dois lançamentos. Duas entradas de 100 unidades em vez de uma, e a média
     * ponderada misturando a mesma compra duas vezes.
     *
     * O `disabled={saving}` não protege disso: `setSaving` é assíncrono, então
     * dois cliques rápidos passam os dois; e um retry depois do timeout é um
     * clique novo, com o botão já liberado.
     *
     * Com o id fixo por abertura, gravar de novo é `setDoc` no MESMO documento:
     * idempotente por construção.
     */
    const movId = idDoLancamento.current;
    try {
      await addMovimento({
        id: movId,
        productId: product.id,
        tipo,
        quantidade: isAjuste ? qNum : Math.abs(qNum),
        custoUnit: precisaCusto ? cNum : undefined,
        data,
        obs: obs.trim() || undefined,
        /**
         * O estoque real NO INSTANTE do lançamento — sem isto o custo médio
         * não pode ser refeito depois, porque venda não é movimentação e o
         * livro sozinho não sabe quanto havia aqui. Saldo inicial custeia o
         * Full misturando contra o que está fora dele; entrada e ajuste
         * misturam contra o total.
         */
        estoqueAntes: isSaldo ? foraDoFull : estoqueAtual,
        custoMedioAntes: avgAtual,
      });
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
      // O id do lançamento é fixo por abertura: tentar de novo regrava o MESMO documento.
      setErro(mensagemDeErroDeSalvamento(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} titulo={titulo} confirmarDescarte={sujo && !saving}>
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
        <div style={{ margin: "4px 0 12px", padding: "8px 12px", borderRadius: 8, background: "rgba(233,169,45,.08)", border: "1px solid rgba(233,169,45,.2)", fontSize: ".82rem", color: "var(--muted)" }}>
          {full > 0
            ? <>O ML mostra <b>{full} un</b> deste produto no Full sem custo lançado. Informe quanto você pagou por unidade — isso <b>entra no custo médio</b> pra o lucro sair certo quando elas venderem. Não soma no “em casa” (já estão fora).</>
            : <>Use pra custear unidades que <b>já estavam no estoque</b> antes de você começar a lançar (ex.: o que está no Full). Entra na média do custo, mas <b>não soma no “em casa”</b>.</>}
        </div>
      )}

      {tipo === "saida_full" && (
        <div style={{ margin: "4px 0 12px", padding: "8px 12px", borderRadius: 8, background: "rgba(var(--brand-rgb),.08)", border: "1px solid rgba(var(--brand-rgb),.25)", fontSize: ".82rem", color: "var(--muted)" }}>
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

      {erro && <div className="note note-danger" role="alert" style={{ marginBottom: 10 }}>{erro}</div>}

      <div className="modal-btns">
        <button type="button" className="btn btn-success" onClick={handleSave} disabled={saving || !obs.trim()}>
          {saving ? "Salvando…" : erro ? "Tentar lançar de novo" : "Lançar"}
        </button>
        <button
          type="button" className="btn btn-ghost" disabled={saving}
          onClick={() => { if (sujo && !confirm("Descartar as alterações não salvas?")) return; onClose(); }}
        >
          Cancelar
        </button>
      </div>
    </Modal>
  );
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
  /**
   * O que já está planejado sai do localStorage NO PRIMEIRO RENDER.
   *
   * Era `useState(new Set())` mais um efeito que substituía o conteúdo
   * logo depois — um quadro com a lista vazia antes da lista de verdade,
   * e cada linha piscando de 'não planejado' pra 'planejado'.
   *
   * `lerChaveApp` devolve null sem `window`, então a leitura preguiçosa é
   * segura no servidor. E o servidor nunca renderiza este painel — o
   * portão de autenticação devolve null antes —, então não há hidratação
   * pra divergir.
   */
  const [planejados, setPlanejados] = useState<Set<string>>(() => lerPlanejados());
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
                        <span style={{ display: "block", fontSize: ".75rem", fontWeight: 400, color: "var(--warning)" }}>
                          sem anúncio vinculado — use “Vincular por SKU”
                        </span>
                      ) : f.total === 0 && f.mediaDiaria === 0 ? (
                        <span style={{ display: "block", fontSize: ".75rem", fontWeight: 400, color: "var(--muted)" }}>
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
                            <span style={{ display: "block", fontSize: ".75rem", color: "var(--muted)", fontWeight: 400 }}>
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
                          : `${fmtBRL(f.lucro.lucroUnitario)} por unidade × ${f.total} un · margem ${fmtPct(f.lucro.margem, 1)}`
                      }
                    >
                      {f.lucro == null ? "—" : (
                        <>
                          {fmtBRL(f.lucro.lucroTotal)}
                          <span style={{ display: "block", fontSize: ".75rem", fontWeight: 400, color: "var(--muted)" }}>
                            {fmtBRL(f.lucro.lucroUnitario)}/un · {fmtPct(f.lucro.margem, 1)}
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

/** Quantos produtos a lista desenha por vez (ver `limiteDeLinhas`). */
const LINHAS_POR_PAGINA = 60;

export function ProductModal({ product: initial, isNew, onClose, onSave }: { product: Product; isNew: boolean; onClose: () => void; onSave: (p: Product) => Promise<void> }) {
  const [p, setP] = useState<Product>({ ...initial, mlbs: mlbsDe(initial).length ? mlbsDe(initial) : [""] });
  // Custo do estoque atual (custo médio efetivo). É o ponto de partida do blend.
  const [custoStr, setCustoStr] = useState(
    initial.custoMedio != null ? String(Math.round(initial.custoMedio * 100) / 100) : (initial.custo ?? ""),
  );
  const [saving, setSaving] = useState(false);
  /** Falha do salvamento: fica NO formulário até a próxima tentativa. */
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  const [erroNome, setErroNome] = useState(false);
  /** Foto do que foi aberto — pra saber se há alteração a perder. */
  const [aoAbrir] = useState(() => JSON.stringify({ p, custoStr }));
  const sujo = JSON.stringify({ p, custoStr }) !== aoAbrir;

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
    if (saving) return;
    if (!p.name.trim()) { setErroNome(true); return; }
    setErroNome(false);
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
    setErroSalvar(null);
    const r = await salvarSemPerder(() => onSave(saveObj));
    // Sucesso: o pai fecha o modal (e este componente é desmontado). Falha: fica
    // aberto, com os valores como estavam e a mensagem visível.
    if (!r.ok) setErroSalvar(r.mensagem);
    setSaving(false);
  }

  return (
    <Modal open onClose={onClose} titulo={isNew ? "Novo produto" : "Editar produto"} confirmarDescarte={sujo && !saving}>
      <div className="modal-title">{isNew ? "Novo Produto" : "Editar Produto"}</div>

      <div className="config-field">
        <label htmlFor="produto-nome">Nome do produto</label>
        <input
          id="produto-nome" type="text" placeholder="Ex: Kit Erva Mate Trot's 1,25kg" value={p.name}
          onChange={(e) => { set({ name: e.target.value }); if (erroNome) setErroNome(false); }}
          aria-invalid={erroNome || undefined} aria-describedby={erroNome ? "produto-nome-erro" : undefined}
        />
        {erroNome && <div id="produto-nome-erro" className="hint" role="alert" style={{ color: "var(--red-text)" }}>Informe o nome do produto.</div>}
      </div>

      <div className="config-field">
        <label htmlFor="produto-sku">SKU (código interno)</label>
        <input id="produto-sku" type="text" placeholder="Ex: 250" value={p.sku ?? ""} onChange={(e) => set({ sku: e.target.value })} />
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

      <div style={{ margin: "4px 0 12px", padding: "8px 12px", borderRadius: 8, background: "rgba(233,169,45,.08)", border: "1px solid rgba(233,169,45,.2)", fontSize: ".82rem", color: "var(--muted)" }}>
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

      {erroSalvar && (
        <div className="note note-danger" role="alert" style={{ marginBottom: 10 }}>{erroSalvar}</div>
      )}

      <div className="modal-btns">
        <button type="button" className="btn btn-success" onClick={handleSave} disabled={saving}>
          {saving ? "Salvando…" : erroSalvar ? "Tentar salvar de novo" : "Salvar Produto"}
        </button>
        <button
          type="button" className="btn btn-ghost" disabled={saving}
          onClick={() => { if (sujo && !confirm("Descartar as alterações não salvas?")) return; onClose(); }}
        >
          Cancelar
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
function ReposicaoPanel({ produtos, estoqueML, forecast, retencao, retencaoVeio }: {
  produtos: Product[];
  estoqueML: EstoqueML;
  forecast: Forecast;
  /** Unidades retidas no Full, por produto — vem de quem busca a gestão do Full. */
  retencao: RetencaoPorProduto[];
  /** O detalhe chegou? Lista vazia é ambígua; sem isto o plano afirmaria demais. */
  retencaoVeio: boolean;
}) {
  const [dias, setDias] = useState("30");
  const [folga, setFolga] = useState("7");
  const [aberto, setAberto] = useState(false);

  const diasN = Math.max(0, Math.round(parseNum(dias) || 0));
  const folgaN = Math.max(0, Math.round(parseNum(folga) || 0));

  const [aba, setAba] = useState<"pedir" | "full" | "todos">("pedir");
  const [busca, setBusca] = useState("");
  const [alvoData, setAlvoData] = useState(() => fimDaSemanaQueVem(hojeBR()));
  const [transito, setTransito] = useState("3");

  /**
   * Filtro unico pras tres abas: o produto que voce esta investigando e o
   * mesmo em todas, e ter tres campos separados faria repetir a digitacao a
   * cada troca de aba.
   */
  const filtrar = <T extends { nome: string }>(lista: T[]) => {
    const termo = busca.trim().toLowerCase();
    return termo ? lista.filter((x) => x.nome.toLowerCase().includes(termo)) : lista;
  };

  /**
   * Cor pela COBERTURA, nao pela quantidade: 20 unidades e emergencia num
   * produto que gira rapido e folga num que gira devagar. Mesma escala nas
   * tres abas, pra a cor querer dizer sempre a mesma coisa.
   */
  const corDias = (d: number | null) =>
    d == null ? "var(--muted)"
      : d <= 3 ? "var(--red)"
      : d <= 10 ? "var(--warning)"
      : d <= 20 ? "var(--text)"
      : "var(--green)";

  /**
   * Base de cada produto: o estoque de hoje e a média diária ajustada pelos
   * dias em que ele esteve à venda (ver mediaDiariaAjustada). Sem o ajuste,
   * anúncio pausado metade do período parece vender metade do que vende.
   */
  /** Retenção por produto, indexada — o plano consulta por id. */
  const retencaoPorProduto = useMemo(
    () => new Map(retencao.map((r) => [r.productId, r])),
    [retencao],
  );

  const paraDominio = useMemo(() => produtos.map((p) => {
    const f = previsaoDe(p, estoqueML, forecast);

    /**
     * ─── QUANTO VAI ESTAR VENDÁVEL, E NÃO QUANTO ESTÁ DISPONÍVEL ───────
     *
     * `f.full` é `available_quantity`: o que dá pra vender AGORA. O plano de
     * reposição não pergunta isso — ele pergunta com quanto dá pra contar
     * até o produto chegar. As unidades que o ML está movendo entre centros
     * entram nessa conta (já foram pagas, voltam a vender sozinhas); as
     * avariadas e as em retirada, não.
     *
     * `baseDaReposicao` é onde essa regra mora, com teste. Aqui só se soma
     * a diferença — somar `transito` a `estoqueTotal`, que já contém `full`.
     */
    const ret = retencaoPorProduto.get(p.id);
    const comp = composicaoDoEstoque(f.full, ret?.porStatus ?? []);
    const emTransitoNoFull = comp.transito;
    const retidoSemVolta = comp.retidoSemVolta + comp.perdido;
    const diasAtivos = forecast.diasAtivos?.[p.id];
    const diasBase = diasAtivos && diasAtivos > 0 ? Math.min(diasAtivos, forecast.dias) : forecast.dias;
    return {
      id: p.id,
      nome: p.name || p.id,
      /**
       * O total que o plano usa: disponível + o que volta a vender sozinho.
       * Não é o físico — avaria e vencido estão no centro, contam no que
       * você pagou e não vendem nunca.
       */
      estoqueTotal: f.total + emTransitoNoFull,
      /** O físico, pra tela poder mostrar a diferença em vez de escondê-la. */
      estoqueFisico: f.total + emTransitoNoFull + retidoSemVolta,
      emTransitoNoFull,
      retidoSemVolta,
      emCasa: f.casa,
      // Separados do total: a aba de envio precisa do Full sozinho.
      noFull: f.full,
      ehFull: f.ehFull,
      mediaDiaria: mediaDiariaAjustada(forecast.vendas[p.id] ?? 0, forecast.dias, diasAtivos),
      custoUnitario: custoMedioDe(p),
      ativo: Boolean(p.ativo),
      diasBase,
      /** Esteve à venda menos que a janela inteira — a tela explica a base. */
      parcial: diasBase < forecast.dias,
    };
  }), [produtos, estoqueML, forecast, retencaoPorProduto]);

  const plano = useMemo(
    () => montarPlanoReposicao(paraDominio, diasN, folgaN),
    [paraDominio, diasN, folgaN],
  );

  /** Só pro aviso: quanto do plano se apoia em unidade que ainda não vende. */
  const totalEmTransito = useMemo(() => paraDominio.reduce((n, p) => n + p.emTransitoNoFull, 0), [paraDominio]);
  const totalSemVolta = useMemo(() => paraDominio.reduce((n, p) => n + p.retidoSemVolta, 0), [paraDominio]);

  /**
   * Envio pro Full responde outra pergunta: o galpao NAO segura o Full, e
   * se ele zera o anuncio para mesmo com estoque em casa. A acao ai e
   * despachar, nao comprar.
   */
  const planoFull = useMemo(
    () => planoEnvioParaFull(paraDominio.map((x) => ({ ...x, noFull: x.noFull, ehFull: x.ehFull })), diasN),
    [paraDominio, diasN],
  );

  const transitoN = Math.max(0, Math.round(parseNum(transito) || 0));
  /**
   * "Quanto enviar pra durar ate DIA X" — a pergunta como ela e feita de
   * verdade. O ML mostra sugestao parecida na tela de envio, mas nao expoe
   * por API (oito endpoints testados, 404/403), entao o numero e nosso.
   */
  const planoSemana = useMemo(
    () => planoEnvioAteData(paraDominio, hojeBR(), alvoData, transitoN),
    [paraDominio, alvoData, transitoN],
  );

  const todos = useMemo(() => situacaoDoEstoque(paraDominio), [paraDominio]);
  const baseDe = useMemo(
    () => new Map(paraDominio.map((p) => [p.id, { diasBase: p.diasBase, parcial: p.parcial }])),
    [paraDominio],
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
          <label htmlFor="repor-dias">Estoque deve durar</label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input id="repor-dias" inputMode="numeric" value={dias} onChange={(e) => setDias(e.target.value)} style={{ width: 90 }} aria-describedby="repor-dias-un" />
            <span id="repor-dias-un" style={{ color: "var(--muted)", fontSize: ".85rem" }}>dias</span>
          </div>
        </div>
        <div className="config-field" style={{ margin: 0, maxWidth: 230 }}>
          <label htmlFor="repor-folga">Folga de segurança</label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input id="repor-folga" inputMode="numeric" value={folga} onChange={(e) => setFolga(e.target.value)} style={{ width: 90 }} aria-describedby="repor-folga-un repor-folga-dica" />
            <span id="repor-folga-un" style={{ color: "var(--muted)", fontSize: ".85rem" }}>dias a mais</span>
          </div>
          <div id="repor-folga-dica" className="hint">Pra não raspar o zero num dia de venda forte.</div>
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

      {/*
        ─── O QUE ESTE PLANO SABE, E O QUE ELE NÃO SABE ───────────────────

        O plano conta com as unidades que o ML está movendo entre centros:
        já foram pagas e voltam a vender sozinhas, então comprá-las de novo
        seria comprar duas vezes o mesmo estoque.

        Quando o detalhe de retenção não chega, essas unidades ficam
        invisíveis — e invisível aqui não é zero, é desconhecido. O plano
        continua sendo mostrado (sem ele a tela não serve pra nada), com a
        ressalva de que o número pode estar pedindo a mais.
      */}
      {!retencaoVeio && (
        <div className="note note-warn" style={{ marginBottom: 12 }}>
          Não consegui ler o detalhe do estoque retido no Full. Unidades em
          transferência entre centros — já pagas e prestes a voltar a vender —
          não entraram nesta conta, então o plano pode estar <b>pedindo a mais</b>.
        </div>
      )}

      {retencaoVeio && totalEmTransito > 0 && (
        <div className="note" style={{ marginBottom: 12 }}>
          <b>{totalEmTransito} unidade(s)</b> em transferência entre centros do ML
          entraram no plano: estão pagas e voltam a vender sozinhas, então não
          precisam ser compradas de novo.
          {totalSemVolta > 0 && <> Outras <b>{totalSemVolta}</b> estão retidas e
          {" "}<b>não</b> voltam a vender — essas o plano ignora de propósito.</>}
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

      {/* Duas leituras do mesmo dado: o pedido de compra e o panorama.
          Separadas porque respondem perguntas diferentes — "o que comprar
          hoje" e "como está cada produto". */}
      <div className="seg" style={{ marginBottom: 12 }}>
        <button
          type="button" className={`seg-btn ${aba === "pedir" ? "active" : ""}`}
          onClick={() => setAba("pedir")}
        >
          Precisam pedir ({plano.itens.length})
        </button>
        <button
          type="button" className={`seg-btn ${aba === "full" ? "active" : ""}`}
          onClick={() => setAba("full")}
        >
          Enviar pro Full ({planoFull.itens.length})
        </button>
        <button
          type="button" className={`seg-btn ${aba === "todos" ? "active" : ""}`}
          onClick={() => setAba("todos")}
        >
          Todos os produtos ({todos.length})
        </button>
      </div>

      {/* Legenda da cor: a coluna "dura" e a informacao central das tres
          abas, e cor sem legenda vira adivinhacao. */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: ".75rem", color: "var(--muted)", marginBottom: 10 }}>
        <span>Dias de cobertura:</span>
        <span><b style={{ color: "var(--red-text)" }}>ate 3d</b> critico</span>
        <span><b style={{ color: "var(--warning)" }}>4 a 10d</b> repor agora</span>
        <span><b style={{ color: "var(--text)" }}>11 a 20d</b> atencao</span>
        <span><b style={{ color: "var(--green)" }}>21d+</b> folga</span>
      </div>

      {/* Busca unica: o produto investigado e o mesmo nas tres abas. */}
      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Filtrar produto pelo nome..."
        style={{ width: "100%", marginBottom: 12 }}
      />

      {aba === "todos" ? (
        <>
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Produto</th>
                  <th style={{ textAlign: "right" }}>Vendas/dia</th>
                  <th style={{ textAlign: "right" }}>Base</th>
                  <th style={{ textAlign: "right" }}>Tenho</th>
                  <th style={{ textAlign: "right" }}>Dura</th>
                </tr>
              </thead>
              <tbody>
                {filtrar(todos).map((t) => {
                  const b = baseDe.get(t.produtoId);
                  const curto = t.duraDias != null && t.duraDias < diasN;
                  return (
                    <tr key={t.produtoId} style={{ opacity: t.ativo ? 1 : 0.55 }}>
                      <td style={{ textAlign: "left" }}>
                        {!t.ativo && <span className="chip chip-muted" style={{ marginRight: 6 }}>inativo</span>}
                        {t.nome}
                      </td>
                      <td style={{ textAlign: "right", color: t.mediaDiaria > 0 ? "var(--text)" : "var(--muted)" }}>
                        {t.mediaDiaria > 0 ? t.mediaDiaria.toFixed(1) : "—"}
                      </td>
                      {/* A base explica a média: 12 dias em vez de 30 significa
                          anúncio pausado parte do período. */}
                      <td
                        style={{ textAlign: "right", color: b?.parcial ? "var(--warning)" : "var(--muted)", fontSize: ".82rem" }}
                        title={b?.parcial
                          ? `Esteve à venda ${b.diasBase} dos ${forecast.dias} dias. A média usa só esses dias — dividir pela janela inteira trataria a pausa como venda fraca.`
                          : `À venda nos ${forecast.dias} dias do período.`}
                      >
                        {b ? `${b.diasBase}d` : "—"}
                      </td>
                      <td style={{ textAlign: "right" }}>{t.estoqueTotal} un</td>
                      <td style={{ textAlign: "right", fontWeight: curto ? 700 : 400, color: corDias(t.duraDias) }}>
                        {t.duraDias == null ? "sem venda" : `${t.duraDias}d`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="hint" style={{ marginTop: 10 }}>
            &quot;Base&quot; são os dias em que o produto esteve à venda dentro dos {forecast.dias} dias —
            é por eles que a média é dividida. Produto pausado parte do período aparece com base
            menor, e a média reflete o ritmo real de quando ele estava no ar.
            &quot;Sem venda&quot; significa que não houve saída no período: sem ritmo, não dá pra projetar duração.
          </div>
        </>
      ) : aba === "full" ? (
        <>
          {/* ─── PLANEJAMENTO DA SEMANA ───────────────────────────────
              Responde "quanto enviar pra durar ate a data X", que e como a
              decisao e tomada de verdade: a coleta tem dia, o fim de semana
              tem dia. Traduzir isso pra "16 dias" de cabeca toda vez e onde
              se erra — hoje sao 16, amanha sao 15.

              O ML mostra uma sugestao parecida na tela de envio, mas ela NAO
              e exposta pela API: oito endpoints testados, todos 404 ou 403.
              Entao o numero e calculado aqui, e a conta fica a vista. */}
          <div style={{ border: "1px solid var(--accent)", borderRadius: 10, padding: 12, marginBottom: 14, background: "var(--surface2)" }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 10 }}>
              <div className="config-field" style={{ margin: 0, maxWidth: 190 }}>
                <label>Precisa durar até</label>
                <input type="date" value={alvoData} onChange={(e) => setAlvoData(e.target.value)} />
              </div>
              <div className="config-field" style={{ margin: 0, maxWidth: 150 }}>
                <label>Trânsito (dias)</label>
                <input inputMode="numeric" value={transito} onChange={(e) => setTransito(e.target.value)} />
                <div className="hint">Coleta + processamento no CD.</div>
              </div>
              <button
                type="button" className="btn btn-ghost btn-sm" style={{ marginBottom: 18 }}
                onClick={() => setAlvoData(fimDaSemanaQueVem(hojeBR()))}
              >
                Fim da semana que vem
              </button>
            </div>

            <div style={{ fontSize: ".8rem", marginBottom: 8 }}>
              Cobrindo <b>{planoSemana.diasAteAlvo} dia(s)</b> de venda
              {transitoN > 0 ? <> + <b>{transitoN}</b> de trânsito</> : null} ·{" "}
              <b style={{ color: "var(--green)" }}>{planoSemana.totalAEnviar} un</b> a despachar
              {planoSemana.totalAComprar > 0 && (
                <> · <b style={{ color: "var(--warning)" }}>{planoSemana.totalAComprar} un</b> que o galpão não cobre</>
              )}
            </div>

            {planoSemana.itens.length === 0 ? (
              <div style={{ fontSize: ".82rem", color: "var(--green)" }}>
                O Full já cobre até lá em todos os produtos. Nada a enviar.
              </div>
            ) : (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {planoSemana.itens.map((i) => (
                    <div key={i.produtoId} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: ".82rem" }}>
                      <span>
                        {i.naoChega && (
                          <span className="chip chip-red" style={{ marginRight: 6 }} title={`O Full de hoje não alcança ${alvoData}.`}>
                            não chega
                          </span>
                        )}
                        {i.nome}
                        <span style={{ color: "var(--muted)", fontSize: ".75rem" }}>
                          {" "}· {i.noFull} no Full · {i.mediaDiaria.toFixed(1)}/dia
                        </span>
                      </span>
                      <span style={{ whiteSpace: "nowrap" }}>
                        <b style={{ color: i.enviar > 0 ? "var(--green)" : "var(--muted)" }}>
                          {i.enviar > 0 ? `enviar ${i.enviar} un` : "sem estoque em casa"}
                        </b>
                        {i.faltaComprar > 0 && (
                          <span style={{ color: "var(--warning)" }}> · comprar {i.faltaComprar}</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
                <button
                  type="button" className="btn btn-ghost btn-xs" style={{ marginTop: 10 }}
                  onClick={() => {
                    const linhas = [
                      `Envio pro Full — durar até ${alvoData.split("-").reverse().join("/")}`,
                      `(${planoSemana.diasAteAlvo} dias de venda + ${transitoN} de trânsito)`,
                      "",
                      ...planoSemana.itens
                        .filter((i) => i.enviar > 0)
                        .map((i) => `${i.nome}: ${i.enviar} un`),
                      "",
                      `Total: ${planoSemana.totalAEnviar} un`,
                      ...(planoSemana.totalAComprar > 0
                        ? [`Falta comprar: ${planoSemana.totalAComprar} un`] : []),
                    ];
                    navigator.clipboard?.writeText(linhas.join("\n")).catch(() => {});
                  }}
                >
                  Copiar lista
                </button>
              </>
            )}
          </div>

          {planoFull.urgentes.length > 0 && (
            <div className="note note-danger" style={{ marginBottom: 12 }}>
              <b>{planoFull.urgentes.length} produto(s) com o Full acabando antes dos {diasN} dias.</b>{" "}
              O estoque em casa NÃO segura o Full — se ele zera, o anúncio para mesmo com o
              galpão cheio. Estes decidem a coleta de hoje.
            </div>
          )}

          <div className="kpi-grid" style={{ marginBottom: 12 }}>
            <div className="kpi"><div className="k-lbl">Produtos a enviar</div><div className="k-val">{planoFull.itens.length}</div></div>
            <div className="kpi k-pos"><div className="k-lbl">Enviar do galpão</div><div className="k-val" style={{ color: "var(--green)" }}>{planoFull.totalAEnviar} un</div></div>
            <div className="kpi"><div className="k-lbl">Falta comprar</div><div className="k-val" style={{ color: planoFull.totalAComprar > 0 ? "var(--warning)" : "var(--muted)" }}>{planoFull.totalAComprar} un</div></div>
          </div>

          {planoFull.itens.length === 0 ? (
            <div className="empty-state">
              <span className="empty-ico">📦</span>
              Nenhum produto precisa de envio pro Full pra cobrir {diasN} dias.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Produto</th>
                    <th style={{ textAlign: "right" }}>Vendas/dia</th>
                    <th style={{ textAlign: "right" }}>No Full</th>
                    <th style={{ textAlign: "right" }}>Full dura</th>
                    <th style={{ textAlign: "right" }}>Em casa</th>
                    <th style={{ textAlign: "right" }}>ENVIAR</th>
                    <th style={{ textAlign: "right" }}>Falta comprar</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrar(planoFull.itens).map((i) => (
                    <tr key={i.produtoId}>
                      <td style={{ textAlign: "left" }}>
                        {i.vaiZerar && (
                          <span
                            className="chip chip-red" style={{ marginRight: 6 }}
                            title={`O Full dura ${i.duraFull} dia(s), abaixo do alvo de ${diasN}.`}
                          >
                            Full acabando
                          </span>
                        )}
                        {i.nome}
                      </td>
                      <td style={{ textAlign: "right" }}>{i.mediaDiaria.toFixed(1)}</td>
                      <td style={{ textAlign: "right" }}>{i.noFull} un</td>
                      {/* A pergunta central: quanto tempo o que está NO FULL aguenta.
                          O galpão não entra nesta conta de propósito. */}
                      <td style={{ textAlign: "right", fontWeight: i.vaiZerar ? 700 : 400, color: corDias(i.duraFull) }}>
                        {i.duraFull == null ? "—" : `${i.duraFull}d`}
                      </td>
                      <td style={{ textAlign: "right", color: "var(--muted)" }}>{i.emCasa} un</td>
                      <td style={{ textAlign: "right", fontWeight: 800, color: i.enviar > 0 ? "var(--green)" : "var(--muted)" }}>
                        {i.enviar > 0 ? `${i.enviar} un` : "—"}
                      </td>
                      <td style={{ textAlign: "right", color: i.faltaComprar > 0 ? "var(--warning)" : "var(--muted)" }}>
                        {i.faltaComprar > 0 ? `${i.faltaComprar} un` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="hint" style={{ marginTop: 10 }}>
            &quot;Full dura&quot; considera SÓ o que está no centro de distribuição — o galpão não
            segura o Full. &quot;Enviar&quot; é quanto mandar pra cobrir os {diasN} dias, limitado
            ao que existe em casa; o que sobra vira compra e aparece na última coluna.
          </div>
        </>
      ) : plano.itens.length === 0 ? (
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
                {filtrar(visiveis).map((i) => (
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
                          style={{ color: "var(--muted)", fontSize: ".75rem" }}
                          title="Já está no galpão: mandar pro Full resolve essa parte sem esperar o fornecedor."
                        >
                          {" "}· {i.jaTemEmCasa} un já em casa
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>{i.mediaDiaria.toFixed(1)}</td>
                    <td style={{ textAlign: "right" }}>{i.estoqueTotal} un</td>
                    <td style={{ textAlign: "right", fontWeight: i.vaiZerarAntes ? 700 : 400, color: corDias(i.duraDias) }}>
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
