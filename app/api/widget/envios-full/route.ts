import { NextResponse } from "next/server";
import { comTenant } from "@/lib/firebase/contexto-tenant";
import { acessoDoWidget } from "@/lib/widget-acesso";
import { idsParaDetalhar, sincronizarEnvios } from "@/lib/ml/envios-full-sync";

export const maxDuration = 60;

/**
 * A extensão do Chrome (extensao-vigia-full) manda aqui o que leu do painel
 * "Gestão de envios Full" do ML — lista e detalhe dos envios. SEM sessão:
 * autoriza o mesmo código secreto da vigia (o endereço que o dono cola na
 * extensão). Ver lib/ml/envios-full-sync.ts pro que acontece com a leitura.
 *
 *  - GET: quais envios a extensão deve abrir no detalhe nesta rodada.
 *  - POST { lista?: [...], detalhes?: [...], versao }: grava e aplica; a
 *    resposta traz `detalhar` pra próxima etapa da rodada.
 */
const nao = () => NextResponse.json({ error: "nao_autorizado" }, { status: 401, headers: { "Cache-Control": "no-store" } });

async function naEmpresa<T>(tenantId: string | null, fn: () => Promise<T>): Promise<T> {
  return tenantId ? comTenant(tenantId, fn) : fn();
}

export async function GET(req: Request) {
  const dono = await acessoDoWidget(new URL(req.url).searchParams.get("t"));
  if (!dono) return nao();
  const detalhar = await naEmpresa(dono.tenantId, idsParaDetalhar);
  return NextResponse.json({ detalhar }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const dono = await acessoDoWidget(new URL(req.url).searchParams.get("t"));
  if (!dono) return nao();
  const corpo = (await req.json().catch(() => null)) as { lista?: unknown; detalhes?: unknown; versao?: unknown } | null;
  const lista = Array.isArray(corpo?.lista) ? corpo.lista : [];
  const detalhes = Array.isArray(corpo?.detalhes) ? corpo.detalhes : [];
  if (!lista.length && !detalhes.length) return NextResponse.json({ error: "vazio" }, { status: 400 });
  try {
    const r = await naEmpresa(dono.tenantId, () => sincronizarEnvios({ lista, detalhes, versao: String(corpo?.versao ?? "") }));
    return NextResponse.json({ ok: true, ...r }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: "falhou", details: String(err).slice(0, 300) }, { status: 500 });
  }
}
