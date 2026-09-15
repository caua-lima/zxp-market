import { NextResponse } from "next/server";
import { etapaFalhou, resumir } from "@/lib/domain/sync-resultado";
import { getMlAccessToken } from "../token";
import { requireAccess } from "@/lib/api-auth";
import { dispararMarcos } from "@/lib/marcos-gatilho";
import {
  currentMonthRangeBR,
  lastNDaysRangeBR,
  syncOrdersRange,
  syncReturnsRange,
  syncClaimsRange,
  type SyncRange,
} from "@/lib/ml/sync";

export const maxDuration = 60;

function rangeFromRequest(req: Request): SyncRange {
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const days = url.searchParams.get("days");

  if (from && to) {
    return { from: `${from}T00:00:00.000-03:00`, to: `${to}T23:59:59.999-03:00` };
  }
  if (days) {
    const n = Number(days);
    if (Number.isFinite(n) && n > 0) return lastNDaysRangeBR(n);
  }
  return currentMonthRangeBR();
}

export async function POST(req: Request) {
  const gate = await requireAccess(req, { allowCron: true, capacidade: "ver_operacao" });
  if (gate instanceof NextResponse) return gate;

  try {
    const accessToken = await getMlAccessToken();
    if (!accessToken) {
      return NextResponse.json({ error: "Token não encontrado" }, { status: 400 });
    }

    const range = rangeFromRequest(req);

    /**
     * Cada etapa devolve se COMPLETOU, não só quantos registros gravou.
     *
     * Antes o `.catch(() => 0)` do claims transformava falta de permissão em
     * "zero reclamações sincronizadas" — indistinguível de "não houve
     * reclamação". A rota respondia `savedClaims: 0` com `ok: true`, e
     * ninguém tinha como saber a diferença entre "está tudo em ordem" e "não
     * consegui olhar".
     */
    const etapas = await Promise.all([
      syncOrdersRange(accessToken, range).catch((e) => etapaFalhou("pedidos", e)),
      syncReturnsRange(accessToken, range).catch((e) => etapaFalhou("devolucoes", e)),
      syncClaimsRange(accessToken, range).catch((e) => etapaFalhou("reclamacoes", e)),
    ]);
    const resumo = resumir(etapas);

    /**
     * Marcos, DEPOIS do sync: as vendas que acabaram de entrar ja contam.
     *
     * Rodava so no cron diario, e passar de R$ 10 mil as 14h de terca so era
     * comemorado as 6h de quarta. O sync roda a cada 15 minutos com o painel
     * aberto, entao o aviso passa a chegar no mesmo dia.
     *
     * Best-effort de proposito: comemoracao nunca pode derrubar a
     * sincronizacao, que e o que mantem o painel correto.
     */
    const marcos = await dispararMarcos(
      new URL(req.url).origin,
      req.headers.get("authorization"),
    ).catch(() => null);

    /**
     * `ok` deixa de significar "a requisição não explodiu" e passa a
     * significar "sincronizou tudo". Quem consome precisa dessa diferença pra
     * saber se o painel está completo.
     */
    return NextResponse.json({
      ok: resumo.completo,
      completo: resumo.completo,
      incompletas: resumo.incompletas,
      etapas: resumo.etapas,
      // Nomes antigos preservados: outras telas leem estes campos.
      savedOrders: etapas[0].gravados,
      savedReturns: etapas[1].gravados,
      savedClaims: etapas[2].gravados,
      range,
      marcos,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "sync_failed", details: msg }, { status: 500 });
  }
}
