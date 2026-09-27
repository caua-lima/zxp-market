import "server-only";
import { getAdminDb } from "@/lib/firebase/admin";
import { motivoRecusaDoCron } from "@/lib/api-auth";
import { lerModoDeDados } from "@/lib/firebase/caminhos";
import { comTenant, tenantAtual } from "@/lib/firebase/contexto-tenant";
import { empresaDaRequisicao } from "@/lib/firebase/db-de-dados";

/**
 * Rotinas agendadas (cron, worker) rodando UMA VEZ POR EMPRESA — segundo cliente.
 *
 * Modo raiz: roda uma vez, como sempre. Modo empresa: percorre `tenants/*` e
 * roda cada uma dentro do contexto dela (contexto-tenant.ts) — o sync da
 * empresa A busca a conta do ML DELA e grava no dado DELA. Uma empresa
 * falhando não derruba as outras: o erro fica no resultado dela.
 *
 * Sequencial de propósito: o orçamento de tempo da função é um só, e duas
 * empresas em paralelo dividiriam cota da API do ML e do Firestore sem aviso.
 * Com muitas empresas, o próximo passo é uma fila por empresa.
 */
export async function listarEmpresas(): Promise<string[]> {
  if (lerModoDeDados() === "raiz") return [];
  const refs = await getAdminDb().collection("tenants").listDocuments();
  return refs.map((r) => r.id).sort();
}

export type ResultadoDaEmpresa<T> = { tenantId: string | null; resultado?: T; erro?: string };

export async function paraCadaEmpresa<T>(fn: () => Promise<T>): Promise<ResultadoDaEmpresa<T>[]> {
  if (lerModoDeDados() === "raiz") return [{ tenantId: null, resultado: await fn() }];
  const saida: ResultadoDaEmpresa<T>[] = [];
  for (const tenantId of await listarEmpresas()) {
    try {
      saida.push({ tenantId, resultado: await comTenant(tenantId, fn) });
    } catch (err) {
      console.error(`[empresas] ${tenantId} falhou`, err);
      saida.push({ tenantId, erro: err instanceof Error ? err.message : String(err) });
    }
  }
  return saida;
}

/** Cabeçalho que leva a empresa numa chamada interna autenticada pelo segredo do cron. */
export const CABECALHO_EMPRESA = "x-zxp-tenant";

export function cabecalhoDaEmpresaAtual(): Record<string, string> {
  const t = tenantAtual();
  return t ? { [CABECALHO_EMPRESA]: t } : {};
}

/**
 * Uma rota agendada, uma vez por empresa.
 *
 * Chamada pelo agendador (segredo do cron) no modo empresa: roda o handler de
 * sempre dentro de cada empresa e junta as respostas. Qualquer outro caso —
 * modo raiz, ou um usuário logado disparando à mão — roda o handler direto
 * (o usuário já entra na empresa dele pelo gate).
 */
export function porEmpresa(handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (lerModoDeDados() === "raiz" || motivoRecusaDoCron(req) !== null) return handler(req);
    const resultados = await paraCadaEmpresa(async () => {
      const r = await handler(req.clone());
      return { status: r.status, corpo: (await r.json().catch(() => null)) as unknown };
    });
    const ok = resultados.every((x) => !x.erro && (x.resultado?.status ?? 500) < 400);
    return Response.json({ ok, empresas: resultados }, { status: ok ? 200 : 207 });
  };
}

/**
 * Onde está o time de quem usa o app, no servidor. Modo raiz: `controleAcesso`,
 * a lista única. Modo empresa: os membros DA EMPRESA DA REQUISIÇÃO — ler a
 * lista global ali trataria como "sem acesso" quem é da segunda empresa (e o
 * push dela seria suprimido em silêncio).
 */
export function caminhoDoTime(): string {
  if (lerModoDeDados() === "raiz") return "controleAcesso";
  const cfg = empresaDaRequisicao();
  return cfg.modo === "tenant" ? `tenants/${cfg.tenantId}/members` : "controleAcesso";
}
