import "server-only";
import { getMlAccessToken, getSellerId, tenantCol } from "@/lib/tenant";
import { marcoDeReputacao, marcosDeFaturamento } from "@/lib/domain/marcos";
import { notificarMarco } from "@/lib/ml/notificar-venda";

const ML_API = "https://api.mercadolibre.com";

/**
 * Verifica e avisa os marcos comemorativos — faturamento do mês e reputação.
 *
 * ─── POR QUE ISTO NÃO CALCULA O FATURAMENTO ─────────────────────────────
 *
 * Recebe o faturamento pronto de quem chama, em vez de somar por conta
 * própria. Recalcular aqui criaria uma SEGUNDA definição de faturamento no
 * app — e definição duplicada foi a origem de quase todo número errado nesta
 * base (frete por pedido, cancelado do cache, dia em fuso trocado). O marco
 * tem que comemorar o mesmo número que o Dashboard mostra, senão vira mais
 * uma coisa pra conferir.
 *
 * Best-effort por construção: nenhum erro aqui pode derrubar o sync ou o cron,
 * que é o que mantém o painel correto. Comemoração é o que menos importa
 * quando algo quebra.
 */

/** Onde guardamos o último nível de reputação visto, pra detectar a SUBIDA. */
const ESTADO = "marcos_estado";

async function lerUltimoNivel(tenantId: string): Promise<{ nivel: string | null; conhecido: boolean }> {
  try {
    const d = await tenantCol(tenantId, ESTADO).doc("reputacao").get();
    if (!d.exists) return { nivel: null, conhecido: false };
    return { nivel: (d.data()?.powerSellerStatus as string | null) ?? null, conhecido: true };
  } catch {
    // Sem leitura, trata como desconhecido: melhor não comemorar do que dar
    // parabéns por um nível que talvez seja de meses atrás.
    return { nivel: null, conhecido: false };
  }
}

async function salvarNivel(tenantId: string, nivel: string | null): Promise<void> {
  try {
    await tenantCol(tenantId, ESTADO).doc("reputacao").set(
      { powerSellerStatus: nivel, em: Date.now() },
      { merge: true },
    );
  } catch { /* perder o ponteiro só adia a detecção pra próxima */ }
}

export type ResultadoMarcos = {
  faturamento: string[];
  reputacao: string | null;
  nivelAtual: string | null;
};

export async function verificarMarcos(tenantId: string, faturamentoMes: number, mes: string): Promise<ResultadoMarcos> {
  const avisadosFaturamento: string[] = [];
  let avisadoReputacao: string | null = null;
  let nivelAtual: string | null = null;

  // ── Faturamento do mês ──
  for (const m of marcosDeFaturamento(faturamentoMes, mes)) {
    try {
      if (await notificarMarco(tenantId, m)) avisadosFaturamento.push(m.chave);
    } catch (err) {
      console.error("[marcos] falhou ao avisar", m.chave, err);
    }
  }

  // ── Reputação ──
  try {
    const token = await getMlAccessToken(tenantId);
    if (token) {
      const r = await fetch(`${ML_API}/users/${await getSellerId(tenantId)}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        cache: "no-store",
      });
      if (r.ok) {
        const j = (await r.json()) as { seller_reputation?: { power_seller_status?: string | null } };
        nivelAtual = j.seller_reputation?.power_seller_status ?? null;

        const { nivel: anterior, conhecido } = await lerUltimoNivel(tenantId);
        const marco = marcoDeReputacao(nivelAtual, anterior, conhecido);
        if (marco && await notificarMarco(tenantId, marco)) avisadoReputacao = marco.chave;

        /**
         * Grava SEMPRE, mesmo sem marco. É esta gravação que transforma a
         * primeira execução (que não comemora, por não saber de onde veio) na
         * base de comparação da próxima — sem ela, nenhuma subida seria
         * detectada nunca.
         */
        await salvarNivel(tenantId, nivelAtual);
      }
    }
  } catch (err) {
    console.error("[marcos] reputação indisponível", err);
  }

  return { faturamento: avisadosFaturamento, reputacao: avisadoReputacao, nivelAtual };
}
