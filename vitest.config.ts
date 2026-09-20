import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    // Os testes que precisam do emulador do Firestore rodam à parte
    // (`npm run test:emulador`, ver vitest.emulador.config.ts): sem o emulador
    // no ar eles falhariam, e `npm test` tem que passar em qualquer máquina.
    exclude: [...configDefaults.exclude, "**/*.emulador.test.ts"],
  },
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "lib/test/server-only-stub.ts"),
      "@": path.resolve(__dirname, "."),
    },
  },
});
