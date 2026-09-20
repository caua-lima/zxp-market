import "server-only";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import {
  interpretarPreferencias,
  preferenciasIndisponiveis,
  type LeituraDePreferencias,
} from "@/lib/domain/notification-preferences";

/**
 * Preferências de UM destinatário, por e-mail (é assim que pushTokens
 * identifica quem recebe). O documento fica em usuarios/{uid}/preferences/
 * notifications — resolve o uid via Admin Auth (getUserByEmail), sem
 * precisar manter um mapa email→uid próprio.
 *
 * Devolve o QUE a leitura encontrou (ver LeituraDePreferencias), não uma
 * preferência fingida: e-mail sem conta ou sem documento é "ausente" (os
 * defaults são a preferência da pessoa), mas erro de rede ou de Auth é
 * "indisponivel" — e indisponível nunca vira permissão pra mostrar dinheiro.
 */
export async function lerPreferenciasPorEmail(email: string): Promise<LeituraDePreferencias> {
  let uid: string;
  try {
    uid = (await getAdminAuth().getUserByEmail(email)).uid;
  } catch (err) {
    // Sem conta no Auth não há documento de preferências possível.
    if ((err as { code?: string })?.code === "auth/user-not-found") return interpretarPreferencias(undefined);
    return preferenciasIndisponiveis(`auth: ${(err as { code?: string })?.code ?? "erro"}`);
  }
  try {
    const snap = await getAdminDb().doc(`usuarios/${uid}/preferences/notifications`).get();
    return interpretarPreferencias(snap.exists ? snap.data() : undefined);
  } catch (err) {
    return preferenciasIndisponiveis(`firestore: ${(err as { code?: string | number })?.code ?? "erro"}`);
  }
}

/** Minutos desde 00:00 e dia da semana (0=domingo) no fuso BR (-03:00), sem depender de Intl/timezone do servidor. */
export function agoraBR(agora = Date.now()): { minutosDoDia: number; diaSemana: number } {
  const d = new Date(agora - 3 * 3600 * 1000);
  return { minutosDoDia: d.getUTCHours() * 60 + d.getUTCMinutes(), diaSemana: d.getUTCDay() };
}
