import "server-only";
import { fetchML } from "./fetch-ml";
import { getMlAccessToken } from "@/app/api/ml/token";

export type MlUserProfile = {
  id?: number;
  nickname?: string;
  email?: string;
  site_id?: string;
  registration_date?: string;
  seller_reputation?: unknown;
} & Record<string, unknown>;

/**
 * Busca o perfil do vendedor DIRETO no ML, sem o cache do Firestore que
 * app/api/ml/account usa (útil ali pra abrir rápido, mas pode ficar velho
 * por dias — reputação muda com frequência). Usado só pelo painel de
 * Desempenho, que já tem cache próprio de resposta (ver
 * app/api/ml/desempenho/route.ts).
 */
export async function fetchMlUserProfileFresh(): Promise<MlUserProfile | null> {
  const access = await getMlAccessToken();
  if (!access) return null;
  try {
    const res = await fetchML("https://api.mercadolibre.com/users/me", {
      headers: { Authorization: `Bearer ${access}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
