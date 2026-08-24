import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function lerEnvLocal() {
  const caminho = join(RAIZ, ".env.local");
  if (!existsSync(caminho)) return {};

  const txt = readFileSync(caminho, "utf8");
  const pega = (nome) => {
    const m = txt.match(new RegExp(`^${nome}=(.*)$`, "m"));
    if (!m) return undefined;
    let v = m[1];
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    return v;
  };

  const privateKey = pega("FIREBASE_PRIVATE_KEY");
  return {
    projectId: pega("FIREBASE_PROJECT_ID"),
    clientEmail: pega("FIREBASE_CLIENT_EMAIL"),
    privateKey: privateKey ? privateKey.split("\\n").join("\n") : undefined,
  };
}

/**
 * Credencial do Admin SDK pros scripts — SEMPRE a mesma que o app usa.
 *
 * ─── POR QUE ISTO EXISTE ─────────────────────────────────────────────────
 *
 * Cada script lia `serviceAccountKey.json` direto da raiz, sem checar se
 * batia com o projeto que `npm run dev` realmente usa. Isso já causou um
 * engano de verdade: um script escreveu dado de teste no projeto ERRADO
 * (vazxpress-a2350, o dashboard pessoal) achando que estava testando o SaaS
 * (controleml-saas) — sem erro nenhum, silencioso, só descoberto comparando
 * os dois bancos a mão.
 *
 * `.env.local` é a fonte que `lib/firebase/admin.ts` usa pro APP de verdade.
 * Ler daqui primeiro torna essa categoria de erro impossível: o script mira
 * sempre o mesmo projeto que o `npm run dev` está rodando, sem precisar de
 * ninguém lembrar de conferir.
 *
 * `serviceAccountKey.json` continua como fallback — só entra em cena se
 * `.env.local` não tiver as três variáveis (ambiente novo, ainda sem
 * configurar). Sempre imprime a ORIGEM junto do projeto, pra nunca mais ficar
 * ambíguo qual credencial um script usou.
 */
export function carregarCredencial() {
  const doEnv = lerEnvLocal();
  if (doEnv.projectId && doEnv.clientEmail && doEnv.privateKey) {
    return { ...doEnv, origem: ".env.local" };
  }

  const caminhoChave = join(RAIZ, "serviceAccountKey.json");
  if (!existsSync(caminhoChave)) {
    throw new Error(
      "Sem credencial: .env.local não tem FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/" +
      "FIREBASE_PRIVATE_KEY completos, e não achei serviceAccountKey.json na raiz.",
    );
  }

  const chave = JSON.parse(readFileSync(caminhoChave, "utf8"));
  return {
    projectId: chave.project_id,
    clientEmail: chave.client_email,
    privateKey: chave.private_key,
    origem: "serviceAccountKey.json",
  };
}
