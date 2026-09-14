import { NextResponse } from "next/server";
import { diaRelativoBR, diasNaJanela, janelaDeDias } from "@/lib/domain/janela-dias";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAccess } from "@/lib/api-auth";
import { fetchMlUserProfileFresh } from "@/lib/ml/account";
import { calcularCompradoresPeriodo } from "@/lib/domain/repurchase";
import { calcularConcentracaoVendas } from "@/lib/domain/sales-heatmap";
import { calcularEntregasNoPrazo } from "@/lib/domain/shipping-performance";
import { avaliarRequisitosMercadoLider, type ReputationParaChecklist } from "@/lib/domain/mercadolider-requisitos";

// Cache generoso (30min) — essa rota fazia varredura SEM LIMITE de ml_orders
// (2x, UTC+BR) e ml_returns inteiro a cada abertura da aba, o que ajudou a
// estourar a cota diária do Firestore (Spark: 50k leituras/dia). Com 4
// botões de período (3/6/12/24 meses), cada um vira uma chave de cache
// própria — 30min reduz drasticamente quantas vezes isso roda de novo.
const cache = new Map<string, { at: number; body: Record<string, unknown> }>();
const CACHE_TTL = 30 * 60 * 1000;

// Teto do histórico usado só pra decidir "esse comprador já comprava antes
// do período?" — sem teto, a rota lia TODO ml_orders (podem ser milhares de
// documentos, 2x por causa do UTC/BR) toda vez que alguém abria a aba. Com
// o teto, um comprador cuja compra anterior foi há mais de
// months+HISTORICO_EXTRA_MESES atrás aparece como "novo" mesmo não sendo —
// a tela avisa disso via `historicoDesde` (ver calcularCompradoresPeriodo).
const HISTORICO_EXTRA_MESES = 24;

function isNaoVenda(status: unknown): boolean {
  const s = String(status ?? "").toLowerCase();
  return s === "cancelled" || s === "invalid";
}

/**
 * Reexporta a definicao compartilhada em vez de manter uma copia.
 *
 * Esta rota ja contava certo (-(dias-1)); /api/ml/reputacao-vendas, que recebe
 * o mesmo parametro da mesma tela, contava um dia a mais. Duas copias da mesma
 * conta e como as duas divergem — ver lib/domain/janela-dias.
 */
const brDayISO = diaRelativoBR;

