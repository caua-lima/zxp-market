import "server-only";
import { getAdminDb } from "@/lib/firebase/admin";
import { acessoExpirado } from "@/lib/domain/acesso-temporario";
import { FORMATO_TOKEN, hashDoToken } from "@/lib/domain/widget-token";

/**
 * De quem é este código secreto (widget/vigia do iPhone) — e se a pessoa ainda
 * tem acesso. `null` pra código torto, desconhecido ou de quem saiu da equipe:
 * quem chama responde 401 igual nos três casos.
 */
export async function acessoDoWidget(t: string | null): Promise<{ email: string; tenantId: string | null } | null> {
  if (!t || !FORMATO_TOKEN.test(t)) return null;
  const db = getAdminDb();
  const reg = await db.collection("widget_tokens").doc(hashDoToken(t)).get();
  if (!reg.exists) return null;
  const email = String(reg.get("email") ?? "").toLowerCase();
  const tenantId = (reg.get("tenantId") as string | null) ?? null;
  if (!email) return null;
  const acesso = await db.doc(tenantId ? `tenants/${tenantId}/members/${email}` : `controleAcesso/${email}`).get();
  if (!acesso.exists || acessoExpirado(acesso.data(), Date.now())) return null;
  return { email, tenantId };
}
