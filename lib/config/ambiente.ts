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
  // Cobrança (S25) — sem as duas primeiras, a cobrança fica desligada.
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_ESSENCIAL",
  "STRIPE_PRICE_PROFISSIONAL",
  "ZXP_COBRANCA_LIVE",
  "APP_URL",
  // Cadastro self-service de empresa (S24) — a mesma chave na tela e no servidor.
  "ZXP_CADASTRO_ABERTO",
  "NEXT_PUBLIC_ZXP_CADASTRO_ABERTO",
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

  // Cobrança (S25).
  const chaveStripe = env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (chaveStripe && vazio(env.STRIPE_WEBHOOK_SECRET)) erros.push("STRIPE_SECRET_KEY sem STRIPE_WEBHOOK_SECRET: a cobrança fica desligada");
  if (!chaveStripe && !vazio(env.STRIPE_WEBHOOK_SECRET)) erros.push("STRIPE_WEBHOOK_SECRET sem STRIPE_SECRET_KEY: a cobrança fica desligada");
  if (chaveStripe && !/^(sk|rk)_(test|live)_/.test(chaveStripe)) erros.push("STRIPE_SECRET_KEY não parece uma chave secreta do Stripe (sk_test_…)");
  if (chaveStripe.startsWith("sk_live_") && env.ZXP_COBRANCA_LIVE !== "autorizado") {
    erros.push("STRIPE_SECRET_KEY é de PRODUÇÃO (sk_live_) sem ZXP_COBRANCA_LIVE=autorizado: a cobrança fica desligada");
  }
  if (!vazio(env.STRIPE_WEBHOOK_SECRET) && !env.STRIPE_WEBHOOK_SECRET!.trim().startsWith("whsec_")) erros.push("STRIPE_WEBHOOK_SECRET não parece um segredo de webhook (whsec_…)");
  if (chaveStripe) {
    for (const p of ["STRIPE_PRICE_ESSENCIAL", "STRIPE_PRICE_PROFISSIONAL"]) {
      const v = env[p]?.trim();
      if (v && !v.startsWith("price_")) erros.push(`${p} não parece um ID de preço do Stripe (price_…)`);
    }
    if (vazio(env.STRIPE_PRICE_ESSENCIAL) && vazio(env.STRIPE_PRICE_PROFISSIONAL)) avisos.push("cobrança ligada sem nenhum STRIPE_PRICE_*: nenhum plano aparece pra assinar");
    if (opcoes.producao && vazio(env.APP_URL)) erros.push("APP_URL ausente: o checkout e o portal não sabem pra onde voltar");
    if (modo !== "tenant") avisos.push("cobrança configurada no modo raiz: só vale no modo empresa");
  }
  // Cadastro self-service (S24).
  const cadastroServidor = env.ZXP_CADASTRO_ABERTO?.trim() === "1";
  const cadastroTela = env.NEXT_PUBLIC_ZXP_CADASTRO_ABERTO?.trim() === "1";
  if (cadastroServidor !== cadastroTela) erros.push("ZXP_CADASTRO_ABERTO e NEXT_PUBLIC_ZXP_CADASTRO_ABERTO diferentes: a tela e o servidor discordam sobre o cadastro");
  if ((cadastroServidor || cadastroTela) && modo !== "tenant") erros.push("cadastro aberto fora do modo empresa: não tem efeito");
  if (cadastroServidor && !chaveStripe) avisos.push("cadastro aberto sem cobrança: o teste grátis das empresas novas acaba em somente leitura, sem como assinar");

  if (!vazio(env.APP_URL)) {
    try { if (opcoes.producao && new URL(env.APP_URL!).protocol !== "https:") erros.push("APP_URL precisa ser https em produção"); }
    catch { erros.push("APP_URL não é uma URL"); }
  }

  return { erros, avisos };
}
