/**
 * Escreve a sigla de separação (`2TT`) na etiqueta do ML — sem cobrir nada.
 *
 * ─── POR QUE NÃO UMA COORDENADA FIXA ────────────────────────────────────
 *
 * Em 13/11/2026 a sigla foi posta no canto superior direito de todas as 19
 * etiquetas, e em 4 delas o ML desenha ali um aviãozinho (envio aéreo). A
 * caixa cobriu o ícone. Agora cada etiqueta tem as suas áreas ocupadas
 * calculadas (imagem, caixa, texto, código de barras, QR) e a marcação só vai
 * pra uma região candidata que não encosta em nada. Nenhuma livre → não marca:
 * quem chama gera a etiqueta AUXILIAR de separação (ver `etiquetaAuxiliar`).
 *
 * ─── O QUE NUNCA MUDA ───────────────────────────────────────────────────
 *
 * Nada do original é alterado nem removido: a marcação é um bloco a mais,
 * entre comentários `^FX ZXP-MARCA`, inserido antes do último `^XZ`. Marcar de
 * novo troca o bloco (não empilha). Texto só com A-Z, 0-9, espaço e "+":
 * `^`/`~` não passam, então nada vira comando de impressora.
 *
 * Puro e autossuficiente (sem `@/`).
 */

export type Caixa = { x: number; y: number; w: number; h: number };

const INICIO = "^FX ZXP-MARCA INICIO^FS";
const FIM = "^FX ZXP-MARCA FIM^FS";

/** Largura útil da etiqueta 4" a 203 dpi (812 dots) menos a margem do ^LH. */
export const LARGURA_ETIQUETA = 805;

/** Regiões tentadas, em ordem de preferência (coordenadas de ^FO). */
export const REGIOES_CANDIDATAS: Caixa[] = [
  { x: 640, y: 10, w: 150, h: 120 }, // canto superior direito (o que o dono já usa)
  { x: 722, y: 10, w: 78, h: 120 },  // estreita, ao lado do ícone do ML
];

const num = (s: string | undefined, padrao = 0) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : padrao;
};

/** Remove a marcação que já existir (marcar de novo não empilha). */
export function semMarcacao(zpl: string): string {
  const i = zpl.indexOf(INICIO);
  if (i < 0) return zpl;
  const f = zpl.indexOf(FIM, i);
  if (f < 0) return zpl;
  return zpl.slice(0, i) + zpl.slice(f + FIM.length).replace(/^\n/, "");
}

/**
 * As áreas ocupadas da etiqueta, por campo (`^FO … ^FS`). Estimativa por
 * EXCESSO de propósito: errar pra mais só faz a marcação procurar outro canto;
 * errar pra menos cobre informação do ML.
 */
export function caixasOcupadas(zplOriginal: string): Caixa[] {
  const zpl = semMarcacao(zplOriginal);
  const caixas: Caixa[] = [];
  let modulo = 2; // ^BY corrente (largura do módulo de barras)
  const campos = zpl.split(/(?=\^FO)/);
  for (const campo of campos) {
    const by = campo.match(/\^BY(\d+)/);
    if (by) modulo = num(by[1], 2);
    const fo = campo.match(/^\^FO(\d+),(\d+)/);
    if (!fo) continue;
    const x = num(fo[1]), y = num(fo[2]);

    const gf = campo.match(/\^GF[AB],(\d+),(\d+),(\d+)/);
    if (gf) {
      const bpr = num(gf[3], 1);
      caixas.push({ x, y, w: bpr * 8, h: Math.ceil(num(gf[2]) / Math.max(bpr, 1)) });
      continue;
    }
    const gb = campo.match(/\^GB(\d+),(\d+)/);
    if (gb) { caixas.push({ x, y, w: Math.max(num(gb[1]), 1), h: Math.max(num(gb[2]), 1) }); continue; }

    const bc = campo.match(/\^BC[NRIB]?,(\d+)/);
    if (bc) {
      const dado = (campo.match(/\^FD([^\^]*)/)?.[1] ?? "").replace(/>[0-9:;<=>]/g, "");
      const larg = modulo * (11 * Math.ceil(dado.length / 2 + 3) + 13); // Code 128 (subconjunto C, por cima)
      caixas.push({ x, y, w: Math.min(larg + 20, LARGURA_ETIQUETA), h: num(bc[1], 100) + 10 });
      continue;
    }
    const bq = campo.match(/\^BQ[NRIB]?,\d,(\d+)/);
    if (bq) { const lado = num(bq[1], 5) * 45; caixas.push({ x, y, w: lado, h: lado }); continue; }

    const fonte = campo.match(/\^A[0-9A-Z]?[NRIB]?,(\d+)(?:,(\d+))?/);
    if (fonte) {
      const h = num(fonte[1], 20);
      const wChar = num(fonte[2], h);
      const fb = campo.match(/\^FB(\d+),(\d+),[^,\^]*,([LCRJ])/) ?? campo.match(/\^FB(\d+),(\d+)/);
      // ^FH: "_C3_A9" é um caractere só — conta como um.
      const texto = (campo.match(/\^FD([^\^]*)/)?.[1] ?? "").replace(/(_[0-9A-Fa-f]{2}){1,4}/g, "x");
      // Fonte 0 é condensada (~0,5 da altura por caractere medido); 0,62 erra pra mais.
      const corrido = Math.ceil(texto.length * wChar * 0.62) + 4;
      if (fb) {
        const largBloco = num(fb[1]);
        const linhas = Math.min(Math.max(num(fb[2], 1), 1), Math.max(Math.ceil(corrido / Math.max(largBloco, 1)), 1));
        const w = Math.min(largBloco, corrido);
        const alinh = (fb as RegExpMatchArray)[3] ?? "L";
        const dx = alinh === "C" ? Math.floor((largBloco - w) / 2) : alinh === "R" ? largBloco - w : 0;
        caixas.push({ x: x + dx, y, w, h: h * linhas + 4 });
      } else caixas.push({ x, y, w: corrido, h: h + 4 });
    }
  }
  return caixas;
}

