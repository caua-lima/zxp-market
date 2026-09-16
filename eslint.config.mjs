import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      /**
       * O underscore como "este argumento existe de propósito e não é usado".
       *
       * ─── POR QUE ISTO NÃO É AFROUXAR A REGRA ─────────────────────────────
       *
       * `lib/firebase/data.ts` tem umas dez funções com a assinatura
       * `(_uid: string, ...)`. O `uid` está ali porque toda a camada de dados
       * é chamada assim, e não é usado porque hoje as coleções são
       * compartilhadas, não por usuário. O underscore é o registro dessa
       * decisão — apagar o argumento esconderia que ele volta a importar no
       * dia da migração multi-tenant.
       *
       * Sem esta configuração, a regra reclamava de UMA delas só —
       * `clearDraft(_uid)`, onde o argumento é o último — porque o padrão é
       * `args: "after-used"`. Nas outras, um argumento usado depois do `_uid`
       * já bastava pra calar o aviso.
       *
       * Ou seja: a convenção já existia e era respeitada; o que faltava era
       * dizer isso à ferramenta, em vez de conviver com um aviso que só
       * aparecia por acidente de posição.
       */
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        // O argumento antes de um usado continua sendo reportado se não tiver
        // underscore — a regra não foi enfraquecida, só ensinada a ler a marca.
        args: "after-used",
      }],
    },
  },
]);

export default eslintConfig;
