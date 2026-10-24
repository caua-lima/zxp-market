/**
 * O mini painel FIXO na barra de notificações do celular: o dia de hoje numa
 * notificação que não empilha — cada venda reescreve a mesma (mesma `tag`), em
 * silêncio.
 *
 * ─── QUEM DESENHA ───────────────────────────────────────────────────────
 *
 * Duas pontas mostram o mesmo painel:
 *  - o APP aberto (lib/painel-fixo.ts), a cada número novo da barra ao vivo;
 *  - o SERVICE WORKER, com o app fechado, quando chega o push silencioso
 *    `ao_vivo` que o webhook manda a cada venda (lib/ml/ao-vivo-tempo-real.ts).
 *
 * O Service Worker leva `lerPlacarFixo`, `conteudoPainelFixo` e
 * `desenharPainelFixo` pelo TEXTO (`toString`), como já faz com o deep link
 * (ver lib/domain/deep-link.ts) — por isso cada uma é AUTOCONTIDA: nada de
 * constante, import ou auxiliar de fora. Os testes rodam a versão reconstruída
 * a partir do texto.
 */

/** O que o painel mostra. Viaja no push (JSON numa string) e fica no app. */
export type PlacarFixo = {
  /** Dia (BR) a que os números se referem, "AAAA-MM-DD". */
  dia: string;
  vendas: number;
  pedidos: number;
  unidades: number;
  /** A meta de hoje. `null` sem meta configurada. */
  meta: { alvo: number; pct: number; falta: number; batida: boolean; mesBatido: boolean } | null;
  ultima: { valor: number; titulo: string; em: number } | null;
  /** Faturamento por hora de hoje (24 posições). */
  porHora: number[];
  /** Ontem até o mesmo relógio — o "ritmo". */
  ontemAteAgora: number;
  atualizadoEm: number;
};

/** A notificação do painel: sempre a mesma `tag`, pra substituir em vez de empilhar. */
export const TAG_PAINEL_FIXO = "zxp-ao-vivo";

type DadosDoPlacar = {
  dia: string;
  hoje: { vendas: number; pedidos: number; unidades: number };
  ontemAteAgora: { vendas: number };
  porHora: { hoje: number[] };
  ultimaVenda: { em: number; valor: number; titulo: string } | null;
  metaDoDia?: { alvo: number; pct: number; falta: number; batida: boolean; mesBatido: boolean } | null;
  atualizadoEm: number;
};

const dinheiro = (v: number) => Math.round((Number(v) || 0) * 100) / 100;

/** O placar a partir do que a barra ao vivo já tem (resposta de /api/ml/ao-vivo). */
export function placarDe(d: DadosDoPlacar): PlacarFixo {
  const m = d.metaDoDia ?? null;
  return {
    dia: d.dia,
    vendas: dinheiro(d.hoje.vendas),
    pedidos: d.hoje.pedidos,
    unidades: d.hoje.unidades,
    // `pct` sem arredondar: a barra arredonda uma vez só, e o painel tem que dar o MESMO %.
    meta: m ? { alvo: dinheiro(m.alvo), pct: m.pct, falta: dinheiro(m.falta), batida: m.batida, mesBatido: m.mesBatido } : null,
    ultima: d.ultimaVenda ? { valor: dinheiro(d.ultimaVenda.valor), titulo: String(d.ultimaVenda.titulo ?? "").slice(0, 60), em: d.ultimaVenda.em } : null,
    porHora: Array.from({ length: 24 }, (_, i) => dinheiro(d.porHora.hoje[i] ?? 0)),
    ontemAteAgora: dinheiro(d.ontemAteAgora.vendas),
    atualizadoEm: d.atualizadoEm,
  };
}

/**
 * Lê o placar que veio em texto (o push só leva string). Tudo é conferido: o
 * que não for número vira 0, texto é cortado — um payload torto nunca derruba
 * o Service Worker nem desenha lixo. `null` quando nem o básico presta.
 */
