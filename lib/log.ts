import { requisicaoAtual, tenantAtual } from "@/lib/firebase/contexto-tenant";

/**
 * Log estruturado do servidor (S27).
 *
 * Uma linha JSON por evento, com a empresa e a requisição de onde veio — com
 * várias empresas, "o cron falhou" sem dizer de QUAL empresa não serve pra nada.
 * Na Vercel, cada linha vira um registro filtrável por `evento`, `tenantId` e
 * `requisicao`.
 *
 * Redação: o que parece segredo ou dado pessoal sai como "[redigido]" ANTES de
 * virar texto — pelo NOME do campo (token, senha, e-mail, telefone, endereço,
 * documento…) e pelo FORMATO do valor (Bearer, JWT, chave PEM, e-mail no meio
 * de uma mensagem de erro). O log da Vercel é lido por quem tem acesso ao
 * projeto, não só pelo dono dos dados; na dúvida, some.
 */

type Nivel = "info" | "warn" | "error";
type Campos = Record<string, unknown>;

const CAMPO_SENSIVEL =
  /token|secret|segredo|senha|password|authorization|cookie|private|credencial|credential|api[_-]?key|e-?mail|phone|telefone|celular|cpf|cnpj|documento|identification|address|endereco|endereço|receiver|billing|zip|cep|first_name|last_name|full_name|nome_completo/i;

const VALOR_SENSIVEL: [RegExp, string][] = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redigido]"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[chave redigida]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[jwt redigido]"],
  [/\bAPP_USR-[A-Za-z0-9-]+/g, "[token ML redigido]"],
  [/\b(sk|rk|whsec)_(test|live)?_?[A-Za-z0-9]{8,}/g, "[segredo redigido]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[e-mail redigido]"],
];

export function redigirTexto(texto: string): string {
  let s = texto;
  for (const [re, troca] of VALOR_SENSIVEL) s = s.replace(re, troca);
  return s;
}

type Limites = { profundidade: number; itens: number };
const LIMITES_DE_LOG: Limites = { profundidade: 4, itens: 20 };

/** Cópia redigida de qualquer valor. Profundidade limitada: log não é dump. */
export function redigir(valor: unknown, profundidade = 0, limites: Limites = LIMITES_DE_LOG): unknown {
  if (valor === null || valor === undefined) return valor;
  if (typeof valor === "string") return redigirTexto(valor);
  if (typeof valor === "number" || typeof valor === "boolean") return valor;
  if (valor instanceof Error) {
    return { nome: valor.name, mensagem: redigirTexto(valor.message) };
  }
  if (profundidade >= limites.profundidade) return "[…]";
  if (Array.isArray(valor)) return valor.slice(0, limites.itens).map((v) => redigir(v, profundidade + 1, limites));
  if (typeof valor === "object") {
    const saida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      saida[k] = CAMPO_SENSIVEL.test(k) ? "[redigido]" : redigir(v, profundidade + 1, limites);
    }
    return saida;
  }
  return String(valor);
}

/**
 * Resposta de diagnóstico sem dado pessoal (S27): mesma redação do log, sem o
 * corte de profundidade — o diagnóstico precisa da estrutura inteira do que o
 * ML devolveu (é pra isso que existe), só não do nome/endereço do comprador.
 */
export function semDadosPessoais(valor: unknown): unknown {
  return redigir(valor, 0, { profundidade: 14, itens: 200 });
}

export function linhaDeLog(nivel: Nivel, evento: string, campos: Campos = {}): string {
  return JSON.stringify({
    nivel,
    evento,
    tenantId: tenantAtual(),
    requisicao: requisicaoAtual(),
    ...(redigir(campos) as Campos),
    ts: new Date().toISOString(),
  });
}

function escrever(nivel: Nivel, evento: string, campos?: Campos) {
  const linha = linhaDeLog(nivel, evento, campos);
  if (nivel === "error") console.error(linha);
  else if (nivel === "warn") console.warn(linha);
  else console.info(linha);
}

export const log = {
  info: (evento: string, campos?: Campos) => escrever("info", evento, campos),
  warn: (evento: string, campos?: Campos) => escrever("warn", evento, campos),
  error: (evento: string, campos?: Campos) => escrever("error", evento, campos),
};
