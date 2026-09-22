import { NextResponse } from "next/server";
import { requireTenantAccess } from "@/lib/tenant-auth";

/**
 * Diagnóstico da fundação multi-tenant (S01): resolve o `TenantContext` de
 * quem chama e devolve, sem tocar em NENHUM dado de negócio.
 *
 * Não existe fluxo ainda que crie `memberships`/`tenants/*` de verdade —
 * então hoje, pra qualquer chamador, a resposta é `sem_tenant` (o correto:
 * ninguém pertence a tenant nenhum ainda). Existe pra dar um jeito concreto
 * de testar a resolução ponta a ponta assim que o primeiro tenant/membro
 * for criado (onboarding, Etapa 6), sem esperar uma tela pra isso.
 */
export async function GET(req: Request) {
  const ctx = await requireTenantAccess(req);
  if (ctx instanceof NextResponse) return ctx;

  return NextResponse.json({
    uid: ctx.uid,
    email: ctx.email,
    tenantId: ctx.tenantId,
    papel: ctx.papel,
    membershipVersion: ctx.membershipVersion,
    capabilities: [...ctx.capabilities],
  });
}
