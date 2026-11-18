// Copia o motor ZPL (WASM) de node_modules para public/motor — roda no predev e no prebuild.
// O arquivo gerado não vai pro git (.gitignore): a fonte é a versão exata do package-lock.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(raiz, "node_modules/zpl-renderer-js/package.json"), "utf8"));
const esperado = readFileSync(join(raiz, "lib/etiquetas/render.ts"), "utf8").match(/VERSAO_MOTOR = "([^"]+)"/)?.[1];
if (pkg.version !== esperado) {
  console.error(`motor ZPL: instalado ${pkg.version}, lib/etiquetas/render.ts espera ${esperado}`);
  process.exit(1);
}
const destino = join(raiz, "public/motor");
mkdirSync(destino, { recursive: true });
copyFileSync(join(raiz, "node_modules/zpl-renderer-js/dist/zebrash.wasm"), join(destino, `zebrash-${pkg.version}.wasm`));
console.log(`motor ZPL ${pkg.version} copiado para public/motor`);
