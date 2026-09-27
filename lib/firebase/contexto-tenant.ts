import { AsyncLocalStorage } from "node:async_hooks";

/**
 * A empresa DESTA requisição — o passo pro segundo cliente.
 *
 * Com uma empresa só, a chave `NEXT_PUBLIC_ZXP_TENANT_ID` bastava. Com duas, a
 * empresa tem que vir de quem chama: o login (requireAccess resolve o
 * membership), o vendedor da notificação do ML (webhook), a empresa da
 * iteração (cron/worker). Ela fica guardada aqui pelo resto da requisição, e
 * `getAdminDb()` lê daqui ao montar cada caminho — as ~120 chamadas que
 * acessam o banco não precisam receber a empresa por parâmetro.
 *
 * `AsyncLocalStorage` é por cadeia assíncrona: duas requisições ao mesmo
 * tempo no mesmo processo não enxergam a empresa uma da outra (provado em
 * contexto-tenant.test.ts).
 */

const armazem = new AsyncLocalStorage<{ tenantId: string | null }>();

const ID_VALIDO = /^[a-z0-9-]{2,60}$/;

function validar(tenantId: string): string {
  if (!ID_VALIDO.test(tenantId)) throw new Error(`tenantId inválido: ${tenantId}`);
  return tenantId;
}

/** Roda `fn` dentro da empresa — cron e worker, uma empresa por vez. */
export function comTenant<T>(tenantId: string, fn: () => T): T {
  return armazem.run({ tenantId: validar(tenantId) }, fn);
}

/**
 * Entra na empresa pelo resto desta cadeia assíncrona.
 */
export function entrarNoTenant(tenantId: string): void {
  armazem.enterWith({ tenantId: validar(tenantId) });
}

/**
 * Abre o contexto da requisição e devolve como preenchê-lo depois.
 *
 * TEM que ser chamado na parte SÍNCRONA de uma função async, antes do primeiro
 * await. `enterWith` feito depois de um await, dentro da função, não chega a
 * quem fez `await` nela — a rota continuaria sem empresa depois do gate
 * (achado pelo teste). Aberto antes, o contexto é o de quem chamou; e o objeto
 * é mutável, então preenchê-lo depois vale pra rota inteira.
 */
export function abrirContextoDaRequisicao(): (tenantId: string) => void {
  const caixa: { tenantId: string | null } = { tenantId: null };
  armazem.enterWith(caixa);
  return (tenantId: string) => { caixa.tenantId = validar(tenantId); };
}

export function tenantAtual(): string | null {
  return armazem.getStore()?.tenantId ?? null;
}
