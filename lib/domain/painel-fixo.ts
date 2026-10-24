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
    const cheios = Math.max(0, Math.min(10, Math.floor(p.meta.pct / 10)));
    if (p.meta.batida) {
      linhas.push("✓ Meta do dia batida · " + pct + "% de " + brl(p.meta.alvo));
    } else {
      linhas.push("▰".repeat(cheios) + "▱".repeat(10 - cheios) + " " + pct + "% da meta · faltam " + brl(p.meta.falta));
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
};

/**
 * A imagem do painel (Android mostra ao expandir a notificação): o valor grande,
 * a barra da meta e as vendas por hora. Desenha em `w`×`h` (720×360 no uso).
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
  const margem = px(32);

  ctx.fillStyle = "#15171c";
  ctx.fillRect(0, 0, w, h);

  // Selo "AO VIVO" e a hora da leitura
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  caixa(margem, px(30), px(12), px(12), px(6), "#36b37e");
  ctx.fillStyle = "#36b37e";
  ctx.font = "700 " + px(20) + "px sans-serif";
  ctx.fillText("AO VIVO · HOJE", margem + px(22), px(42));
  ctx.textAlign = "right";
  ctx.fillStyle = "#8b8f98";
  ctx.font = "500 " + px(20) + "px sans-serif";
  ctx.fillText("atualizado " + hora(p.atualizadoEm || agoraMs), w - margem, px(42));

  // O valor e a contagem
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 " + px(66) + "px sans-serif";
  ctx.fillText(brl(p.vendas), margem, px(112), w - 2 * margem);
  ctx.fillStyle = "#b9bdc6";
  ctx.font = "500 " + px(24) + "px sans-serif";
  const n = p.pedidos;
  ctx.fillText(n + (n === 1 ? " venda · " : " vendas · ") + p.unidades + " un", margem, px(150));
  if (p.ontemAteAgora > 0) {
    const r = Math.round(((p.vendas - p.ontemAteAgora) / p.ontemAteAgora) * 100);
    ctx.textAlign = "right";
    ctx.fillStyle = r >= 0 ? "#36b37e" : "#ff6b5e";
    ctx.font = "700 " + px(24) + "px sans-serif";
    ctx.fillText((r >= 0 ? "▲ " + r : "▼ " + Math.abs(r)) + "% vs ontem", w - margem, px(150));
  }

  // Meta do dia
  let topoBarras = px(196);
  if (p.meta && p.meta.alvo > 0 && !p.meta.mesBatido) {
    const yb = px(186);
    ctx.textAlign = "left";
    ctx.fillStyle = "#b9bdc6";
    ctx.font = "500 " + px(20) + "px sans-serif";
    ctx.fillText("Meta de hoje " + brl(p.meta.alvo), margem, yb);
    ctx.textAlign = "right";
    ctx.fillStyle = p.meta.batida ? "#36b37e" : "#f2b33d";
    ctx.font = "800 " + px(22) + "px sans-serif";
    ctx.fillText(Math.round(p.meta.pct) + "%", w - margem, yb);
    const largura = w - 2 * margem;
    caixa(margem, yb + px(10), largura, px(14), px(7), "#2a2d35");
    const cheio = Math.max(0, Math.min(1, p.meta.pct / 100));
    if (cheio > 0) caixa(margem, yb + px(10), Math.max(px(14), largura * cheio), px(14), px(7), p.meta.batida ? "#36b37e" : "#f2b33d");
    topoBarras = px(232);
  }

  // Vendas por hora (hoje)
  const base = h - px(30);
  const alturaMax = Math.max(px(20), base - topoBarras - px(8));
  const maior = Math.max(1, ...p.porHora.map((v) => Number(v) || 0));
  const largura = (w - 2 * margem) / 24;
  for (let i = 0; i < 24; i++) {
    const v = Number(p.porHora[i]) || 0;
    const alt = v > 0 ? Math.max(px(4), (v / maior) * alturaMax) : px(3);
    caixa(margem + i * largura + px(2), base - alt, Math.max(px(4), largura - px(4)), alt, px(3), v > 0 ? "#f2b33d" : "#2a2d35");
  }
  ctx.textAlign = "left";
  ctx.fillStyle = "#6f737c";
  ctx.font = "500 " + px(16) + "px sans-serif";
  ctx.fillText("0h", margem, h - px(8));
  ctx.textAlign = "center";
  ctx.fillText("12h", margem + 12 * largura, h - px(8));
  ctx.textAlign = "right";
  ctx.fillText("23h", w - margem, h - px(8));
}
