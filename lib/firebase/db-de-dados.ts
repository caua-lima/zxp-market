import type { Firestore } from "firebase-admin/firestore";
import { lerModoDeDados, traduzirCaminho, type ConfigDeDados } from "./caminhos";
import { tenantAtual } from "./contexto-tenant";

/**
 * O Firestore do servidor com os caminhos do dado da empresa já traduzidos
 * (Etapa 3). Todo acesso do servidor passa por `getAdminDb()`, então a virada
 * acontece AQUI, num ponto só, em vez de em cada uma das ~120 chamadas
 * `.collection(...)` espalhadas pelas rotas.
 *
 * Só `collection()` e `doc()` são interceptados — é por eles que todo caminho
 * nasce. Lote, transação, `getAll`, `recursiveDelete` recebem referências que
 * já nasceram no lugar certo. Com a chave desligada devolve o próprio `db`,
 * sem invólucro nenhum.
 *
 * A empresa é resolvida A CADA caminho, não ao criar o invólucro: vem do
 * contexto da requisição (contexto-tenant.ts) e, na falta dele, da empresa
 * padrão da chave (a operação de uma empresa só). Sem nenhuma das duas, falha
 * alto — gravar dado de empresa sem saber de qual empresa é o erro que não
 * pode acontecer em silêncio.
 */
export function empresaDaRequisicao(padrao = process.env.NEXT_PUBLIC_ZXP_TENANT_ID): ConfigDeDados {
  const tenantId = tenantAtual() ?? String(padrao ?? "").trim();
  if (!tenantId) throw new Error("dado de empresa acessado sem empresa: nenhum contexto de requisição e sem NEXT_PUBLIC_ZXP_TENANT_ID");
  return { modo: "tenant", tenantId };
}

export function comCaminhosDeDados(
  db: Firestore,
  cfg: ConfigDeDados | (() => ConfigDeDados) = lerModoDeDados() === "raiz" ? { modo: "raiz" } : empresaDaRequisicao,
): Firestore {
  if (typeof cfg !== "function" && cfg.modo === "raiz") return db;
  const resolver = typeof cfg === "function" ? cfg : () => cfg;
  return new Proxy(db, {
    get(alvo, prop) {
      if (prop === "collection") return (caminho: string) => alvo.collection(traduzirCaminho(caminho, resolver));
      if (prop === "doc") return (caminho: string) => alvo.doc(traduzirCaminho(caminho, resolver));
      const v = Reflect.get(alvo, prop, alvo);
      return typeof v === "function" ? v.bind(alvo) : v;
    },
  });
}
