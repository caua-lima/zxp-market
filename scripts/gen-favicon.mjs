// ⚠ DESATUALIZADO — NÃO RODE SEM CORRIGIR ANTES.
//
// Este script desenha o "Z" como POLÍGONO PREENCHIDO de 10 vértices (Z_POLY
// abaixo), que é a aproximação feita à mão e já substituída em todo o resto
// do app: a marca real é uma POLILINHA com traço de espessura 34 (ver
// lib/marca.ts, fonte única do desenho). As cores também estão invertidas em
// relação ao guia de identidade — aqui o fundo é dourado e o Z é onyx.
//
// Rodar como está sobrescreveria app/favicon.ico com um símbolo que não é
// mais o da marca. Não está ligado a nenhum script do package.json e não há
// .ico versionado no repositório, então hoje ele não roda sozinho.
//
// Pra consertar: rasterizar o traço de lib/marca.ts em vez de preencher
// Z_POLY, e usar onyx como fundo com o Z dourado.
//
// Gera app/favicon.ico (32x32, 32bpp com alpha) desenhando o logomark:
//
// Existe porque Next.js não gera favicon.ico a partir de código (só icon.tsx,
// que produz PNG); browsers/OS que buscam /favicon.ico direto ainda precisam
// de um .ico de verdade. Roda com: node scripts/gen-favicon.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SIZE = 32; // dimensão final do ícone
const SS = 4; // supersampling: renderiza em (SIZE*SS)² e reduz com média, para anti-aliasing
const HI = SIZE * SS;

// Mesmo polígono do "Z" em ZxpMark.tsx (viewBox 0..100)
const Z_POLY = [
  [18, 18], [82, 18], [82, 34], [52, 66], [82, 66],
  [82, 82], [18, 82], [18, 66], [48, 34], [18, 34],
];
const RECT_RADIUS = 24; // rx do <rect>, mesma unidade 0..100

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Distância ao retângulo arredondado 0..100 com raio r (>0 dentro, <0 fora, aprox. em px)
function roundedRectInside(x, y, r) {
  const cx = Math.min(Math.max(x, r), 100 - r);
  const cy = Math.min(Math.max(y, r), 100 - r);
  const dx = x - cx, dy = y - cy;
  return Math.sqrt(dx * dx + dy * dy) <= r || (x >= r && x <= 100 - r) || (y >= r && y <= 100 - r);
}

const BG_COLOR = [0xf4, 0xb9, 0x42]; // #F4B942 — dourado assinatura
const Z_COLOR = [0x10, 0x10, 0x0e]; // #10100E — onyx

// Renderiza em alta resolução (RGBA por pixel, alpha 0 ou 255)
const hiPixels = new Uint8ClampedArray(HI * HI * 4);
for (let py = 0; py < HI; py++) {
  for (let px = 0; px < HI; px++) {
    const x = ((px + 0.5) / HI) * 100;
    const y = ((py + 0.5) / HI) * 100;
    const idx = (py * HI + px) * 4;
    if (!roundedRectInside(x, y, RECT_RADIUS)) {
      hiPixels[idx] = 0; hiPixels[idx + 1] = 0; hiPixels[idx + 2] = 0; hiPixels[idx + 3] = 0;
      continue;
    }
    const [r, g, b] = pointInPolygon(x, y, Z_POLY) ? Z_COLOR : BG_COLOR;
    hiPixels[idx] = r; hiPixels[idx + 1] = g; hiPixels[idx + 2] = b; hiPixels[idx + 3] = 255;
  }
}

