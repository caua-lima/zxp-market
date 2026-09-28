/**
 * Cadastro self-service de uma empresa (S24). Puro.
 *
 * O caminho: criar conta → confirmar o e-mail → dar nome à empresa e aceitar
 * os termos → a empresa nasce com a pessoa como DONA, em teste grátis → o
 * checklist de ativação leva até o primeiro número confiável.
 *
 * Fica atrás de uma chave (`ZXP_CADASTRO_ABERTO=1` no servidor e
 * `NEXT_PUBLIC_ZXP_CADASTRO_ABERTO=1` na tela) e só no modo empresa: sem ela,
 * empresa nova continua nascendo pelo script (scripts/criar-empresa.mjs).
 */

/** Versão dos termos aceitos no cadastro. Mudou o texto de /termos ou /privacidade? Suba a data. */
export const TERMOS_VERSAO = "2026-09-27";

export function validarNomeDaEmpresa(nome: unknown): { ok: true; nome: string } | { ok: false; erro: string } {
  const n = typeof nome === "string" ? nome.replace(/\s+/g, " ").trim() : "";
  if (n.length < 2) return { ok: false, erro: "Dê um nome à empresa (pelo menos 2 letras)." };
  if (n.length > 80) return { ok: false, erro: "Nome longo demais (até 80 caracteres)." };
  if (/[<>{}\\]/.test(n)) return { ok: false, erro: "O nome não pode ter < > { } ou \\." };
  return { ok: true, nome: n };
}

/**
 * O id da empresa no banco: o nome sem acento, em minúsculas, com hífen, e um
 * sufixo aleatório — dois clientes chamados "Loja do João" não colidem, e o id
 * não revela quantas empresas existem.
 */
export function idDaEmpresa(nome: string, sufixo: string): string {
  const base = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  const s = sufixo.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  return `${base || "empresa"}-${s}`;
}

export type PedidoDeCadastro = {
  email: string;
  emailVerificado: boolean;
  nome: unknown;
  termos: unknown;
  cadastroAberto: boolean;
  modoEmpresa: boolean;
  empresaAtual: string | null;
};

export type RecusaDoCadastro =
  | "cadastro_fechado"
  | "so_modo_empresa"
  | "email_nao_verificado"
  | "termos_nao_aceitos"
  | "nome_invalido"
  | "ja_tem_empresa";

/** Pode criar? A ordem das recusas é a que a tela precisa explicar primeiro. */
export function avaliarCadastro(p: PedidoDeCadastro): { ok: true; nome: string } | { ok: false; motivo: RecusaDoCadastro; detalhe?: string } {
  if (!p.cadastroAberto) return { ok: false, motivo: "cadastro_fechado" };
  if (!p.modoEmpresa) return { ok: false, motivo: "so_modo_empresa" };
  if (!p.emailVerificado) return { ok: false, motivo: "email_nao_verificado" };
  if (p.empresaAtual) return { ok: false, motivo: "ja_tem_empresa" };
  if (p.termos !== TERMOS_VERSAO) return { ok: false, motivo: "termos_nao_aceitos" };
  const n = validarNomeDaEmpresa(p.nome);
  if (!n.ok) return { ok: false, motivo: "nome_invalido", detalhe: n.erro };
  return { ok: true, nome: n.nome };
}
