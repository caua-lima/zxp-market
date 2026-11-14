/**
 * Lote de etiquetas ZPL do Mercado Livre: separa as etiquetas e identifica o
 * envio de cada uma.
 *
 * ─── DE ONDE VEM O NÚMERO DO ENVIO ──────────────────────────────────────
 *
 * Do Code 128 principal (`^BC … ^FD>:48513432846^FS`) e, conferindo, do JSON
 * do QR Code (`^BQ … ^FDLA,{"id":"48513432846",…}`). Nunca do "primeiro
 * número comprido": a etiqueta tem CEP, NF, tracking de transportadora (um
 * segundo `^BC` em parte das etiquetas) e o "Envio: 485134 / 32846" partido.
 *
 * O `>:` (e `>;`, `>5`…) é comando de subconjunto do Code 128 no ZPL, não faz
 * parte do dado — sai antes de comparar.
 *
 * Puro e autossuficiente (sem `@/`): roda no navegador, no Worker e no teste.
 */

export type EtiquetaZpl = {
  /** Posição no arquivo (0, 1, 2…) — é a ordem de impressão. */
  indice: number;
  /** O bloco `^XA … ^XZ` exatamente como veio. */
  zpl: string;
  /** Envio pelo Code 128 principal, sem os comandos de subconjunto. null = não achei. */
  envioBarcode: string | null;
  /** Envio pelo QR Code (campo "id" do JSON). null = sem QR ou sem id. */
  envioQr: string | null;
  /** O envio que vale: os dois iguais, ou o único que existe. null = conflito ou nenhum. */
  envio: string | null;
  /** Por que `envio` é null, quando é. */
  problema: string | null;
};

export type LoteZpl = {
  etiquetas: EtiquetaZpl[];
  /** Texto fora de qualquer `^XA … ^XZ` (comandos de impressora, download de gráfico…). Mantido, nunca descartado. */
  prefixo: string;
  /** Envios que aparecem em mais de uma etiqueta (reimpressão no mesmo arquivo). */
  duplicados: string[];
};

/** Tira os comandos de subconjunto do Code 128 (`>:`, `>;`, `>5`, `>6`, `>7`…) e o que não for dado. */
export function dadoDoCode128(fd: string): string {
  return String(fd ?? "").replace(/>[0-9:;<=>]/g, "").trim();
}

/** O dado de cada campo de código de barras (`^BC`) e de QR (`^BQ`), na ordem em que aparecem. */
function camposDeCodigo(zpl: string, comando: "BC" | "BQ"): string[] {
  const out: string[] = [];
  const re = new RegExp(`\\^${comando}[^\\^]*(?:\\^(?!FD|FS)[A-Z0-9@]{2}[^\\^]*)*\\^FD([\\s\\S]*?)\\^FS`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(zpl))) out.push(m[1]);
  return out;
}

/** O "id" do JSON do QR do ML: `LA,{"id":"48513432846","t":"lm"}`. */
export function idDoQr(fd: string): string | null {
  const texto = String(fd ?? "").replace(/^[A-Z]{1,2},/, "");
  try {
    const j = JSON.parse(texto) as { id?: unknown };
    const id = String(j?.id ?? "").trim();
    return /^\d{6,20}$/.test(id) ? id : null;
  } catch {
    const m = texto.match(/"id"\s*:\s*"(\d{6,20})"/);
    return m ? m[1] : null;
  }
}

export function lerEtiqueta(zpl: string, indice: number): EtiquetaZpl {
  // O código principal é o PRIMEIRO ^BC; o segundo, quando existe, é o tracking da transportadora.
  const barras = camposDeCodigo(zpl, "BC").map(dadoDoCode128).filter(Boolean);
  const envioBarcode = barras.length && /^\d{6,20}$/.test(barras[0]) ? barras[0] : null;
  const qrs = camposDeCodigo(zpl, "BQ").map(idDoQr).filter((x): x is string => !!x);
  const envioQr = qrs[0] ?? null;

  let envio: string | null = null;
  let problema: string | null = null;
  if (envioBarcode && envioQr && envioBarcode !== envioQr) {
    problema = `o código de barras (${envioBarcode}) e o QR (${envioQr}) não batem`;
  } else if (envioBarcode || envioQr) {
    envio = envioBarcode ?? envioQr;
  } else {
    problema = "não achei o número do envio nesta etiqueta";
  }
  return { indice, zpl, envioBarcode, envioQr, envio, problema };
}

/**
 * Separa o arquivo nas etiquetas. Só o que está entre `^XA` e `^XZ` vira
 * etiqueta; o resto vai pro `prefixo` (nada some em silêncio).
 */
export function lerLote(texto: string): LoteZpl {
  const t = String(texto ?? "").replace(/^﻿/, "");
  const etiquetas: EtiquetaZpl[] = [];
  let prefixo = "";
  let pos = 0;
  const re = /\^XA[\s\S]*?\^XZ/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    prefixo += t.slice(pos, m.index);
    etiquetas.push(lerEtiqueta(m[0], etiquetas.length));
    pos = m.index + m[0].length;
  }
  prefixo += t.slice(pos);

  const vistos = new Map<string, number>();
  for (const e of etiquetas) if (e.envio) vistos.set(e.envio, (vistos.get(e.envio) ?? 0) + 1);
  const duplicados = [...vistos].filter(([, n]) => n > 1).map(([id]) => id);
  return { etiquetas, prefixo: prefixo.trim(), duplicados };
}

/** O arquivo parece ZPL? (conteúdo, não extensão — PDF/EPL renomeado não passa). */
export function pareceZpl(texto: string): boolean {
  const t = String(texto ?? "");
  return /\^XA/.test(t) && /\^XZ/.test(t);
}
