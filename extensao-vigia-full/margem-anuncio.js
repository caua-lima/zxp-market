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

  /** O elemento-folha cujo texto é exatamente `texto` (ignora espaços). */
  function folhaComTexto(raiz, texto) {
    const alvo = texto.toLowerCase();
    const it = document.createTreeWalker(raiz, NodeFilter.SHOW_ELEMENT);
    for (let el = it.currentNode; el; el = it.nextNode()) {
      if (el.closest && el.closest(".zxp-margem-anuncio")) continue;
      if (el.children.length === 0 && el.textContent.trim().toLowerCase() === alvo) return el;
    }
    return null;
  }

  /** Sobe a partir de `el` até achar um ancestral cujo texto tem um "R$". */
  function blocoComValor(el, limite = 4) {
    let b = el;
    for (let i = 0; i < limite && b; i++) {
      b = b.parentElement;
      if (b && /R\$\s*[\d.]+/.test(b.innerText)) return b;
    }
    return null;
  }

  /**
   * Lê o "Resumo de custos": o "Você recebe" (repasse) e o preço da unidade
   * ("Preço de 1 unidade … R$ 39,94/u"). Sem o painel na tela, null.
   */
  function lerResumo() {
    const titulo = folhaComTexto(document.body, "Resumo de custos");
    const raiz = titulo ? (titulo.closest("aside,section,[role=dialog]") || titulo.parentElement?.parentElement || document.body) : document.body;
    const rotulo = folhaComTexto(raiz, "Você recebe");
    if (!rotulo) return null;
    const blocoRecebe = blocoComValor(rotulo);
    if (!blocoRecebe) return null;
    const recebe = M.lerReais(blocoRecebe.innerText.slice(blocoRecebe.innerText.indexOf("Você recebe")));

    // Preço: a linha "Preço de 1 unidade" do próprio painel; sem ela, o campo de preço da tela.
    let preco = null;
    const linhas = [...raiz.querySelectorAll("*")].filter((e) => e.children.length === 0 && /^Preço de\b/i.test(e.textContent.trim()));
    for (const l of linhas) {
      const b = blocoComValor(l);
      if (b) { preco = M.lerReais(b.innerText.slice(b.innerText.search(/Preço de/i))); if (preco) break; }
    }
    if (preco == null) {
      const campo = [...document.querySelectorAll("input")].find((i) => /preço|price/i.test(i.getAttribute("aria-label") || i.name || i.id || "") && /\d/.test(i.value));
      if (campo) preco = M.lerReais(`R$ ${campo.value}`);
    }
    return { recebe, preco, blocoRecebe };
  }

  let ultima = "";
  function marcar() {
    const r = lerResumo();
    if (!r || r.recebe == null) { document.querySelectorAll(".zxp-margem-anuncio").forEach((e) => e.remove()); ultima = ""; return; }
    const mlb = mlbDaPagina();
    const assinatura = `${mlb}|${r.preco}|${r.recebe}|${dados ? (dados.em || dados.erro) : ""}`;
    const existente = document.querySelector(".zxp-margem-anuncio");
    if (assinatura === ultima && existente && r.blocoRecebe.contains(existente)) return;
    ultima = assinatura;
    document.querySelectorAll(".zxp-margem-anuncio").forEach((e) => e.remove());

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
    r.blocoRecebe.appendChild(el);
  }

  let pendente = 0;
  new MutationObserver(() => {
    clearTimeout(pendente);
    pendente = setTimeout(marcar, 250);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  await carregar(false);
})();
