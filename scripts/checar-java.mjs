// Antes do emulador (S26): o firebase-tools fixado no package.json exige Java 21+.
// Com Java mais velho o emulador morre com um erro que não fala de versão —
// foi o que travou a auditoria (Java 17). Aqui a mensagem diz o que fazer.
import { spawnSync } from "node:child_process";

const MINIMO = 21;
const r = spawnSync("java", ["-version"], { encoding: "utf8" });
const saida = `${r.stderr ?? ""}${r.stdout ?? ""}`;
const m = saida.match(/version "(\d+)(?:\.(\d+))?/);
const major = m ? (m[1] === "1" ? Number(m[2]) : Number(m[1])) : NaN;

if (r.error || !Number.isFinite(major)) {
  console.error(`Java não encontrado. Instale o Java ${MINIMO} (Temurin: https://adoptium.net) e abra um terminal novo.`);
  process.exit(1);
}
if (major < MINIMO) {
  console.error(`Java ${major} encontrado; o emulador do Firestore precisa de Java ${MINIMO}+. Instale o Temurin ${MINIMO}.`);
  process.exit(1);
}
