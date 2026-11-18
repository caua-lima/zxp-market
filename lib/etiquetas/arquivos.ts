/**
 * Do arquivo que a pessoa escolheu ao texto ZPL.
 *
 * O ML entrega as etiquetas num ZIP ("Etiqueta MercadoEnvios-….zip") com um
 * `.txt` dentro; às vezes a pessoa já extraiu e manda o `.txt`/`.zpl`. Decide
 * pelo CONTEÚDO (`^XA … ^XZ`), não pela extensão: PDF renomeado não passa.
 * Tudo no navegador — a etiqueta tem nome e endereço do comprador e não sobe
 * pro servidor.
 */

import { strFromU8, unzipSync } from "fflate";
import { pareceZpl } from "./lote-zpl";

export type TextoZpl = { nome: string; texto: string };
export type LeituraDeArquivos = { textos: TextoZpl[]; ignorados: { nome: string; motivo: string }[] };

const MAX_BYTES = 25 * 1024 * 1024;

function ehZip(b: Uint8Array): boolean {
  return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5) && (b[3] === 4 || b[3] === 6);
}

/** Bytes → texto: UTF-8; se vier quebrado, Latin-1 (impressora antiga). */
export function decodificar(b: Uint8Array): string {
  const utf = strFromU8(b);
  return utf.includes("�") ? strFromU8(b, true) : utf;
}

export function lerBytes(nome: string, bytes: Uint8Array): LeituraDeArquivos {
  const textos: TextoZpl[] = [];
  const ignorados: { nome: string; motivo: string }[] = [];
  if (bytes.length > MAX_BYTES) return { textos, ignorados: [{ nome, motivo: "arquivo grande demais (máx. 25 MB)" }] };
  if (ehZip(bytes)) {
    let itens: Record<string, Uint8Array>;
    try {
      itens = unzipSync(bytes, { filter: (f) => !f.name.endsWith("/") && f.originalSize <= MAX_BYTES });
    } catch {
      return { textos, ignorados: [{ nome, motivo: "ZIP corrompido" }] };
    }
    for (const [interno, conteudo] of Object.entries(itens).sort(([a], [b]) => a.localeCompare(b))) {
      const rotulo = `${nome} › ${interno}`;
      if (/(^|\/)(__MACOSX|\.)/.test(interno)) continue;
      const texto = decodificar(conteudo);
      if (pareceZpl(texto)) textos.push({ nome: rotulo, texto });
      else ignorados.push({ nome: rotulo, motivo: "não é ZPL" });
    }
    if (!textos.length && !ignorados.length) ignorados.push({ nome, motivo: "ZIP vazio" });
    return { textos, ignorados };
  }
  const texto = decodificar(bytes);
  if (pareceZpl(texto)) textos.push({ nome, texto });
  else ignorados.push({ nome, motivo: /^%PDF/.test(texto) ? "é PDF, não ZPL — baixe as etiquetas em ZPL no ML" : "não é ZPL" });
  return { textos, ignorados };
}

export async function lerArquivos(arquivos: readonly File[]): Promise<LeituraDeArquivos> {
  const out: LeituraDeArquivos = { textos: [], ignorados: [] };
  for (const f of arquivos) {
    const r = lerBytes(f.name, new Uint8Array(await f.arrayBuffer()));
    out.textos.push(...r.textos);
    out.ignorados.push(...r.ignorados);
  }
  return out;
}
