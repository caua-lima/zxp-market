"use client";

import {
  type Firestore,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  where,
} from "firebase/firestore";
import type { CustoFaixa, EstoqueMovimento } from "@/lib/domain/types";
import { faixasAlteradas, reconstruirCusto } from "@/lib/domain/custo-medio";

/**
 * Tentativas antes de desistir — cobre concorrência real (várias pessoas
 * mexendo no mesmo produto ao mesmo tempo) sem virar loop infinito num bug
 * de outra natureza. Generoso de propósito: cada tentativa é barata (uma
 * query + uma transação pequena), e desistir cedo devolveria um erro pra
 * quem só teve azar na ordem de chegada.
 */
const RECOMPUTE_MAX_TENTATIVAS = 20;

class RecomputeConflitoDeVersao extends Error {
  constructor() { super("estoqueVersao mudou durante o recálculo — outra gravação concorrente venceu"); }
}

/**
 * Reconstrói quantidade, custo médio e faixas de um produto a partir do
 * LIVRO (`estoque_movimentos`) — com controle de concorrência otimista
 * (achado S13 da auditoria SaaS).
 *
 * `db` é injetado (em vez de vir de `getFirebase()`) pra esta função poder
 * rodar tanto no app (client SDK de verdade) quanto no teste de emulador
 * (`@firebase/rules-unit-testing`, que dá um Firestore compatível mas sem
 * depender de `window`).
 *
 * ─── POR QUE PRECISA DE UMA VERSÃO, E NÃO SÓ UMA TRANSAÇÃO ──────────────
 *
 * A varredura do livro (`getDocs` com `where`) não pode entrar numa
 * transação do SDK cliente: `Transaction.get()` só lê documento por
 * referência, não query (verificado no `.d.ts` do `@firebase/firestore`
 * instalado — o SDK Admin aceita, o de cliente não). Isso deixava DOIS
 * `addMovimento` concorrentes no MESMO produto correrem cada um sua própria
 * varredura e escrever por cima do outro: quem escrevesse por ÚLTIMO podia
 * ter varrido o livro ANTES do movimento do primeiro existir, e o agregado
 * (`qtdLocal`/`custoMedio`) ficava sem aquele movimento até o PRÓXIMO
 * recálculo qualquer o pegasse. Silencioso: o livro (fonte da verdade)
 * sempre tinha os dois movimentos, só o agregado (o que a tela mostra) que
 * podia ficar defasado.
 *
 * A saída: `estoqueVersao` no produto, incrementada a cada gravação daqui.
 * Lê a versão ANTES de varrer; grava dentro de uma transação que só aceita
 * se a versão não mudou nesse meio-tempo (a transação PROTEGE a leitura e a
 * escrita do documento do produto — isso o SDK cliente faz nativamente).
 * Mudou = outra gravação concorrente completou primeiro (possivelmente
 * incluindo um movimento que esta varredura ainda não via) — refaz a
 * varredura inteira do zero e tenta de novo, em vez de gravar um número que
 * já sabe estar potencialmente velho.
 */
export async function recomputeProdutoComVersao(
  db: Firestore,
  productId: string,
): Promise<{ faixasAlteradas: { desde: string; de: number; para: number }[] }> {
  const prodRef = doc(db, "estoque", productId);

  for (let tentativa = 1; tentativa <= RECOMPUTE_MAX_TENTATIVAS; tentativa++) {
    const prodSnapAntes = await getDoc(prodRef);
    const prodData = prodSnapAntes.data() as
      | { custo?: string | number; custoMedioFaixas?: CustoFaixa[]; estoqueVersao?: number }
      | undefined;
    const versaoAntes = Number(prodData?.estoqueVersao ?? 0);

    const snap = await getDocs(query(collection(db, "estoque_movimentos"), where("productId", "==", productId)));
    const movs = snap.docs.map((d) => d.data() as EstoqueMovimento);

    /**
     * O custo ANTERIOR ao livro é o `custo` manual do cadastro — nunca o
     * `custoMedio` atual, que é derivado do próprio livro. Usar o derivado
     * como ponto de partida faria a média se realimentar e subir sozinha a
     * cada recálculo.
     */
    const custoInicial = Number(String(prodData?.custo ?? "").replace(",", ".")) || 0;

    const { qtdLocal, custoMedio, faixas } = reconstruirCusto(movs, custoInicial);
    const mudancas = faixasAlteradas(prodData?.custoMedioFaixas, faixas);

    try {
      await runTransaction(db, async (tx) => {
        const atual = await tx.get(prodRef);
        const versaoAtual = Number((atual.data() as { estoqueVersao?: number } | undefined)?.estoqueVersao ?? 0);
        if (versaoAtual !== versaoAntes) {
          throw new RecomputeConflitoDeVersao();
        }
        tx.update(prodRef, {
          qtdLocal,
          custoMedio,
          custoMedioFaixas: faixas,
          estoqueVersao: versaoAtual + 1,
          /**
           * EST-02: o agregado está em dia com o livro.
           *
           * Gravar a movimentação e recalcular o produto são duas escritas
           * (a primeira, fora desta função). Se o recálculo falhar depois
           * disso, o livro tem o movimento e o produto fica com o número
           * antigo — quem chama marca `custoDesatualizado: true` nesse caso;
           * aqui, tendo chegado até a gravação, ele volta a `false`.
           */
          custoDesatualizado: false,
        });
      });
      // Quem chamou decide o que fazer com isso — corrigir movimento antigo
      // muda a margem de vendas já apuradas, e isso não pode acontecer em
      // silêncio.
      return { faixasAlteradas: mudancas };
    } catch (err) {
      if (err instanceof RecomputeConflitoDeVersao && tentativa < RECOMPUTE_MAX_TENTATIVAS) continue;
      throw err;
    }
  }
  throw new Error(`recomputeProdutoComVersao: ${RECOMPUTE_MAX_TENTATIVAS} tentativas concorrentes sem sucesso para ${productId}`);
}
