import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { comTenant } from "@/lib/firebase/contexto-tenant";
import { inboundValido } from "@/lib/domain/agenda-full";
import { acessoDoWidget } from "@/lib/widget-acesso";
import { avisarAgendaLiberada, COLECAO_VIGIAS } from "@/lib/ml/vigia-agenda-full";

/**
 * A rota da extensão do Chrome da vigia (pasta extensao-vigia-full). SEM
 * sessão: autoriza o código secreto. O ML só mostra a agenda pra quem está
 * logado no navegador, então quem olha a página é o Chrome do PC; aqui ele
 * busca a lista de envios e conta o que viu. (O campo no banco se chama
 * `iphone` por causa da primeira tentativa, com o Scriptable, que o ML bloqueou.)
 *
 *  - GET: os envios vigiados (só os números).
 *  - POST { inboundId, estado, trecho }: o que a extensão viu. "datas" na
 *    primeira vez dispara o push pros outros aparelhos (crítico).
 */
const nao = () => NextResponse.json({ error: "nao_autorizado" }, { status: 401, headers: { "Cache-Control": "no-store" } });
const ESTADOS = new Set(["datas", "sem_datas", "login", "indefinido"]);

async function naEmpresa<T>(tenantId: string | null, fn: () => Promise<T>): Promise<T> {
  return tenantId ? comTenant(tenantId, fn) : fn();
}

export async function GET(req: Request) {
  const dono = await acessoDoWidget(new URL(req.url).searchParams.get("t"));
  if (!dono) return nao();
  const ids = await naEmpresa(dono.tenantId, async () => {
    const snap = await getAdminDb().collection(COLECAO_VIGIAS).where("ativa", "==", true).limit(5).get();
    return snap.docs.map((d) => String(d.get("inboundId") ?? d.id));
  });
  return NextResponse.json({ ids }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const dono = await acessoDoWidget(new URL(req.url).searchParams.get("t"));
  if (!dono) return nao();
  const corpo = (await req.json().catch(() => null)) as { inboundId?: unknown; estado?: unknown; trecho?: unknown } | null;
  const id = inboundValido(corpo?.inboundId);
  const estado = String(corpo?.estado ?? "");
  if (!id || !ESTADOS.has(estado)) return NextResponse.json({ error: "invalido" }, { status: 400 });

  const r = await naEmpresa(dono.tenantId, async () => {
    const ref = getAdminDb().collection(COLECAO_VIGIAS).doc(id);
    const snap = await ref.get();
    if (!snap.exists || snap.get("ativa") !== true) return { ok: false as const };
    const agora = Date.now();
    const patch: Record<string, unknown> = {
      iphone: { estado, em: agora, trecho: String(corpo?.trecho ?? "").slice(0, 300) },
    };
    let avisou = false;
    if (estado === "datas") {
      patch.estado = "datas_liberadas";
      if (snap.get("avisadoDatas") !== "iphone") {
        await avisarAgendaLiberada(id, [], `iphone-${new Date(agora).toISOString().slice(0, 10)}`).catch(() => 0);
        patch.avisadoEm = agora;
        patch.avisadoDatas = "iphone";
        avisou = true;
      }
    } else if (snap.get("avisadoDatas") === "iphone") {
      // Fechou de novo: a próxima abertura volta a avisar.
      patch.avisadoDatas = "";
      if (estado === "sem_datas") patch.estado = "sem_datas";
    }
    await ref.update(patch);
    return { ok: true as const, avisou };
  });
  if (!r.ok) return NextResponse.json({ error: "nao_vigiado" }, { status: 404 });
  return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
}
