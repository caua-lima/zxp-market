import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAccess } from "@/lib/api-auth";
import { getMlAccessToken } from "../token";
import { SELLER_ID } from "@/lib/ml/orders";
import { consolidarEstoqueAnuncios } from "@/lib/domain/estoque";

const ML_API = "https://api.mercadolibre.com";

// A auditoria varre várias páginas com pausa entre elas e estoura o limite
// padrão da Vercel; sem isso ela morre no meio e o painel não mostra nada.
export const maxDuration = 60;

/**
 * Cache por lambda quente: o Dashboard consulta esta rota para avisar de
 * remessa pendente, e ela faz mais de dez chamadas ao ML. Sem cache, abrir o
 * painel várias vezes ao dia derrubaria a cota (já aconteceu, HTTP 429).
 */
const cache = new Map<string, { at: number; body: Record<string, unknown> }>();
const CACHE_TTL = 5 * 60 * 1000;

/** Executa `fn` sobre `items` com no máximo `limit` chamadas simultâneas — mesmo
 *  helper de lib/ml/sync.ts, repetido aqui pra não exportar de um módulo que é
 *  "server-only" por outro motivo. Segura o burst que já causou HTTP 429 no ML. */
async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

function normId(s: string) {
  const up = String(s).trim().toUpperCase();
  return up ? (up.startsWith("MLB") ? up : `MLB${up}`) : "";
}

type Item = { mlb: string; title: string; available: number; sold: number; status: string; inventory_id: string };

/**
 * Gestão Full: estoque por anúncio (disponível/vendido/status) + recebimentos
 * (inbound) do Full. A lista de "envios inbound" do print não é exposta pela
 * API pública do ML (só Seller Center), então mostramos o que a API entrega.
 */
