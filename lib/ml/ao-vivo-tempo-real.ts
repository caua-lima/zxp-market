import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb, getAdminMessaging } from "@/lib/firebase/admin";
import { tenantAtual } from "@/lib/firebase/contexto-tenant";
import { caminhoDoTime } from "@/lib/empresas";
import { acessoExpirado } from "@/lib/domain/acesso-temporario";
import { sinalDoPedido, type EstadoParaSinal, type SinalAoVivo } from "@/lib/domain/ao-vivo-tempo-real";
import { placarDe } from "@/lib/domain/painel-fixo";
import { calcularAoVivo } from "@/lib/ml/ao-vivo-calculo";

/**
 * O lado do servidor das vendas ao vivo em tempo real. O webhook chama logo
 * depois de gravar o pedido (lib/ml/webhook-inbox.ts):
 *
 *  1. `publicarSinalAoVivo` — escreve `ao_vivo/sinal`. A barra de quem está
 *     com o app aberto escuta esse documento e soma a venda na hora.
 *  2. `enviarPainelFixo` — com o app FECHADO não há quem escute: os aparelhos
 *     que fixaram o mini painel na barra do celular recebem um push silencioso
 *     com o placar já calculado, e o Service Worker reescreve a notificação.
 *
 * Os dois são melhor-esforço: falhar aqui nunca impede o pedido de ser gravado
 * nem o aviso da venda de sair. A barra continua relendo o ML sozinha.
 */

/** A empresa do momento (a da requisição/webhook) — a mesma chave que a rota usa. */
export function empresaDoAoVivo(): string {
  return tenantAtual() ?? "raiz";
}

/** Publica o sinal se o pedido mudou algo que a barra mostra. Devolve o sinal, ou `null`. */
export async function publicarSinalAoVivo(
  db: FirebaseFirestore.Firestore,
  estado: EstadoParaSinal,
  antes: { status?: unknown } | undefined,
  agora = Date.now(),
): Promise<Omit<SinalAoVivo, "seq"> | null> {
  const sinal = sinalDoPedido(estado, antes, agora);
  if (!sinal) return null;
  // `seq` sobe a cada sinal: duas vendas iguais seguidas ainda são duas mudanças pro app.
  await db.collection("ao_vivo").doc("sinal").set({ ...sinal, seq: FieldValue.increment(1) }, { merge: true });
  return sinal;
}

export type AparelhoDoPainel = { docId: string; email: string; token: string };

/**
 * Os aparelhos que fixaram o painel DESTA empresa e cujo dono ainda tem acesso.
 * O registro de push é global (a pessoa, não a empresa), por isso o campo
 * `painelFixoEmpresa`: quem é de duas empresas fixa o painel de uma.
 */
export async function aparelhosComPainelFixo(db: FirebaseFirestore.Firestore, empresa: string, agora = Date.now()): Promise<AparelhoDoPainel[]> {
  const snap = await db.collection("pushTokens").where("painelFixoEmpresa", "==", empresa).get();
  if (snap.empty) return [];
  const time = await db.collection(caminhoDoTime()).get();
  const comAcesso = new Set<string>();
  for (const d of time.docs) {
    const dados = d.data() ?? {};
    if (acessoExpirado(dados, agora)) continue;
    comAcesso.add(String(dados.email ?? d.id).toLowerCase());
  }
  return snap.docs
    .map((d) => ({ docId: d.id, email: String(d.get("email") ?? "").toLowerCase(), token: String(d.get("token") ?? "") }))
    .filter((a) => a.token && comAcesso.has(a.email));
}

/**
 * Manda o placar do dia pros aparelhos com o painel fixo. O número é o MESMO da
 * barra (calcularAoVivo), já incluindo este pedido — a busca do ML ainda não o
 * listaria.
 *
 * Só `data` (como o resto dos pushes — ver lib/notification-outbox.ts): quem
 * desenha é o Service Worker. `Topic` faz o provedor guardar só o último placar
 * de um aparelho desligado, e o TTL curto descarta placar velho.
 */
export async function enviarPainelFixo(
  pedido: { orderId: string; valida: boolean },
  estado: Record<string, unknown> | null,
  agora = Date.now(),
): Promise<{ aparelhos: number; enviados: number }> {
  const db = getAdminDb();
  const empresa = empresaDoAoVivo();
  const aparelhos = await aparelhosComPainelFixo(db, empresa, agora);
  if (aparelhos.length === 0) return { aparelhos: 0, enviados: 0 };

  const { body } = await calcularAoVivo({ empresa, pedido: { ...pedido, estado } });
  const resp = await getAdminMessaging().sendEachForMulticast({
    tokens: aparelhos.map((a) => a.token),
    data: { type: "ao_vivo", placar: JSON.stringify(placarDe(body)) },
    webpush: { headers: { TTL: "900", Urgency: "high", Topic: "aovivo" } },
  });
  return { aparelhos: aparelhos.length, enviados: resp.successCount };
}
