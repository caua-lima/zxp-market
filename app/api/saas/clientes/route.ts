import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { ehMaster, listarClientes } from "@/lib/tenant";
import { montarDocsCliente, senhaInicial, validarNovoCliente } from "@/lib/domain/onboarding";

export const maxDuration = 30;

/**
 * Clientes do SaaS — listar e criar. Só pro admin master.
 *
 * ─── POR QUE UMA ROTA, SE JÁ EXISTE O SCRIPT ────────────────────────────
 *
 * `scripts/criar-cliente.mjs` faz o mesmo, mas exige a chave de serviço na
 * máquina e rodar node. Onboarding é o ciclo principal de quem vende o
 * sistema — precisa funcionar do celular, na rua, na hora que fechar a venda.
 *
 * A VALIDAÇÃO é a mesma dos dois lados (lib/domain/onboarding.ts): duas
 * cópias divergiriam, e a que aceitasse um `tenantId` inválido criaria um
 * cliente com caminho quebrado em todas as coleções.
 */

/** Recusa quem não é master. Devolve o e-mail dele quando passa. */
async function exigirMaster(req: Request): Promise<{ email: string } | NextResponse> {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;
  if (!(await ehMaster(gate.email))) {
    // 403 e não 404: quem chega aqui está autenticado, só não é master.
    return NextResponse.json({ error: "nao_e_master" }, { status: 403 });
  }
  return { email: gate.email };
}

export async function GET(req: Request) {
  const m = await exigirMaster(req);
  if (m instanceof NextResponse) return m;

  try {
    return NextResponse.json({ clientes: await listarClientes() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "listagem_falhou", details: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const m = await exigirMaster(req);
  if (m instanceof NextResponse) return m;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      tenantId?: string; nome?: string; email?: string; diasLicenca?: number;
    };
    const entrada = {
      tenantId: String(body.tenantId ?? "").trim(),
      nome: String(body.nome ?? "").trim(),
      email: String(body.email ?? "").trim().toLowerCase(),
      diasLicenca: Number(body.diasLicenca ?? 0) || 0,
    };

    const v = validarNovoCliente(entrada);
    if (!v.ok) return NextResponse.json({ error: "invalido", erros: v.erros }, { status: 400 });

    const db = getAdminDb();
    // Tenant existente ABORTA: criar por cima da operação de um cliente é
    // irreversível, e é o pior erro possível nesta rota.
    if ((await db.collection("tenants").doc(entrada.tenantId).get()).exists) {
      return NextResponse.json(
        { error: "tenant_existe", erros: [`Já existe uma conta com o identificador "${entrada.tenantId}".`] },
        { status: 409 },
      );
    }

    const auth = getAdminAuth();
    let usuario = await auth.getUserByEmail(entrada.email).catch(() => null);
    let senha: string | null = null;
    if (!usuario) {
      senha = senhaInicial();
      usuario = await auth.createUser({
        email: entrada.email, password: senha, emailVerified: false, displayName: entrada.nome,
      });
    }

    const docs = montarDocsCliente(entrada, m.email);
    await Promise.all([
      db.collection("tenants").doc(entrada.tenantId).set(docs.tenant, { merge: true }),
      db.collection("licencas").doc(docs.licenca.email).set(docs.licenca, { merge: true }),
      db.collection("tenant_membros").doc(usuario.uid).set(docs.membro, { merge: true }),
    ]);

    return NextResponse.json({
      ok: true,
      tenantId: entrada.tenantId,
      uid: usuario.uid,
      /**
       * A senha volta UMA vez e não é guardada em lugar nenhum. Quando o
       * usuário do Auth já existia, ela vem null — ele entra com a que já usa,
       * e sobrescrever a senha de alguém sem avisar seria pior.
       */
      senhaInicial: senha,
      proximoPasso: "O cliente precisa entrar no app e conectar o Mercado Livre dele — só ele pode autorizar.",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "criacao_falhou", details: msg }, { status: 500 });
  }
}
