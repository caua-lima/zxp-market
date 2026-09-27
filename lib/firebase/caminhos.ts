import { DESTINOS } from "@/lib/domain/migracao-dados";

/**
 * Onde o dado da empresa mora — a CHAVE da virada (Etapa 3).
 *
 *   NEXT_PUBLIC_ZXP_MODO_DADOS = "raiz"   (padrão) → /estoque, /ml_orders… como sempre
 *   NEXT_PUBLIC_ZXP_MODO_DADOS = "tenant"          → /tenants/{id}/estoque…
 *   NEXT_PUBLIC_ZXP_TENANT_ID  = "vazxpress"
 *
 * Uma chave só pra servidor E navegador: se os dois lessem de lugares
 * diferentes, o painel mostraria o que o cron não gravou. `NEXT_PUBLIC_` porque o
 * navegador precisa dela (o Next embute no build) — o id da empresa não é
 * segredo; quem protege o dado são as regras e a autorização.
 *
 * Com a chave desligada, TODO caminho sai idêntico ao de antes: é o que permite
 * este código estar em produção antes da migração. Só vire depois de rodar
 * scripts/migrar-dados-tenant.mjs e conferir (docs/saas/MIGRACAO.md).
 */

export type ConfigDeDados = { modo: "raiz" } | { modo: "tenant"; tenantId: string };

export function lerConfigDeDados(
  // Referência LITERAL a cada variável: é assim que o Next as embute no navegador.
  modo = process.env.NEXT_PUBLIC_ZXP_MODO_DADOS,
  tenantId = process.env.NEXT_PUBLIC_ZXP_TENANT_ID,
): ConfigDeDados {
  const m = String(modo ?? "").trim().toLowerCase();
  if (m === "" || m === "raiz") return { modo: "raiz" };
  if (m !== "tenant") throw new Error(`NEXT_PUBLIC_ZXP_MODO_DADOS inválido: "${modo}" (use "raiz" ou "tenant")`);
  const t = String(tenantId ?? "").trim();
  // Falhar alto: modo empresa sem empresa gravaria no lugar errado em silêncio.
  if (!/^[a-z0-9-]{2,60}$/.test(t)) throw new Error("NEXT_PUBLIC_ZXP_MODO_DADOS=tenant exige NEXT_PUBLIC_ZXP_TENANT_ID válido (ex.: vazxpress)");
  return { modo: "tenant", tenantId: t };
}

/**
 * Traduz um caminho relativo à raiz ("ml_orders/123", "estoque",
 * "notification_feed/a@b.com/itens/x") pro lugar certo. Só o PRIMEIRO segmento
 * decide: coleção de empresa vai pra tenants/{id}/…, a conexão do ML
 * (`ml_tokens`) vira `connections`, e o resto (pessoa, sistema, o próprio
 * `tenants`) fica onde está.
 */
export function traduzirCaminho(caminho: string, cfg: ConfigDeDados = lerConfigDeDados()): string {
  if (cfg.modo === "raiz") return caminho;
  const limpo = caminho.replace(/^\/+/, "");
  const [primeiro, ...resto] = limpo.split("/");
  const destino = DESTINOS[primeiro]?.destino;
  if (destino === "tenant") return [`tenants/${cfg.tenantId}`, primeiro, ...resto].join("/");
  if (destino === "conexao") return [`tenants/${cfg.tenantId}/connections`, ...resto].join("/");
  return limpo;
}
