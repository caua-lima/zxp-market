import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdminDb } from "@/lib/firebase/admin";
import { lerModoDeDados } from "@/lib/firebase/caminhos";
import { papelDe, type PermissionTab } from "@/lib/domain/types";
import { lerDireitos } from "@/lib/billing/empresa";
import { podeAdicionarMembro } from "@/lib/domain/assinatura";

/**
 * O time DA EMPRESA de quem chama (segundo cliente, modo empresa).
 *
 * No modo raiz a tela de Acesso grava `controleAcesso` direto (regras). No
 * modo empresa ela não pode: `controleAcesso` é uma lista GLOBAL — alguém
 * adicionado pelo dono da empresa B entraria na lista de todo mundo. Aqui a
 * escrita vai pros membros da empresa do dono logado e pro ponteiro
 * `memberships/{email}`, que só o servidor grava.
 *
 * Regras de negócio:
 *  - só o dono da empresa convida, altera e remove;
 *  - a empresa tem UM dono: ninguém é criado ou promovido a owner por aqui;
 *  - uma pessoa pertence a UMA empresa: e-mail de outra empresa é recusado;
 *  - o próprio membro só pode trocar o próprio nome e foto;
 *  - o dono não se remove (a empresa ficaria sem ninguém pra administrar).
 */

const CAMPOS_DE_SI = ["displayName", "photoURL"] as const;

function soModoEmpresa() {
  return lerModoDeDados() === "tenant"
    ? null
    : NextResponse.json({ error: "so_modo_empresa", details: "No modo raiz o acesso é gravado em controleAcesso." }, { status: 400 });
}

function normalizar(corpo: Record<string, unknown>) {
  const email = String(corpo.email ?? "").trim().toLowerCase();
  const papel = papelDe(corpo.role as Parameters<typeof papelDe>[0]);
  const permissoesEdicao = Array.isArray(corpo.permissoesEdicao) ? (corpo.permissoesEdicao as PermissionTab[]).map(String) : [];
  return { email, papel, permissoesEdicao };
}

export async function POST(req: Request) {
  const fora = soModoEmpresa(); if (fora) return fora;
  const gate = await requireAccess(req, { capacidade: "administrar" });
  if (gate instanceof NextResponse) return gate;
  const t = gate.tenantId!;
  const corpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const { email, papel, permissoesEdicao } = normalizar(corpo);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: "email_invalido" }, { status: 400 });
  if (papel === "owner") return NextResponse.json({ error: "um_dono_so", details: "A empresa tem um dono só." }, { status: 400 });

  const db = getAdminDb();
  const ponteiro = await db.doc(`memberships/${email}`).get();
  const outra = ponteiro.data()?.tenantId;
  if (outra && outra !== t) return NextResponse.json({ error: "pessoa_em_outra_empresa" }, { status: 409 });

  // Limite do plano (S25), só pra pessoa NOVA — editar quem já está não conta.
  // Plano rebaixado com gente acima do limite: ninguém é removido, só não entra mais ninguém.
  if (!(await db.doc(`tenants/${t}/members/${email}`).get()).exists) {
    const { direitos, membros } = await lerDireitos(db, t);
    if (!podeAdicionarMembro(direitos, membros)) {
      return NextResponse.json(
        { error: direitos.bloqueada ? "empresa_bloqueada" : "limite_do_plano", limite: direitos.membros, atuais: membros, estado: direitos.estado },
        { status: 402 },
      );
    }
  }

  const lote = db.batch();
  lote.set(db.doc(`tenants/${t}/members/${email}`), {
    email, role: papel,
    ...(papel === "partner" && permissoesEdicao.length ? { permissoesEdicao } : {}),
    ...(typeof corpo.displayName === "string" ? { displayName: corpo.displayName.slice(0, 120) } : {}),
    addedAt: Date.now(), addedBy: gate.email,
  }, { merge: true });
  lote.set(db.doc(`memberships/${email}`), { email, tenantId: t });
  await lote.commit();
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  const fora = soModoEmpresa(); if (fora) return fora;
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;
  const t = gate.tenantId!;
  const corpo = (await req.json().catch(() => ({}))) as { email?: string; patch?: Record<string, unknown> };
  const email = String(corpo.email ?? "").trim().toLowerCase();
  const patch = corpo.patch ?? {};
  const db = getAdminDb();
  const ref = db.doc(`tenants/${t}/members/${email}`);
  const atual = await ref.get();
  if (!atual.exists) return NextResponse.json({ error: "membro_nao_encontrado" }, { status: 404 });

  const soDeSi = Object.keys(patch).every((k) => (CAMPOS_DE_SI as readonly string[]).includes(k));
  if (email === gate.email && soDeSi) {
    await ref.update(Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, String(v ?? "").slice(0, k === "photoURL" ? 900_000 : 120)])));
    return NextResponse.json({ ok: true });
  }
  if (!gate.pode("administrar")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (atual.data()?.role === "owner") return NextResponse.json({ error: "dono_so_se_altera_pelo_nome_e_foto" }, { status: 400 });
  const { papel, permissoesEdicao } = normalizar({ role: patch.role ?? atual.data()?.role, permissoesEdicao: patch.permissoesEdicao ?? atual.data()?.permissoesEdicao });
  if (papel === "owner") return NextResponse.json({ error: "um_dono_so" }, { status: 400 });
  await ref.set({ role: papel, permissoesEdicao: papel === "partner" ? permissoesEdicao : [] }, { merge: true });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const fora = soModoEmpresa(); if (fora) return fora;
  const gate = await requireAccess(req, { capacidade: "administrar" });
  if (gate instanceof NextResponse) return gate;
  const t = gate.tenantId!;
  const email = String(new URL(req.url).searchParams.get("email") ?? "").trim().toLowerCase();
  if (email === gate.email) return NextResponse.json({ error: "dono_nao_se_remove" }, { status: 400 });
  const db = getAdminDb();
  const lote = db.batch();
  lote.delete(db.doc(`tenants/${t}/members/${email}`));
  // Só solta o ponteiro se ele aponta pra ESTA empresa.
  if ((await db.doc(`memberships/${email}`).get()).data()?.tenantId === t) lote.delete(db.doc(`memberships/${email}`));
  await lote.commit();
  return NextResponse.json({ ok: true });
}
