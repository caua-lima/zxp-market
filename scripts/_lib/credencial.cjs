const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..", "..");

function lerEnvLocal() {
  const caminho = path.join(RAIZ, ".env.local");
  if (!fs.existsSync(caminho)) return {};

  const txt = fs.readFileSync(caminho, "utf8");
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

/** Versão CommonJS de scripts/_lib/credencial.mjs — mesmo porquê, mesma lógica. */
function carregarCredencial() {
  const doEnv = lerEnvLocal();
  if (doEnv.projectId && doEnv.clientEmail && doEnv.privateKey) {
    return { ...doEnv, origem: ".env.local" };
  }

  const caminhoChave = path.join(RAIZ, "serviceAccountKey.json");
  if (!fs.existsSync(caminhoChave)) {
    throw new Error(
      "Sem credencial: .env.local não tem FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/" +
      "FIREBASE_PRIVATE_KEY completos, e não achei serviceAccountKey.json na raiz.",
    );
  }

  const chave = JSON.parse(fs.readFileSync(caminhoChave, "utf8"));
  return {
    projectId: chave.project_id,
    clientEmail: chave.client_email,
    privateKey: chave.private_key,
    origem: "serviceAccountKey.json",
  };
}

module.exports = { carregarCredencial };