function monthsAgoISO(months: number): string {
  const d = new Date(Date.now() - 3 * 3600 * 1000);
  d.setUTCMonth(d.getUTCMonth() - months);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export async function GET(req: Request) {
  const gate = await requireAccess(req, { capacidade: "ver_operacao" });
  if (gate instanceof NextResponse) return gate;

  try {
    const url = new URL(req.url);
    const monthsParam = Number(url.searchParams.get("months") ?? "12");
    const months = Number.isFinite(monthsParam) && monthsParam > 0 ? monthsParam : 12;
    /**
     * Janela em DIAS, opcional. Existe pra dar pra comparar o numero com o
     * painel "Detalhe dos compradores" do proprio Mercado Livre, que trabalha
     * em periodos curtos (7/15/30 dias) — com a janela em meses nao dava pra
     * conferir se a nossa taxa bate com a deles.
     */
    const diasParam = Number(url.searchParams.get("dias") ?? "");
    const dias = Number.isFinite(diasParam) && diasParam > 0 ? Math.floor(diasParam) : null;

    const cacheKey = dias != null ? `d${dias}` : String(months);
    const bust = url.searchParams.get("fresh") === "1";
    if (!bust) {
      const cached = cache.get(cacheKey);
      if (cached && Date.now() - cached.at < CACHE_TTL) {
        return NextResponse.json({ ...cached.body, cached: true });
      }
    }

    const db = getAdminDb();
    const toStr = brDayISO();
    const periodoInicio = dias != null ? janelaDeDias(dias).de : monthsAgoISO(months);
    const historicoInicio = monthsAgoISO(months + HISTORICO_EXTRA_MESES);

    const start = `${historicoInicio}T00:00:00.000Z`;
    const end = `${toStr}T23:59:59.999Z`;
    const startBR = `${historicoInicio}T00:00:00.000-03:00`;
    const endBR = `${toStr}T23:59:59.999-03:00`;

    const [snapUTC, snapBR, retUTC, retBR, perfil] = await Promise.all([
      db.collection("ml_orders").where("date_created", ">=", start).where("date_created", "<=", end).get(),
      db.collection("ml_orders").where("date_created", ">=", startBR).where("date_created", "<=", endBR).get(),
      db.collection("ml_returns").where("date_created", ">=", start).where("date_created", "<=", end).get(),
      db.collection("ml_returns").where("date_created", ">=", startBR).where("date_created", "<=", endBR).get(),
      fetchMlUserProfileFresh(),
    ]);

    const ordersMap = new Map<string, FirebaseFirestore.DocumentData>();
    for (const snap of [snapUTC, snapBR]) for (const doc of snap.docs) ordersMap.set(doc.id, doc.data());

    // Cancelamento/devolução não é venda de verdade — mesmo critério do
    // resto do app. Conservador: exclui até devolução ainda em disputa.
    const excluidos = new Set<string>();
    for (const snap of [retUTC, retBR]) for (const doc of snap.docs) excluidos.add(doc.id);

    const validosBrutos = Array.from(ordersMap.entries())
      .filter(([id, d]) => !excluidos.has(id) && !isNaoVenda(d.status));
    /**
     * Pedido valido do periodo SEM buyer_id nao entra na conta de compradores
     * e puxa a taxa de recompra pra baixo sem aviso. Ate agora o webhook nao
     * gravava esse campo (so o sync completo), entao era o caso comum nos
     * pedidos recentes — expor o numero e o que torna o problema visivel.
     */
    const semComprador = validosBrutos.filter(([, d]) => {
      const dia = String(d.date_created ?? "").slice(0, 10);
      return !d.buyer_id && dia >= periodoInicio && dia <= toStr;
    }).length;

    const validos = validosBrutos
      .map(([, d]) => ({
        buyer_id: (d.buyer_id as string | null | undefined) ?? null,
        date_created: String(d.date_created ?? ""),
        estimatedDelivery: d.estimated_delivery ? String(d.estimated_delivery) : undefined,
        dateDelivered: d.date_delivered ? String(d.date_delivered) : undefined,
      }));

    // Compradores usa o histórico ESTENDIDO (months + HISTORICO_EXTRA_MESES)
    // pra saber quem já comprava antes do período, sem escanear a coleção inteira.
    const compradores = calcularCompradoresPeriodo(validos, periodoInicio, toStr);

    // Data mais antiga que a gente realmente tem sincronizada — se for depois
    // do início do período, "novos" está inflado (não é que ninguém recomprou,
    // é que não temos como saber; a tela avisa em vez de fingir certeza).
    const datasValidas = validos.map((o) => o.date_created.slice(0, 10)).filter(Boolean);
    const historicoDesde = datasValidas.length > 0 ? datasValidas.reduce((min, d) => (d < min ? d : min)) : null;

    // Heatmap e entregas usam só o que caiu DENTRO do período pedido.
    const noPeriodo = validos.filter((o) => {
      const dia = o.date_created.slice(0, 10);
      return dia >= periodoInicio && dia <= toStr;
    });
    const heatmap = calcularConcentracaoVendas(noPeriodo);
    const entregas = calcularEntregasNoPrazo(noPeriodo);

    const reputacao = (perfil?.seller_reputation as Record<string, unknown> | undefined) ?? null;

    const body = {
      months,
      dias,
      // O tamanho REAL da janela, pra a tela nao ter que reconstruir a conta.
      diasCobertos: diasNaJanela(periodoInicio, toStr),
      semComprador,
      from: periodoInicio,
      to: toStr,
      compradores,
      historicoDesde,
      heatmap,
      entregas,
      reputacao,
      reputacaoIndisponivel: perfil == null,
      registrationDate: perfil?.registration_date ?? null,
      requisitosMercadoLider: avaliarRequisitosMercadoLider(reputacao as unknown as ReputationParaChecklist | null),
    };
    cache.set(cacheKey, { at: Date.now(), body });
    return NextResponse.json(body);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "desempenho_failed", details: msg }, { status: 500 });
  }
}
