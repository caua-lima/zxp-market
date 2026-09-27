/**
 * Exportação e eliminação de dados por EMPRESA e por PESSOA (S27, LGPD).
 *
 * Quem pede é o titular (a pessoa) ou o cliente (a empresa, ao sair). Até aqui
 * isso seria "abrir o console do Firestore e apagar na mão" — com várias
 * empresas no mesmo banco, é o jeito certo de apagar a empresa errada.
 *
 * Tudo aqui é ENSAIO por padrão (`aplicar: false`): conta o que seria apagado
 * e não escreve. O script (`scripts/dados-empresa.mjs`) exige confirmação
 * digitada pra aplicar em produção.
 *
 * O que NÃO é apagado: a raiz legada (dado de antes da virada, que é o rollback
 * da migração) e o backup semanal (tem retenção própria, docs/backup.md). Isso
 * precisa constar na resposta ao titular — ver docs/saas/PRIVACIDADE.md.
 *
 * Módulo sem `@/` e sem dependência de runtime: roda no Node puro pelos scripts.
 */
import type { DocumentReference, Firestore } from "firebase-admin/firestore";

/** Campos que nunca saem numa exportação: são credenciais, não dados do titular. */
const CAMPOS_SECRETOS = new Set(["access_token", "refresh_token", "accessToken", "refreshToken", "token", "leaseOwner"]);

export type DocExportado = { caminho: string; dados: Record<string, unknown> };

function semSegredos(dados: Record<string, unknown>): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(dados)) if (!CAMPOS_SECRETOS.has(k)) saida[k] = v;
  return saida;
}

async function coletar(ref: DocumentReference, saida: DocExportado[]): Promise<void> {
  const snap = await ref.get();
  if (snap.exists) saida.push({ caminho: ref.path, dados: semSegredos(snap.data() ?? {}) });
  for (const col of await ref.listCollections()) {
    // listDocuments inclui documento "fantasma" (só com subcoleção), que get() da coleção pularia.
    for (const filho of await col.listDocuments()) await coletar(filho, saida);
  }
}

async function contar(ref: DocumentReference): Promise<number> {
  let n = (await ref.get()).exists ? 1 : 0;
  for (const col of await ref.listCollections()) {
    for (const filho of await col.listDocuments()) n += await contar(filho);
  }
  return n;
}

// ─── Empresa ──────────────────────────────────────────────────────────────

export async function exportarEmpresa(db: Firestore, tenantId: string): Promise<DocExportado[]> {
  const saida: DocExportado[] = [];
  await coletar(db.doc(`tenants/${tenantId}`), saida);
  return saida;
}

export type ResultadoExclusaoEmpresa = {
  documentosDaEmpresa: number;
  vinculosDePessoas: string[];
  vendedoresIndexados: string[];
  aplicado: boolean;
};

export async function excluirEmpresa(
  db: Firestore,
  tenantId: string,
  opcoes: { aplicar: boolean },
): Promise<ResultadoExclusaoEmpresa> {
  const raiz = db.doc(`tenants/${tenantId}`);
  const documentosDaEmpresa = await contar(raiz);
  // Só os ponteiros que apontam pra ESTA empresa. Um e-mail que entrou em outra
  // empresa depois (memberships é 1 por pessoa) não é desta — não se toca.
  const vinculos = await db.collection("memberships").where("tenantId", "==", tenantId).get();
  const vendedores = await db.collection("vendedores").where("tenantId", "==", tenantId).get();

  const resultado: ResultadoExclusaoEmpresa = {
    documentosDaEmpresa,
    vinculosDePessoas: vinculos.docs.map((d) => d.id).sort(),
    vendedoresIndexados: vendedores.docs.map((d) => d.id).sort(),
    aplicado: false,
  };
  if (!opcoes.aplicar) return resultado;

  // Ordem: primeiro os ponteiros (ninguém mais entra nem recebe webhook desta
  // empresa), depois o dado. Se parar no meio, sobra dado órfão inacessível —
  // rodar de novo termina; o contrário deixaria gente entrando numa empresa pela metade.
  const lote = db.batch();
  for (const d of [...vinculos.docs, ...vendedores.docs]) lote.delete(d.ref);
  await lote.commit();
  await db.recursiveDelete(raiz);
  return { ...resultado, aplicado: true };
}

// ─── Pessoa ───────────────────────────────────────────────────────────────

