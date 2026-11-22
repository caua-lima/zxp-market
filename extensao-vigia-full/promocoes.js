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
  }

  const colunaDe = (box, n) => [...box.querySelectorAll('[class*="promotion-box__column__"]')]
    .find((c) => [...c.classList].some((k) => k.endsWith(`promotion-box__column__${n}`)));

  function marcar() {
    if (!dados || dados.erro) return;
    for (const box of document.querySelectorAll(".sc-list-collapsible-row__promotion-box")) {
      const col3 = colunaDe(box, 3);
      const col4 = colunaDe(box, 4);
      if (!col3 || !col4) continue;
      const valorRecebe = col4.querySelector(".ps-total-charges-with-tooltip__value-container");
      const precoFinal = M.lerReais(col3.innerText);
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
  function atualizarBotao() {
    if (!dados) { botao.textContent = "ZXP · carregando custos…"; return; }
    if (dados.erro) { botao.textContent = `ZXP · ${dados.erro}`; botao.style.color = "#f23d4f"; return; }
    const hora = new Date(dados.em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    botao.style.color = "#333";
    botao.textContent = `ZXP · margem com custos de ${hora} · meta ${M.pct(Number(dados.metaMargem) || 10)} ↻`;
    botao.title = "Clique pra buscar de novo os custos do Dash (depois de mudar custo ou imposto no Estoque).";
  }

  let pendente = 0;
  new MutationObserver(() => {
    clearTimeout(pendente);
    pendente = setTimeout(marcar, 300);
  }).observe(document.body, { childList: true, subtree: true });

  atualizarBotao();
  await carregar(false);
})();
