import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { lerSinaisDeSaude } from "@/lib/saude-empresa";
import { avaliarSaude, nivelGeral } from "@/lib/domain/saude";

/** Saúde da operação da empresa de quem chama (Etapa 4). Quem administra. */
export async function GET(req: Request) {
  const gate = await requireAccess(req, { capacidade: "administrar" });
  if (gate instanceof NextResponse) return gate;
  const itens = avaliarSaude(await lerSinaisDeSaude());
  return NextResponse.json({ geral: nivelGeral(itens), itens });
}