function prefixoDosAparelhos(email: string): string {
  // Mesmo formato de idDoRegistro (lib/domain/push-registro.ts).
  return `${email.toLowerCase().replace(/\//g, "_")}__`;
}

async function aparelhosDaPessoa(db: Firestore, email: string) {
  const prefixo = prefixoDosAparelhos(email);
  const snap = await db.collection("pushTokens").orderBy("__name__").startAt(prefixo).endAt(`${prefixo}`).get();
  return snap.docs;
}

async function empresasDaPessoa(db: Firestore, email: string) {
  const empresas = await db.collection("tenants").listDocuments();
  const achadas: { tenantId: string; papel: unknown; ref: DocumentReference }[] = [];
  for (const t of empresas) {
    const m = await t.collection("members").doc(email).get();
    if (m.exists) achadas.push({ tenantId: t.id, papel: m.data()?.papel, ref: m.ref });
  }
  return achadas;
}

/** Avisos pessoais: um feed por pessoa em cada empresa, e o da raiz (modo antigo). */
function feedsDaPessoa(db: Firestore, email: string, empresas: { tenantId: string }[]): DocumentReference[] {
  return [db.doc(`notification_feed/${email}`), ...empresas.map((m) => db.doc(`tenants/${m.tenantId}/notification_feed/${email}`))];
}

export async function exportarPessoa(db: Firestore, email: string, uid?: string): Promise<DocExportado[]> {
  const e = email.trim().toLowerCase();
  const saida: DocExportado[] = [];
  for (const caminho of [`memberships/${e}`, `controleAcesso/${e}`]) {
    const s = await db.doc(caminho).get();
    if (s.exists) saida.push({ caminho, dados: s.data() ?? {} });
  }
  const empresas = await empresasDaPessoa(db, e);
  for (const m of empresas) {
    const s = await m.ref.get();
    saida.push({ caminho: m.ref.path, dados: s.data() ?? {} });
  }
  for (const a of await aparelhosDaPessoa(db, e)) saida.push({ caminho: a.ref.path, dados: semSegredos(a.data()) });
  for (const feed of feedsDaPessoa(db, e, empresas)) await coletar(feed, saida);
  if (uid) await coletar(db.doc(`usuarios/${uid}`), saida);
  return saida;
}

export type ResultadoExclusaoPessoa =
  | { recusado: "dono_de_empresa"; empresas: string[] }
  | { recusado?: undefined; documentos: string[]; aplicado: boolean };

export async function excluirPessoa(
  db: Firestore,
  email: string,
  opcoes: { uid?: string; aplicar: boolean },
): Promise<ResultadoExclusaoPessoa> {
  const e = email.trim().toLowerCase();
  const empresas = await empresasDaPessoa(db, e);
  // Apagar o dono deixaria a empresa sem ninguém que administre. Primeiro o
  // dono passa a empresa pra outra pessoa (tela de Acesso) — ou a empresa sai inteira.
  const comoDono = empresas.filter((m) => m.papel === "owner").map((m) => m.tenantId);
  // Modo raiz (a operação de antes da virada): o dono está em controleAcesso.
  if ((await db.doc(`controleAcesso/${e}`).get()).data()?.role === "owner") comoDono.push("(raiz)");
  if (comoDono.length) return { recusado: "dono_de_empresa", empresas: comoDono };

  const alvos: DocumentReference[] = [db.doc(`memberships/${e}`), db.doc(`controleAcesso/${e}`), ...empresas.map((m) => m.ref)];
  for (const a of await aparelhosDaPessoa(db, e)) alvos.push(a.ref);
  const existentes: DocumentReference[] = [];
  for (const r of alvos) if ((await r.get()).exists) existentes.push(r);
  const arvores = [...feedsDaPessoa(db, e, empresas), ...(opcoes.uid ? [db.doc(`usuarios/${opcoes.uid}`)] : [])];
  const arvoresComDado: { ref: DocumentReference; n: number }[] = [];
  for (const ref of arvores) {
    const n = await contar(ref);
    if (n) arvoresComDado.push({ ref, n });
  }

  const documentos = [...existentes.map((r) => r.path), ...arvoresComDado.map((a) => `${a.ref.path} (${a.n} doc)`)];
  if (!opcoes.aplicar) return { documentos, aplicado: false };

  const lote = db.batch();
  for (const r of existentes) lote.delete(r);
  await lote.commit();
  for (const a of arvoresComDado) await db.recursiveDelete(a.ref);
  return { documentos, aplicado: true };
}
