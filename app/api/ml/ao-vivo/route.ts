import { NextResponse, after } from "next/server";
import { comTenant } from "@/lib/firebase/contexto-tenant";
import { vigiarAgendasFull } from "@/lib/ml/vigia-agenda-full";
import { requireAccess } from "@/lib/api-auth";
import { redigirOperacao } from "@/lib/domain/ao-vivo";
import { calcularAoVivo, type PedidoQueMudou } from "@/lib/ml/ao-vivo-calculo";

export const maxDuration = 20;

/**
 * A barra "Ao vivo": o dia de hoje em andamento, em todas as telas. O cálculo
 * mora em lib/ml/ao-vivo-calculo.ts (o webhook usa o mesmo, pro mini painel).
 *
 * Parâmetros:
 *  - `fresh=1`: chegou o aviso de uma venda, a barra quer o número novo já. Com
 *    piso — senão dez abas abertas virariam dez buscas no ML por venda.
 *  - `pedido=<id>&valida=1|0`: o sinal em tempo real disse que ESTE pedido
 *    mudou. A resposta já o reflete, mesmo que a busca do ML ainda não o liste.
 *
 * Faturamento e contagem: nada de custo, margem ou lucro. Por isso o `member`
 * também recebe (`ver_resumo`). Visitas e estoque por produto são da OPERAÇÃO
 * (`ver_operacao`): saem da resposta de quem não tem — ausência, nunca zero.
 */

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
  const gate = await requireAccess(req, { capacidade: "ver_resumo" });
  if (gate instanceof NextResponse) return gate;

  try {
    const q = new URL(req.url).searchParams;
    const id = q.get("pedido") ?? "";
    // Id de pedido do ML é numérico; qualquer outra coisa é ignorada (nunca vira caminho no banco).
    const pedido: PedidoQueMudou | null = /^\d{1,24}$/.test(id) ? { orderId: id, valida: q.get("valida") !== "0" } : null;
    const { body, doCache } = await calcularAoVivo({ empresa: gate.tenantId ?? "raiz", urgente: q.get("fresh") === "1", pedido });
    caronaDaVigia(gate.tenantId ?? null);
    return NextResponse.json({ ...redigirOperacao(body, gate.pode("ver_operacao")), ...(doCache ? { doCache: true } : {}) });
  } catch (e) {
    console.error("[ao-vivo]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "ao_vivo_indisponivel" }, { status: 500 });
  }
}