const encosta = (a: Caixa, b: Caixa) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** A primeira região candidata livre, ou null. */
export function regiaoLivre(zpl: string, candidatas: Caixa[] = REGIOES_CANDIDATAS): Caixa | null {
  const ocupadas = caixasOcupadas(zpl);
  return candidatas.find((c) => c.x + c.w <= LARGURA_ETIQUETA && !ocupadas.some((o) => encosta(c, o))) ?? null;
}

/** Só o que pode ir pra etiqueta: letras, números, espaço e "+". */
export function textoSeguro(texto: string): string {
  return String(texto ?? "").toUpperCase().replace(/[^A-Z0-9 +]/g, "").replace(/\s+/g, " ").trim();
}

/** Altura de fonte que cabe na caixa (A0 condensada: ~0,55 da altura por caractere), ou null se não cabe legível. */
export function fonteQueCabe(texto: string, caixa: Caixa): number | null {
  const n = Math.max(texto.length, 1);
  const h = Math.min(Math.floor(caixa.h * 0.75), Math.floor((caixa.w - 8) / (n * 0.55)));
  return h >= 30 ? h : null;
}

export type ResultadoMarcacao =
  | { ok: true; zpl: string; regiao: Caixa }
  | { ok: false; motivo: string };

/** Marca a etiqueta. Não achando lugar livre ou texto que caiba, não marca — nunca cobre. */
export function marcarEtiqueta(zpl: string, textoBruto: string): ResultadoMarcacao {
  const texto = textoSeguro(textoBruto);
  if (!texto) return { ok: false, motivo: "sem texto pra marcar" };
  const limpo = semMarcacao(zpl);
  if (!/\^XZ/.test(limpo)) return { ok: false, motivo: "etiqueta sem ^XZ" };
  for (const regiao of REGIOES_CANDIDATAS) {
    if (regiao !== regiaoLivre(limpo, [regiao])) continue;
    const fonte = fonteQueCabe(texto, regiao);
    if (!fonte) continue;
    const yTexto = regiao.y + Math.max(Math.floor((regiao.h - fonte) / 2), 0);
    const bloco = `${INICIO}\n^FO${regiao.x},${regiao.y}^GB${regiao.w},${regiao.h},${regiao.w}^FS\n`
      + `^FO${regiao.x},${yTexto}^A0N,${fonte},${fonte}^FB${regiao.w},1,0,C^FR^FD${texto}^FS\n${FIM}\n`;
    const ultimo = limpo.lastIndexOf("^XZ");
    return { ok: true, zpl: limpo.slice(0, ultimo) + bloco + limpo.slice(ultimo), regiao };
  }
  return { ok: false, motivo: "sem espaço livre na etiqueta pra marcação legível" };
}

/**
 * Etiqueta auxiliar de separação (quando a oficial não tem espaço): só a
 * sigla grande e o envio, pra colar junto. Nada do comprador.
 */
export function etiquetaAuxiliar(textoBruto: string, envio: string, ordem: number): string {
  const texto = textoSeguro(textoBruto) || "?";
  const id = String(envio ?? "").replace(/[^0-9]/g, "");
  const fonte = Math.max(60, Math.min(220, Math.floor(760 / (texto.length * 0.55))));
  return [
    "^XA", "^CI28", "^LH5,15",
    `^FO20,40^A0N,40,40^FDSEPARACAO - etiqueta ${Math.max(ordem, 1)}^FS`,
    `^FO20,160^A0N,${fonte},${fonte}^FB780,1,0,C^FD${texto}^FS`,
    `^FO20,${200 + fonte}^A0N,40,40^FB780,1,0,C^FDEnvio ${id}^FS`,
    "^XZ",
  ].join("\n");
}
