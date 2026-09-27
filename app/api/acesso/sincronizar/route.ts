import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdminDb } from "@/lib/firebase/admin";
import { sincronizarMembros } from "@/lib/tenant-membros";

/**
 * Espelha controleAcesso nos membros da empresa logo depois de uma mudança na
 * tela de Acesso (Etapa 3) — sem esperar o worker. Só o dono; e só faz algo
 * com a chave de dados em modo tenant (ver lib/tenant-membros.ts).
 */
export async function POST(req: Request) {
  const gate = await requireAccess(req, { adminOnly: true });
  if (gate instanceof NextResponse) return gate;
  try {
    return NextResponse.json({ ok: true, ...(await sincronizarMembros(getAdminDb())) });
  } catch (err) {
    console.error("[acesso] sincronizar membros falhou", err);
    return NextResponse.json({ ok: false, error: "sincronizacao_falhou" }, { status: 500 });
  }
}
