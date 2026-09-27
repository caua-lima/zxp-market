import { rotaDeDiagnostico } from "@/lib/diagnostico";
import { getMlAccessToken } from "../token";

const ML_API = "https://api.mercadolibre.com";

/** Diagnóstico das devoluções/claims: mostra a resposta crua da busca. */
export const GET = rotaDeDiagnostico("debug-claims", async () => {
  const token = await getMlAccessToken();
  if (!token) return { corpo: { error: "sem token" }, status: 400 };
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json", "x-format-new": "true" };

  const res = await fetch(`${ML_API}/post-purchase/v1/claims/search?sort=date_created,desc&limit=5`, { headers, cache: "no-store" });
  const body = await res.json().catch(() => null);

  return { corpo: { status: res.status, body } };
});
