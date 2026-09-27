"use client";

import { useState } from "react";
import type { Pagina } from "@/lib/firebase/paginas";

type Estado<T> = { para: T[]; extras: T[]; temMais: boolean };

/**
 * "Carregar mais antigos" sobre uma lista cuja primeira página vem de outro
 * lugar (o cache compartilhado de watchMovimentos/watchTasks) — S22.
 *
 * As páginas extras valem para UMA primeira página. Se ela é relida (alguém
 * lançou algo novo), a fronteira anda: o item que era o último da primeira
 * página desce pra fora dela, e as extras — que começavam DEPOIS dele — o
 * deixariam num buraco. Então primeira página nova descarta as extras; clicar
 * de novo continua da fronteira nova. Sem setState em efeito: o estado guarda
 * pra qual primeira página ele vale.
 */
export function useMaisAntigos<T extends { id: string }>(
  primeira: T[],
  truncado: boolean,
  valorDoCursor: (item: T) => string | number | undefined,
  carregar: (ultimo: { id: string; valor: string | number }) => Promise<Pagina<T>>,
) {
  const [estado, setEstado] = useState<Estado<T> | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(false);

  const valido = estado && estado.para === primeira ? estado : null;
  const extras = valido?.extras ?? [];
  const temMais = valido ? valido.temMais : truncado;

  const vistos = new Set(primeira.map((i) => i.id));
  const itens = [...primeira, ...extras.filter((i) => !vistos.has(i.id))];

  async function carregarMais() {
    const ultimo = itens[itens.length - 1];
    const valor = ultimo ? valorDoCursor(ultimo) : undefined;
    if (!ultimo || valor === undefined || carregando) return;
    setCarregando(true);
    setErro(false);
    try {
      const pagina = await carregar({ id: ultimo.id, valor });
      setEstado({ para: primeira, extras: [...extras, ...pagina.itens], temMais: pagina.temMais });
    } catch {
      // Falhar não esconde o botão: o aviso segue dizendo que há mais.
      setErro(true);
    } finally {
      setCarregando(false);
    }
  }

  return { itens, temMais, carregando, erro, carregarMais, extras: extras.length };
}
