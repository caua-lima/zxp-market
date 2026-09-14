import { NextResponse } from "next/server";
import { getMlTokenStatus } from "../token";
import { requireAccess } from "@/lib/api-auth";

export async function GET(req: Request) {
  const gate = await requireAccess(req, { capacidade: "ver_resumo" });
  if (gate instanceof NextResponse) return gate;

  const status = await getMlTokenStatus();
  return NextResponse.json(status);
}
