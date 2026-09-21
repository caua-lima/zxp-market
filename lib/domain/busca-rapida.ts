/**
 * A busca rápida (Ctrl/Cmd+K): quais atalhos casam com o que foi digitado.
 *
 * Era `label.toLowerCase().includes(query.toLowerCase())`. Quem digita
 * "precificacao" (sem cedilha nem til, como se digita no celular e no teclado
 * de quem não troca de layout) não achava "Precificação" — a busca parecia
 * quebrada justamente pra quem ia direto pro teclado. Custos já ignorava acento
 * (`lib/domain/custos-lista`); a busca rápida não.
 *
 * Regras: sem acento, sem diferença de caixa, e várias palavras são E (todas
 * precisam aparecer, em qualquer ordem): "ads chat" acha "Chat de Ads". Quem
 * começa com o termo vem antes de quem só o contém no meio.
 */

function chave(s: unknown): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function filtrarComandos<T extends { label: string }>(itens: readonly T[], consulta: string): T[] {
  const termo = chave(consulta);
  if (!termo) return [...itens];
  const palavras = termo.split(/\s+/);

  const casados = itens.filter((it) => {
    const alvo = chave(it.label);
    return palavras.every((p) => alvo.includes(p));
  });

  // Estável: quem começa pelo termo sobe; o resto mantém a ordem original.
  const comeca = (it: T) => (chave(it.label).startsWith(palavras[0]) ? 0 : 1);
  return casados
    .map((it, i) => ({ it, i }))
    .sort((a, b) => comeca(a.it) - comeca(b.it) || a.i - b.i)
    .map((x) => x.it);
}
