/**
 * Leitura dos ENVIOS PRO FULL no painel do ML ("Gestão de envios Full"), com
 * o login deste Chrome. Puro (sem chrome.*): testado em
 * lib/domain/leitura-envios-extensao.test.ts.
 *
 * O painel não tem API que o app possa chamar — a pública responde 403 pro
 * app (medido em 22/11/2026). Mas a própria página traz os dados num script
 * `<script id="__NORDIC_RENDERING_CTX__">_n.ctx.r={…};…</script>`:
 *
 *  - lista  (/shipping/inbounds?page=N):         appProps.pageProps.data.results
 *  - detalhe (/shipping/inbounds/{id}/details):  appProps.pageProps.view.data
 *
 * A extensão só RECORTA esse objeto e manda as partes cruas pro app; quem
 * interpreta é lib/domain/envios-full-ml.ts (testado com recortes reais).
 * Sem DOMParser: o service worker do Chrome não tem.
 */

export const SITE = "https://vendedores.mercadolivre.com.br";
export const caminhoDaLista = (pagina) => `/shipping/inbounds${pagina > 1 ? `?page=${pagina}` : ""}`;
export const caminhoDoDetalhe = (id) => `/shipping/inbounds/${encodeURIComponent(String(id))}/details`;

/** O endereço dos envios no app, a partir do endereço da vigia (mesmo código `t`). */
export function enderecoDosEnvios(enderecoDaVigia) {
  const s = String(enderecoDaVigia || "");
  return s.includes("/api/widget/vigias") ? s.replace("/api/widget/vigias", "/api/widget/envios-full") : "";
}

/**
 * Recorta o PRIMEIRO objeto JSON que vem depois de `marca`, respeitando
 * aspas e escapes (o script continua com outras instruções depois do `;`,
 * então JSON.parse do resto inteiro falha). `null` se não achar ou não parsear.
 */
export function recortarObjeto(texto, marca) {
  const t = String(texto || "");
  const i = t.indexOf(marca);
  if (i < 0) return null;
  const k = t.indexOf("{", i);
  if (k < 0) return null;
  let nivel = 0;
  let emTexto = false;
  let escape = false;
  for (let p = k; p < t.length; p++) {
    const c = t[p];
    if (emTexto) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') emTexto = false;
      continue;
    }
    if (c === '"') emTexto = true;
    else if (c === "{") nivel++;
    else if (c === "}") {
      nivel--;
      if (nivel === 0) {
        try { return JSON.parse(t.slice(k, p + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

/** O contexto de renderização da página (`_n.ctx.r`), direto do HTML. */
export function contextoDaPagina(html) {
  const h = String(html || "");
  const i = h.indexOf('id="__NORDIC_RENDERING_CTX__"');
  if (i < 0) return null;
  return recortarObjeto(h.slice(i), "_n.ctx.r=");
}

/** Lista: `{ resultados, total, porPagina }` — ou null se a página não é a lista. */
export function lerLista(html) {
  const ctx = contextoDaPagina(html);
  const data = ctx && ctx.appProps && ctx.appProps.pageProps && ctx.appProps.pageProps.data;
  if (!data || !Array.isArray(data.results)) return null;
  const paging = data.paging || {};
  return { resultados: data.results, total: Number(paging.total || 0), porPagina: Number(paging.limit || data.results.length || 20) };
}

/** Detalhe: o objeto `view.data` cru — ou null. */
export function lerDetalhe(html) {
  const ctx = contextoDaPagina(html);
  const v = ctx && ctx.appProps && ctx.appProps.pageProps && ctx.appProps.pageProps.view;
  return v && v.data && v.data.inboundId ? v.data : null;
}

/**
 * Até onde descer na lista: ela vem do mais novo pro mais antigo; páginas
 * em que TODO envio está encerrado e parado há mais de `dias` não mudam mais.
 */
export function listaJaCobreOQueImporta(resultados, agoraMs, dias = 45) {
  if (!resultados.length) return true;
  const limite = agoraMs - dias * 86400000;
  const encerrado = (s) => /^(closed|cancel|expired)/i.test(String(s || ""));
  return resultados.every((r) => encerrado(r.status) && (Date.parse(r.last_updated || "") || 0) < limite);
}

/** Só o que o app usa de cada linha da lista — sem endereço nem dado pessoal. */
export function enxugarLinha(r) {
  return {
    id: r.id, shipment_type: r.shipment_type, appointment: r.appointment, status: r.status, sub_status: r.sub_status,
    units_count: r.units_count, products_count: r.products_count, last_updated: r.last_updated,
    reception_date: r.reception_date, on_sale_units: r.on_sale_units, inbound_charges: r.inbound_charges,
  };
}

/** Só o que o app usa do detalhe — sem endereço de coleta nem dado pessoal. */
export function enxugarDetalhe(d) {
  const ap = d.appointment || {};
  return {
    inboundId: d.inboundId, status: d.status, subStatus: d.subStatus, cancellationLimitDate: d.cancellationLimitDate,
    appointment: { type: ap.type, scheduledDate: ap.scheduledDate, arrivalDate: ap.arrivalDate },
    unitsDetail: d.unitsDetail,
    units: (d.units || []).map((u) => ({
      itemId: u.itemId, itemTitle: u.itemTitle, sku: u.sku, inventoryId: u.inventoryId,
      declaredQuantity: u.declaredQuantity, receivedQuantity: u.receivedQuantity, onSaleQuantity: u.onSaleQuantity,
      differencesQuantity: u.differencesQuantity, processedQuantity: u.processedQuantity,
    })),
    charges: (d.charges || []).map((c) => ({
      type: c.type, concept: c.concept, totalCharged: c.totalCharged, chargeDate: c.chargeDate, tags: c.tags,
      detail: { declaredQuantity: c.detail && c.detail.declaredQuantity, receivedQuantity: c.detail && c.detail.receivedQuantity, estimated: c.detail && c.detail.estimated },
    })),
  };
}
