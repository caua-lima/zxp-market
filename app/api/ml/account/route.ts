import { NextResponse } from "next/server";
import { fetchML } from "@/lib/ml/fetch-ml";
import { getMlTokenStatus, getMlAccessToken, getMlTokenData } from "../token";
import { requireAccess } from "@/lib/api-auth";

export async function GET(req: Request) {
  const gate = await requireAccess(req, { capacidade: "ver_operacao" });
  if (gate instanceof NextResponse) return gate;

  const status = await getMlTokenStatus();
  if (!status.connected) return NextResponse.json(status);

  // if we already have a cached profile, return it immediately
  const tokenData = await getMlTokenData();
  if (tokenData?.user_profile) return NextResponse.json({ ...status, user: tokenData.user_profile });

  const access = await getMlAccessToken();
  if (!access) return NextResponse.json({ connected: false });

  try {
    const res = await fetchML(`https://api.mercadolibre.com/users/me`, {
      headers: { Authorization: `Bearer ${access}` },
      cache: "no-store",
    });

    if (!res.ok) return NextResponse.json({ ...status, user: null });

    const user = await res.json();

    // persist profile for faster responses
    try {
      const db = (await import("@/lib/firebase/admin")).getAdminDb();
      await db.collection("ml_tokens").doc("main").set({ user_profile: user, updated_at: new Date().toISOString() }, { merge: true });
    } catch {
      // Persistir o perfil e um extra: se falhar, a resposta continua valida.
      // `catch` sem binding porque o erro nao e lido - era `catch (e)` com o
      // `e` morto, que a regra de variavel nao usada apontava com razao.
    }

    return NextResponse.json({ ...status, user });
  } catch {
    // Sem perfil: a rota ainda responde o status da conexao, que e o que a
    // tela precisa pra decidir se mostra "conectado".
    return NextResponse.json({ ...status, user: null });
  }
}
