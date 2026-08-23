import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getLicenca, getMembro } from "@/lib/tenant";
import { situacaoDaConta } from "@/lib/domain/tenant";

/**
 * Por que este usuário não está vendo o Dashboard — pra tela mostrar a razão,
 * não um "carregando" infinito.
 *
 * ─── POR QUE NÃO REUSA resolverTenant() ─────────────────────────────────
 *
 * resolverTenant() devolve null pra QUALQUER motivo de bloqueio (sem vínculo,
 * sem licença, suspensa, vencida) — certo pras 35 rotas que só precisam
 * decidir "deixa passar ou não". Esta rota existe justamente pra distinguir
 * os motivos, então precisa dos dois pedaços (membro e licença) separados, e
 * NÃO pode negar quando a licença está inválida — é exatamente esse caso que
 * ela precisa responder com sucesso, explicando o motivo.
 */
export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  const membro = await getMembro(gate.uid);
  if (!membro?.tenantId) {
    return NextResponse.json({ situacao: "sem_licenca", tenantId: null, licenca: null });
  }

  const licenca = await getLicenca(membro.email || gate.email);
  const situacao = situacaoDaConta(licenca, Date.now());

  return NextResponse.json({
    situacao,
    tenantId: membro.tenantId,
    licenca: licenca ? { status: licenca.status, expiresAt: licenca.expiresAt ?? null } : null,
  });
}
