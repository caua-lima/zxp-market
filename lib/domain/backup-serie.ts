/**
 * O formato do dump: como um documento do Firestore vira texto e volta.
 *
 * ─── POR QUE ISTO SAIU DE DENTRO DOS SCRIPTS ─────────────────────────────
 *
 * `serializar` vivia solta em backup-firestore.mjs e `desserializar` em
 * restore-firestore.mjs — as duas metades da mesma conversa, em arquivos
 * diferentes, sem nada garantindo que combinassem.
 *
 * E era a parte mais provável de estar errada, porque é a única que não dá
 * pra conferir olhando o resultado: um Timestamp mal serializado vira um mapa
 * de aparência inofensiva, e o erro só aparece meses depois, numa restauração
 * em que a data não filtra nada.
 *
 * Como par testável, a ida e a volta podem ser exercitadas sem Firestore,
 * sem rede e sem credencial — que é exatamente o que faltava pra afirmar
 * alguma coisa sobre o backup desta base.
 *
 * ─── O QUE AINDA NÃO ESTÁ VERIFICADO ─────────────────────────────────────
 *
 * Que o Firestore ACEITA de volta o que `desserializar` produz. Isso exige um
 * projeto de destino descartável. O que dá pra afirmar aqui é mais modesto e
 * ainda assim é o que quebra em silêncio: que a ida e a volta preservam o
 * valor, o tipo e a estrutura.
 */

/** O mínimo de um Timestamp do Firestore que interessa aqui. */
type ComoTimestamp = { toDate: () => Date };

/** O mínimo de uma DocumentReference. */
type ComoRef = { path: string; id: string };

export type ValorSerializado =
  | { __tipo: "timestamp"; iso: string }
  | { __tipo: "ref"; path: string }
  | { [k: string]: unknown }
  | unknown[]
  | string | number | boolean | null | undefined;

function ehTimestamp(v: unknown): v is ComoTimestamp {
  return !!v && typeof (v as ComoTimestamp).toDate === "function";
}

function ehRef(v: unknown): v is ComoRef {
  const r = v as ComoRef;
  return !!v && typeof r.path === "string" && typeof r.id === "string"
    && typeof (v as ComoTimestamp).toDate !== "function";
}

/**
 * Documento → texto.
 *
 * ─── A ORDEM DAS CHECAGENS É O QUE IMPORTA ───────────────────────────────
 *
 * Timestamp antes de referência, e as duas antes de "objeto qualquer": um
 * Timestamp É um objeto, e uma referência também. Testar `typeof === "object"`
 * primeiro transformaria os dois em mapas de campos internos — que é
 * exatamente o bug que este formato existe pra evitar.
 */
export function serializar(v: unknown): ValorSerializado {
  if (v === null || v === undefined) return v as null | undefined;
  if (ehTimestamp(v)) return { __tipo: "timestamp", iso: v.toDate().toISOString() };
  if (ehRef(v)) return { __tipo: "ref", path: v.path };
  if (Array.isArray(v)) return v.map(serializar);
  if (typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = serializar(x);
    return o;
  }
  return v as string | number | boolean;
}

/**
 * Texto → documento.
 *
 * `paraData` e `paraRef` são injetados porque este módulo não pode importar
 * `firebase-admin`: ele roda em teste, no navegador do editor e dentro de um
 * script Node, e só o último tem o SDK. Quem chama traz as duas fábricas.
 */
export function desserializar(
  v: unknown,
  fabricas: { paraData: (iso: string) => unknown; paraRef: (path: string) => unknown },
): unknown {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map((x) => desserializar(x, fabricas));
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (o.__tipo === "timestamp" && typeof o.iso === "string") return fabricas.paraData(o.iso);
    if (o.__tipo === "ref" && typeof o.path === "string") return fabricas.paraRef(o.path);
    const saida: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) saida[k] = desserializar(x, fabricas);
    return saida;
  }
  return v;
}

/**
 * Uma linha do arquivo `.jsonl`.
 *
 * Um documento por linha, e não um array JSON: um dump de dez mil documentos
 * cabe na memória de quem lê UMA linha por vez, e um arquivo truncado pela
 * metade ainda entrega as linhas que chegaram inteiras.
 */
export function linhaDoDump(caminho: string, dados: unknown): string {
  return JSON.stringify({ caminho, dados: serializar(dados) });
}

export function lerLinhaDoDump(
  linha: string,
  fabricas: { paraData: (iso: string) => unknown; paraRef: (path: string) => unknown },
): { caminho: string; dados: unknown } {
  const { caminho, dados } = JSON.parse(linha) as { caminho: string; dados: unknown };
  return { caminho, dados: desserializar(dados, fabricas) };
}
