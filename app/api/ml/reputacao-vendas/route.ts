import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getMlAccessToken } from "../token";
import { fetchOrdersLive } from "@/lib/ml/orders";
import { montarBlocoVendas, serieDiariaDeVendas } from "@/lib/domain/reputacao-vendas";
import { diasNaJanela, janelaDeDias } from "@/lib/domain/janela-dias";

export const maxDuration = 60;

/**
 * O bloco "Acompanhamos suas vendas nos últimos N dias" do Seller Center.
 *
 * ─── POR QUE AO VIVO, E NÃO DO BANCO ────────────────────────────────────
 *
 * O sync cobre mês atual + anterior. Uma janela de 60 dias alcança o mês
 * retrasado, e medindo em 22/08 o banco tinha ZERO pedidos de junho — a conta
 * fechava 691 contra 750 do painel. Buscar ao vivo fecha em 763/728/R$ 33.561
 * contra 750/727/R$ 33.377, e a diferença é só o que vendeu entre o print e a
 * consulta.
 *
 * As definições de cada número (três delas contraintuitivas) estão em
 * lib/domain/reputacao-vendas.ts.
 */

// Cache curto por lambda quente: são até 16 páginas do ML por chamada, e o
// painel de Desempenho recarrega a cada troca de aba.
let cache: { at: number; dias: number; body: Record<string, unknown> } | null = null;
const CACHE_TTL = 5 * 60 * 1000;


/**
 * O dia no fuso de Sao Paulo a partir do ISO que o ML devolve (com offset).
 * Agrupar por UTC jogaria as vendas da noite pro dia seguinte.
 */
function diaBRDeISO(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t - 3 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export async function GET(req: Request) {
  const gate = await requireAccess(req, { capacidade: "ver_operacao" });
  if (gate instanceof NextResponse) return gate;

  try {
    const url = new URL(req.url);
    // 60 é o que o Mercado Livre usa pra reputação; o parâmetro existe pra o
    // filtro de período da tela reaproveitar a mesma conta.
    const dias = Math.max(1, Math.min(180, Number(url.searchParams.get("dias") ?? 60) || 60));

    /**
     * REP-02: a janela era `de = diaBR(-dias)` com `ate = diaBR()`, e a busca
     * e INCLUSIVA nas duas pontas — com dias=60 isso cobria 61 datas: os 60
     * dias anteriores MAIS hoje.
     *
     * Pior, /api/ml/desempenho recebe o MESMO parametro da MESMA tela e ja
     * fazia -(dias-1). Os dois paineis liam um filtro so e contavam bases
     * diferentes: a reputacao saia com um dia a mais de vendas no denominador
     * do que o desempenho ao lado. Um dia a mais vira ~1,6% de erro na taxa de
     * reclamacao, sempre pra baixo — a direcao que engana.
     *
     * A definicao agora e uma so, em lib/domain/janela-dias.
     */
    const padrao = janelaDeDias(dias);
    const de = url.searchParams.get("from") || padrao.de;
    const ate = url.searchParams.get("to") || padrao.ate;

    /**
     * Quantas datas a janela cobre DE FATO. Quando a tela manda from/to
     * direto, o parametro `dias` deixa de descrever o intervalo — e quem le a
     * resposta precisa do numero real, nao do pedido.
     */
    const diasCobertos = diasNaJanela(de, ate);

    /**
     * REP-01: uma sub-janela calculada da MESMA busca.
     *
     * A tela de Desempenho pedia esta rota DUAS vezes — uma pra reputacao (60
     * dias) e outra pra medalha (3 meses + mes vigente) — e cada chamada e ate
     * 16 paginas de pedidos na API do ML. Como a janela da medalha CONTEM a da
     * reputacao, buscar de novo e pagar duas vezes pelos mesmos pedidos.
     *
     * Com `subFrom`/`subTo` a rota devolve os dois blocos de uma busca so.
     */
    const subDe = url.searchParams.get("subFrom");
    const subAte = url.searchParams.get("subTo");

    // A sub-janela entra na chave: senao uma resposta guardada sem `sub`
    // responderia a um pedido que pede `sub`, e a tela ficaria sem o bloco.
    const chave = `${de}|${ate}|${url.searchParams.get("subFrom") ?? ""}|${url.searchParams.get("subTo") ?? ""}`;
    if (cache && cache.dias === dias && cache.body.chave === chave && Date.now() - cache.at < CACHE_TTL) {
      return NextResponse.json({ ...cache.body, cached: true });
    }

    const token = await getMlAccessToken();
    if (!token) return NextResponse.json({ error: "sem_token", bloco: null }, { status: 200 });

    const pedidos = await fetchOrdersLive(
      token,
      `${de}T00:00:00.000-03:00`,
      `${ate}T23:59:59.999-03:00`,
    );
    if (!pedidos) {
      // null, nunca zeros: "não consegui perguntar" e "não vendeu nada" levam
      // a leituras opostas da reputação.
      return NextResponse.json({ error: "pedidos_indisponiveis", bloco: null, de, ate }, { status: 200 });
    }

    /**
     * Mapeia UMA vez e reaproveita: o bloco agregado e a serie diaria saem dos
     * mesmos pedidos, e percorrer a lista duas vezes com dois formatos e como
     * as duas contas divergem.
     */
    const paraDominio = pedidos.map((o) => ({
      orderId: String(o.order_id ?? ""),
      status: o.status,
      shippingId: (o.shipping_id as string | null | undefined) ?? null,
      packId: (o.pack_id as string | null | undefined) ?? null,
      total: Number(o.total_amount ?? 0),
      // Dia no fuso de Sao Paulo — date_created vem com offset do ML.
      dia: diaBRDeISO(String(o.date_created ?? "")),
    }));

    const bloco = montarBlocoVendas(paraDominio);

    // O bloco da sub-janela sai dos mesmos pedidos, so filtrando por dia.
    const blocoSub = subDe && subAte
      ? montarBlocoVendas(paraDominio.filter((p) => p.dia >= subDe && p.dia <= subAte))
      : null;

    /**
     * A serie por dia, pra a projecao da medalha poder simular a JANELA MOVEL.
     *
     * A janela e "3 meses + os dias do mes vigente": quando o mes vira, o mes
     * mais antigo sai dela inteiro. Sem saber o que cada dia produziu nao da
     * pra saber o que vai sair — e a projecao linear, que so somava ritmo,
     * prometia uma data que a conta nao alcanca.
     */
    const serie = serieDiariaDeVendas(paraDominio);

    const body = {
      bloco, serie, de, ate, dias, diasCobertos, chave,
      sub: blocoSub ? { bloco: blocoSub, de: subDe, ate: subAte } : null,
    };
    cache = { at: Date.now(), dias, body };
    return NextResponse.json(body);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "reputacao_vendas_failed", details: msg, bloco: null }, { status: 500 });
  }
}
