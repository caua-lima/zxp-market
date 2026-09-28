import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireAccess } from "@/lib/api-auth";
import { getAdminDb } from "@/lib/firebase/admin";
import { lerModoDeDados } from "@/lib/firebase/caminhos";
import { acessoExpirado } from "@/lib/domain/acesso-temporario";

/**
 * Transferir a propriedade da empresa (Etapa 6 — Acesso). A empresa tem UM
 * dono; sem isto, o dono que sai da empresa leva a administração junto (e o
 * último recurso era mexer no banco).
 *
 * Só o dono atual, pra alguém que JÁ está no time, com acesso permanente. Na
 * mesma transação: a pessoa vira dono e quem transferiu vira parceiro com
 * edição de todas as abas — perde só o que é exclusivo do dono (time,
 * cobrança, conexão). Fica registrado no histórico de auditoria da empresa.
 */
const TODAS_AS_ABAS = ["custos", "metas", "estoque", "ads"];

export async function POST(req: Request) {
  if (lerModoDeDados() !== "tenant") return NextResponse.json({ error: "so_modo_empresa" }, { status: 400 });
  const gate = await requireAccess(req, { capacidade: "administrar" });
  if (gate instanceof NextResponse) return gate;
  if (gate.papel !== "owner" || !gate.tenantId) return NextResponse.json({ error: "so_o_dono" }, { status: 403 });

  const { email: bruto } = (await req.json().catch(() => ({}))) as { email?: string };
  const novo = String(bruto ?? "").trim().toLowerCase();
  if (!novo || novo === gate.email) return NextResponse.json({ error: "destino_invalido" }, { status: 400 });

  const db = getAdminDb();
  const t = gate.tenantId;
  const resultado = await db.runTransaction(async (tx) => {
    const [alvo, eu] = await Promise.all([tx.get(db.doc(`tenants/${t}/members/${novo}`)), tx.get(db.doc(`tenants/${t}/members/${gate.email}`))]);
    if (!alvo.exists) return "nao_esta_no_time" as const;
    if (alvo.data()?.expiraEm != null || acessoExpirado(alvo.data(), Date.now())) return "acesso_temporario" as const;
    if (eu.data()?.role !== "owner") return "so_o_dono" as const;
    tx.update(alvo.ref, { role: "owner", permissoesEdicao: FieldValue.delete() });
    tx.update(eu.ref, { role: "partner", permissoesEdicao: TODAS_AS_ABAS });
    tx.update(db.doc(`tenants/${t}`), { dono: novo });
    const agora = Date.now();
    tx.set(db.collection(`tenants/${t}/auditLog`).doc(`dono_${agora}`), {
      acao: "editar", entidade: "acesso", entidadeId: novo, entidadeLabel: novo,
      detalhe: `propriedade transferida de ${gate.email} para ${novo}`, por: gate.email, em: agora,
    });
    return "ok" as const;
  });

  if (resultado !== "ok") {
    const status = resultado === "so_o_dono" ? 403 : 400;
    const details = resultado === "acesso_temporario" ? "Acesso com prazo não pode virar dono. Torne o acesso permanente antes." : undefined;
    return NextResponse.json({ error: resultado, details }, { status });
  }
  return NextResponse.json({ ok: true });
}
