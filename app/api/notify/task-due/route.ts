import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { enviarLembretesDeTarefa } from "@/lib/task-reminders-run";

/**
 * Disparo MANUAL da varredura de prazo das tarefas.
 *
 * Em produção quem chama isto é o cron das 9h (app/api/ml/cron/route.ts) —
 * esta rota existe pra dar pra testar na hora, sem esperar o dia virar, do
 * mesmo jeito que a rota de snapshot tem o POST manual.
 *
 * `dia` no corpo (opcional, "yyyy-mm-dd") força a data de referência: útil pra
 * conferir o texto de uma tarefa que vence amanhã sem ter que mexer no prazo
 * dela. Sem isso, usa hoje no fuso de São Paulo.
 *
 * Cuidado ao repetir: o evento é único por pessoa/dia e o outbox não reenvia o
 * que já foi aceito, então a segunda chamada no mesmo dia responde
 * `jaAvisadoHoje` (nada novo a enviar) — é o comportamento correto. Se o envio
 * anterior tinha falhado, a nova chamada TENTA DE NOVO só o que faltou.
 */
export async function POST(req: Request) {
  const gate = await requireAccess(req, { allowCron: true, capacidade: "administrar" });
  if (gate instanceof NextResponse) return gate;

  const body = await req.json().catch(() => null) as { dia?: string } | null;
  const dia = typeof body?.dia === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.dia) ? body.dia : undefined;

  try {
    const r = await enviarLembretesDeTarefa(dia);
    return NextResponse.json({ ok: true, ...r });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "task_due_failed", details: msg }, { status: 500 });
  }
}
