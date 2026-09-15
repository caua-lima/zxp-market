/**
 * Onde cada cabeçalho de grupo aparece na navegação.
 *
 * ─── POR QUE ISTO NÃO É UM `<section>` POR GRUPO ─────────────────────────
 *
 * O papel filtra os itens ANTES: um partner não vê Acesso, um member vê só o
 * Dashboard. Com uma seção fixa por grupo, sobrariam títulos vazios — e
 * "Administração" sem nada embaixo não é um detalhe estético: diz pra pessoa
 * que existe uma tela ali que ela não está conseguindo achar.
 *
 * Marcando a abertura no primeiro item de cada grupo, grupo sem item
 * simplesmente não existe na tela.
 */
export function marcarAberturaDeGrupo<T extends { grupo: string }>(itens: readonly T[]): (T & { abreGrupo: boolean })[] {
  return itens.map((item, i) => ({
    ...item,
    abreGrupo: i === 0 || itens[i - 1].grupo !== item.grupo,
  }));
}

/**
 * Os grupos que de fato aparecem, na ordem em que aparecem.
 *
 * Serve pra afirmar em teste o que a tela promete: nenhum cabeçalho sem item
 * embaixo, e nenhum grupo partido em dois pedaços — se a lista chegar fora de
 * ordem, o mesmo título apareceria duas vezes, e um grupo que aparece duas
 * vezes é pior que nenhum agrupamento.
 */
export function gruposVisiveis(itens: readonly { grupo: string }[]): string[] {
  const vistos: string[] = [];
  for (const i of itens) if (vistos[vistos.length - 1] !== i.grupo) vistos.push(i.grupo);
  return vistos;
}

/** Algum grupo foi partido em pedaços separados? */
export function grupoRepetido(itens: readonly { grupo: string }[]): boolean {
  const seq = gruposVisiveis(itens);
  return new Set(seq).size !== seq.length;
}
