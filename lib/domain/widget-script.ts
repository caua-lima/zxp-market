/**
 * O script do widget do iPhone, para o app gratuito Scriptable.
 *
 * Sai do servidor já com o endereço e o código secreto dentro: a pessoa só cola
 * no Scriptable. Desenha o MESMO painel do app (faixa dourada, cartão marfim,
 * meta de hoje, vendas por hora) na tela inicial e uma versão enxuta nos
 * widgets da tela de bloqueio. O iPhone decide quando atualizar um widget
 * (alguns minutos), então o script pede a próxima leitura pra 5 min e guarda o
 * último número pra mostrar quando a rede falha.
 */
export function scriptDoWidget(url: string): string {
  // O endereço entra como literal JSON: aspas e barras escapadas, sem quebrar o script.
  const endereco = JSON.stringify(url);
  return `// Vendas ao vivo — widget (gerado pelo app; não compartilhe: o endereço abaixo é só seu)
const URL_API = ${endereco};
const ARQUIVO = "vendas-ao-vivo.json";
const fm = FileManager.local();
const caminho = fm.joinPath(fm.documentsDirectory(), ARQUIVO);

async function carregar() {
  try {
    const req = new Request(URL_API);
    req.timeoutInterval = 20;
    const dados = await req.loadJSON();
    if (dados && typeof dados.vendas === "number") {
      fm.writeString(caminho, JSON.stringify({ dados, em: Date.now() }));
      return { dados, antigo: false };
    }
  } catch (e) {}
  try {
    if (fm.fileExists(caminho)) {
      const salvo = JSON.parse(fm.readString(caminho));
      return { dados: salvo.dados, antigo: true };
    }
  } catch (e) {}
  return null;
}

const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const brlCurto = (v) => (v >= 1000 ? "R$ " + (v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mil" : brl(v));
const hora = (ms) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const cor = (hex) => new Color(hex);

function ritmo(d) {
  if (!(d.ontemAteAgora > 0)) return "";
  const r = Math.round(((d.vendas - d.ontemAteAgora) / d.ontemAteAgora) * 100);
  return (r >= 0 ? "↑ " + r : "↓ " + Math.abs(r)) + "% vs ontem";
}

function caixa(ctx, x, y, w, h, r, hex) {
  ctx.setFillColor(cor(hex));
  const p = new Path();
  p.addRoundedRect(new Rect(x, y, w, h), r, r);
  ctx.addPath(p);
  ctx.fillPath();
}

function texto(ctx, t, x, y, w, h, tam, peso, hex, alinhar) {
  ctx.setFont(peso ? Font.boldSystemFont(tam) : Font.systemFont(tam));
  ctx.setTextColor(cor(hex));
  if (alinhar === "c") ctx.setTextAlignedCenter();
  else if (alinhar === "r") ctx.setTextAlignedRight();
  else ctx.setTextAlignedLeft();
  ctx.drawTextInRect(t, new Rect(x, y, w, h));
}

// O mesmo desenho do painel do app, em 720×360.
function desenhar(d, antigo) {
  const W = 720, H = 360, m = 28;
  const ctx = new DrawContext();
  ctx.size = new Size(W, H);
  ctx.opaque = true;
  ctx.respectScreenScale = true;
  ctx.setFillColor(cor("#15150f"));
  ctx.fillRect(new Rect(0, 0, W, H));
  ctx.setFillColor(cor("#F4B942"));
  ctx.fillRect(new Rect(0, 0, W, 196));

  caixa(ctx, m, 26, 11, 11, 6, antigo ? "#6B6A5E" : "#D93025");
  texto(ctx, "Vendas de hoje ao vivo", m + 20, 12, 400, 30, 21, true, "#1B1A14", "l");
  texto(ctx, hora(d.atualizadoEm || Date.now()), W - m - 120, 12, 120, 30, 19, true, "#1B1A14", "r");

  const cy = 56, ch = 150, cx = m, cw = W - 2 * m;
  caixa(ctx, cx, cy, cw, ch, 16, "#FBF8EE");
  texto(ctx, brl(d.vendas), cx, cy + 10, cw, 70, 58, true, "#1B1A14", "c");
  const n = d.pedidos;
  const rit = ritmo(d);
  const sub = (rit ? rit + " · " : "") + n + (n === 1 ? " venda" : " vendas");
  texto(ctx, sub, cx, cy + 76, cw, 28, 21, true, rit.startsWith("↓") ? "#B3261E" : "#0B7A4B", "c");
  if (d.meta && d.meta.alvo > 0 && !d.meta.mesBatido) {
    const ix = cx + 20, iw = cw - 40;
    texto(ctx, "Meta de hoje " + brl(d.meta.alvo), ix, cy + 104, iw - 80, 24, 18, false, "#3A392F", "l");
    texto(ctx, Math.round(d.meta.pct) + "%", ix + iw - 80, cy + 102, 80, 26, 20, true, d.meta.batida ? "#0B7A4B" : "#8A5A00", "r");
    caixa(ctx, ix, cy + 130, iw, 9, 5, "#E4E1D4");
    const cheio = Math.max(0, Math.min(1, d.meta.pct / 100));
    if (cheio > 0) caixa(ctx, ix, cy + 130, Math.max(9, iw * cheio), 9, 5, d.meta.batida ? "#1FA866" : "#E9A92D");
  }

  const base = H - 26, topo = cy + ch + 18, alturaMax = Math.max(20, base - topo);
  const horas = d.porHora || [];
  const maior = Math.max(1, ...horas.map((v) => Number(v) || 0));
  const larg = (W - 2 * m) / 24;
  for (let k = 0; k < 24; k++) {
    const v = Number(horas[k]) || 0;
    const alt = v > 0 ? Math.max(4, (v / maior) * alturaMax) : 3;
    caixa(ctx, m + k * larg + 2, base - alt, Math.max(4, larg - 4), alt, 3, v > 0 ? "#F4B942" : "#2D2C22");
  }
  texto(ctx, "0h", m, H - 24, 60, 20, 15, false, "#8f8c7d", "l");
  texto(ctx, "12h", m + 12 * larg - 30, H - 24, 60, 20, 15, false, "#8f8c7d", "c");
  texto(ctx, "23h", W - m - 60, H - 24, 60, 20, 15, false, "#8f8c7d", "r");
  return ctx.getImage();
}

async function montar() {
  const w = new ListWidget();
  w.refreshAfterDate = new Date(Date.now() + 5 * 60 * 1000);
  const r = await carregar();
  if (!r) {
    w.backgroundColor = cor("#15150f");
    const t = w.addText("Vendas ao vivo: sem dados. Abra o app pra conferir.");
    t.textColor = cor("#FBF8EE");
    t.font = Font.systemFont(12);
    return w;
  }
  const d = r.dados;
  const familia = config.widgetFamily || "medium";
  if (familia.indexOf("accessory") === 0) {
    // Tela de bloqueio: texto enxuto (o iPhone pinta tudo em tons de cinza/branco).
    if (familia === "accessoryInline") {
      w.addText(brlCurto(d.vendas) + (d.meta && d.meta.alvo > 0 ? " · " + Math.round(d.meta.pct) + "%" : ""));
    } else if (familia === "accessoryCircular") {
      const t = w.addText(d.meta && d.meta.alvo > 0 ? Math.round(d.meta.pct) + "%" : String(d.pedidos));
      t.font = Font.boldSystemFont(18);
      t.centerAlignText();
    } else {
      const a = w.addText(brl(d.vendas));
      a.font = Font.boldSystemFont(17);
      const b = w.addText(d.pedidos + (d.pedidos === 1 ? " venda" : " vendas") + (ritmo(d) ? " · " + ritmo(d) : ""));
      b.font = Font.systemFont(11);
      if (d.meta && d.meta.alvo > 0) {
        const c = w.addText(d.meta.batida ? "✓ meta do dia batida" : Math.round(d.meta.pct) + "% da meta · faltam " + brlCurto(d.meta.falta));
        c.font = Font.systemFont(11);
      }
    }
    return w;
  }
  w.backgroundImage = desenhar(d, r.antigo);
  return w;
}

const widget = await montar();
if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();
}
Script.complete();
`;
}
