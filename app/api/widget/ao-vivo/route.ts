import { NextResponse, after } from "next/server";
import { comTenant } from "@/lib/firebase/contexto-tenant";
import { placarDe } from "@/lib/domain/placar-ao-vivo";
import { acessoDoWidget } from "@/lib/widget-acesso";
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
  try {
    const dono = await acessoDoWidget(new URL(req.url).searchParams.get("t"));
    if (!dono) return nao();
    const tenantId = dono.tenantId;

    const rodar = () => calcularAoVivo({ empresa: tenantId ?? "raiz" });
    const { body } = tenantId ? await comTenant(tenantId, rodar) : await rodar();
    caronaDaVigia(tenantId);
    return NextResponse.json(placarDe(body), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[widget/ao-vivo]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "indisponivel" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
