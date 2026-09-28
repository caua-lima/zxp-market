import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { diasAte } from "@/lib/domain/saude";

/**
 * Contador diário de respostas ruins do Mercado Livre, POR EMPRESA (Etapa 4):
 * 429 (limite de uso), 5xx (erro do ML) e sem resposta. Só o que deu errado
 * é gravado — chamada boa não custa escrita. Documento por dia em
 * `cron_estado/ml_saude_{AAAA-MM-DD}` (vai pra empresa pela tradução de caminho).
 *
 * Nunca lança nem atrasa a chamada: quem chama não espera por isto.
 */
export async function registrarRespostaRuimDoML(tipo: "429" | "5xx" | "timeout"): Promise<void> {
  const [hoje] = diasAte(Date.now(), 1);
  const campo = tipo === "429" ? "s429" : tipo === "5xx" ? "s5xx" : "timeouts";
  await getAdminDb().collection("cron_estado").doc(`ml_saude_${hoje}`).set({ [campo]: FieldValue.increment(1), ultimoEm: Date.now() }, { merge: true });
}
