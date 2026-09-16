#!/usr/bin/env node
/**
 * Aplica a retenção aos dumps locais: 14 diários, 8 semanais, 12 mensais.
 *
 * ─── A LACUNA QUE ISTO FECHA ─────────────────────────────────────────────
 *
 * A regra existia em `manterBackup()`, com testes, e nada a executava. Uma
 * retenção que ninguém aplica não é política, é comentário: o diretório
 * cresce até acabar o disco, e aí alguém apaga tudo às pressas — inclusive o
 * mensal de seis meses atrás, que era o único que cobria a perda silenciosa.
 *
 * ─── POR QUE ELE PERGUNTA ANTES ──────────────────────────────────────────
 *
 * Porque apaga backup, e backup é a coisa que existe justamente pra quando
 * algo deu errado. `--aplicar` é obrigatório; sem ele, o script só LISTA o
 * que faria. É o mesmo desenho do restore: o modo padrão não destrói nada.
 *
 * ─── USO ─────────────────────────────────────────────────────────────────
 *
 *   node scripts/podar-backups.mjs               # só mostra
 *   node scripts/podar-backups.mjs --aplicar     # apaga de verdade
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { manterBackup, RETENCAO } from "../lib/domain/backup-inventario.ts";

const args = process.argv.slice(2);
const opt = (n, p) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : p; };
const aplicar = args.includes("--aplicar");
const dir = opt("dir", "./backups");

/**
 * A data do dump sai do NOME do diretório, e não do mtime.
 *
 * O mtime muda se alguém copiar a pasta, e uma cópia não é um backup novo —
 * pelo mtime, copiar o diretório inteiro faria todos os dumps parecerem de
 * hoje e a retenção pararia de podar qualquer coisa.
 *
 * O nome é `<projeto>_<ISO com - no lugar de : e .>`; o `resumo.json` tem a
 * data exata e é preferido quando existe.
 */
function dataDoDump(nome, caminho) {
  const resumo = path.join(caminho, "resumo.json");
  if (fs.existsSync(resumo)) {
    try {
      const j = JSON.parse(fs.readFileSync(resumo, "utf8"));
      if (j.feitoEm) return new Date(j.feitoEm);
    } catch { /* nome como plano B */ }
  }
  const m = nome.match(/_(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
}

function ehUltimoDiaDoMes(d) {
  const seguinte = new Date(d.getTime());
  seguinte.setUTCDate(seguinte.getUTCDate() + 1);
  return seguinte.getUTCMonth() !== d.getUTCMonth();
}

function main() {
  if (!fs.existsSync(dir)) {
    console.log(`Nada a podar: ${dir} não existe.`);
    return 0;
  }

  const agora = Date.now();
  const entradas = fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const caminho = path.join(dir, e.name);
      const data = dataDoDump(e.name, caminho);
      return { nome: e.name, caminho, data };
    });

  const semData = entradas.filter((x) => !x.data);
  const comData = entradas.filter((x) => x.data);

  console.log(`Retenção: ${RETENCAO.diarios} diários · ${RETENCAO.semanais} semanais · ${RETENCAO.mensais} mensais`);
  console.log(`${entradas.length} dump(s) em ${dir}\n`);

  let apagados = 0, mantidos = 0;

  for (const x of comData.sort((a, b) => b.data - a.data)) {
    const idadeEmDias = (agora - x.data.getTime()) / 86400000;
    const manter = manterBackup({
      idadeEmDias,
      fimDeMes: ehUltimoDiaDoMes(x.data),
      fimDeSemana: x.data.getUTCDay() === 0,
    });

    const idade = `${Math.floor(idadeEmDias)}d`;
    if (manter) {
      mantidos += 1;
      console.log(`  mantém  ${x.nome}  (${idade})`);
    } else {
      apagados += 1;
      console.log(`  ${aplicar ? "APAGA  " : "apagaria"} ${x.nome}  (${idade})`);
      if (aplicar) fs.rmSync(x.caminho, { recursive: true, force: true });
    }
  }

  /**
   * Diretório sem data legível NUNCA é apagado.
   *
   * Pode ser um dump renomeado à mão, de outra ferramenta, ou o que alguém
   * guardou de propósito. Apagar o que não se consegue datar é o oposto do
   * trabalho deste script.
   */
  for (const x of semData) {
    console.log(`  mantém  ${x.nome}  (sem data legível — nunca apagado)`);
    mantidos += 1;
  }

  console.log(`\n${mantidos} mantido(s), ${apagados} ${aplicar ? "apagado(s)" : "a apagar"}.`);
  if (!aplicar && apagados > 0) {
    console.log("Nada foi apagado. Repita com --aplicar.");
  }
  return 0;
}

// Só executa quando chamado direto — importar não apaga backup de ninguém.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
