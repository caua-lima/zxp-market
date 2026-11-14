/**
 * Siglas de separação: o que vai escrito na etiqueta pra saber o que pôr no
 * pacote sem abrir o pedido.
 *
 * Regra do dono (13/11/2026): `TT` = Trot's Tradicional; `2TT` = duas
 * unidades FÍSICAS desse produto. Uma unidade sai só `TT` (como ele já marca
 * à mão: "S" pro Sertanejo).
 *
 * ─── KIT ────────────────────────────────────────────────────────────────
 *
 * Kit com composição cadastrada se expande nos componentes: 1 kit de 2 TT →
 * `2TT`; 2 kits → `4TT`; kit misto → cada componente. Produto marcado como kit
 * SEM composição fica PENDENTE — não vira "1 unidade" por padrão, que é o erro
 * que manda o pacote incompleto. Produto que já sai montado (o kit Sertanejo
 * vem fechado do fornecedor) é cadastrado como unitário, com a sua sigla.
 *
 * A composição nunca é deduzida de número no título ("Kit 5 Erva…").
 *
 * Puro e autossuficiente (sem `@/`).
 */

export type ComponenteKit = { sigla: string; quantidade: number };

export type SiglaDoProduto = {
  produtoId: string;
  /** Nome pra lista de separação ("Trot's Tradicional"). */
  nome: string;
  sigla: string;
  /** SKUs que levam a este produto (atual e anteriores). */
  skus: string[];
  /** MLBs dos anúncios deste produto. */
  mlbs: string[];
  /** Presente = é kit e se expande nisto. `[]` = kit SEM composição (pendente). Ausente = unitário. */
  componentes?: ComponenteKit[];
};

/** Um item vendido dentro de um envio. */
export type ItemDoEnvio = { sku?: string | null; mlb?: string | null; titulo?: string; quantidade: number };

export type ResultadoDoEnvio =
  | { ok: true; porSigla: { sigla: string; quantidade: number }[]; texto: string }
  | { ok: false; motivo: string; pendentes: ItemDoEnvio[] };

export const SIGLA_VALIDA = /^[A-Z0-9]{1,4}$/;

const normSku = (s: unknown) => String(s ?? "").trim().toLowerCase();
const normMlb = (s: unknown) => String(s ?? "").trim().toUpperCase().replace(/^MLB/, "");

/** Sigla escrita como o dono escreveria: maiúscula, sem espaço nem símbolo. */
export function normalizarSigla(s: unknown): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Confere o cadastro: sigla válida e única entre produtos FISICAMENTE
 * diferentes. Duas linhas do mesmo produto (Full e Agências) podem — e devem —
 * dividir a sigla: é o mesmo pacote na prateleira.
 */
export function conferirCadastro(lista: readonly SiglaDoProduto[]): string[] {
  const erros: string[] = [];
  const dono = new Map<string, string>();
  for (const p of lista) {
    if (!SIGLA_VALIDA.test(p.sigla)) erros.push(`${p.nome}: sigla "${p.sigla}" inválida (1 a 4 letras/números, maiúsculas).`);
    const nomeBase = p.nome.replace(/\s*ag[eê]ncias?\s*$/i, "").trim().toLowerCase();
    const outro = dono.get(p.sigla);
    if (outro != null && outro !== nomeBase) erros.push(`Sigla "${p.sigla}" usada por dois produtos diferentes.`);
    else dono.set(p.sigla, nomeBase);
    for (const c of p.componentes ?? []) {
      if (!SIGLA_VALIDA.test(c.sigla) || !(c.quantidade > 0) || !Number.isInteger(c.quantidade)) {
        erros.push(`${p.nome}: componente do kit inválido (${c.sigla} × ${c.quantidade}).`);
      }
    }
  }
  return erros;
}

/** Acha o produto de um item: pelo MLB do anúncio primeiro (como o Dash liga a venda), depois pelo SKU. */
export function produtoDoItem(item: ItemDoEnvio, lista: readonly SiglaDoProduto[]): SiglaDoProduto | null {
  const mlb = normMlb(item.mlb);
  if (mlb) {
    const porMlb = lista.find((p) => p.mlbs.some((m) => normMlb(m) === mlb));
    if (porMlb) return porMlb;
  }
  const sku = normSku(item.sku);
  if (sku) {
    const porSku = lista.find((p) => p.skus.some((s) => normSku(s) === sku));
    if (porSku) return porSku;
  }
  return null;
}

/** Texto da marcação: `TT`, `2TT`, `2TT + BM`. Ordem estável (a do primeiro aparecimento). */
export function textoDaMarcacao(porSigla: readonly { sigla: string; quantidade: number }[]): string {
  return porSigla.map((x) => `${x.quantidade > 1 ? x.quantidade : ""}${x.sigla}`).join(" + ");
}

/**
 * Do que foi vendido no envio às unidades físicas por sigla. Qualquer item sem
 * produto, sem sigla ou kit sem composição deixa o envio PENDENTE inteiro —
 * marcação pela metade manda pacote errado.
 */
export function siglasDoEnvio(itens: readonly ItemDoEnvio[], lista: readonly SiglaDoProduto[]): ResultadoDoEnvio {
  if (!itens.length) return { ok: false, motivo: "envio sem itens", pendentes: [] };
  const soma = new Map<string, number>();
  const pendentes: ItemDoEnvio[] = [];
  let motivo = "";
  for (const item of itens) {
    const q = Number(item.quantidade);
    if (!Number.isInteger(q) || q <= 0) { pendentes.push(item); motivo ||= "quantidade inválida"; continue; }
    const p = produtoDoItem(item, lista);
    if (!p) { pendentes.push(item); motivo ||= "produto sem cadastro de sigla"; continue; }
    if (p.componentes) {
      if (p.componentes.length === 0) { pendentes.push(item); motivo ||= `${p.nome} é kit sem composição cadastrada`; continue; }
      for (const c of p.componentes) soma.set(c.sigla, (soma.get(c.sigla) ?? 0) + c.quantidade * q);
      continue;
    }
    soma.set(p.sigla, (soma.get(p.sigla) ?? 0) + q);
  }
  if (pendentes.length) return { ok: false, motivo, pendentes };
  const porSigla = [...soma].map(([sigla, quantidade]) => ({ sigla, quantidade }));
  return { ok: true, porSigla, texto: textoDaMarcacao(porSigla) };
}

/** Lista de separação: soma das unidades físicas por sigla em vários envios. */
export function totaisPorSigla(envios: readonly { porSigla: readonly { sigla: string; quantidade: number }[] }[]): Map<string, number> {
  const t = new Map<string, number>();
  for (const e of envios) for (const x of e.porSigla) t.set(x.sigla, (t.get(x.sigla) ?? 0) + x.quantidade);
  return t;
}
