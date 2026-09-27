import "server-only";
import { getMlTokenData } from "@/app/api/ml/token";
import { lerModoDeDados } from "@/lib/firebase/caminhos";

/**
 * O vendedor da operação de uma empresa só — o valor que era fixo no código.
 * Função, não constante: lido a cada chamada, como a rota fazia antes.
 */
export function vendedorLegado(): string {
  return process.env.ML_SELLER_ID || "2420261535";
}

/**
 * O id do vendedor no Mercado Livre DA EMPRESA DESTA REQUISIÇÃO (segundo cliente).
 *
 * Era `SELLER_ID = process.env.ML_SELLER_ID || "2420261535"`, fixo, em uns 14
 * lugares: com duas empresas, o sync da segunda buscaria os pedidos da
 * primeira. O vendedor é o dono da conexão do ML, gravado no token quando o
 * OAuth completa (`user_id`); a conexão já é a da empresa da requisição
 * (getAdminDb traduz `ml_tokens/main` pra `tenants/{t}/connections/main`).
 *
 * Modo raiz: o de sempre (a conexão, e na falta dela o valor legado).
 * Modo empresa: a conexão OU erro — cair no vendedor legado buscaria a conta
 * de outra empresa.
 */
export async function sellerIdAtual(): Promise<string> {
  const doToken = String((await getMlTokenData())?.user_id ?? "").trim();
  if (doToken) return doToken;
  if (lerModoDeDados() === "raiz") return vendedorLegado();
  throw new Error("esta empresa ainda não conectou o Mercado Livre (sem user_id na conexão)");
}
