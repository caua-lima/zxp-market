import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { comTenant } from "@/lib/firebase/contexto-tenant";
import { acessoDoWidget } from "@/lib/widget-acesso";
import { requireAccess } from "@/lib/api-auth";
import { metaMargemAtual } from "@/lib/ml/notificar-venda";
import { custoNaData, impostoNaData, type CustoFaixa, type ImpostoFaixa } from "@/lib/domain/types";

/**
 * Custo e imposto VIGENTES HOJE por anúncio (MLB), pra extensão do Chrome
 * mostrar a margem de cada promoção dentro da página de promoções do ML
 * (extensao-vigia-full/promocoes.js). Mesmo código secreto da vigia, sem
 * sessão.
 *
 * Custo = custoNaData (a mesma faixa de vigência que o Dashboard, a DRE e o
 * lucro por anúncio usam); imposto = impostoNaData. Produto sem custo
 * cadastrado volta com custo 0 — a extensão diz "sem custo no Estoque" em vez
 * de mostrar margem de 100%.
 */
const nao = () => NextResponse.json({ error: "nao_autorizado" }, { status: 401, headers: { "Cache-Control": "no-store" } });
const normMlb = (s: unknown) => {
  const up = String(s ?? "").trim().toUpperCase();
  return up ? (up.startsWith("MLB") ? up : `MLB${up}`) : "";
};

export async function GET(req: Request) {
  /**
   * Código da vigia (extensão) OU sessão de quem vê o financeiro (custo é
   * dado financeiro). A sessão serve pra conferir a margem sem gerar outro
   * código — gerar revoga os antigos.
   */
  const t = new URL(req.url).searchParams.get("t");
  let dono: { tenantId: string | null } | null = t ? await acessoDoWidget(t) : null;
  if (!t) {
    const gate = await requireAccess(req, { capacidade: "ver_financeiro" });
    if (gate instanceof NextResponse) return gate;
    dono = { tenantId: gate.tenantId ?? null };
  }
  if (!dono) return nao();
  const corpo = await (dono.tenantId ? (f: () => Promise<unknown>) => comTenant(dono.tenantId!, f) : (f: () => Promise<unknown>) => f())(async () => {
    const db = getAdminDb();
    const hoje = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
    const [snap, meta] = await Promise.all([db.collection("estoque").get(), metaMargemAtual(db)]);
    const itens: Record<string, { nome: string; sku: string; custo: number; impostoPct: number }> = {};
    for (const d of snap.docs) {
      const p = d.data();
      if (p.ativo === false) continue;
      const prod = {
        custoMedio: Number(p.custoMedio ?? p.custo ?? 0),
        custoMedioFaixas: Array.isArray(p.custoMedioFaixas) ? (p.custoMedioFaixas as CustoFaixa[]) : undefined,
        imposto: p.imposto ?? 0,
        impostoFaixas: Array.isArray(p.impostoFaixas) ? (p.impostoFaixas as ImpostoFaixa[]) : undefined,
      };
      const lista: unknown[] = Array.isArray(p.mlbs) && p.mlbs.length ? p.mlbs : p.mlb ? [p.mlb] : [];
      for (const m of lista) {
        const mlb = normMlb(m);
        if (!mlb || itens[mlb]) continue; // o primeiro cadastro ativo do MLB manda
        itens[mlb] = {
          nome: String(p.name ?? ""), sku: String(p.sku ?? ""),
          custo: Math.round(custoNaData(prod, hoje) * 10000) / 10000,
          impostoPct: impostoNaData(prod, hoje),
        };
      }
    }
    return { itens, metaMargem: meta ?? 10, em: Date.now() };
  });
  return NextResponse.json(corpo, { headers: { "Cache-Control": "no-store" } });
}
