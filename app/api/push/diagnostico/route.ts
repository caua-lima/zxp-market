import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdminDb } from "@/lib/firebase/admin";
import { idDoRegistro } from "@/lib/domain/push-registro";
import type { DiagnosticoServidor } from "@/lib/domain/diagnostico-push";
import type { StatusEntrega } from "@/lib/domain/entrega-destino";
import { COLECAO_ENTREGAS } from "@/lib/notification-outbox";
import { lerPreferenciasPorEmail } from "@/lib/notification-preferences";

const DEVICE_ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * O que o SERVIDOR sabe sobre as notificações DE QUEM PERGUNTA.
 *
 * Qualquer pessoa com acesso pode chamar, e só enxerga o que é dela: os próprios
 * aparelhos (contados, sem token), a própria situação de acesso e de preferências,
 * e os próprios últimos envios (só status e código). Nada de outra pessoa, nenhum
 * e-mail, nenhum token — o diagnóstico anterior listava os e-mails de TODO o time
 * pra qualquer um que abrisse o botão.
 *
 * `acesso` aqui é sempre "ok": quem chegou até este ponto passou por
 * requireAccess. Quem não tem acesso recebe 403, e o cliente traduz isso em
 * "sem_acesso" — o único jeito honesto de dizer isso a alguém que não tem acesso.
 */
export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  const db = getAdminDb();
  const deviceId = new URL(req.url).searchParams.get("deviceId") ?? "";

  const [aparelhos, leitura, entregas] = await Promise.all([
    db.collection("pushTokens").where("email", "==", gate.email).get(),
    lerPreferenciasPorEmail(gate.email),
    db.collection(COLECAO_ENTREGAS).where("email", "==", gate.email).limit(50).get(),
  ]);

  const meuRegistro = DEVICE_ID.test(deviceId) ? idDoRegistro(gate.email, deviceId) : null;

  const ultimos = entregas.docs
    .map((d) => d.data())
    .sort((a, b) => Number(b.criadoEm ?? 0) - Number(a.criadoEm ?? 0))
    .slice(0, 10)
    .map((e) => ({
      status: e.status as StatusEntrega,
      motivo: typeof e.motivo === "string" ? e.motivo : undefined,
      erro: typeof e.ultimoErro?.codigo === "string" ? e.ultimoErro.codigo : undefined,
      clicado: Boolean(e.clicadoEm),
    }));

  const corpo: DiagnosticoServidor = {
    acesso: "ok",
    preferencias: leitura.estado,
    aparelhos: {
      total: aparelhos.size,
      esteRegistrado: meuRegistro ? aparelhos.docs.some((d) => d.id === meuRegistro) : null,
    },
    ultimosEnvios: ultimos,
  };
  return NextResponse.json(corpo);
}
