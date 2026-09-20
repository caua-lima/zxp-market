import { NextResponse } from "next/server";
import { isCronRequest, requireAccess } from "@/lib/api-auth";
import { enviarEPersistirEntrega } from "@/lib/notification-dispatch";
import { createNotificationEventIdempotent } from "@/lib/notification-events";
import { montarResumoDiario } from "@/lib/domain/resumo-diario";
import { calculateBreakEvenRoas } from "@/lib/domain/ads";
import { findProdutosEmRisco, type RiskProduto } from "@/lib/domain/risk";
import { getAdminDb } from "@/lib/firebase/admin";
import type { SalePushPayload } from "@/lib/domain/notifications";

export const maxDuration = 60;

/**
 * Resumo do dia, enviado por push no fim do expediente.
 *
 * Não recalcula nada: consome /api/ml/metrics e /api/ml/ads, que são as
 * MESMAS fontes do Dashboard e da aba Ads. Se o resumo divergisse do que a
 * tela mostra, ele viraria mais uma coisa pra conferir em vez de poupar
 * tempo — então tem que ser literalmente o mesmo número.
 *
 * Idempotente por dia: `dedupeKey` é `resumo_diario:{data}`. Se o cron rodar
 * duas vezes (retry da Vercel, disparo manual pra testar), o segundo não cria
 * evento nem manda push duplicado.
 */

function brDayISO(): string {
  const d = new Date(Date.now() - 3 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

async function handler(req: Request) {
  try {
    const origem = new URL(req.url).origin;
    const hoje = brDayISO();
    // Repassa a credencial de quem chamou: as rotas internas exigem acesso, e
    // o cron da Vercel manda o Bearer do CRON_SECRET.
    const auth = req.headers.get("authorization");
    const headers: Record<string, string> = auth ? { Authorization: auth } : {};

    const [rMetrics, rAds, rForecast] = await Promise.all([
      fetch(`${origem}/api/ml/metrics?from=${hoje}&to=${hoje}`, { headers, cache: "no-store" }),
      fetch(`${origem}/api/ml/ads?from=${hoje}&to=${hoje}`, { headers, cache: "no-store" }).catch(() => null),
      // Best-effort: sem forecast, produtosEmRisco fica 0 em vez de derrubar o resumo inteiro.
      fetch(`${origem}/api/ml/estoque-forecast?dias=30`, { headers, cache: "no-store" }).catch(() => null),
    ]);

    if (!rMetrics.ok) {
      return NextResponse.json({ error: "metrics_indisponivel", status: rMetrics.status }, { status: 502 });
    }
    const m = (await rMetrics.json()) as {
      hoje?: { faturamentoLiquido?: number; pedidos?: number; lucroLiquido?: number; faturamentoBruto?: number };
      adsFalhou?: boolean;
      anuncios?: { item_id: string; lucro: number }[];
    };

    const h = m.hoje ?? {};
    const faturamento = Number(h.faturamentoLiquido ?? 0);
    const pedidos = Number(h.pedidos ?? 0);
    /**
     * Sem o gasto de Ads confirmado, o lucro do dia é OTIMISTA — falta
     * descontar a publicidade. Melhor mandar "ainda não calculável" do que um
     * número que a pessoa vai usar pra decidir. Mesma regra que o Dashboard
     * já aplica com `adsFalhou`.
     */
    const lucro = m.adsFalhou ? null : Number(h.lucroLiquido ?? 0);
    const bruto = Number(h.faturamentoBruto ?? 0);
    const margem = lucro != null && bruto > 0 ? (lucro / bruto) * 100 : null;

    // Anúncios abaixo do break-even hoje — o mesmo cálculo da aba Ads.
    let anunciosNoPrejuizo = 0;
    if (rAds?.ok) {
      const a = (await rAds.json()) as {
        items?: { cost: number; totalSales: number; lucroAntesAds: number }[];
      };
      for (const it of a.items ?? []) {
        if (it.cost <= 0) continue;
        const be = calculateBreakEvenRoas(it.totalSales, it.lucroAntesAds);
        const roas = it.totalSales / it.cost;
        if (be != null && roas < be) anunciosNoPrejuizo += 1;
      }
    }

    // Produtos ativos com cobertura de estoque crítica (<7 dias pela mesma
    // régua da aba Estoque). Reaproveita findProdutosEmRisco (lib/domain/risk.ts)
    // em vez de recalcular a régua aqui — margem fica de fora de propósito
    // (metaMargem: 0 nunca dispara "margem-baixa"): este resumo já tem sua
    // própria linha de margem, contar de novo aqui duplicaria o aviso.
    let produtosEmRisco = 0;
    if (rForecast?.ok) {
      try {
        const forecast = (await rForecast.json()) as { vendas?: Record<string, number>; dias?: number };
        const prodSnap = await getAdminDb().collection("estoque").get();
        const produtos: RiskProduto[] = prodSnap.docs.map((d) => {
          const p = d.data();
          return {
            id: String(p.id ?? d.id), name: String(p.name ?? ""), ativo: Boolean(p.ativo),
            qtdLocal: Number(p.qtdLocal ?? 0), mlb: p.mlb, mlbs: p.mlbs,
          };
        });
        const riscos = findProdutosEmRisco(produtos, [], 0, { vendas: forecast.vendas ?? {}, dias: forecast.dias ?? 30 });
        produtosEmRisco = riscos.filter((r) => r.motivos.includes("estoque-baixo")).length;
      } catch { /* best-effort — resumo segue sem esta linha */ }
    }

    const conteudo = montarResumoDiario({
      faturamento, pedidos, lucro, margem,
      // Meta diária depende de configuração por mês e não está nesta rota;
      // omitir é melhor do que exibir uma meta errada.
      metaDiaria: null,
      produtosEmRisco,
      anunciosNoPrejuizo,
    });

    const dedupeKey = `resumo_diario:${hoje}`;
    const { eventId } = await createNotificationEventIdempotent({
      type: "system", severity: "info", entityType: "system", entityId: hoje, dedupeKey,
      title: conteudo.title, body: conteudo.body,
      financialState: lucro == null ? "unavailable" : "estimated",
      deepLink: "/",
    });

    const payload: SalePushPayload = {
      eventId, type: "system", title: conteudo.title, body: conteudo.body,
      tag: `resumo-${hoje}`, deepLink: "/", timestamp: new Date().toISOString(),
    };
    // Respeita as preferências de cada pessoa, igual ao resto: quem desligou
    // resumo não recebe, e horário silencioso vale (não é evento crítico).
    // Publica também quando o evento do dia já existia: o `jaEnviado` que havia
    // aqui tratava "já existe" como "já entregue", e um envio que falhou na
    // primeira vez nunca era refeito. O que já foi aceito não é reenviado.
    const enviados = await enviarEPersistirEntrega(eventId, "system", payload, true, { origem: "resumo-diario" });

    return NextResponse.json({ ok: true, dia: hoje, enviados, title: conteudo.title, body: conteudo.body });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "resumo_diario_failed", details: msg }, { status: 500 });
  }
}

/** GET = chamada do Vercel Cron. */
export async function GET(req: Request) {
  if (!isCronRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return handler(req);
}

/** POST = disparo manual pra testar sem esperar o horário. */
export async function POST(req: Request) {
  const gate = await requireAccess(req, { allowCron: true, capacidade: "administrar" });
  if (gate instanceof NextResponse) return gate;
  return handler(req);
}
