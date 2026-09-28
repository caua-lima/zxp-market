/**
 * Checklist de ativação de uma empresa nova (S24): do cadastro até o primeiro
 * resultado confiável. Puro — a tela junta os sinais e mostra.
 *
 * "Confiável" tem ordem: sem a conta do ML não há venda; sem a primeira
 * sincronização não há número; sem CUSTO nos produtos o lucro é fantasia (o
 * painel mostraria margem de 100%). Por isso "produtos com custo" vem antes de
 * meta e de time.
 */

export type SinaisDeAtivacao = {
  mlConectado: boolean;
  /** Pedidos já gravados na empresa. */
  pedidosImportados: number;
  /** A primeira sincronização terminou (mesmo que com zero pedidos). */
  primeiraSincronizacao: boolean;
  produtos: number;
  produtosComCusto: number;
  custosCadastrados: number;
  temMeta: boolean;
  pessoasNoTime: number;
};

export type IdDoPasso = "conectar_ml" | "sincronizar" | "custos_dos_produtos" | "custos_fixos" | "meta" | "time";

export type Passo = {
  id: IdDoPasso;
  titulo: string;
  detalhe: string;
  feito: boolean;
  /** Pra onde o botão leva. */
  aba: string;
  acao: string;
};

export function passosDeAtivacao(s: SinaisDeAtivacao): Passo[] {
  const semCusto = Math.max(0, s.produtos - s.produtosComCusto);
  return [
    {
      id: "conectar_ml",
      titulo: "Conectar a conta do Mercado Livre",
      detalhe: "É de lá que vêm as vendas. A autorização é feita no site do Mercado Livre.",
      feito: s.mlConectado,
      aba: "dashboard",
      acao: "Conectar",
    },
    {
      id: "sincronizar",
      titulo: "Importar as vendas",
      detalhe: !s.mlConectado
        ? "Começa sozinho depois de conectar."
        : s.primeiraSincronizacao
          ? `${s.pedidosImportados} pedido(s) importado(s).`
          : "Importando os pedidos dos últimos dois meses — pode levar alguns minutos.",
      feito: s.mlConectado && s.primeiraSincronizacao,
      aba: "pedidos",
      acao: "Ver pedidos",
    },
    {
      id: "custos_dos_produtos",
      titulo: "Informar o custo dos produtos",
      detalhe: s.produtos === 0
        ? "Cadastre os produtos com o custo de cada um — sem isso o lucro não existe."
        : semCusto > 0
          ? `${semCusto} produto(s) ainda sem custo: o lucro deles aparece inflado.`
          : "Todos os produtos têm custo.",
      feito: s.produtos > 0 && semCusto === 0,
      aba: "estoque",
      acao: "Abrir estoque",
    },
    {
      id: "custos_fixos",
      titulo: "Lançar os custos fixos",
      detalhe: "Aluguel, ferramentas, salários — o que sai todo mês, venda ou não venda.",
      feito: s.custosCadastrados > 0,
      aba: "custos",
      acao: "Abrir custos",
    },
    {
      id: "meta",
      titulo: "Definir a meta do mês",
      detalhe: "O painel passa a mostrar quanto falta e o ritmo pra chegar lá.",
      feito: s.temMeta,
      aba: "metas",
      acao: "Abrir metas",
    },
    {
      id: "time",
      titulo: "Convidar o time",
      detalhe: "Cada pessoa com o próprio login e só as telas que precisa.",
      feito: s.pessoasNoTime > 1,
      aba: "acesso",
      acao: "Abrir acesso",
    },
  ];
}

/** Quanto falta, e se o painel já mostra um número confiável (os três primeiros passos). */
export function resumoDaAtivacao(passos: Passo[]): { feitos: number; total: number; confiavel: boolean; completo: boolean } {
  const feitos = passos.filter((p) => p.feito).length;
  const essenciais: IdDoPasso[] = ["conectar_ml", "sincronizar", "custos_dos_produtos"];
  return {
    feitos,
    total: passos.length,
    confiavel: essenciais.every((id) => passos.find((p) => p.id === id)?.feito),
    completo: feitos === passos.length,
  };
}
