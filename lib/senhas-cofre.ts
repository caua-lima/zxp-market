import "server-only";
import { getAdminDb } from "@/lib/firebase/admin";
import { cifrar, decifrar, derivarChave } from "@/lib/cofre-cripto";

/**
 * O cofre das senhas de acesso — ver lib/cofre-cripto.ts pro porquê.
 *
 * Um documento por e-mail em `senhas_cofre`, só o servidor lê e grava (as
 * regras do Firestore negam o cliente). A chave sai de SENHAS_COFRE_CHAVE, ou,
 * sem ela, da chave privada do Firebase Admin — segredo que já existe só no
 * servidor. Trocar esse segredo deixa as senhas guardadas ilegíveis (a tela diz
 * "defina uma nova"), nunca expostas.
 *
 * Só existe senha guardada a partir de 23/11/2026: as definidas antes nunca
 * passaram por aqui, e o Firebase não as devolve.
 */
const COLECAO = "senhas_cofre";

function chave(): Buffer {
  return derivarChave(process.env.SENHAS_COFRE_CHAVE || process.env.FIREBASE_PRIVATE_KEY || "");
}

export async function guardarSenha(email: string, senha: string, por: string): Promise<void> {
  await getAdminDb().collection(COLECAO).doc(email.trim().toLowerCase()).set({
    cifrada: cifrar(senha, chave()),
    definidaEm: Date.now(),
    definidaPor: por.toLowerCase(),
  });
}

export type SenhaGuardada =
  | { situacao: "ok"; senha: string; definidaEm: number; definidaPor: string }
  | { situacao: "nao_guardada" }
  | { situacao: "ilegivel" };

export async function lerSenha(email: string): Promise<SenhaGuardada> {
  const snap = await getAdminDb().collection(COLECAO).doc(email.trim().toLowerCase()).get();
  if (!snap.exists) return { situacao: "nao_guardada" };
  const d = snap.data() as { cifrada?: string; definidaEm?: number; definidaPor?: string };
  const senha = decifrar(String(d.cifrada ?? ""), chave());
  if (senha == null) return { situacao: "ilegivel" };
  return { situacao: "ok", senha, definidaEm: Number(d.definidaEm ?? 0), definidaPor: String(d.definidaPor ?? "") };
}

/** Quem viu qual senha, e quando — na trilha de auditoria da aba Acesso. */
export async function registrarVisualizacao(alvo: string, quem: string): Promise<void> {
  await getAdminDb().collection("auditLog").doc(`audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`).set({
    acao: "visualizar", entidade: "acesso", entidadeId: alvo, entidadeLabel: alvo,
    detalhe: alvo === quem ? "viu a própria senha" : "viu a senha de login", por: quem, em: Date.now(),
  }).catch(() => {});
}
