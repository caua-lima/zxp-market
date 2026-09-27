import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { conferirAmbiente, OBRIGATORIAS_NAVEGADOR, OBRIGATORIAS_SERVIDOR, OPCIONAIS } from "./ambiente";

const RAIZ = join(__dirname, "..", "..");
/** Do runtime/plataforma, não da configuração do app. */
const DA_PLATAFORMA = new Set(["NODE_ENV", "NEXT_RUNTIME", "VERCEL_ENV", "VERCEL_URL", "CI"]);

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return arquivos(p);
    return /\.(ts|tsx|mjs)$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : [];
  });
}

const valido = (): Record<string, string> => ({
  FIREBASE_PROJECT_ID: "p1",
  FIREBASE_CLIENT_EMAIL: "sa@p1.iam.gserviceaccount.com",
  FIREBASE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n",
  ML_APP_ID: "1",
  ML_SECRET: "s",
  ML_REDIRECT_URI: "https://app.exemplo/api/ml/callback",
  CRON_SECRET: "a".repeat(32),
  NEXT_PUBLIC_FIREBASE_API_KEY: "k",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "p1.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "p1",
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "0",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:0:web:0",
  NEXT_PUBLIC_FIREBASE_VAPID_KEY: "v",
  ML_SELLER_ID: "123",
});

describe("S26 — conferência da configuração na subida", () => {
  it("configuração completa passa sem erro nem aviso", () => {
    expect(conferirAmbiente(valido(), { producao: true })).toEqual({ erros: [], avisos: [] });
  });

  it("falta, formato e combinação: só nomes, nunca valores", () => {
    const env = { ...valido(), ML_SECRET: "", NEXT_PUBLIC_FIREBASE_PROJECT_ID: "p2", FIREBASE_PRIVATE_KEY: "segredo-colado-errado", CRON_SECRET: "xyzzy7", ML_REDIRECT_URI: "http://app/api/ml/callback", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8199", NEXT_PUBLIC_ZXP_MODO_DADOS: "empresa" };
    const { erros } = conferirAmbiente(env, { producao: true });
    expect(erros).toEqual([
      "ML_SECRET ausente",
      "FIREBASE_PROJECT_ID e NEXT_PUBLIC_FIREBASE_PROJECT_ID apontam pra projetos diferentes",
      expect.stringContaining("FIREBASE_PRIVATE_KEY não parece"),
      "ML_REDIRECT_URI precisa ser https em produção",
      expect.stringContaining("CRON_SECRET curto"),
      "NEXT_PUBLIC_ZXP_MODO_DADOS só aceita raiz ou tenant",
      "FIRESTORE_EMULATOR_HOST definido em produção",
    ]);
    expect(erros.join(" ")).not.toContain("segredo-colado-errado");
    expect(erros.join(" ")).not.toContain("xyzzy7");
  });

  it("modo empresa sem empresa padrão avisa; fora de produção http e emulador são aceitos", () => {
    const env = { ...valido(), NEXT_PUBLIC_ZXP_MODO_DADOS: "tenant", ML_REDIRECT_URI: "http://localhost:3000/api/ml/callback", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8199" };
    const r = conferirAmbiente(env, { producao: false });
    expect(r.erros).toEqual([]);
    expect(r.avisos).toEqual([expect.stringContaining("NEXT_PUBLIC_ZXP_TENANT_ID")]);
  });

  it("inventário: toda variável lida pelo código está na lista e no .env.example (e vice-versa)", () => {
    const noCodigo = new Set<string>();
    for (const dir of ["app", "lib", "components", "hooks", "scripts"]) {
      for (const f of arquivos(join(RAIZ, dir))) {
        for (const m of readFileSync(f, "utf8").matchAll(/process\.env\.([A-Z0-9_]+)/g)) noCodigo.add(m[1]);
      }
    }
    for (const n of DA_PLATAFORMA) noCodigo.delete(n);
    const conhecidas = new Set<string>([...OBRIGATORIAS_SERVIDOR, ...OBRIGATORIAS_NAVEGADOR, ...OPCIONAIS]);
    expect([...noCodigo].filter((n) => !conhecidas.has(n)).sort()).toEqual([]);

    const exemplo = readFileSync(join(RAIZ, ".env.example"), "utf8");
    const noExemplo = new Set([...exemplo.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
    expect([...conhecidas].filter((n) => !noExemplo.has(n)).sort()).toEqual([]);
    expect([...noExemplo].filter((n) => !conhecidas.has(n)).sort()).toEqual([]);
  });
});
