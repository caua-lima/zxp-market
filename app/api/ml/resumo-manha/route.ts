import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { chaveDoResumo, montarResumoManha } from "@/lib/domain/resumo-manha";
import { hojeBR } from "@/lib/marcos-gatilho";
import { lerNivelMercadoLider } from "@/lib/marcos-run";
import { notificarMarco } from "@/lib/ml/notificar-venda";

export const maxDuration = 60;

/**
 * O aviso das 7h — a média de faturamento do mês, sobre dias fechados.
 *
 * ─── POR QUE UM CRON PRÓPRIO ────────────────────────────────────────────
 *
 * Os outros rodam às 6h, 8h e 20h (BR) e existem pra sincronizar e apurar. Ao
 * meter este junto de um deles, ele sairia no horário do outro — e o valor
 * deste aviso É o horário: ele chega quando se está começando o dia e ainda dá
 * pra decidir alguma coisa com o número.
 *
 * ─── A JANELA ───────────────────────────────────────────────────────────
 *
 * Do dia 1º até ONTEM. O porquê está em lib/domain/resumo-manha.ts, junto do
 * cálculo — em resumo: incluir o dia corrente faria a média despencar toda
 * manhã e subir toda tarde sem nada ter acontecido.
 */
export async function GET(req: Request) {
  const gate = await requireAccess(req, { allowCron: true });
  if (gate instanceof NextResponse) return gate;

  const hoje = hojeBR();
  const mes = hoje.slice(0, 7);
  const origem = new URL(req.url).origin;
  const auth = req.headers.get("authorization");

  let serie: { dia: string; valor: number }[] = [];
  try {
    const r = await fetch(`${origem}/api/ml/metrics?month=${mes}`, {
      headers: auth ? { Authorization: auth } : {},
      cache: "no-store",
    });
    if (!r.ok) {
      return NextResponse.json({ erro: "metricas_indisponiveis", status: r.status }, { status: 200 });
    }
    const j = (await r.json()) as { serieDiaria?: { data: string; faturamento: number }[] };
    serie = (j.serieDiaria ?? []).map((d) => ({ dia: d.data, valor: Number(d.faturamento) || 0 }));
  } catch (err) {
    return NextResponse.json({
      erro: "metricas_falharam",
      detalhe: err instanceof Error ? err.message : String(err),
    }, { status: 200 });
  }

  const nivel = await lerNivelMercadoLider();
  const resumo = montarResumoManha(serie, hoje, nivel);
  if (!resumo) {
    // Dia 1º: não há dia fechado no mês, e média de zero dias não existe.
    return NextResponse.json({ ok: true, enviado: false, motivo: "sem_dia_fechado", hoje });
  }

  /**
   * A chave leva o DIA: se o cron rodar duas vezes (retry da Vercel, deploy no
   * horário), o segundo não manda nada. A mesma garantia que os marcos usam.
   */
  const enviado = await notificarMarco({
    chave: chaveDoResumo(hoje),
    titulo: resumo.titulo,
    corpo: resumo.corpo,
  }).catch((err) => {
    console.error("[resumo-manha] falhou ao notificar", err);
    return false;
  });

  return NextResponse.json({
    ok: true,
    enviado,
    hoje,
    janela: { de: resumo.de, ate: resumo.ate, dias: resumo.diasContados },
    media: resumo.media,
    total: resumo.total,
    projecao: resumo.projecao,
    nivelML: nivel,
  });
}
