import { rotaDeDiagnostico } from "@/lib/diagnostico";
import { getValidMlAccessToken } from "@/lib/ml/getToken";
import { sellerIdAtual } from "@/lib/ml/vendedor";
import { fetchML } from "@/lib/ml/fetch-ml";

const ML_API = "https://api.mercadolibre.com";

/**
 * Diagnóstico: o que a API PÚBLICA do ML entrega sobre envios pro Full
 * (agenda da coleta, prazo de edição, quantidades declaradas/processadas e
 * custo da coleta). O painel "Gestão de envios Full" tem tudo isso, mas por
 * uma API interna que o servidor não pode usar. Aqui só se PERGUNTA — GETs,
 * nada é alterado — a cada caminho candidato, e se devolve status + trecho.
 *
 * Uso: /api/ml/debug-inbounds?inbound=80517703&fechado=81226703
 */
export const GET = rotaDeDiagnostico("debug-inbounds", async (req) => {
  const url = new URL(req.url);
  const inbound = url.searchParams.get("inbound") || "80517703";
  const fechado = url.searchParams.get("fechado") || "81226703";
  const token = await getValidMlAccessToken();
  const seller = String(await sellerIdAtual());
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };

  const caminhos = [
    `/inbounds/search?seller_id=${seller}`,
    `/inbounds?seller_id=${seller}`,
    `/inbounds/${inbound}`,
    `/inbounds/${fechado}`,
    `/inbounds/${fechado}/details`,
    `/inbound/${inbound}`,
    `/fbm/inbounds?seller_id=${seller}`,
    `/fulfillment/inbounds?seller_id=${seller}`,
    `/fulfillment/inbounds/${inbound}`,
    `/shipping/inbounds?seller_id=${seller}`,
    `/users/${seller}/inbounds`,
    `/users/${seller}/fulfillment/inbounds`,
    `/marketplace/inbounds?seller_id=${seller}`,
    `/stock/fulfillment/inbounds?seller_id=${seller}`,
    `/stock/fulfillment/inbounds/${inbound}`,
    `/shipments/${inbound}`,
    `/shipments/${fechado}`,
    `/shipments/${fechado}/costs`,
    `/shipments/${fechado}/items`,
    `/billing/integration/monthly/periods?group=ML&document_type=BILL&offset=0&limit=2`,
  ];

  /**
   * `?billing=AAAA-MM-01`: lê o DETALHE de um fechamento do faturamento e
   * devolve só as linhas que parecem coleta/Full — é onde o custo da coleta
   * pode aparecer depois que o ML cobra (o recurso de envios dá 403).
   */
  const chaveBilling = url.searchParams.get("billing");
  if (chaveBilling) {
    const linhas: Record<string, unknown>[] = [];
    const status: number[] = [];
    let total = 0;
    for (let offset = 0; offset < 3000; offset += 1000) {
      const r = await fetchML(
        `${ML_API}/billing/integration/periods/key/${chaveBilling}/group/ML/details?document_type=BILL&limit=1000&offset=${offset}`,
        { headers, cache: "no-store" }, { maxTentativas: 1 },
      );
      status.push(r.status);
      if (!r.ok) { linhas.push({ erro: (await r.text()).slice(0, 600) }); break; }
      const j = (await r.json()) as { results?: Record<string, unknown>[]; total?: number };
      total = Number(j.total ?? 0);
      linhas.push(...(j.results ?? []));
      if ((j.results ?? []).length < 1000) break;
    }
    const texto = (o: unknown) => JSON.stringify(o);
    const coleta = linhas.filter((l) => /colet|full|fulfil|inbound|pickup|armazen|storage/i.test(texto(l)));
    const tipos = new Map<string, number>();
    for (const l of linhas) {
      const ci = (l.charge_info ?? {}) as Record<string, unknown>;
      const k = String(ci.detail_type ?? ci.detail_sub_type ?? l.detail_type ?? "?") + " · " + String(ci.transaction_detail ?? ci.detail_description ?? "");
      tipos.set(k, (tipos.get(k) ?? 0) + 1);
    }
    return { corpo: {
      chave: chaveBilling, status, total, lidas: linhas.length,
      tipos: Object.fromEntries([...tipos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)),
      coleta: coleta.slice(0, 15),
      amostra: linhas[0] ?? null,
    } };
  }

  const resultados: { caminho: string; status: number; trecho: string }[] = [];
  for (const c of caminhos) {
    try {
      const r = await fetchML(`${ML_API}${c}`, { headers, cache: "no-store" }, { maxTentativas: 1 });
      const t = await r.text().catch(() => "");
      resultados.push({ caminho: c, status: r.status, trecho: t.slice(0, 1500) });
    } catch (e) {
      resultados.push({ caminho: c, status: -1, trecho: String(e).slice(0, 200) });
    }
  }
  return { corpo: { inbound, fechado, resultados } };
});
