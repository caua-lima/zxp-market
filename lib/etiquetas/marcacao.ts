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

/** Altura de fonte que cabe na caixa, ou null se não cabe legível. */
export function fonteQueCabe(texto: string, caixa: Caixa): number | null {
  return arranjoQueCabe(texto, caixa)?.fonte ?? null;
}

/** Menor letra que ainda se lê na separação (pontos, 203 dpi ≈ 3,8 mm). */
const FONTE_MINIMA = 30;
/** Folga de cada lado dentro da moldura (pontos). */
const FOLGA = 10;

/**
 * Largura de um caractere da fonte 0 da Zebra (`^A0N,f,f`), em frações da
 * fonte, POR CIMA. Era um 0,55 fixo pra tudo, e o "M" ocupa ~0,85: "2MS" e
 * "MC+" não cabiam, a impressora imprimia o excesso POR CIMA das outras letras
 * e, com o texto invertido (^FR), a sobreposição se apagava — o borrão "M/C"
 * e "2∑M" das etiquetas de 26/11/2026.
 */
export function larguraDoCaractere(c: string): number {
  if (c === "M" || c === "W") return 0.9;
  if (c === " ") return 0.32;
  if (c === "I" || c === "1") return 0.4;
  if (/[0-9+]/.test(c)) return 0.64;
  return 0.72;
}
export function larguraDoTexto(texto: string, fonte: number): number {
  return [...texto].reduce((s, c) => s + larguraDoCaractere(c), 0) * fonte;
}

/**
 * Como escrever o texto na caixa com a MAIOR letra possível: numa linha só
 * ("2TT + BM"), numa linha sem espaços ("TT+MS+PF") ou empilhando as siglas
 * (TT / MS / PF, uma por linha — sem o "+" pendurado, que só roubava largura).
 * Antes era só a primeira: pacote com 3 produtos diferentes não cabia e ia
 * pra etiqueta auxiliar (18/11/2026, envio 48573153721).
 */
export function arranjoQueCabe(texto: string, caixa: Caixa): { linhas: string[]; fonte: number } | null {
  const partes = texto.split("+").map((x) => x.trim()).filter(Boolean);
  const candidatos: string[][] = [[texto], [texto.replace(/\s+/g, "")]];
  for (let k = 2; k <= partes.length; k++) {
    const porLinha = Math.ceil(partes.length / k);
    const linhas: string[] = [];
    for (let i = 0; i < partes.length; i += porLinha) linhas.push(partes.slice(i, i + porLinha).join("+"));
    candidatos.push(linhas);
  }
  const util = caixa.w - 2 * FOLGA;
  let melhor: { linhas: string[]; fonte: number } | null = null;
  for (const linhas of candidatos) {
    const maiorFator = Math.max(...linhas.map((l) => larguraDoTexto(l, 1)), 0.01);
    const fonte = Math.min(
      Math.floor((caixa.h - 2 * FOLGA) * 0.8),
      Math.floor((caixa.h - 2 * FOLGA) / linhas.length),
      Math.floor(util / maiorFator),
    );
    if (fonte < FONTE_MINIMA) continue;
    if (!melhor || fonte > melhor.fonte) melhor = { linhas, fonte };
  }
  return melhor;
}

/** Espessura da moldura da sigla (pontos). */
const MOLDURA = 5;

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
    const arranjo = arranjoQueCabe(texto, regiao);
    if (!arranjo) continue;
    const { linhas, fonte } = arranjo;
    // Uma linha por campo, cada uma na sua altura. Um ^FB de várias linhas
    // deixa o espaçamento por conta da impressora/motor (medido no Zebrash:
    // ~1,5× a fonte) e o texto vazava pra fora da caixa preta.
    const passo = Math.floor((regiao.h - 2 * FOLGA) / linhas.length);
    const y0 = regiao.y + FOLGA + Math.max(Math.floor((passo - fonte) / 2), 0);
    /**
     * PRETO SOBRE BRANCO, dentro de uma moldura — sem ^FR. O texto invertido
     * (branco na caixa preta) se apaga onde duas letras se sobrepõem, e foi o
     * que borrou as siglas em 26/11/2026. Preto sobre branco, no pior caso,
     * fica com letras encostadas, mas legíveis.
     */
    const campos = linhas.map((l, i) =>
      `^FO${regiao.x},${y0 + i * passo}^A0N,${fonte},${fonte}^FB${regiao.w},1,0,C^FD${l}^FS`).join("\n");
    const bloco = `${INICIO}\n^FO${regiao.x},${regiao.y}^GB${regiao.w},${regiao.h},${MOLDURA}^FS\n${campos}\n${FIM}\n`;
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
