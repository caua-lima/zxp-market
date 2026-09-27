import { getMlAccessToken } from "../token";
import { rotaDeDiagnostico } from "@/lib/diagnostico";

/**
 * A conta do ML conectada (S27): antes devolvia o `/users/me` inteiro (e-mail,
 * telefone, documento, endereço do vendedor) e os 30 primeiros caracteres do
 * token. Agora só o que serve pra conferir QUAL conta está conectada.
 */
export const GET = rotaDeDiagnostico("debug", async () => {
  const token = await getMlAccessToken();
  if (!token) return { corpo: { error: "sem token" } };

  const res = await fetch("https://api.mercadolibre.com/users/me", {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const b = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const rep = (b?.seller_reputation ?? {}) as Record<string, unknown>;
  return {
    corpo: {
      status: res.status,
      conta: b && {
        id: b.id,
        nickname: b.nickname,
        site_id: b.site_id,
        user_type: b.user_type,
        tags: b.tags,
        seller_reputation: { level_id: rep.level_id, power_seller_status: rep.power_seller_status },
      },
    },
  };
});