// Reduz para SIZE x SIZE com média em espaço premultiplicado (anti-aliasing
// correto na borda do quadrado arredondado, sem escurecer o contorno).
const pixels = new Uint8ClampedArray(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let sr = 0, sg = 0, sb = 0, sa = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const hx = x * SS + sx, hy = y * SS + sy;
        const i = (hy * HI + hx) * 4;
        const a = hiPixels[i + 3];
        sr += (hiPixels[i] * a) / 255;
        sg += (hiPixels[i + 1] * a) / 255;
        sb += (hiPixels[i + 2] * a) / 255;
        sa += a;
      }
    }
    const n = SS * SS;
    const avgA = sa / n;
    const idx = (y * SIZE + x) * 4;
    if (avgA <= 0) {
      pixels[idx] = 0; pixels[idx + 1] = 0; pixels[idx + 2] = 0; pixels[idx + 3] = 0;
    } else {
      pixels[idx] = Math.round((sr / n) / (avgA / 255));
      pixels[idx + 1] = Math.round((sg / n) / (avgA / 255));
      pixels[idx + 2] = Math.round((sb / n) / (avgA / 255));
      pixels[idx + 3] = Math.round(avgA);
    }
  }
}

// ── Empacota como .ico (1 imagem, 32x32, 32bpp BGRA + BITMAPINFOHEADER) ──
const pixelDataSize = SIZE * SIZE * 4;
const andMaskRowBytes = Math.ceil(SIZE / 8 / 4) * 4; // padded a 4 bytes
const andMaskSize = andMaskRowBytes * SIZE;
const dibSize = 40;
const bytesInRes = dibSize + pixelDataSize + andMaskSize;

const buf = Buffer.alloc(6 + 16 + bytesInRes);
let o = 0;
// ICONDIR
buf.writeUInt16LE(0, o); o += 2; // reserved
buf.writeUInt16LE(1, o); o += 2; // type = icon
buf.writeUInt16LE(1, o); o += 2; // count
// ICONDIRENTRY
buf.writeUInt8(SIZE, o); o += 1; // width
buf.writeUInt8(SIZE, o); o += 1; // height
buf.writeUInt8(0, o); o += 1; // colorCount
buf.writeUInt8(0, o); o += 1; // reserved
buf.writeUInt16LE(1, o); o += 2; // planes
buf.writeUInt16LE(32, o); o += 2; // bitCount
buf.writeUInt32LE(bytesInRes, o); o += 4;
buf.writeUInt32LE(22, o); o += 4; // offset (6+16)
// BITMAPINFOHEADER
buf.writeUInt32LE(dibSize, o); o += 4;
buf.writeInt32LE(SIZE, o); o += 4; // width
buf.writeInt32LE(SIZE * 2, o); o += 4; // height*2 (imagem + AND mask)
buf.writeUInt16LE(1, o); o += 2; // planes
buf.writeUInt16LE(32, o); o += 2; // bitcount
buf.writeUInt32LE(0, o); o += 4; // BI_RGB
buf.writeUInt32LE(pixelDataSize, o); o += 4;
buf.writeInt32LE(0, o); o += 4;
buf.writeInt32LE(0, o); o += 4;
buf.writeUInt32LE(0, o); o += 4;
buf.writeUInt32LE(0, o); o += 4;
// Pixel data: BGRA, bottom-up (última linha da imagem primeiro no arquivo)
for (let y = SIZE - 1; y >= 0; y--) {
  for (let x = 0; x < SIZE; x++) {
    const idx = (y * SIZE + x) * 4;
    buf.writeUInt8(pixels[idx + 2], o); o += 1; // B
    buf.writeUInt8(pixels[idx + 1], o); o += 1; // G
    buf.writeUInt8(pixels[idx], o); o += 1; // R
    buf.writeUInt8(pixels[idx + 3], o); o += 1; // A
  }
}
// AND mask: tudo zero (transparência real vem do canal alpha acima)
for (let i = 0; i < andMaskSize; i++) { buf.writeUInt8(0, o); o += 1; }

const outPath = join(__dirname, "..", "app", "favicon.ico");
writeFileSync(outPath, buf);
console.log(`favicon.ico gerado em ${outPath} (${buf.length} bytes)`);
