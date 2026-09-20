import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Testes contra o emulador do Firestore: regras de segurança e transações.
 *
 * Rodam com `npm run test:emulador`, que sobe o emulador, executa e derruba.
 * Sequenciais de propósito: todos falam com o MESMO emulador, e um teste que
 * limpa o banco não pode apagar o dado de outro rodando ao lado.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.emulador.test.ts"],
    exclude: [...configDefaults.exclude],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "lib/test/server-only-stub.ts"),
      "@": path.resolve(__dirname, "."),
    },
  },
});
