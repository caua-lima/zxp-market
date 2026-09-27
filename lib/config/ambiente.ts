/**
 * Conferência da configuração do servidor (S26).
 *
 * Variável faltando hoje só aparece quando a primeira rota que a usa quebra —
 * às vezes horas depois do deploy, às vezes só no cron da madrugada. Isto roda
 * na subida do servidor (`instrumentation.ts`) e diz, de uma vez, o que falta
 * ou não combina.
 *
 * Só NOMES de variável saem daqui. Nunca valor — nem pedaço, nem tamanho.
 *
 * A lista completa, com valores de exemplo falsos, está em `.env.example`; um
 * teste confere que as duas não se desencontram.
 */

export type Ambiente = Record<string, string | undefined>;

export type Conferencia = {
  /** O app não funciona direito assim. */
  erros: string[];
  /** Funciona, mas algo está desligado ou no modo antigo. */
  avisos: string[];
};

/** Obrigatórias no servidor: sem elas o Firestore, o ML ou o cron não sobem. */
export const OBRIGATORIAS_SERVIDOR = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "ML_APP_ID",
  "ML_SECRET",
  "ML_REDIRECT_URI",
  "CRON_SECRET",
] as const;

/** Obrigatórias no navegador (entram no pacote no build). */
export const OBRIGATORIAS_NAVEGADOR = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
] as const;

/** Opcionais conhecidas — existem pra o teste de inventário cobrir todas. */
export const OPCIONAIS = [
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_VAPID_KEY",
  "NEXT_PUBLIC_FIREBASE_EMULADOR",
  "FIRESTORE_EMULATOR_HOST",
  "NEXT_PUBLIC_ZXP_MODO_DADOS",
  "NEXT_PUBLIC_ZXP_TENANT_ID",
  "ML_SELLER_ID",
  "BOOTSTRAP_OWNER_EMAILS",
  "GITHUB_TOKEN",
  "GITHUB_REPO",
  "GITHUB_BRANCH",
] as const;

const vazio = (v: string | undefined) => v === undefined || v.trim() === "";

export function conferirAmbiente(env: Ambiente, opcoes: { producao: boolean }): Conferencia {
  const erros: string[] = [];
  const avisos: string[] = [];

  for (const nome of [...OBRIGATORIAS_SERVIDOR, ...OBRIGATORIAS_NAVEGADOR]) {
    if (vazio(env[nome])) erros.push(`${nome} ausente`);
  }

  // Servidor e navegador em projetos Firebase diferentes: o login acontece num,
  // os dados são lidos do outro — a tela abre vazia e parece perda de dado.
  const projServidor = env.FIREBASE_PROJECT_ID?.trim();
  const projNavegador = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  if (projServidor && projNavegador && projServidor !== projNavegador) {
    erros.push("FIREBASE_PROJECT_ID e NEXT_PUBLIC_FIREBASE_PROJECT_ID apontam pra projetos diferentes");
  }

  const chave = env.FIREBASE_PRIVATE_KEY;
  if (!vazio(chave) && !/BEGIN [A-Z ]*PRIVATE KEY/.test(chave!)) {
    erros.push("FIREBASE_PRIVATE_KEY não parece uma chave PEM (copie o campo private_key inteiro do JSON da conta de serviço)");
  }

  const redirect = env.ML_REDIRECT_URI?.trim();
  if (redirect) {
    let url: URL | null = null;
    try { url = new URL(redirect); } catch { /* inválida */ }
    if (!url) erros.push("ML_REDIRECT_URI não é uma URL");
    else if (opcoes.producao && url.protocol !== "https:") erros.push("ML_REDIRECT_URI precisa ser https em produção");
    else if (!url.pathname.endsWith("/api/ml/callback")) avisos.push("ML_REDIRECT_URI não termina em /api/ml/callback");
  }

  // Segredo curto é adivinhável: o cron e o worker rodam com poder de sistema.
  if (!vazio(env.CRON_SECRET) && env.CRON_SECRET!.trim().length < 16) {
    erros.push("CRON_SECRET curto demais (use 32+ caracteres aleatórios)");
  }

  const modo = env.NEXT_PUBLIC_ZXP_MODO_DADOS?.trim() ?? "";
  if (modo !== "" && modo !== "raiz" && modo !== "tenant") {
    erros.push("NEXT_PUBLIC_ZXP_MODO_DADOS só aceita raiz ou tenant");
  }
  if (modo === "tenant" && vazio(env.NEXT_PUBLIC_ZXP_TENANT_ID)) {
    avisos.push("modo empresa sem NEXT_PUBLIC_ZXP_TENANT_ID: rotas sem empresa na requisição não terão empresa padrão");
  }
  if (modo !== "tenant" && vazio(env.ML_SELLER_ID)) {
    avisos.push("ML_SELLER_ID ausente: o modo raiz usa o vendedor legado fixo no código");
  }

  if (opcoes.producao) {
    // O emulador em produção desviaria as gravações pra lugar nenhum.
    if (!vazio(env.FIRESTORE_EMULATOR_HOST)) erros.push("FIRESTORE_EMULATOR_HOST definido em produção");
    if (!vazio(env.NEXT_PUBLIC_FIREBASE_EMULADOR)) avisos.push("NEXT_PUBLIC_FIREBASE_EMULADOR definido em produção (ignorado no build de produção)");
  }

  if (vazio(env.NEXT_PUBLIC_FIREBASE_VAPID_KEY)) avisos.push("NEXT_PUBLIC_FIREBASE_VAPID_KEY ausente: push desligado");

  return { erros, avisos };
}
