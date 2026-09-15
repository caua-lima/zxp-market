// lib/ml/client.ts
import crypto from "crypto";
import { fetchML } from "./fetch-ml";

const ML_APP_ID = process.env.ML_APP_ID!;
const ML_SECRET = process.env.ML_SECRET!;
const ML_REDIRECT_URI = process.env.ML_REDIRECT_URI!;
const ML_API = "https://api.mercadolibre.com";

/** Gera o par PKCE (o ML passou a exigir code_challenge/code_verifier). */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/**
 * @param state o identificador da transacao OAuth (ver lib/ml/oauth-transacao).
 *   Era `Date.now()` com o comentario "evita cache" — um valor previsivel,
 *   que o callback nem conferia. `state` existe pra ligar a volta ao pedido;
 *   sem isso, qualquer volta era aceita.
 */
export function getAuthURL(codeChallenge: string, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: ML_APP_ID,
    redirect_uri: ML_REDIRECT_URI,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });

  return `https://auth.mercadolivre.com.br/authorization?${params.toString()}`;
}

export async function exchangeCodeForToken(code: string, codeVerifier: string) {
  const body: Record<string, string> = {
    grant_type: "authorization_code",
    client_id: ML_APP_ID,
    client_secret: ML_SECRET,
    code,
    redirect_uri: ML_REDIRECT_URI,
  };
  if (codeVerifier) body.code_verifier = codeVerifier;

  const res = await fetchML(`${ML_API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function refreshAccessToken(refreshToken: string) {
  const res = await fetchML(`${ML_API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: ML_APP_ID,
      client_secret: ML_SECRET,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getOrdersForDay(accessToken: string, sellerId: string, dateISO: string) {
  const from = `${dateISO}T00:00:00.000-03:00`;
  const to   = `${dateISO}T23:59:59.999-03:00`;
  const url = `${ML_API}/orders/search?seller=${sellerId}&order.date_created.from=${encodeURIComponent(from)}&order.date_created.to=${encodeURIComponent(to)}&order.status=paid&limit=50`;
  const res = await fetchML(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getItemDetails(accessToken: string, itemId: string) {
  const res = await fetchML(`${ML_API}/items/${itemId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json();
}