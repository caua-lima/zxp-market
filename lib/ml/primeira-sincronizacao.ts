import "server-only";
import { getAdminDb } from "@/lib/firebase/admin";
import { log } from "@/lib/log";

/**
 * Marca da primeira sincronização completa da empresa (S24): é o que o
 * checklist de ativação usa pra dizer "vendas importadas" — mesmo com zero
 * pedidos (loja nova), que é diferente de "ainda importando".
 *
 * `create`: só a primeira vale; as seguintes falham em silêncio (já existe).
 */
const REF = () => getAdminDb().collection("cron_estado").doc("primeira_sincronizacao");

export async function marcarPrimeiraSincronizacao(pedidos: number): Promise<void> {
  try {
    await REF().create({ em: Date.now(), pedidos });
  } catch (err) {
    if (/already exists/i.test(String(err)) || String((err as { code?: unknown })?.code) === "6") return;
    log.error("sincronizacao", { mensagem: "não marquei a primeira sincronização", erro: err });
  }
}

export async function lerPrimeiraSincronizacao(): Promise<number | null> {
  const d = (await REF().get()).data();
  return typeof d?.em === "number" ? d.em : null;
}
