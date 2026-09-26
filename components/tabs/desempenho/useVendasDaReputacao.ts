"use client";

import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/api/authed-fetch";
import { janelaDeDias } from "@/lib/domain/janela-dias";
import { janelaDaMedalha } from "@/lib/domain/mercadolider-metas";
import type { BlocoVendas, DiaDeVendas } from "@/lib/domain/reputacao-vendas";

export type Janela = { de: string; ate: string; dias: number };

export type VendasDaReputacao = {
  estado: "carregando" | "ok" | "falhou";
  /** Janela da medalha — 3 meses + mês vigente. */
  medalha: BlocoVendas | null;
  /** Janela da REPUTAÇÃO, no tamanho que o ML informa (60 ou 365 dias). */
  reputacao: BlocoVendas | null;
  /** Vendas por dia da janela da medalha — o que a projeção simula. */
  serie: DiaDeVendas[];
  janelaMedalha: Janela;
  janelaReputacao: Janela;
  /** Quando a resposta foi buscada no ML (ISO), pra a tela dizer de quando é o número. */
  buscadoEm: string | null;
};

type Resultado = Omit<VendasDaReputacao, "janelaMedalha" | "janelaReputacao"> & { chave: string };

/**
 * As vendas da aba Desempenho — UMA busca pros dois painéis (S10).
 *
 * Antes, o painel da reputação e o da medalha buscavam cada um a sua janela na
 * mesma rota, que guardava uma resposta só: um expulsava o outro, e cada
 * abertura da aba eram duas buscas ao vivo no ML. E o "⟳ Atualizar" da aba não
 * alcançava nenhuma das duas.
 *
 * Agora a aba busca uma vez o intervalo que cobre a janela da medalha e a da
 * reputação, a rota conta cada uma, e os dois painéis recebem o resultado.
 * `versao` sobe no "Atualizar": muda a chave e a busca vai com `fresh=1`.
 *
 * @param periodoDias a janela da reputação como o ML informa — ver
 *   periodoOficialDaReputacao. `null` = ainda não se sabe; não busca.
 */
export function useVendasDaReputacao(periodoDias: number | null, versao: number, hoje: string): VendasDaReputacao {
  const janelaMedalha = janelaDaMedalha(hoje);
  const janelaReputacao = janelaDeDias(periodoDias ?? 60);
  const de = janelaMedalha.de < janelaReputacao.de ? janelaMedalha.de : janelaReputacao.de;
  const ate = janelaMedalha.ate > janelaReputacao.ate ? janelaMedalha.ate : janelaReputacao.ate;
  const chave = periodoDias == null
    ? ""
    : `${de}|${ate}|${janelaMedalha.de}|${janelaReputacao.de}|${versao}`;

  const [resultado, setResultado] = useState<Resultado | null>(null);

  useEffect(() => {
    if (!chave) return;
    let vivo = true;
    const qs = new URLSearchParams({ from: de, to: ate });
    qs.append("janela", `medalha:${janelaMedalha.de}:${janelaMedalha.ate}`);
    qs.append("janela", `reputacao:${janelaReputacao.de}:${janelaReputacao.ate}`);
    if (versao > 0) qs.set("fresh", "1");

    authedFetch(`/api/ml/reputacao-vendas?${qs}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("falhou"))))
      .then((j) => {
        if (!vivo) return;
        const medalha = j?.janelas?.medalha?.bloco ?? null;
        const serie: DiaDeVendas[] = Array.isArray(j?.serie) ? j.serie : [];
        setResultado({
          chave,
          // Sem bloco é falta de resposta, não falta de venda — a tela diz isso.
          estado: j?.bloco ? "ok" : "falhou",
          medalha,
          reputacao: j?.janelas?.reputacao?.bloco ?? null,
          // A série vem do intervalo inteiro; a projeção é da janela da medalha.
          serie: serie.filter((d) => d.dia >= janelaMedalha.de && d.dia <= janelaMedalha.ate),
          buscadoEm: typeof j?.fonte?.fetchedAt === "string" ? j.fonte.fetchedAt : null,
        });
      })
      .catch(() => {
        if (!vivo) return;
        setResultado({ chave, estado: "falhou", medalha: null, reputacao: null, serie: [], buscadoEm: null });
      });
    return () => { vivo = false; };
    // A chave resume tudo que muda a busca.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  // Resultado de outra chave (período ou versão anterior) não vale: é "carregando".
  const atual = resultado && resultado.chave === chave ? resultado : null;
  return {
    estado: atual?.estado ?? "carregando",
    medalha: atual?.medalha ?? null,
    reputacao: atual?.reputacao ?? null,
    serie: atual?.serie ?? [],
    buscadoEm: atual?.buscadoEm ?? null,
    janelaMedalha,
    janelaReputacao,
  };
}
