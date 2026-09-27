import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { direitosDaEmpresa, type Assinatura, type Direitos } from "@/lib/domain/assinatura";

/** Direitos e uso da empresa, lidos no servidor (a tela nunca decide limite). */
export async function lerDireitos(
  db: Firestore,
  tenantId: string,
  agora = Date.now(),
): Promise<{ direitos: Direitos; membros: number; assinatura: Assinatura | null }> {
  const [empresa, membros] = await Promise.all([
    db.doc(`tenants/${tenantId}`).get(),
    db.collection(`tenants/${tenantId}/members`).count().get(),
  ]);
  const assinatura = (empresa.data()?.assinatura as Assinatura | undefined) ?? null;
  return { direitos: direitosDaEmpresa(assinatura, agora), membros: membros.data().count, assinatura };
}

/**
 * Endereço do app pras voltas do checkout e do portal — montado no SERVIDOR.
 * Aceitar URL de retorno vinda do cliente abriria redirecionamento pra
 * qualquer site com a marca do Stripe no meio.
 */
export function urlDoApp(req: Request, env: Record<string, string | undefined> = process.env): string | null {
  const configurada = env.APP_URL?.trim().replace(/\/+$/, "");
  if (configurada) return configurada;
  if (env.NODE_ENV !== "production") return new URL(req.url).origin;
  return null;
}
