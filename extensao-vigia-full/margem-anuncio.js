/**
 * MARGEM NA TELA DE MODIFICAR ANÚNCIO DO ML (content script).
 *
 * Pedido do dono (25/11/2026): no "Resumo de custos" da tela de editar o
 * anúncio, embaixo do "Você recebe", a mesma marca da página de promoções:
 *
 *     Margem 19,8% · lucro R$ 4,23
 *
 * E ela acompanha a edição: mudou o preço, o ML recalcula o "Você recebe" e a
 * margem é refeita na hora (um observador olha o painel).
 *
 * A conta é a mesma de margem-promocao.js (testada): o "Você recebe" do ML já
 * é o repasse (preço − tarifa − envio), e daí sai custo médio vigente e
 * imposto sobre o preço — os dois vindos do Dash pelo fundo da extensão.
 */
(async () => {
  const M = await import(chrome.runtime.getURL("margem-promocao.js"));
  const COR = { saudavel: "#00a650", atencao: "#b37400", prejuizo: "#f23d4f" };
  const FUNDO = { saudavel: "#e6f7ed", atencao: "#fff4dc", prejuizo: "#feecee" };

  let dados = null;
  async function carregar(forcar = false) {
    dados = await chrome.runtime.sendMessage({ tipo: "custos", forcar }).catch(() => ({ erro: "Extensão sem resposta — recarregue a página." }));
    ultima = "";
    marcar();
  }

  /** O MLB do anúncio: `?item_id=MLB…` na URL (a tela é por variação/UP, o MLB vem aqui). */
  function mlbDaPagina() {
    const q = new URLSearchParams(location.search).get("item_id");
    if (q && /^MLB\d+$/i.test(q)) return q.toUpperCase();
    const m = location.href.match(/MLB\d{6,}/i);
    return m ? m[0].toUpperCase() : null;
  }

  /**
   * O "Resumo de custos" é um micro-frontend do ML dentro de um SHADOW DOM
   * (#remote-module-container-sc-costcalculator-…, modo "open"): uma busca
   * comum no document não o enxerga. Por isso a leitura varre o document E
   * cada shadow root aberto. Medido em 25/11/2026.
   */
  function raizes() {
    const lista = [document];
    for (const el of document.querySelectorAll("*")) if (el.shadowRoot) lista.push(el.shadowRoot);
    return lista;
  }

  /** Folhas de texto em ordem de documento (sem script/style e sem a nossa marca). */
  function folhas(raiz) {
    return [...raiz.querySelectorAll("*")].filter((el) => el.children.length === 0
      && el.tagName !== "SCRIPT" && el.tagName !== "STYLE" && !(el.closest && el.closest(".zxp-margem-anuncio")));
  }

  /** O primeiro valor em R$ que vem DEPOIS do rótulo, na ordem da tela. */
  function valorDepoisDe(fs, rotulo) {
    const i = fs.findIndex((el) => el.textContent.trim().toLowerCase() === rotulo.toLowerCase());
    if (i < 0) return null;
    for (let j = i + 1; j < Math.min(fs.length, i + 12); j++) {
      const v = M.lerReais(fs[j].textContent);
      if (v != null) return { el: fs[j], valor: v };
    }
    return null;
  }

  /**
   * Lê o "Resumo de custos": o "Você recebe" (repasse, `.rm-card-profit__amount`)
   * e o preço da unidade ("Preço de 1 unidade … R$ 39,94/u"). Sem o painel, null.
   */
  function lerResumo() {
    for (const raiz of raizes()) {
      const fs = folhas(raiz);
      if (!fs.some((el) => /^Você recebe$/i.test(el.textContent.trim()))) continue;
      const amount = raiz.querySelector(".rm-card-profit__amount");
      const rec = amount ? { el: amount, valor: M.lerReais(amount.textContent) } : valorDepoisDe(fs, "Você recebe");
      const pre = valorDepoisDe(fs, "Preço de");
      if (!rec || rec.valor == null) continue;
      const blocoRecebe = rec.el.closest('[class*="card-profit"]:not([class*="__"])') || rec.el.parentElement?.parentElement || rec.el.parentElement;
      return { recebe: rec.valor, preco: pre ? pre.valor : null, blocoRecebe };
    }
    return null;
  }

  let ultima = "";
  function marcar() {
    const r = lerResumo();
    if (!r || r.recebe == null) { ultima = ""; return; }
    const mlb = mlbDaPagina();
    const assinatura = `${mlb}|${r.preco}|${r.recebe}|${dados ? (dados.em || dados.erro) : ""}`;
    const prox = r.blocoRecebe.nextElementSibling;
    const existente = prox && prox.classList.contains("zxp-margem-anuncio") ? prox : null;
    if (assinatura === ultima && existente) return;
    ultima = assinatura;
    raizes().forEach((rz) => rz.querySelectorAll(".zxp-margem-anuncio").forEach((e) => e.remove()));

    const el = document.createElement("div");
    el.className = "zxp-margem-anuncio";
    el.style.cssText = "margin-top:8px;padding:6px 10px;border-radius:8px;font:600 13px/1.45 system-ui,-apple-system,sans-serif;cursor:help;";
    const cinza = (texto, title) => { el.textContent = texto; el.title = title || ""; el.style.cssText += "background:#f0f0f0;color:#666;"; };

    if (!dados) cinza("ZXP · carregando custos do Dash…");
    else if (dados.erro) cinza(`ZXP · ${dados.erro}`, "Clique pra tentar de novo.");
    else {
      const item = mlb ? dados.itens[mlb] : null;
      if (!item) cinza("ZXP · anúncio sem cadastro no Estoque", `${mlb || "MLB?"} não está ligado a nenhum produto do Estoque do Dash.`);
      else if (!(r.preco > 0)) cinza("ZXP · não achei o preço nesta tela");
      else {
        const m = M.margemDaPromocao({ recebe: r.recebe, precoFinal: r.preco, custo: item.custo, impostoPct: item.impostoPct });
        if (!m) cinza("ZXP · produto sem custo no Estoque", `${item.nome}: cadastre o custo no Estoque do Dash pra ver a margem.`);
        else {
          const meta = Number(dados.metaMargem) || 10;
          const st = M.statusDaMargem(m.margem, meta);
          el.innerHTML = `<div style="font-size:14px">Margem ${M.pct(m.margem)} · lucro ${M.reais(m.lucro)}</div>`
            + `<div style="font-weight:500;font-size:11px;opacity:.85">custo ${M.reais(item.custo)} · imposto ${M.pct(item.impostoPct)} · meta ${M.pct(meta)} · ZXP</div>`;
          el.style.cssText += `background:${FUNDO[st]};color:${COR[st]};`;
          const falta = M.repasseParaMeta(r.preco, item.custo, item.impostoPct, meta);
          el.title = [
            item.nome,
            `Você recebe ${M.reais(r.recebe)} (o ML já tirou tarifa e envio)`,
            `− custo ${M.reais(item.custo)} (custo médio vigente, do Dash)`,
            `− imposto ${M.pct(item.impostoPct)} sobre ${M.reais(r.preco)} = ${M.reais(m.imposto)}`,
            `= lucro ${M.reais(m.lucro)} · margem ${M.pct(m.margem)} do preço`,
            st !== "saudavel" && falta != null ? `Pra bater a meta neste preço, o "você recebe" teria de ser ${M.reais(falta)}.` : "",
            "Clique pra buscar os custos do Dash de novo.",
          ].filter(Boolean).join("\n");
        }
      }
    }
    el.addEventListener("click", () => { el.textContent = "ZXP · atualizando custos…"; carregar(true); });
    // Logo ABAIXO do cartão: ele tem altura fixa e overflow escondido, e por dentro a marca sumia.
    r.blocoRecebe.insertAdjacentElement("afterend", el);
  }

  /**
   * Mudança dentro do shadow DOM não chega a um observador do document, e o
   * painel abre e fecha com a seção "Condições de venda". Uma conferida a cada
   * 0,7 s é barata (a marca só é refeita quando preço ou repasse mudam).
   */
  setInterval(marcar, 700);

  await carregar(false);
})();
