/**
 * Pedaços da vigia da agenda do Full que o app e o servidor dividem: validar o
 * número do envio e escrever as datas por extenso no aviso.
 *
 * A leitura da agenda em si mora na extensão do Chrome
 * (extensao-vigia-full/leitura.js): a API pública do ML não mostra a agenda.
 */

/** Número do envio como o ML mostra (#80517703): só dígitos, 5 a 15. */
export function inboundValido(v: unknown): string | null {
  const s = String(v ?? "").trim().replace(/^#/, "");
  return /^\d{5,15}$/.test(s) ? s : null;
}

/** A data em texto curto pro aviso: "30/10" ou "30/10, 31/10 e 03/11". */
export function datasPorExtenso(datas: readonly string[]): string {
  const curtas = datas.slice(0, 4).map((d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`);
  const extra = datas.length > 4 ? ` (+${datas.length - 4})` : "";
  if (curtas.length <= 1) return (curtas[0] ?? "") + extra;
  return `${curtas.slice(0, -1).join(", ")} e ${curtas[curtas.length - 1]}${extra}`;
}
