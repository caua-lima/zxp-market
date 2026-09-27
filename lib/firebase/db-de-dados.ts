import type { Firestore } from "firebase-admin/firestore";
import { lerConfigDeDados, traduzirCaminho, type ConfigDeDados } from "./caminhos";

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
 */
export function comCaminhosDeDados(db: Firestore, cfg: ConfigDeDados = lerConfigDeDados()): Firestore {
  if (cfg.modo === "raiz") return db;
  return new Proxy(db, {
    get(alvo, prop) {
      if (prop === "collection") return (caminho: string) => alvo.collection(traduzirCaminho(caminho, cfg));
      if (prop === "doc") return (caminho: string) => alvo.doc(traduzirCaminho(caminho, cfg));
      const v = Reflect.get(alvo, prop, alvo);
      return typeof v === "function" ? v.bind(alvo) : v;
    },
  });
}
