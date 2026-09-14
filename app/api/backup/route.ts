import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { fazerBackupSemanal } from "@/lib/backup-run";

/**
 * Disparo MANUAL do backup semanal (ver lib/backup-run.ts para o que é
 * copiado e por quê). Em produção quem chama isto é o cron diário, só aos
 * domingos — esta rota existe pra dar pra rodar na hora, mesmo dia de semana,
 * ou conferir que o backup de hoje já rodou.
 *
 * Repetir no mesmo dia não duplica nada: o marcador em
 * `backups_semanais/{dia}` faz a segunda chamada responder `feito: false`
 * sem tocar em nada de novo.
 */
export async function POST(req: Request) {
  const gate = await requireAccess(req, { allowCron: true, capacidade: "administrar" });
  if (gate instanceof NextResponse) return gate;

  try {
    const r = await fazerBackupSemanal();
    return NextResponse.json({ ok: true, ...r });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "backup_failed", details: msg }, { status: 500 });
  }
}
