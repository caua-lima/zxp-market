import { NextResponse, after } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { comTenant } from "@/lib/firebase/contexto-tenant";
import { acessoExpirado } from "@/lib/domain/acesso-temporario";
import { placarDe } from "@/lib/domain/placar-ao-vivo";
import { FORMATO_TOKEN, hashDoToken } from "@/lib/domain/widget-token";
import { calcularAoVivo } from "@/lib/ml/ao-vivo-calculo";
import { vigiarAgendasFull } from "@/lib/ml/vigia-agenda-full";

export const maxDuration = 20;

/**
 * O placar pro widget do iPhone (Scriptable). SEM sessão: quem autoriza é o
 * código secreto da URL (ver lib/domain/widget-token.ts). Devolve só o que a
 * barra ao vivo mostra a qualquer acesso — faturamento, contagem, meta e vendas
 * por hora; nunca custo, lucro, visitas nem estoque. Recusa igual (401) código
 * torto, desconhecido ou de quem perdeu o acesso: a resposta não diz qual.
 */
const nao = () => NextResponse.json({ error: "nao_autorizado" }, { status: 401, headers: { "Cache-Control": "no-store" } });


/**
 * Carona pra vigia da agenda do Full: esta rota é chamada sozinha a cada poucos
 * minutos (barra ao vivo / widget). Depois da resposta, confere os envios
 * vigiados — o intervalo mínimo da vigia evita perguntar ao ML demais.
 */
function caronaDaVigia(tenantId: string | null) {
  try {
    after(() => (tenantId ? comTenant(tenantId, () => vigiarAgendasFull()) : vigiarAgendasFull()).catch(() => {}));
  } catch { /* fora de uma requisição (testes): sem carona */ }
}

export async function GET(req: Request) {
  const t = new URL(req.url).searchParams.get("t") ?? "";
  if (!FORMATO_TOKEN.test(t)) return nao();

  try {
    const db = getAdminDb();
    const reg = await db.collection("widget_tokens").doc(hashDoToken(t)).get();
    if (!reg.exists) return nao();
    const email = String(reg.get("email") ?? "").toLowerCase();
    const tenantId = (reg.get("tenantId") as string | null) ?? null;
    if (!email) return nao();

    // Quem saiu da equipe (ou teve o acesso vencido) não recebe mais o placar.
    const acesso = await db.doc(tenantId ? `tenants/${tenantId}/members/${email}` : `controleAcesso/${email}`).get();
    if (!acesso.exists || acessoExpirado(acesso.data(), Date.now())) return nao();

    const rodar = () => calcularAoVivo({ empresa: tenantId ?? "raiz" });
    const { body } = tenantId ? await comTenant(tenantId, rodar) : await rodar();
    caronaDaVigia(tenantId);
    return NextResponse.json(placarDe(body), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[widget/ao-vivo]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "indisponivel" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
