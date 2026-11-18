/**
 * Os dois PDFs da expedição, montados no navegador (pdf-lib, MIT):
 *
 *  · etiquetas — uma página 4×6 pol. por etiqueta, com a imagem que o motor
 *    renderizou (a mesma da prévia), na ordem do arquivo;
 *  · lista de separação — A4: total por sigla (o que tirar da prateleira),
 *    pendências em destaque e a lista de conferência envio a envio.
 *
 * Sem dado de comprador na lista: só envio, sigla e produto.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

const PT_POR_POL = 72;

export async function pdfDasEtiquetas(pngs: readonly Uint8Array[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Etiquetas");
  doc.setCreator("ZXP Market");
  const w = 4 * PT_POR_POL;
  const h = 6 * PT_POR_POL;
  for (const png of pngs) {
    const img = await doc.embedPng(png);
    const page = doc.addPage([w, h]);
    page.drawImage(img, { x: 0, y: 0, width: w, height: h });
  }
  return doc.save();
}

export type ItemDaLista = { titulo: string; quantidade: number; sku?: string | null };
export type LinhaDaLista = {
  /** Posição da etiqueta no arquivo, a partir de 1 (a ordem em que sai da impressora). */
  ordem: number;
  envio: string | null;
  /** "TT", "2TT + BM"… null = pendente. */
  texto: string | null;
  itens: ItemDaLista[];
  /** Por que está pendente (sem sigla, envio não achado, conflito…). */
  problema?: string | null;
};

/** A fonte padrão do PDF só escreve WinAnsi: o resto vira equivalente simples. */
export function textoPdf(s: unknown): string {
  return String(s ?? "")
    .replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[›→]/g, ">").replace(/…/g, "...").replace(/[\r\n\t]+/g, " ")
    .normalize("NFC")
    .replace(/[^\x20-\x7E -ÿ]/g, "");
}

function cortar(texto: string, fonte: PDFFont, tamanho: number, largura: number): string {
  let t = textoPdf(texto);
  if (fonte.widthOfTextAtSize(t, tamanho) <= largura) return t;
  while (t.length > 1 && fonte.widthOfTextAtSize(`${t}...`, tamanho) > largura) t = t.slice(0, -1);
  return `${t}...`;
}

export async function pdfDaListaDeSeparacao(e: { linhas: readonly LinhaDaLista[]; geradoEm: Date; arquivo?: string }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Lista de separação");
  doc.setCreator("ZXP Market");
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);
  const A4: [number, number] = [595.28, 841.89];
  const M = 40;
  const largura = A4[0] - 2 * M;
  const cinza = rgb(0.4, 0.4, 0.4);
  const vermelho = rgb(0.7, 0.1, 0.1);

  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - M;
  const novaPagina = () => { page = doc.addPage(A4); y = A4[1] - M; };
  const garantir = (altura: number) => { if (y - altura < M) novaPagina(); };
  const escrever = (t: string, x: number, o: { fonte?: PDFFont; tam?: number; cor?: ReturnType<typeof rgb>; max?: number } = {}) => {
    const fonte = o.fonte ?? normal;
    const tam = o.tam ?? 10;
    page.drawText(cortar(t, fonte, tam, o.max ?? largura - (x - M)), { x, y, size: tam, font: fonte, color: o.cor ?? rgb(0, 0, 0) });
  };
  const linhaH = () => page.drawLine({ start: { x: M, y: y + 4 }, end: { x: A4[0] - M, y: y + 4 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });

  const prontas = e.linhas.filter((l) => l.texto);
  const pendentes = e.linhas.filter((l) => !l.texto);
  const data = e.geradoEm.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  escrever("Lista de separação", M, { fonte: negrito, tam: 18 });
  y -= 18;
  escrever(`${e.linhas.length} etiqueta(s) · ${prontas.length} pronta(s) · ${pendentes.length} pendente(s) · gerada em ${data}`, M, { tam: 9, cor: cinza });
  if (e.arquivo) { y -= 12; escrever(`Arquivo: ${e.arquivo}`, M, { tam: 9, cor: cinza }); }
  y -= 26;

  // 1) O que tirar da prateleira.
  const porSigla = new Map<string, { quantidade: number }>();
  for (const l of prontas) {
    for (const parte of String(l.texto).split("+").map((s) => s.trim()).filter(Boolean)) {
      const m = parte.match(/^(\d*)([A-Z0-9]+)$/);
      if (!m) continue;
      const atual = porSigla.get(m[2]) ?? { quantidade: 0 };
      atual.quantidade += m[1] ? Number(m[1]) : 1;
      porSigla.set(m[2], atual);
    }
  }
  escrever("Separar (unidades)", M, { fonte: negrito, tam: 12 });
  y -= 18;
  const siglas = [...porSigla].sort(([a], [b]) => a.localeCompare(b));
  if (!siglas.length) { escrever("Nada pronto pra separar.", M, { cor: cinza }); y -= 16; }
  for (const [sigla, v] of siglas) {
    garantir(22);
    page.drawRectangle({ x: M, y: y - 4, width: 12, height: 12, borderColor: rgb(0, 0, 0), borderWidth: 0.8 });
    escrever(sigla, M + 22, { fonte: negrito, tam: 14 });
    escrever(`${v.quantidade} un`, M + 90, { fonte: negrito, tam: 14 });
    y -= 22;
  }
  const totalUn = siglas.reduce((s, [, v]) => s + v.quantidade, 0);
  escrever(`Total: ${totalUn} un`, M, { tam: 10, cor: cinza });
  y -= 26;

  // 2) Pendências — não marcar nem despachar sem resolver.
  if (pendentes.length) {
    garantir(40);
    escrever(`Pendentes (${pendentes.length}) — conferir à mão antes de despachar`, M, { fonte: negrito, tam: 12, cor: vermelho });
    y -= 18;
    for (const l of pendentes) {
      garantir(14 + 12 * Math.max(l.itens.length, 1));
      escrever(`#${l.ordem}  Envio ${l.envio ?? "?"}  —  ${l.problema ?? "pendente"}`, M, { fonte: negrito, tam: 10 });
      y -= 13;
      for (const it of l.itens) { escrever(`${it.quantidade}x ${it.titulo}${it.sku ? ` (SKU ${it.sku})` : ""}`, M + 16, { tam: 9 }); y -= 12; }
      y -= 4;
    }
    y -= 12;
  }

  // 3) Conferência envio a envio, na ordem das etiquetas.
  garantir(40);
  escrever("Conferência por etiqueta", M, { fonte: negrito, tam: 12 });
  y -= 18;
  for (const l of e.linhas) {
    const altura = 16 + 11 * l.itens.length;
    garantir(altura);
    linhaH();
    page.drawRectangle({ x: M, y: y - 3, width: 10, height: 10, borderColor: rgb(0, 0, 0), borderWidth: 0.8 });
    escrever(`#${l.ordem}`, M + 16, { fonte: negrito, tam: 10, max: 34 });
    escrever(l.envio ?? "sem envio", M + 52, { tam: 10, max: 90 });
    escrever(l.texto ?? "PENDENTE", M + 150, { fonte: negrito, tam: 11, cor: l.texto ? rgb(0, 0, 0) : vermelho });
    y -= 13;
    for (const it of l.itens) { escrever(`${it.quantidade}x ${it.titulo}`, M + 150, { tam: 8, cor: cinza }); y -= 11; }
    y -= 3;
  }
  return doc.save();
}
