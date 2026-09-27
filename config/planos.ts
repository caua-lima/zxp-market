/**
 * Catálogo de planos (S25) — VERSIONADO. Mudou limite ou plano? Suba `versao`
 * e registre no ADR (docs/saas/adr/0004-cobranca-stripe.md).
 *
 * NENHUM PREÇO AQUI, de propósito: o valor cobrado mora no Stripe (um Price
 * por plano). O código só conhece o ID do preço, lido da variável de ambiente
 * em `precoEnv`. Assim o app nunca inventa preço, e trocar preço não exige
 * deploy.
 *
 * ⚠ Os LIMITES abaixo são o ponto de partida técnico, não decisão comercial:
 * confirme antes de vender (OPERACAO.md, parte E).
 *
 * `null` = sem limite.
 */

export type IdDoPlano = "interno" | "trial" | "essencial" | "profissional";

export type Plano = {
  nome: string;
  /** Pessoas no time, contando o dono. */
  membros: number | null;
  /** Contas do Mercado Livre conectadas. */
  conexoes: number | null;
  /** Variável de ambiente com o ID do Price no Stripe. Ausente = não se vende pelo checkout. */
  precoEnv?: string;
};

export const CATALOGO = {
  versao: 1,
  /** Teste grátis de uma empresa nova, sem cartão. */
  trialDias: 14,
  /** Dias de acesso normal depois de uma cobrança falhar, enquanto o Stripe retenta. */
  carenciaDias: 7,
  planos: {
    // A operação que já existia (e empresas cadastradas à mão por script): sem cobrança pelo app.
    interno: { nome: "Interno", membros: null, conexoes: null },
    trial: { nome: "Teste grátis", membros: 3, conexoes: 1 },
    essencial: { nome: "Essencial", membros: 3, conexoes: 1, precoEnv: "STRIPE_PRICE_ESSENCIAL" },
    profissional: { nome: "Profissional", membros: 10, conexoes: 1, precoEnv: "STRIPE_PRICE_PROFISSIONAL" },
  } satisfies Record<IdDoPlano, Plano>,
} as const;
