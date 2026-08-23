import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getMlAccessToken, getSellerId, resolverTenantDaRequisicao } from "@/lib/tenant";

const ML_API = "https://api.mercadolibre.com";
export const maxDuration = 30;

/**
 * Visitas dos anúncios da conta — o topo do funil que o app nunca teve.
 *
 * ─── POR QUE `time_window` E NÃO `date_from/date_to` ────────────────────
 *
 * O caminho óbvio seria `/users/{id}/items_visits?date_from=…&date_to=…`.
 * Testado contra a conta: ele RECUSA o ISO com offset que o resto do app usa
 * — `{"message":"Invalid request unknown date format: 2026-08-01T00:00:00.000-03:00"}`.
 *
 * `items_visits/time_window?last=N&unit=day` responde 200 e, melhor, devolve
 * a série DIÁRIA junto. Com os dias na mão dá pra recortar exatamente o
 * período pedido em vez de depender do que a API entendeu por janela.
 *
 * Conferido contra o Seller Center no mesmo intervalo: 5.072 aqui contra
 * 5.065 lá — 0,14%. A diferença é esperada e tem causa conhecida: o painel
 * deduplica por VISITANTE ("Visitas únicas") e a API conta VISITAS. O número
 * daqui vem igual ou um pouco acima, nunca abaixo.
 *
 * ─── O DEGRAU QUE NÃO EXISTE ────────────────────────────────────────────
 *
 * O painel do ML tem três degraus: visitas → intenção de compra → vendas. A
 * "intenção de compra" vem de sinais internos (carrinho, checkout iniciado)
 * que NENHUM endpoint público devolve. Esta rota entrega visitas e conversão
 * real; estimar o degrau do meio seria pior que não tê-lo — quem comparasse
 * com o ML acharia o app quebrado, e pior, poderia decidir em cima de um
 * número inventado.
 */

/** Teto do `last` aceito pelo recurso. Acima disso o ML recusa a janela. */
const MAX_DIAS = 150;

function diaBR(offset = 0): string {
  const d = new Date(Date.now() - 3 * 3600 * 1000 + offset * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  const tenant = await resolverTenantDaRequisicao(gate);
  if (!tenant) return NextResponse.json({ error: "sem_tenant", visitas: null }, { status: 403 });

  try {
    const url = new URL(req.url);
    const hoje = diaBR();
    const from = (url.searchParams.get("from") || hoje).slice(0, 10);
    // Período do Dashboard vai até o fim do mês; a API não conhece o futuro.
    const toPedido = (url.searchParams.get("to") || hoje).slice(0, 10);
    const to = toPedido > hoje ? hoje : toPedido;

    const token = await getMlAccessToken(tenant.tenantId);
    if (!token) return NextResponse.json({ error: "sem_token", visitas: null }, { status: 200 });

    /**
     * Quantos dias pedir. A janela conta pra trás a partir de hoje, então
     * precisa alcançar `from` — e não só o tamanho do período, senão um
     * período antigo voltaria dias que não são os pedidos.
     */
    const diasAte = Math.ceil((Date.parse(`${hoje}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
    const last = Math.min(Math.max(diasAte, 1), MAX_DIAS);
    const foraDoAlcance = diasAte > MAX_DIAS;

    const r = await fetch(
      `${ML_API}/users/${await getSellerId(tenant.tenantId)}/items_visits/time_window?last=${last}&unit=day`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store" },
    );
    if (!r.ok) {
      const corpo = (await r.text().catch(() => "")).slice(0, 200);
      /**
       * `visitas: null`, nunca 0. "Ninguém visitou" e "não consegui perguntar"
       * levam a decisões opostas sobre o anúncio, e zero disfarçado de dado
       * real é o padrão de erro que já custou caro neste app.
       */
      return NextResponse.json(
        { error: "visitas_indisponivel", status: r.status, details: corpo, visitas: null, from, to },
        { status: 200 },
      );
    }

    const j = (await r.json()) as {
      results?: { date?: string; total?: number; visits_detail?: { company?: string; quantity?: number }[] }[];
    };

    // Recorte pelo dia pedido: a janela pode trazer dias antes de `from`.
    const porCanal = new Map<string, number>();
    const serie: { data: string; visitas: number }[] = [];
    let visitas = 0;
    for (const d of j.results ?? []) {
      const dia = String(d?.date ?? "").slice(0, 10);
      if (!dia || dia < from || dia > to) continue;
      const t = Number(d?.total ?? 0);
      visitas += t;
      serie.push({ data: dia, visitas: t });
      for (const c of d?.visits_detail ?? []) {
        const nome = String(c?.company ?? "").trim();
        if (nome) porCanal.set(nome, (porCanal.get(nome) ?? 0) + Number(c?.quantity ?? 0));
      }
    }

    return NextResponse.json({
      visitas,
      serie: serie.sort((a, b) => a.data.localeCompare(b.data)),
      porCanal: Array.from(porCanal.entries())
        .map(([canal, v]) => ({ canal, visitas: v }))
        .sort((a, b) => b.visitas - a.visitas),
      from,
      to,
      // Período mais antigo que a janela alcança: melhor dizer que o número é
      // parcial do que devolver um total que cobre menos do que foi pedido.
      parcial: foraDoAlcance,
      observacao:
        "visitas da API (não deduplicadas por visitante). O “Visitas únicas” do "
        + "Seller Center deduplica, então costuma vir ligeiramente abaixo deste número.",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "visitas_failed", details: msg, visitas: null }, { status: 500 });
  }
}
