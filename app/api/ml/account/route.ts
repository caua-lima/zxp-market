import { NextResponse } from "next/server";
import { fetchML } from "@/lib/ml/fetch-ml";
import { getMlTokenStatus, getMlAccessToken, getMlTokenData } from "../token";
import { requireAccess } from "@/lib/api-auth";

/**
 * Quanto o perfil gravado vale. Esta rota serve identidade (apelido, e-mail,
 * site) — muda pouco, mas muda, e o perfil ficava gravado pra sempre.
 */
const VALIDADE_PERFIL_MS = 24 * 3600 * 1000;

export async function GET(req: Request) {
  const gate = await requireAccess(req, { capacidade: "ver_operacao" });
  if (gate instanceof NextResponse) return gate;

  const status = await getMlTokenStatus();
  if (!status.connected) return NextResponse.json(status);

  /**
   * O perfil gravado só vale se for DA CONTA CONECTADA e recente (S10). Antes
   * bastava existir: sem prazo, e sem conferir de quem era — reconectar outra
   * conta podia continuar mostrando o apelido da anterior.
   */
  const tokenData = await getMlTokenData();
  const gravado = (tokenData?.user_profile ?? null) as { id?: unknown } | null;
  const doConectado = gravado != null && (!tokenData?.user_id || String(gravado.id ?? "") === String(tokenData.user_id));
  const gravadoEm = Number((tokenData as { user_profile_em?: unknown } | null)?.user_profile_em ?? 0);
  if (gravado && doConectado && Date.now() - gravadoEm < VALIDADE_PERFIL_MS) {
    return NextResponse.json({ ...status, user: gravado });
  }
  // Renovar falhou: o gravado da MESMA conta ainda serve, dito como velho.
  const semRenovar = () => NextResponse.json(
    gravado && doConectado ? { ...status, user: gravado, perfilDesatualizado: true } : { ...status, user: null },
  );

  const access = await getMlAccessToken();
  if (!access) return gravado && doConectado ? semRenovar() : NextResponse.json({ connected: false });

  try {
    const res = await fetchML(`https://api.mercadolibre.com/users/me`, {
      headers: { Authorization: `Bearer ${access}` },
      cache: "no-store",
    });

    if (!res.ok) return semRenovar();

    const user = await res.json();

    // persist profile for faster responses
    try {
      const db = (await import("@/lib/firebase/admin")).getAdminDb();
      await db.collection("ml_tokens").doc("main").set(
        { user_profile: user, user_profile_em: Date.now(), updated_at: new Date().toISOString() },
        { merge: true },
      );
    } catch {
      // Persistir o perfil e um extra: se falhar, a resposta continua valida.
      // `catch` sem binding porque o erro nao e lido - era `catch (e)` com o
      // `e` morto, que a regra de variavel nao usada apontava com razao.
    }

    return NextResponse.json({ ...status, user });
  } catch {
    // Sem perfil novo: a rota ainda responde o status da conexao, que e o que
    // a tela precisa pra decidir se mostra "conectado".
    return semRenovar();
  }
}
