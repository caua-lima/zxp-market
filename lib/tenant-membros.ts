import type { Firestore } from "firebase-admin/firestore";
import { planoDeSincronizacao, type AccessEntryMinima } from "@/lib/domain/migracao-tenant";
import { lerConfigDeDados } from "@/lib/firebase/caminhos";

/**
 * Espelha `controleAcesso` em `tenants/{t}/members` e `memberships` (Etapa 3).
 * Ver planoDeSincronizacao. Só faz algo com a chave de dados em modo tenant —
 * antes da virada os membros não autorizam nada e ficam como a primeira fatia
 * os deixou.
 *
 * Recebe `db` (o bruto do Admin SDK ou o do emulador): `controleAcesso`,
 * `tenants` e `memberships` são globais e não passam pela tradução de caminho.
 */
export async function sincronizarMembros(
  db: Firestore,
  cfg = lerConfigDeDados(),
): Promise<{ ativo: false } | { ativo: true; gravados: number; removidos: number; problemas: string[] }> {
  if (cfg.modo !== "tenant") return { ativo: false };
  const t = cfg.tenantId;
  const [acessos, membros] = await Promise.all([
    db.collection("controleAcesso").get(),
    db.collection(`tenants/${t}/members`).get(),
  ]);
  const plano = planoDeSincronizacao(
    acessos.docs.map((d) => ({ ...(d.data() as AccessEntryMinima), email: String(d.data().email ?? d.id) })),
    membros.docs.map((d) => ({ ...(d.data() as { role: string; permissoesEdicao?: string[] }), email: d.id })),
    t,
  );
  const lote = db.batch();
  for (const m of plano.gravar) {
    lote.set(db.doc(`tenants/${t}/members/${m.email}`), m);
    lote.set(db.doc(`memberships/${m.email}`), { email: m.email, tenantId: t });
  }
  for (const e of plano.remover) {
    lote.delete(db.doc(`tenants/${t}/members/${e}`));
    lote.delete(db.doc(`memberships/${e}`));
  }
  if (plano.gravar.length || plano.remover.length) await lote.commit();
  if (plano.problemas.length) console.error(`[membros] ${plano.problemas.join(" | ")}`);
  return { ativo: true, gravados: plano.gravar.length, removidos: plano.remover.length, problemas: plano.problemas };
}