export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  const params = new URL(req.url).searchParams;
  const chaveCache = params.get("dias") ?? "padrao";
  if (!params.has("forcar")) {
    const hit = cache.get(chaveCache);
    if (hit && Date.now() - hit.at < CACHE_TTL) {
      return NextResponse.json({ ...hit.body, doCache: true });
    }
  }

  try {
    const token = await getMlAccessToken();
    if (!token) return NextResponse.json({ error: "sem token" }, { status: 400 });
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    const db = getAdminDb();

    // MLBs cadastrados no Estoque — servem para saber o que já é rastreado.
    const prodSnap = await db.collection("estoque").get();
    const cadastrados = new Set<string>();
    // MLB → produto do Estoque: sem isso a baixa não sabe de quem descontar.
    const produtoPorMlb = new Map<string, { id: string; nome: string }>();
    for (const doc of prodSnap.docs) {
      const d = doc.data();
      const list: string[] = Array.isArray(d.mlbs) && d.mlbs.length ? d.mlbs : d.mlb ? [String(d.mlb)] : [];
      for (const m of list) {
        const n = normId(m);
        if (!n) continue;
        cadastrados.add(n);
        produtoPorMlb.set(n, { id: doc.id, nome: String(d.name ?? "") });
      }
    }

    /**
     * A busca de operações exige inventory_id ("The field inventory_id is
     * required"), então precisamos de TODOS os anúncios da conta: usar só os
     * cadastrados escondia unidades e a remessa fechava a menos.
     */
    const ids = new Set<string>(cadastrados);
    for (let offset = 0; offset < 1000; offset += 100) {
      const res = await fetch(`${ML_API}/users/${SELLER_ID}/items/search?limit=100&offset=${offset}`, { headers, cache: "no-store" });
      if (!res.ok) break;
      const j = (await res.json()) as { results?: string[] };
      const lote = j.results ?? [];
      for (const m of lote) { const n = normId(m); if (n) ids.add(n); }
      if (lote.length < 100) break;
    }
    const arr = Array.from(ids);

    // Estoque + inventory_id via multi-get de itens
    const itens: Item[] = [];
    const inventoryIds = new Set<string>();
    for (let i = 0; i < arr.length; i += 20) {
      const chunk = arr.slice(i, i + 20);
      const res = await fetch(`${ML_API}/items?ids=${chunk.join(",")}&attributes=id,title,available_quantity,sold_quantity,status,inventory_id,shipping,variations`, { headers, cache: "no-store" });
      if (!res.ok) continue;
      const rows = (await res.json()) as { body?: Record<string, unknown> }[];
      for (const row of rows) {
        const b = row?.body;
        if (!b) continue;
        const shipping = (b.shipping as Record<string, unknown>) ?? {};
        const logistic = String(shipping.logistic_type ?? "");
        const inv = String(b.inventory_id ?? "");
        /**
         * Anúncio com variação (sabor, tamanho) não tem inventory_id na raiz:
         * cada variação tem o seu. Lendo só a raiz, essas unidades ficavam
         * invisíveis — é o que fazia duas remessas fecharem 20 a menos.
         */
        const variacoes = (b.variations ?? []) as Record<string, unknown>[];
        const invsVariacao = variacoes
          .map((v) => ({ inv: String(v.inventory_id ?? ""), qtd: Number(v.available_quantity ?? 0) }))
          .filter((v) => v.inv);

        // Só anúncios no Full (fulfillment). Agência/Flex/self ficam de fora.
        const temInv = inv !== "" || invsVariacao.length > 0;
        const isFull = logistic === "fulfillment" || (logistic === "" && temInv);
        if (!isFull) continue;

        const mlb = String(b.id ?? "").toUpperCase();
        const title = String(b.title ?? "");
        const status = String(b.status ?? "");
        if (inv) {
          inventoryIds.add(inv);
          itens.push({
            mlb, title, status, inventory_id: inv,
            available: Number(b.available_quantity ?? 0),
            sold: Number(b.sold_quantity ?? 0),
          });
        }
        for (const v of invsVariacao) {
          inventoryIds.add(v.inv);
          itens.push({ mlb, title, status, inventory_id: v.inv, available: v.qtd, sold: 0 });
        }
      }
    }
    itens.sort((a, b) => b.available - a.available);

    // Recebimentos (inbound) por inventory_id — best-effort
    const invArr = Array.from(inventoryIds);

    /**
     * ─── ESTOQUE INDISPONÍVEL NO FULL ───────────────────────────────────
     *
     * `available_quantity` do /items conta só o que está PRONTO PRA VENDER.
     * Unidade que chegou no centro e ficou retida — em transferência entre
     * centros, avariada, em revisão, em processo interno — some do painel
     * inteiro: não aparece como disponível (não está) e não aparece como
     * perda (ninguém contou). É estoque pago, parado e invisível.
     *
     * `/inventories/{id}/stock/fulfillment` é o único lugar que o ML expõe
     * essa quebra, em `not_available_detail`. Best-effort e com teto de
     * chamadas: é uma requisição por pool, e a cota já derrubou este endpoint
     * antes (HTTP 429 documentado acima).
     */
    const INV_DETALHE_MAX = 60;
    const estoqueDetalhe = new Map<string, { disponivel: number; indisponivel: number; porStatus: Map<string, number> }>();
    let detalheFalhou = 0;
    await mapPool(invArr.slice(0, INV_DETALHE_MAX), 4, async (inv) => {
      try {
        const r = await fetch(`${ML_API}/inventories/${inv}/stock/fulfillment`, { headers, cache: "no-store" });
        if (!r.ok) { detalheFalhou++; return; }
        const j = (await r.json()) as {
          available_quantity?: number;
          not_available_quantity?: number;
          not_available_detail?: { status?: string; quantity?: number }[];
        };
        const porStatus = new Map<string, number>();
        for (const d of j.not_available_detail ?? []) {
          const st = String(d?.status ?? "").trim();
          const q = Number(d?.quantity ?? 0);
          if (!st || q <= 0) continue;
          porStatus.set(st, (porStatus.get(st) ?? 0) + q);
        }
        estoqueDetalhe.set(inv, {
          disponivel: Number(j.available_quantity ?? 0),
          indisponivel: Number(j.not_available_quantity ?? 0),
          porStatus,
        });
      } catch { detalheFalhou++; }
    });

    const now = new Date(Date.now() - 3 * 3600 * 1000);
    /**
     * O ML recusa janela > 60 dias aqui, mas o limite real é a cota: pedir 55
     * dias estourou ("over quota"), porque vem uma linha por evento de
     * recebimento. 15 dias cobre de sobra o uso real — a baixa roda
     * periodicamente e só precisa das remessas novas.
     */
    const dias = Math.min(Number(new URL(req.url).searchParams.get("dias") ?? 25) || 25, 55);
    const from = new Date(now.getTime() - dias * 24 * 3600 * 1000).toISOString().slice(0, 10);
    /**
     * O fim da janela vai 2 dias à frente de propósito. O evento de
     * recebimento sai dias depois da data reservada da remessa, e `date_to`
     * no dia de hoje corta justamente a remessa mais recente — que é a que
     * interessa para dar baixa.
     */
    const to = new Date(now.getTime() + 2 * 24 * 3600 * 1000).toISOString().slice(0, 10);

    const recebimentos: { data: string; quantidade: number; inventory_id: string; tipo: string }[] = [];
    let opStatus = 0;
    let opErro = ""; // corpo do erro do ML — sem isso o diagnóstico fica cego
    let opUrl = "";
    const tiposVistos = new Set<string>();
    let amostra = "";
    const amostras: string[] = [];
    /**
     * O ML emite uma linha por evento de recebimento (palete/caixa). Nela:
     *   detail = o que entrou NESTE evento  → é isso que forma a remessa
     *   result = o saldo do produto no Full DEPOIS da operação (não somar!)
     * Somar `result` daria 152 numa remessa de 80, porque 152 é o estoque.
     * Então acumulamos `detail` por remessa e guardamos `result` só como
     * informação do saldo, tirado do evento mais recente.
     */
    type Agg = {
      data: string; recebido: number; problema: number;
      porInventory: Map<string, number>; porTipo: Map<string, number>;
      refs: Set<string>; saldoData: string; saldo: number;
    };
    const porRemessaAgg = new Map<string, Agg>();
    let truncado = false;
    /**
     * INBOUND_RECEPTION sozinho fecha abaixo do Seller Center (60 contra 80):
     * ele só conta a unidade quando ela vira vendável. Quem passa por
     * quarentena, ajuste ou transferência entra por outro tipo. Como já
     * conhecemos os nomes exatos, consultamos um por um — filtrado na origem
     * é muito mais barato que varrer tudo e jogar as vendas fora.
     */
    const TIPOS = ["INBOUND_RECEPTION", "QUARANTINE_RESTOCK", "ADJUSTMENT", "TRANSFER_DELIVERY"];
    // O tipo vem em MAIÚSCULA — a doc diz minúsculo e o ML recusa.
    const LIMITE = 100;
    /**
     * Voltas de scroll por tipo/chunk. 100 × 40 = 4.000 operações, folga
     * grande pro volume real (144 no período de 25 dias). O teto existe só
     * pra um scroll que não termine não virar laço infinito — e quando é
     * atingido, `truncado` avisa a tela.
     */
    const VOLTAS_MAX = 40;

    /**
     * Deduplicação por OPERAÇÃO — a correção da triplicação reportada em
     * produção (app mostrando 240 un numa remessa que o Seller Center fecha
     * em 80; 2 produtos × 120 contra 2 × 40).
     *
     * Causa: a doc do ML documenta `type` em minúsculo (`inbound_reception`);
     * mandamos MAIÚSCULO (comentário acima: "a doc diz minúsculo e o ML
     * recusa"). Quando o valor não casa, o ML não rejeita a query — ele
     * IGNORA o filtro e devolve todas as operações do período. Como o laço
     * roda uma vez por tipo, a MESMA operação voltava em cada passada e era
     * somada de novo. Com TRANSFER_DELIVERY já fora da soma (fix anterior),
     * sobravam 3 passadas somando as mesmas 80 unidades = 240.
     *
     * A chave é composta em vez de só o `id` porque o id do ML passa de 9e15
     * e o JSON.parse arredonda (mesmo motivo pelo qual a ordenação abaixo usa
     * date_created e não id) — juntar inventory_id + data + tipo elimina
     * qualquer risco de duas operações distintas colidirem no mesmo id
     * arredondado. Vale pra repetição por tipo, por chunk de inventory_id e
     * por sobreposição de paginação: qualquer operação só conta uma vez.
     */
    const opsVistas = new Set<string>();
    let duplicadasIgnoradas = 0;
    // O ML exige inventory_id, então mandamos todos os do Full de uma vez.
    for (const tipoBusca of TIPOS)
    for (let i = 0; i < invArr.length; i += 20) {
      const chunk = invArr.slice(i, i + 20);
      /**
       * ─── PAGINAÇÃO POR SCROLL, NÃO POR OFFSET ────────────────────────
       *
       * Este recurso IGNORA `offset`. Medido contra a API: com 144 operações
       * no período, `offset=0`, `offset=50` e `offset=100` devolvem as
       * MESMAS 100 linhas — mesmo primeiro id, mesmo último id. A resposta
       * traz `paging.scroll` e `paging.limit: null`, que é a assinatura de
       * paginação por token.
       *
       * O efeito era silencioso e caro: o app lia as primeiras 100 operações
       * e as voltas seguintes traziam as mesmas, que a deduplicação
       * descartava corretamente. As outras 44 NUNCA eram buscadas — 30% das
       * unidades sumiam da remessa, e nada na tela dizia que faltava algo.
       * Era isto que fazia as quantidades do Full fecharem abaixo do
       * Seller Center.
       *
       * Cada operação vale POUCAS unidades (o ML emite uma linha por evento
       * de recebimento, normalmente 1 un), então uma remessa de 500 unidades
       * gera centenas de linhas — o teto de 100 era atingido sempre nas
       * remessas grandes, justamente as que mais importam.
       *
       * Com scroll, 3 voltas alcançaram as 144 de 144.
       */
      let scroll: string | null = null;
      for (let volta = 0; volta < VOLTAS_MAX; volta++) {
        if (volta + 1 >= VOLTAS_MAX) truncado = true;
        if (volta > 0) await new Promise((r) => setTimeout(r, 200));
        let lote = 0;
        /**
         * Operações INÉDITAS nesta volta. É este o critério de parada, e não
         * só o token: o recurso já provou repetir a mesma página quando o
         * parâmetro de paginação não é o que ele espera (foi o que o `offset`
         * fazia). Se uma volta não trouxe nada novo, insistir só queima cota
         * do ML — e cota estourada aqui vira 429, que derruba a tela inteira.
         */
        let novasNaVolta = 0;
        try {
          const path =
            `/stock/fulfillment/operations/search?seller_id=${SELLER_ID}` +
            `&inventory_id=${chunk.join(",")}&type=${tipoBusca}` +
            `&date_from=${from}&date_to=${to}&limit=${LIMITE}` +
            (scroll ? `&scroll=${encodeURIComponent(scroll)}` : "");
          const res = await fetch(`${ML_API}${path}`, { headers, cache: "no-store" });
          opStatus = res.status;
          if (!res.ok) {
            if (!opErro) {
              opErro = (await res.text().catch(() => "")).slice(0, 300);
              opUrl = path.slice(0, 200);
            }
            // Insistir depois de estourar a cota só piora — para tudo.
            break;
          }
          const j = (await res.json()) as {
            results?: Record<string, unknown>[];
            data?: Record<string, unknown>[];
            paging?: { scroll?: string | null };
          };
          const linhas = j.results ?? j.data ?? [];
          lote = linhas.length;
          // Token da PRÓXIMA volta. Sem ele não há mais o que buscar.
          scroll = j.paging?.scroll ?? null;
          for (const r of linhas) {
            const tipo = String(r.type ?? r.operation_type ?? "");
            tiposVistos.add(tipo);
            // Ver `opsVistas` acima: mesma operação voltando em outra passada
            // de tipo/chunk/página não pode somar de novo.
            const chaveOp = `${String(r.id ?? "")}|${String(r.inventory_id ?? "")}|${String(r.date_created ?? "")}|${tipo}`;
            if (opsVistas.has(chaveOp)) { duplicadasIgnoradas++; continue; }
            opsVistas.add(chaveOp);
            novasNaVolta++;
            // 60 recebidas contra 80 na tela do ML: faltam 20 e não dá pra
            // saber onde sem ver as linhas. São poucas — mostramos todas.
            if (!amostra) amostra = JSON.stringify(r).slice(0, 900);
            if (amostras.length < 25) amostras.push(JSON.stringify(r).slice(0, 500));

            const refs = (r.external_references ?? []) as { type?: string; value?: string }[];
            const remessa = String(refs.find((x) => x?.type === "inbound_id")?.value ?? "");
            // Devolução de cliente também volta ao Full com inbound_id próprio.
            // Se ela trouxer alguma referência a mais (shipment_id, order_id),
            // dá pra separar envio nosso de devolução — sem isso, automatizar
            // faria toda devolução descontar do estoque de casa.
            const outrasRefs = refs.map((x) => String(x?.type ?? "")).filter((t) => t && t !== "inbound_id");
            // Ajuste/transferência sem remessa é movimento avulso do Full,
            // nada a ver com envio nosso — não pode virar baixa de estoque.
            if (!remessa) continue;
            const inventory = String(r.inventory_id ?? "");
            const quando = String(r.date_created ?? "");
            const data = quando.slice(0, 10);

            const det = (r.detail ?? {}) as Record<string, unknown>;
            const detProblemas = (det.not_available_detail ?? []) as { status?: string; quantity?: number }[];
            const entrou = Number(det.available_quantity ?? 0);
            const ruins = detProblemas.reduce((s, p) => s + Number(p?.quantity ?? 0), 0);

            const res2 = (r.result ?? {}) as Record<string, unknown>;

            const agg = porRemessaAgg.get(remessa) ?? {
              data, recebido: 0, problema: 0, porInventory: new Map<string, number>(),
              porTipo: new Map<string, number>(), refs: new Set<string>(), saldoData: "", saldo: 0,
            };
            for (const t of outrasRefs) agg.refs.add(t);
            /**
             * TRANSFER_DELIVERY é unidade que JÁ chegou (via INBOUND_RECEPTION)
             * sendo redistribuída entre centros do Full — mesma unidade física,
             * evento novo. Somar isso em cima do INBOUND_RECEPTION duplicava a
             * remessa (visto em produção: app mostrando 1000/500/350 contra
             * 200/120/80 "processadas" no próprio Mercado Livre — cada produto
             * inflado num múltiplo diferente, batendo com quantas vezes cada um
             * foi redistribuído). Conta pra saldo/diagnóstico (porTipo), não
             * pro total que vira baixa de estoque.
             */
            const contaComoRecebido = tipo !== "TRANSFER_DELIVERY";
            if (contaComoRecebido) {
              agg.recebido += entrou;
              if (inventory) agg.porInventory.set(inventory, (agg.porInventory.get(inventory) ?? 0) + entrou);
            }
            agg.problema += ruins;
            // Só `entrou` aqui: a soma dos tipos precisa bater com "recebido"
            // (que também só soma entrou). Incluir "ruins" fazia o total da
            // quebra por tipo, mostrado do lado do recebido, não bater com ele.
            agg.porTipo.set(tipo, (agg.porTipo.get(tipo) ?? 0) + entrou);
            if (data < agg.data) agg.data = data;
            // Ordenamos por date_created: o `id` do ML passa de 9e15 e o
            // JSON.parse já o arredonda, então comparar id não é confiável.
            if (quando > agg.saldoData) {
              agg.saldoData = quando;
              agg.saldo = Number(res2.total ?? 0);
            }
            porRemessaAgg.set(remessa, agg);

            recebimentos.push({ data, quantidade: entrou, inventory_id: inventory, tipo });
          }
        } catch { break; }
        // Acabou de três formas: lote incompleto, sem token pra pedir mais,
        // ou a volta não trouxe nenhuma operação nova (página repetida).
        if (lote < LIMITE || !scroll || novasNaVolta === 0) break;
      }
    }
    recebimentos.sort((a, b) => b.data.localeCompare(a.data));

    // Uma remessa (#71140809) pode conter vários produtos: somamos os
    // inventory_id dela para poder comparar com a tela do Seller Center.
    const tituloPorInventory = new Map<string, { nome: string; cadastrado: boolean; productId: string }>();
    for (const it of itens) {
      if (!it.inventory_id) continue;
      const jaTem = tituloPorInventory.get(it.inventory_id);
      const prod = produtoPorMlb.get(it.mlb);
      const cad = !!prod;
      // Um inventory_id pode servir a mais de um anúncio: basta um cadastrado.
      if (!jaTem || (cad && !jaTem.cadastrado)) {
        tituloPorInventory.set(it.inventory_id, {
          nome: prod?.nome || it.title,
          cadastrado: cad || (jaTem?.cadastrado ?? false),
          productId: prod?.id ?? jaTem?.productId ?? "",
        });
      }
    }

    const remessas = Array.from(porRemessaAgg.entries())
      .map(([remessa, a]) => ({
        remessa: remessa || "—",
        data: a.data,
        recebido: a.recebido,
        problema: a.problema,
        saldoFull: a.saldo,
        refs: Array.from(a.refs),
        /**
         * Remessa sua sempre tem INBOUND_RECEPTION. Só TRANSFER_DELIVERY é
         * unidade vinda de outro centro do ML — ou seja, parte de uma remessa
         * anterior que foi redirecionada, e não um envio novo. Tratar isso
         * como envio faria a baixa acontecer duas vezes.
         */
        ehTransferencia: !a.porTipo.has("INBOUND_RECEPTION"),
        tipos: Array.from(a.porTipo.entries())
          .filter(([, q]) => q > 0)
          .sort((p, q) => q[1] - p[1])
          .map(([tipo, qtd]) => ({ tipo, qtd })),
        // Produto sem cadastro aparece pelo inventory_id cru e marcado — é
        // exatamente o caso que fazia a remessa fechar a menos.
        produtos: Array.from(a.porInventory.entries())
          .sort((p, q) => q[1] - p[1])
          .map(([inv, qtd]) => ({
            inventory: inv,
            nome: tituloPorInventory.get(inv)?.nome ?? "",
            cadastrado: tituloPorInventory.get(inv)?.cadastrado ?? false,
            productId: tituloPorInventory.get(inv)?.productId ?? "",
            qtd,
          })),
      }))
      .sort((x, y) => y.data.localeCompare(x.data));

    /**
     * Custo da COLETA/remessa pro Full — a taxa que o ML cobra pra levar seu
     * estoque de casa até o centro de distribuição (no Seller Center aparece
     * como "R$ 81,70", "R$ 63" etc. na lista de envios).
     *
     * É um custo REAL que não estava em lugar nenhum do app: `totalEnvio` do
     * Dashboard/DRE é só o `shipping_cost` de cada PEDIDO — frete de SAÍDA,
     * do centro até o comprador. A entrada (essa coleta) nunca entrava em
     * nenhuma conta, então o lucro estava otimista pelo valor dela.
     *
     * O id da remessa (inbound_id) é um shipment do ML, então tentamos os
     * mesmos endpoints de custo que lib/ml/sync.ts já usa pro frete de saída.
     * Best-effort de propósito: se o ML não expuser custo pra shipment de
     * entrada, `custo` fica null e a tela mostra "não informado pela API" em
     * vez de fingir R$ 0,00 (que subestimaria o custo e inflaria o lucro).
     */
    const CUSTO_MAX_REMESSAS = 20; // teto de chamadas — o resto fica sem custo, sem estourar cota
    const alvosCusto = remessas.filter((r) => r.remessa !== "—").slice(0, CUSTO_MAX_REMESSAS);
    const custoPorRemessa = new Map<string, number>();
    let custoRemessaIndisponivel = 0; // recalculado depois do merge com o manual
    await mapPool(alvosCusto, 4, async (r) => {
      /**
       * Duas tentativas, nesta ordem. Nenhuma e documentada pra inbound — a
       * doc de Fulfillment do ML diz que a API so expoe estoque e operacoes —
       * mas o inbound_id e um shipment, entao vale tentar os mesmos caminhos
       * que ja funcionam pro frete de saida antes de exigir digitacao.
       */
      try {
        const rc = await fetch(`${ML_API}/shipments/${r.remessa}/costs`, { headers, cache: "no-store" });
        if (rc.ok) {
          const jc = (await rc.json()) as { senders?: { cost?: number }[]; gross_amount?: number };
          const senders = Array.isArray(jc?.senders) ? jc.senders : [];
          const soma = senders.reduce((s, x) => s + Number(x?.cost ?? 0), 0);
          const valor = soma > 0 ? soma : Number(jc?.gross_amount ?? 0);
          if (valor > 0) { custoPorRemessa.set(r.remessa, valor); return; }
        }
      } catch { /* cai na 2a tentativa */ }

      try {
        const rs = await fetch(`${ML_API}/shipments/${r.remessa}`, { headers, cache: "no-store" });
        if (rs.ok) {
          const js = (await rs.json()) as {
            base_cost?: number;
            shipping_option?: { cost?: number; list_cost?: number };
          };
          const valor = Number(js?.shipping_option?.list_cost ?? 0)
            || Number(js?.shipping_option?.cost ?? 0)
            || Number(js?.base_cost ?? 0);
          if (valor > 0) { custoPorRemessa.set(r.remessa, valor); return; }
        }
      } catch { /* segue sem custo da API */ }
    });

    /**
     * Custo informado a mao, por remessa (colecao full_remessas).
     *
     * A doc oficial de Fulfillment do ML e explicita: "atraves das APIs voce
     * pode apenas consultar o estoque de fulfillment e as operacoes
     * realizadas". O custo da coleta NAO tem endpoint publico — ele aparece
     * so na tela de detalhe do envio no Seller Center ("Tarifas > Custo da
     * coleta Full"), normalmente marcado como ESTIMADO (volume x distancia).
     * Por isso a tentativa por API acima quase sempre volta vazia, e o valor
     * digitado e o que de fato alimenta a DRE.
     */
    const custoManualPorRemessa = new Map<string, number>();
    try {
      const remessaSnap = await db.collection("full_remessas").get();
      for (const doc of remessaSnap.docs) {
        const v = Number(doc.data()?.custoManual);
        if (Number.isFinite(v) && v > 0) custoManualPorRemessa.set(doc.id, v);
      }
    } catch { /* sem custo manual: segue so com o que a API devolveu */ }

    const remessasComCusto = remessas.map((r) => {
      // API tem prioridade quando existe (é o valor cravado pelo ML); o
      // digitado entra como complemento, não como concorrente.
      const daApi = custoPorRemessa.get(r.remessa) ?? null;
      const manual = custoManualPorRemessa.get(r.remessa) ?? null;
      return {
        ...r,
        // null (não 0) quando ninguém informou — a tela precisa distinguir
        // "coleta de graça" de "não sabemos quanto custou".
        custo: daApi ?? manual,
        custoEstimado: daApi == null && manual != null,
      };
    });
    const custoTotalRemessas = remessasComCusto.reduce((s, r) => s + (r.custo ?? 0), 0);

    // Recalculado apos o merge: o que interessa pra tela e quantas remessas
    // continuam sem NENHUM custo (nem da API, nem digitado).
    custoRemessaIndisponivel = remessasComCusto.filter((r) => r.custo == null && !r.ehTransferencia).length;

    /**
     * Disponível no Full com cada POOL contado uma vez.
     *
     * `itens` tem uma entrada por par (anúncio, inventory_id) — e o Mercado
     * Livre permite dois anúncios dividirem o MESMO pool no centro de
     * distribuição, cada um respondendo `available_quantity` com o pool
     * inteiro. Somar direto dobrava o número: era o mesmo bug já corrigido do
     * lado do Estoque em adacd6d, que passou batido aqui.
     *
     * Reusa consolidarEstoqueAnuncios (lib/domain/estoque.ts, com testes) em
     * vez de repetir a regra — foi justamente ter duas cópias da mesma conta
     * que deixou uma delas para trás. Todo item aqui já passou pelo filtro de
     * Full lá em cima, daí o logistic fixo.
     */
    const { full: totalDisponivel } = consolidarEstoqueAnuncios(
      itens.map((it) => ({ available: it.available, logistic: "fulfillment", inventoryId: it.inventory_id })),
    );
    /**
     * `sold` NÃO deduplica, de propósito: quantidade vendida é do ANÚNCIO, não
     * do pool. Dois anúncios sobre o mesmo estoque têm vendas próprias e
     * somá-las é o correto — ao contrário do disponível, que é o mesmo monte
     * de caixas visto de duas vitrines.
     */
    const totalVendido = itens.reduce((s, it) => s + it.sold, 0);

    /**
     * Consolidação do indisponível. Cada pool entra UMA vez (a chave já é o
     * inventory_id), então aqui não há o risco de dobra que existe do lado do
     * `available` — ver consolidarEstoqueAnuncios.
     */
    const indisponivelPorStatus = new Map<string, number>();
    let totalIndisponivel = 0;
    for (const d of estoqueDetalhe.values()) {
      totalIndisponivel += d.indisponivel;
      for (const [st, q] of d.porStatus) indisponivelPorStatus.set(st, (indisponivelPorStatus.get(st) ?? 0) + q);
    }

    /** Produto afetado, pra tela poder dizer QUAL item está retido. */
    const indisponivelPorProduto = Array.from(estoqueDetalhe.entries())
      .filter(([, d]) => d.indisponivel > 0)
      .map(([inv, d]) => ({
        inventory: inv,
        nome: tituloPorInventory.get(inv)?.nome ?? "",
        productId: tituloPorInventory.get(inv)?.productId ?? "",
        disponivel: d.disponivel,
        indisponivel: d.indisponivel,
        porStatus: Array.from(d.porStatus.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([status, qtd]) => ({ status, qtd })),
      }))
      .sort((a, b) => b.indisponivel - a.indisponivel);

    const estoqueFull = {
      totalIndisponivel,
      porStatus: Array.from(indisponivelPorStatus.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([status, qtd]) => ({ status, qtd })),
      porProduto: indisponivelPorProduto,
      // Quantos pools não responderam: sem isto, "0 indisponível" seria
      // indistinguível de "não consegui perguntar".
      poolsConsultados: estoqueDetalhe.size,
      poolsFalharam: detalheFalhou,
      poolsForaDoTeto: Math.max(0, invArr.length - INV_DETALHE_MAX),
    };

    const body = { itens, recebimentos, estoqueFull, totalDisponivel, totalVendido, temInventory: invArr.length > 0, opStatus, opErro, opUrl, tiposVistos: Array.from(tiposVistos), amostra, amostras, remessas: remessasComCusto, custoTotalRemessas, custoRemessaIndisponivel, truncado, linhasBrutas: recebimentos.length, duplicadasIgnoradas, dias, janela: { from, to }, inventariosConsultados: invArr.length, anunciosDaConta: arr.length };
    // Só guarda resposta boa: cachear erro esconderia o problema por 5 minutos.
    if (opStatus === 200) cache.set(chaveCache, { at: Date.now(), body });
    return NextResponse.json(body);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "gestao_full_failed", details: msg }, { status: 500 });
  }
}
