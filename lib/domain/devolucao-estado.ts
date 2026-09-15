/**
 * Uma devolução ABERTA não é uma devolução concluída.
 *
 * ─── O QUE ACONTECIA ────────────────────────────────────────────────────
 *
 * A rota de métricas já decidia isso direito, com uma função local: só
 * reverte a venda quando a disputa fechou, porque um claim ainda em aberto
 * pode terminar sem devolução nenhuma.
 *
 * Mas a rota de Ads montava o mesmo conjunto assim:
 *
 *   if (String(r.tipo ?? "") === "devolucao") devolIds.add(doc.id);
 *
 * Só o TIPO. O `status` e o `stage` — gravados pelo sync justamente com o
 * comentário "sem isso não dá para saber se ela foi concluída antes de
 * descontar do lucro" — eram ignorados.
 *
 * O resultado não é só um número diferente: são DOIS números diferentes pro
 * mesmo pedido. Uma devolução em disputa saía do faturamento no Ads e
 * continuava valendo no Dashboard. E, no Ads, essa receita é o denominador do
 * ROAS — a campanha aparecia pior do que é enquanto a disputa corria, e o
 * ajuste seria feito em cima de um número que voltaria ao normal sozinho.
 *
 * Esta é a terceira vez nesta base que duas cópias da mesma regra divergem.
 * Por isso a regra saiu das rotas e veio pra cá.
 *
 * ─── A DATA DE RECONHECIMENTO ───────────────────────────────────────────
 *
 * A venda sai do faturamento quando a devolução se CONCLUI, não quando é
 * pedida. Enquanto está em aberto, a venda continua valendo e a devolução é
 * uma pendência a acompanhar — as duas coisas verdadeiras ao mesmo tempo.
 */

export type RegistroDevolucao = {
  tipo?: unknown;
  status?: unknown;
  stage?: unknown;
};

export type EstadoDevolucao = "nao_e_devolucao" | "em_andamento" | "concluida";

/**
 * Vocabulário de claim VIVA, em `status` ou em `stage`.
 *
 * Os dois campos entram na mesma busca porque o ML distribui a informação
 * entre eles: `status: "opened"` com `stage: "dispute"`, `status: "closed"`
 * com `stage: "recontact"`. Olhar só um deixa passar metade dos casos.
 */
const EM_ABERTO = /open|process|pending|progress|review|recontact|dispute|in_?mediation/;

export function ehDevolucao(r: RegistroDevolucao): boolean {
  const t = String(r?.tipo ?? "").trim().toLowerCase();
  return t === "devolucao" || t.includes("return") || t.includes("devol");
}

/**
 * Em que pé está esta devolução.
 *
 * Status vazio ou desconhecido conta como CONCLUÍDA — de propósito, e essa é
 * a escolha que já estava em produção na rota de métricas.
 *
 * A razão: registros antigos foram gravados antes de o sync guardar `status`,
 * e vieram do caminho baseado em CANCELAMENTO, em que a venda de fato já não
 * existia. Tratá-los como em andamento faria o faturamento histórico saltar
 * de repente. E um vocabulário novo do ML não pode fazer o app parar de
 * descontar devolução real.
 *
 * Note que isso não enfraquece a correção: os estados em aberto que o ML
 * realmente usa estão todos cobertos pela expressão acima, e é justamente
 * deles que vinha o desconto prematuro.
 */
export function estadoDaDevolucao(r: RegistroDevolucao): EstadoDevolucao {
  if (!ehDevolucao(r)) return "nao_e_devolucao";
  const texto = `${String(r?.status ?? "")} ${String(r?.stage ?? "")}`.toLowerCase();
  return EM_ABERTO.test(texto) ? "em_andamento" : "concluida";
}

/**
 * A devolução já reverteu a venda?
 *
 * É esta resposta que tira o pedido do faturamento e do lucro.
 */
export function devolucaoConcluida(r: RegistroDevolucao): boolean {
  return estadoDaDevolucao(r) === "concluida";
}

/**
 * Devolução pedida e ainda correndo — a venda continua valendo, mas há
 * pendência. Vale mostrar: é dinheiro que pode sair do mês.
 */
export function devolucaoEmAndamento(r: RegistroDevolucao): boolean {
  return estadoDaDevolucao(r) === "em_andamento";
}