export function lerPlacarFixo(texto: unknown): PlacarFixo | null {
  let o: Record<string, unknown>;
  try {
    o = typeof texto === "string" ? JSON.parse(texto) : (texto as Record<string, unknown>);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const num = (v: unknown) => { const n = Number(v); return isFinite(n) ? n : 0; };
  const dia = String(o.dia ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null;
  const m = o.meta as Record<string, unknown> | null | undefined;
  const u = o.ultima as Record<string, unknown> | null | undefined;
  const horas = Array.isArray(o.porHora) ? o.porHora : [];
  const porHora: number[] = [];
  for (let i = 0; i < 24; i++) porHora.push(Math.max(0, num(horas[i])));
  return {
    dia,
    vendas: num(o.vendas),
    pedidos: Math.max(0, Math.round(num(o.pedidos))),
    unidades: Math.max(0, Math.round(num(o.unidades))),
    meta: m && typeof m === "object" && num(m.alvo) >= 0
      ? { alvo: num(m.alvo), pct: num(m.pct), falta: num(m.falta), batida: m.batida === true, mesBatido: m.mesBatido === true }
      : null,
    ultima: u && typeof u === "object" && num(u.em) > 0
      ? { valor: num(u.valor), titulo: String(u.titulo ?? "").slice(0, 60), em: num(u.em) }
      : null,
    porHora,
    ontemAteAgora: num(o.ontemAteAgora),
    atualizadoEm: num(o.atualizadoEm),
  };
}

/**
 * Título e texto da notificação.
 *
 * Fechada, a barra do Android mostra o título e a PRIMEIRA linha — então o
 * título é o número que importa (quanto vendeu e quantas vendas) e a primeira
 * linha é a meta do dia. Aberta, aparecem a última venda e o ritmo.
 *
 * Nada de "há 3 min": o texto só é refeito quando chega venda, e um relativo
 * envelheceria parado na barra. Vai a hora (14:32), que nunca mente.
 */
export function conteudoPainelFixo(p: PlacarFixo, agoraMs: number): { title: string; body: string; tag: string; timestamp: number } {
  const fuso = "America/Sao_Paulo";
  const brl = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v) || 0);
  const hora = (ms: number) => new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: fuso }).format(ms);
  const diaBR = (ms: number) => {
    const d = new Date(ms - 3 * 3600 * 1000);
    return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
  };
  const ehHoje = p.dia === diaBR(agoraMs);
  const quando = ehHoje ? "hoje" : "em " + p.dia.slice(8, 10) + "/" + p.dia.slice(5, 7);
  const n = p.pedidos;
  const title = brl(p.vendas) + " " + quando + " · " + n + (n === 1 ? " venda" : " vendas");

  const linhas: string[] = [];
  if (p.meta && p.meta.mesBatido) {
    linhas.push("✓ Meta do mês já batida");
  } else if (p.meta && p.meta.alvo > 0) {
    const pct = Math.round(p.meta.pct);
    if (p.meta.batida) {
      linhas.push("✓ Meta do dia batida · " + pct + "% de " + brl(p.meta.alvo));
    } else {
      linhas.push(pct + "% da meta de hoje · faltam " + brl(p.meta.falta));
    }
  } else {
    linhas.push(p.unidades + (p.unidades === 1 ? " unidade" : " unidades"));
  }

  if (p.ultima) {
    const t = String(p.ultima.titulo || "").replace(/\s+/g, " ").trim();
    const curto = t.length > 34 ? t.slice(0, 33).trim() + "…" : t;
    linhas.push("Última: " + brl(p.ultima.valor) + (curto ? " · " + curto : "") + " às " + hora(p.ultima.em));
  } else if (ehHoje) {
    linhas.push("Nenhuma venda ainda hoje");
  }

  const extras: string[] = [];
  if (p.meta && p.meta.alvo > 0) extras.push(p.unidades + " un");
  if (ehHoje && p.ontemAteAgora > 0) {
    const r = Math.round(((p.vendas - p.ontemAteAgora) / p.ontemAteAgora) * 100);
    extras.push((r >= 0 ? "▲ " + r : "▼ " + Math.abs(r)) + "% vs ontem até agora");
  }
  if (extras.length) linhas.push(extras.join(" · "));

  return { title, body: linhas.join("\n"), tag: "zxp-ao-vivo", timestamp: p.atualizadoEm || agoraMs };
}

