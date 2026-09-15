/**
 * O estado de CADA fonte de dado — porque "vazio" e "não carregou" não são a
 * mesma coisa.
 *
 * ─── O QUE A TELA MOSTRAVA ──────────────────────────────────────────────
 *
 * `useUserData` assina cinco coleções e marca `ready` quando todas respondem.
 * Como nenhuma delas chama `markReady` ao FALHAR, bastava uma ser recusada pra
 * a tela ficar carregando pra sempre — e por isso existe uma rede de
 * segurança que destrava depois de seis segundos.
 *
 * A rede resolve o travamento e cria outro problema: ela libera a tela com
 * `costs: []` e `products: []` nos valores INICIAIS. Quem consome não tem como
 * distinguir "não há custo cadastrado" de "a assinatura de custos foi negada".
 *
 * Isso não é hipotético. O papel `member` não enxerga `custos` nem `estoque`
 * pelas regras do Firestore — então, pra ele, DUAS fontes são negadas por
 * definição, e a tela dizia "nenhum custo cadastrado". A mesma coisa acontece
 * num estouro de cota do Firestore, que esta base já viveu: todo mundo veria
 * estoque vazio, e estoque vazio é uma frase forte.
 *
 * ─── A REGRA ────────────────────────────────────────────────────────────
 *
 * Cada fonte carrega o próprio estado. A tela continua utilizável com o que
 * chegou — uso parcial é melhor que espera infinita — mas o que não chegou é
 * dito, não fingido.
 */

export type SituacaoFonte = "carregando" | "carregada" | "sem_acesso" | "falhou";

export type EstadoFonte = {
  situacao: SituacaoFonte;
  /** Resumo curto do erro, quando houver. */
  erro?: string | null;
};

export const FONTE_CARREGANDO: EstadoFonte = { situacao: "carregando", erro: null };

export function fonteCarregada(): EstadoFonte {
  return { situacao: "carregada", erro: null };
}

/**
 * Traduz o erro do Firestore em situação.
 *
 * `permission-denied` é diferente de falha: não é um problema a resolver, é
 * uma resposta — aquele papel não alcança aquele dado. Dizer "não consegui
 * carregar" nesse caso seria alarme falso; dizer "sem acesso" é a verdade.
 */
export function fonteComErro(erro: unknown): EstadoFonte {
  const texto = (erro instanceof Error ? erro.message : String(erro ?? "")).toLowerCase();
  const semAcesso = texto.includes("permission-denied")
    || texto.includes("permission_denied")
    || texto.includes("missing or insufficient permissions");

  return {
    situacao: semAcesso ? "sem_acesso" : "falhou",
    erro: (erro instanceof Error ? erro.message : String(erro ?? "erro")).slice(0, 200),
  };
}

/**
 * A fonte respondeu de verdade?
 *
 * É esta pergunta que separa "a lista está vazia" de "a lista está vazia
 * porque eu não consegui olhar". Só `carregada` autoriza a tela a afirmar
 * "não há nada cadastrado".
 */
export function podeAfirmarVazio(e: EstadoFonte | undefined): boolean {
  return e?.situacao === "carregada";
}

/** Texto pra tela, no lugar de uma lista vazia mentirosa. */
export function explicarFonte(e: EstadoFonte | undefined, nome: string): string | null {
  switch (e?.situacao) {
    case "carregando":
      return `Carregando ${nome}…`;
    case "sem_acesso":
      return `Você não tem acesso a ${nome}.`;
    case "falhou":
      return `Não consegui carregar ${nome}. O que aparece abaixo pode estar incompleto.`;
    default:
      return null;
  }
}

/**
 * Quantas fontes não chegaram — pra o cabeçalho poder dizer que a tela está
 * parcial em vez de deixar o usuário concluir sozinho que está tudo certo.
 */
export function fontesIncompletas(estados: Record<string, EstadoFonte>): string[] {
  return Object.entries(estados)
    .filter(([, e]) => e.situacao === "falhou" || e.situacao === "carregando")
    .map(([nome]) => nome);
}
