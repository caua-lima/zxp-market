/**
 * MARGEM NA PÁGINA DE PROMOÇÕES DO ML (content script).
 *
 * Em cada promoção da lista ("Com redução de tarifas", "Black Friday",
 * "Oferta relâmpago", "Nova proposta!"…) aparece, embaixo do "Você recebe":
 *
 *     Margem 19,8% · lucro R$ 4,23
 *
 * na cor do Dash (verde bate a meta do mês, amarelo abaixo, vermelho
 * prejuízo). Passando o mouse, a conta inteira. A conta está em
 * margem-promocao.js (testada); o custo e o imposto vêm do Dash pelo fundo
 * da extensão — o código da vigia nunca passa pela página do ML.
 *
 * A página é montada e remontada no navegador (página, filtro, "Alterar"),
 * então um observador refaz as marcas quando a lista muda.
 *
 * Content script não pode ser módulo: a conta entra por import() dinâmico
 * (por isso margem-promocao.js está em web_accessible_resources).
 */
(async () => {
  const M = await import(chrome.runtime.getURL("margem-promocao.js"));
  const COR = { saudavel: "#00a650", atencao: "#b37400", prejuizo: "#f23d4f" };
  const FUNDO = { saudavel: "#e6f7ed", atencao: "#fff4dc", prejuizo: "#feecee" };

  let dados = null; // { itens: { MLB…: { nome, custo, impostoPct } }, metaMargem, em } | { erro }

  async function carregar(forcar = false) {
    dados = await chrome.runtime.sendMessage({ tipo: "custos", forcar }).catch(() => ({ erro: "Extensão sem resposta — recarregue a página." }));
    document.querySelectorAll(".zxp-margem").forEach((e) => e.remove());
    document.querySelectorAll("[data-zxp]").forEach((e) => delete e.dataset.zxp);
    atualizarBotao();
    marcar();
    assinaturaOps = "";
    aplicarOportunidades();
  }

  const colunaDe = (box, n) => [...box.querySelectorAll('[class*="promotion-box__column__"]')]
    .find((c) => [...c.classList].some((k) => k.endsWith(`promotion-box__column__${n}`)));

  /**
   * Preço final da promoção: o PRIMEIRO texto da coluna 3. Ler o innerText da
   * coluna inteira colava o "R$ 57" com o "1 preço de atacado" do lado e dava
   * R$ 571 (Açaí, 23/11/2026).
   */
  const precoDaColuna = (col3) => {
    const el = col3.querySelector('[class*="column__line__text"]') || col3.querySelector('[class*="promotion-box__column__line"]');
    return M.lerReais(el ? el.textContent : col3.innerText);
  };

  function marcar() {
    if (!dados || dados.erro) return;
    for (const box of document.querySelectorAll(".sc-list-collapsible-row__promotion-box")) {
      const col3 = colunaDe(box, 3);
      const col4 = colunaDe(box, 4);
      if (!col3 || !col4) continue;
      const valorRecebe = col4.querySelector(".ps-total-charges-with-tooltip__value-container");
      const precoFinal = precoDaColuna(col3);
      const recebe = M.lerReais(valorRecebe ? valorRecebe.textContent : col4.innerText);
      // Assinatura: se a promoção muda de preço na tela (Alterar), a marca é refeita.
      const assinatura = `${precoFinal}|${recebe}`;
      if (box.dataset.zxp === assinatura) continue;
      box.dataset.zxp = assinatura;
      col4.querySelectorAll(".zxp-margem").forEach((e) => e.remove());

      const linha = box.closest(".sc-list-row");
      const mlb = M.mlbDaLinha(linha && (linha.querySelector(".sc-list-description") || linha).innerText);
      const el = document.createElement("div");
      el.className = "zxp-margem";
      el.style.cssText = "margin-top:6px;padding:3px 8px;border-radius:6px;font:600 12px/1.4 system-ui,-apple-system,sans-serif;display:inline-block;cursor:help;";

      const item = mlb ? dados.itens[mlb] : null;
      if (precoFinal == null || recebe == null) continue;
      if (!item) {
        el.textContent = "ZXP: anúncio sem cadastro no Estoque";
        el.style.cssText += "background:#f0f0f0;color:#666;";
        el.title = `${mlb || "MLB?"} não está ligado a nenhum produto do Estoque do Dash.`;
      } else {
        const r = M.margemDaPromocao({ recebe, precoFinal, custo: item.custo, impostoPct: item.impostoPct });
        if (!r) {
          el.textContent = "ZXP: produto sem custo no Estoque";
          el.style.cssText += "background:#f0f0f0;color:#666;";
          el.title = `${item.nome}: cadastre o custo no Estoque do Dash pra ver a margem.`;
        } else {
          const meta = Number(dados.metaMargem) || 10;
          const st = M.statusDaMargem(r.margem, meta);
          el.textContent = `Margem ${M.pct(r.margem)} · lucro ${M.reais(r.lucro)}`;
          el.style.cssText += `background:${FUNDO[st]};color:${COR[st]};`;
          const falta = M.repasseParaMeta(precoFinal, item.custo, item.impostoPct, meta);
          el.title = [
            `${item.nome}`,
            `Você recebe ${M.reais(recebe)} (o ML já tirou tarifa e envio do Full)`,
            `− custo ${M.reais(item.custo)} (custo médio vigente, do Dash)`,
            `− imposto ${M.pct(item.impostoPct)} sobre ${M.reais(precoFinal)} = ${M.reais(r.imposto)}`,
            `= lucro ${M.reais(r.lucro)} · margem ${M.pct(r.margem)} do preço final`,
            `Meta do mês: ${M.pct(meta)}`,
            st !== "saudavel" && falta != null ? `Pra bater a meta neste preço, o "você recebe" teria de ser ${M.reais(falta)} (faltam ${M.reais(falta - recebe)}).` : "",
          ].filter(Boolean).join("\n");
        }
      }
      col4.appendChild(el);
    }
  }

  // ── Botão flutuante: estado e "atualizar custos" ──
  const botao = document.createElement("button");
  botao.type = "button";
  botao.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:99999;padding:8px 12px;border-radius:20px;border:1px solid #ddd;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.15);font:600 12px system-ui,-apple-system,sans-serif;cursor:pointer;color:#333;";
  botao.addEventListener("click", () => { botao.textContent = "ZXP · atualizando custos…"; carregar(true); });
  document.documentElement.appendChild(botao);
  /**
   * O CARD DO TOPO — sempre visível (pedido do dono, 23/11/2026: "não aparece
   * nada lá em cima"). Sem oportunidade ele diz que conferiu e não achou, com a
   * versão da extensão: assim dá pra saber que ela está rodando.
   */
  const VERSAO = (() => { try { return chrome.runtime.getManifest().version; } catch { return ""; } })();
  const card = document.createElement("div");
  card.className = "zxp-card";
  document.documentElement.appendChild(card);
  let cardMinimizado = false;
  card.addEventListener("click", (e) => {
    const acao = e.target?.dataset?.acao;
    if (acao === "ir") irPara(0);
    else if (acao === "lista") mostrarPopup();
    else if (acao === "min") { cardMinimizado = true; desenharCard(); }
    else if (cardMinimizado) { cardMinimizado = false; desenharCard(); }
  });
  function desenharCard() {
    const n = oportunidades.length;
    card.classList.toggle("zxp-card-verde", n > 0);
    if (cardMinimizado) {
      card.innerHTML = n ? `▲ ${n} oportunidade${n === 1 ? "" : "s"}` : "ZXP ✓";
      card.title = "Clique pra abrir";
      card.style.cursor = "pointer";
      return;
    }
    card.style.cursor = "default";
    card.title = "";
    if (!dados) { card.innerHTML = `<b>ZXP</b> · procurando oportunidades de margem…`; return; }
    if (n > 0) {
      const total = oportunidades.reduce((s, o) => s + o.ganho, 0);
      card.innerHTML = `<div style="display:flex;justify-content:space-between;gap:10px;align-items:start">
          <div><div style="font-size:15px">▲ ${n} oportunidade${n === 1 ? "" : "s"} de melhoria na margem</div>
          <div style="font-weight:500;opacity:.95">+${M.reais(total)} por venda somando todas · preço parecido, lucro maior</div></div>
          <button type="button" class="zxp-x" data-acao="min" title="Minimizar">–</button></div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button type="button" class="zxp-btn zxp-btn-branco" data-acao="ir">Ir aos anúncios →</button>
          <button type="button" class="zxp-btn zxp-btn-contorno" data-acao="lista">Ver lista</button></div>`;
    } else {
      card.innerHTML = `<div style="display:flex;justify-content:space-between;gap:10px;align-items:start">
          <div><div><b>ZXP</b> · nenhuma oportunidade de margem agora</div>
          <div style="font-weight:500;color:#666">Conferi ${analisados} anúncio${analisados === 1 ? "" : "s"} com promoção ativa: nenhuma outra oferta de preço parecido paga mais. Quando aparecer, ela pisca em verde aqui.</div></div>
          <button type="button" class="zxp-x" data-acao="min" title="Minimizar">–</button></div>
        <div style="font-weight:500;color:#999;font-size:11px;margin-top:4px">extensão ${VERSAO}</div>`;
    }
  }

  function atualizarBotao() {
    if (!dados) { botao.textContent = "ZXP · carregando custos…"; return; }
    if (dados.erro) { botao.textContent = `ZXP · ${dados.erro}`; botao.style.color = "#f23d4f"; return; }
    const hora = new Date(dados.em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    botao.style.color = "#333";
    botao.textContent = `ZXP · margem com custos de ${hora} · meta ${M.pct(Number(dados.metaMargem) || 10)} ↻`;
    botao.title = "Clique pra buscar de novo os custos do Dash (depois de mudar custo ou imposto no Estoque).";
    desenharCard();
  }

  // ── Oportunidades de margem: outra promoção, preço parecido, lucro maior ──
  const estilo = document.createElement("style");
  estilo.textContent = `
    @keyframes zxpPisca { 0%,100% { box-shadow: 0 0 0 3px rgba(0,166,80,.95), 0 0 14px rgba(0,166,80,.55); background-color: rgba(0,166,80,.10); }
                          50%     { box-shadow: 0 0 0 3px rgba(0,166,80,.25), 0 0 0 rgba(0,166,80,0);   background-color: rgba(0,166,80,.02); } }
    .zxp-oportunidade { animation: zxpPisca 1.1s ease-in-out infinite; border-radius: 8px; }
    .zxp-oportunidade-atual { outline: 3px dashed #00a650; outline-offset: 4px; }
    .zxp-op-tag { margin-top:6px;padding:3px 8px;border-radius:6px;font:700 12px/1.4 system-ui,-apple-system,sans-serif;display:inline-block;background:#00a650;color:#fff; }
    .zxp-modal-fundo { position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:100000;display:flex;align-items:center;justify-content:center; }
    .zxp-modal { background:#fff;color:#333;border-radius:12px;max-width:520px;width:calc(100% - 32px);max-height:80vh;overflow:auto;padding:20px 22px;box-shadow:0 10px 40px rgba(0,0,0,.3);font:14px/1.45 system-ui,-apple-system,sans-serif; }
    .zxp-modal h2 { margin:0 0 6px;font-size:18px;color:#00a650; }
    .zxp-modal li { margin:6px 0; }
    .zxp-btn { border:0;border-radius:8px;padding:9px 14px;font:600 13px system-ui,-apple-system,sans-serif;cursor:pointer; }
    .zxp-btn-verde { background:#00a650;color:#fff; } .zxp-btn-claro { background:#f0f0f0;color:#333; }
    .zxp-card { position:fixed;top:72px;right:16px;z-index:99999;max-width:380px;background:#fff;color:#333;border:1px solid #ddd;border-radius:12px;padding:10px 12px;box-shadow:0 4px 16px rgba(0,0,0,.15);font:600 13px/1.4 system-ui,-apple-system,sans-serif; }
    .zxp-card-verde { background:#00a650;color:#fff;border-color:#00a650;animation:zxpCard 1.1s ease-in-out infinite; }
    @keyframes zxpCard { 0%,100% { box-shadow:0 0 0 4px rgba(0,166,80,.45),0 4px 16px rgba(0,0,0,.2); } 50% { box-shadow:0 0 0 0 rgba(0,166,80,0),0 4px 16px rgba(0,0,0,.2); } }
    .zxp-x { border:0;background:transparent;color:inherit;font:700 16px system-ui;cursor:pointer;line-height:1;padding:0 2px; }
    .zxp-btn-branco { background:#fff;color:#00a650; } .zxp-btn-contorno { background:transparent;color:#fff;border:1px solid #fff; }
    .zxp-nav { position:fixed;left:50%;transform:translateX(-50%);bottom:16px;z-index:99999;background:#fff;border:2px solid #00a650;border-radius:24px;padding:6px 8px 6px 14px;display:flex;gap:8px;align-items:center;box-shadow:0 4px 16px rgba(0,0,0,.2);font:600 13px system-ui,-apple-system,sans-serif;color:#333; }
  `;
  document.documentElement.appendChild(estilo);

  let oportunidades = []; // [{ box, nome, ganho, ativa, candidata, titulo }]
  let analisados = 0; // anúncios com promoção ativa nesta tela
  let popupJaMostrado = false;
  let navIdx = -1;
  let assinaturaOps = "";

  function lerBox(box) {
    const col1 = colunaDe(box, 1);
    const col3 = colunaDe(box, 3);
    const col4 = colunaDe(box, 4);
    if (!col1 || !col3 || !col4) return null;
    const valorRecebe = col4.querySelector(".ps-total-charges-with-tooltip__value-container");
    const botoes = [...box.querySelectorAll("button,a")].map((b) => b.innerText).join(" | ");
    return {
      box,
      titulo: col1.innerText.replace(/\s+/g, " ").replace(/\b(ATIVA|PROGRAMADA)\b/g, "").replace(/Nova proposta!?/i, "").trim(),
      situacao: M.situacaoDaPromocao(col1.innerText, botoes),
      precoFinal: precoDaColuna(col3),
      recebe: M.lerReais(valorRecebe ? valorRecebe.textContent : col4.innerText),
    };
  }

  function procurarOportunidades() {
    const achadas = [];
    analisados = 0;
    for (const linha of document.querySelectorAll(".sc-list-row")) {
      const promos = [...linha.querySelectorAll(".sc-list-collapsible-row__promotion-box")].map(lerBox).filter((p) => p && p.precoFinal != null && p.recebe != null);
      const ativa = promos.find((p) => p.situacao === "ativa");
      if (!ativa) continue;
      analisados += 1;
      const desc = linha.querySelector(".sc-list-description") || linha;
      const mlb = M.mlbDaLinha(desc.innerText);
      const item = mlb && dados && !dados.erro ? dados.itens[mlb] : null;
      const nome = (desc.innerText.split("\n").find((s) => s.trim()) || mlb || "Anúncio").trim();
      let melhor = null;
      for (const p of promos) {
        if (p === ativa || p.situacao !== "oferecida") continue;
        const op = M.oportunidadeDeMargem(ativa, p, item ? item.impostoPct : 0);
        if (op && (!melhor || op.ganho > melhor.op.ganho)) melhor = { p, op };
      }
      if (melhor) achadas.push({ box: melhor.p.box, nome, ganho: melhor.op.ganho, difPreco: melhor.op.difPreco, ativa, candidata: melhor.p });
    }
    return achadas;
  }

  function aplicarOportunidades() {
    const achadas = procurarOportunidades();
    const assinatura = analisados + "#" + achadas.map((o) => `${o.nome}|${o.candidata.precoFinal}|${o.candidata.recebe}`).join("¦");
    if (assinatura === assinaturaOps && achadas.every((o) => o.box.classList.contains("zxp-oportunidade"))) return;
    assinaturaOps = assinatura;
    document.querySelectorAll(".zxp-oportunidade").forEach((b) => b.classList.remove("zxp-oportunidade", "zxp-oportunidade-atual"));
    document.querySelectorAll(".zxp-op-tag").forEach((e) => e.remove());
    oportunidades = achadas;
    for (const o of achadas) {
      o.box.classList.add("zxp-oportunidade");
      const tag = document.createElement("div");
      tag.className = "zxp-op-tag";
      tag.textContent = `▲ +${M.reais(o.ganho)} por venda vs. a ativa`;
      tag.title = `Ativa: ${M.reais(o.ativa.precoFinal)}, você recebe ${M.reais(o.ativa.recebe)}.\nEsta: ${M.reais(o.candidata.precoFinal)}, você recebe ${M.reais(o.candidata.recebe)}.\nLucro por venda sobe ${M.reais(o.ganho)} (já descontada a diferença de imposto).`;
      const col4 = colunaDe(o.box, 4);
      (col4 || o.box).appendChild(tag);
    }
    atualizarBotao();
    atualizarNav();
    if (achadas.length && !popupJaMostrado) { popupJaMostrado = true; mostrarPopup(); }
  }

  function mostrarPopup() {
    document.querySelector(".zxp-modal-fundo")?.remove();
    if (!oportunidades.length) return;
    const fundo = document.createElement("div");
    fundo.className = "zxp-modal-fundo";
    const total = oportunidades.reduce((s, o) => s + o.ganho, 0);
    fundo.innerHTML = `<div class="zxp-modal" role="dialog" aria-label="Oportunidades de melhoria na margem">
      <h2>▲ Oportunidades de melhoria na margem</h2>
      <div>${oportunidades.length === 1 ? "1 anúncio tem" : `${oportunidades.length} anúncios têm`} outra promoção com <b>preço parecido</b> e <b>lucro maior</b> que a ativa
      (+${M.reais(total)} por venda somando todos).</div>
      <ul style="padding-left:18px;margin:10px 0 14px"></ul>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button type="button" class="zxp-btn zxp-btn-claro" data-acao="fechar">Agora não</button>
        <button type="button" class="zxp-btn zxp-btn-verde" data-acao="ir">Ir aos anúncios →</button>
      </div></div>`;
    const ul = fundo.querySelector("ul");
    for (const o of oportunidades) {
      const li = document.createElement("li");
      li.textContent = `${o.nome}: ${M.reais(o.ativa.precoFinal)} → ${M.reais(o.candidata.precoFinal)} (${o.candidata.titulo}) · +${M.reais(o.ganho)} por venda`;
      ul.appendChild(li);
    }
    fundo.addEventListener("click", (e) => {
      const acao = e.target?.dataset?.acao;
      if (e.target === fundo || acao === "fechar") fundo.remove();
      if (acao === "ir") { fundo.remove(); irPara(0); }
    });
    document.documentElement.appendChild(fundo);
  }

  // Navegação um por um: "Oportunidade 2 de 5 · Próxima →" até acabar.
  const nav = document.createElement("div");
  nav.className = "zxp-nav";
  nav.style.display = "none";
  document.documentElement.appendChild(nav);

  function irPara(i) {
    document.querySelectorAll(".zxp-oportunidade-atual").forEach((b) => b.classList.remove("zxp-oportunidade-atual"));
    if (i >= oportunidades.length) { navIdx = -1; atualizarNav(true); return; }
    navIdx = i;
    const o = oportunidades[i];
    o.box.classList.add("zxp-oportunidade-atual");
    o.box.scrollIntoView({ behavior: "smooth", block: "center" });
    atualizarNav();
  }

  function atualizarNav(acabou = false) {
    if (acabou) {
      nav.innerHTML = `<span>✓ Você viu todas as oportunidades.</span><button type="button" class="zxp-btn zxp-btn-claro" data-acao="sair">Fechar</button>`;
      nav.style.display = "flex";
    } else if (navIdx < 0 || !oportunidades.length) {
      nav.style.display = "none";
      return;
    } else {
      const idx = Math.min(navIdx, oportunidades.length - 1);
      const o = oportunidades[idx];
      nav.innerHTML = `<span>Oportunidade ${idx + 1} de ${oportunidades.length} · <span style="color:#00a650">+${M.reais(o.ganho)}</span> · ${o.nome.slice(0, 40)}</span>
        <button type="button" class="zxp-btn zxp-btn-claro" data-acao="ant" ${idx === 0 ? "disabled" : ""}>←</button>
        <button type="button" class="zxp-btn zxp-btn-verde" data-acao="prox">${idx + 1 < oportunidades.length ? "Próxima →" : "Concluir ✓"}</button>
        <button type="button" class="zxp-btn zxp-btn-claro" data-acao="sair" title="Parar">✕</button>`;
      nav.style.display = "flex";
    }
  }
  nav.addEventListener("click", (e) => {
    const acao = e.target?.dataset?.acao;
    if (acao === "prox") irPara(navIdx + 1);
    if (acao === "ant" && navIdx > 0) irPara(navIdx - 1);
    if (acao === "sair") { navIdx = -1; nav.style.display = "none"; document.querySelectorAll(".zxp-oportunidade-atual").forEach((b) => b.classList.remove("zxp-oportunidade-atual")); }
  });

  let pendente = 0;
  new MutationObserver(() => {
    clearTimeout(pendente);
    pendente = setTimeout(() => { marcar(); aplicarOportunidades(); }, 300);
  }).observe(document.body, { childList: true, subtree: true });

  atualizarBotao();
  await carregar(false);
})();