/** O mínimo de canvas que o desenho usa — o do navegador, o OffscreenCanvas do Service Worker ou um falso nos testes. */
export type PincelDoPainel = {
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(t: string, x: number, y: number, max?: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
  closePath(): void;
  fill(): void;
  /** Opcional: sem ele (pincel simples de teste) o fundo dourado vira cor chapada. */
  createLinearGradient?(x0: number, y0: number, x1: number, y1: number): { addColorStop(o: number, c: string): void };
};

/**
 * A imagem do painel — o MESMO visual do painel "Vendas de hoje ao vivo" do app:
 * faixa dourada com o cartão marfim (valor, ritmo e meta de hoje) e, embaixo, as
 * vendas por hora. Desenha em `w`×`h` (720×360 no uso).
 * Sem `roundRect` (só nos navegadores novos): o retângulo arredondado é feito à mão.
 */
export function desenharPainelFixo(ctx: PincelDoPainel, p: PlacarFixo, agoraMs: number, w: number, h: number): void {
  const fuso = "America/Sao_Paulo";
  const brl = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v) || 0);
  const hora = (ms: number) => new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: fuso }).format(ms);
  const caixa = (x: number, y: number, cw: number, ch: number, r: number, cor: string) => {
    const rr = Math.max(0, Math.min(r, cw / 2, ch / 2));
    ctx.fillStyle = cor;
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + cw, y, x + cw, y + ch, rr);
    ctx.arcTo(x + cw, y + ch, x, y + ch, rr);
    ctx.arcTo(x, y + ch, x, y, rr);
    ctx.arcTo(x, y, x + cw, y, rr);
    ctx.closePath();
    ctx.fill();
  };
  const s = w / 720;
  const px = (v: number) => Math.round(v * s);
  const m = px(28);

  // fundo escuro e a faixa dourada (como o hero do painel)
  ctx.fillStyle = "#15150f";
  ctx.fillRect(0, 0, w, h);
  const heroH = px(196);
  if (ctx.createLinearGradient) {
    const g = ctx.createLinearGradient(0, 0, w, heroH);
    g.addColorStop(0, "#F7C95C");
    g.addColorStop(0.55, "#F4B942");
    g.addColorStop(1, "#E9A92D");
    ctx.fillStyle = g as unknown as string;
  } else {
    ctx.fillStyle = "#F4B942";
  }
  ctx.fillRect(0, 0, w, heroH);

  // título e relógio
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  caixa(m, px(26), px(11), px(11), px(6), "#D93025");
  ctx.fillStyle = "#1B1A14";
  ctx.font = "800 " + px(21) + "px sans-serif";
  ctx.fillText("Vendas de hoje ao vivo", m + px(20), px(37));
  ctx.textAlign = "right";
  ctx.font = "600 " + px(19) + "px sans-serif";
  ctx.fillText(hora(p.atualizadoEm || agoraMs), w - m, px(37));

  // cartão marfim com o valor, o ritmo e a meta
  const cy = px(56), ch = px(150), cx = m, cw = w - 2 * m;
  caixa(cx, cy, cw, ch, px(16), "#FBF8EE");
  ctx.textAlign = "center";
  ctx.fillStyle = "#1B1A14";
  ctx.font = "800 " + px(58) + "px sans-serif";
  ctx.fillText(brl(p.vendas), w / 2, cy + px(64), cw - px(24));
  if (p.ontemAteAgora > 0) {
    const r = Math.round(((p.vendas - p.ontemAteAgora) / p.ontemAteAgora) * 100);
    ctx.fillStyle = r >= 0 ? "#0B7A4B" : "#B3261E";
    ctx.font = "700 " + px(21) + "px sans-serif";
    ctx.fillText((r >= 0 ? "↑ " + r : "↓ " + Math.abs(r)) + "% vs ontem · " + p.pedidos + (p.pedidos === 1 ? " venda" : " vendas"), w / 2, cy + px(94));
  } else {
    ctx.fillStyle = "#5C5B4F";
    ctx.font = "700 " + px(21) + "px sans-serif";
    ctx.fillText(p.pedidos + (p.pedidos === 1 ? " venda" : " vendas") + " · " + p.unidades + " un", w / 2, cy + px(94));
  }
  if (p.meta && p.meta.alvo > 0 && !p.meta.mesBatido) {
    const ix = cx + px(20), iw = cw - px(40), yb = cy + px(118);
    ctx.textAlign = "left";
    ctx.fillStyle = "#3A392F";
    ctx.font = "500 " + px(18) + "px sans-serif";
    ctx.fillText("Meta de hoje " + brl(p.meta.alvo), ix, cy + px(122));
    ctx.textAlign = "right";
    ctx.fillStyle = p.meta.batida ? "#0B7A4B" : "#8A5A00";
    ctx.font = "800 " + px(20) + "px sans-serif";
    ctx.fillText(Math.round(p.meta.pct) + "%", ix + iw, cy + px(122));
    caixa(ix, yb + px(12), iw, px(9), px(5), "#E4E1D4");
    const cheio = Math.max(0, Math.min(1, p.meta.pct / 100));
    if (cheio > 0) caixa(ix, yb + px(12), Math.max(px(9), iw * cheio), px(9), px(5), p.meta.batida ? "#1FA866" : "#E9A92D");
  }

  // vendas por hora, embaixo
  const base = h - px(26);
  const topo = cy + ch + px(18);
  const alturaMax = Math.max(px(20), base - topo);
  const maior = Math.max(1, ...p.porHora.map((v) => Number(v) || 0));
  const largura = (w - 2 * m) / 24;
  for (let k = 0; k < 24; k++) {
    const v = Number(p.porHora[k]) || 0;
    const alt = v > 0 ? Math.max(px(4), (v / maior) * alturaMax) : px(3);
    caixa(m + k * largura + px(2), base - alt, Math.max(px(4), largura - px(4)), alt, px(3), v > 0 ? "#F4B942" : "#2D2C22");
  }
  ctx.fillStyle = "#8f8c7d";
  ctx.font = "500 " + px(15) + "px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("0h", m, h - px(7));
  ctx.textAlign = "center";
  ctx.fillText("12h", m + 12 * largura, h - px(7));
  ctx.textAlign = "right";
  ctx.fillText("23h", w - m, h - px(7));
}
