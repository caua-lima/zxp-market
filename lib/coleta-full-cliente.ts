import { authedFetch } from "@/lib/api/authed-fetch";
import { carregarFonteDaColetaFull } from "@/lib/firebase/data";
import {
  JANELA_MAX_DIAS_FULL,
  montarColetaFull,
  type ColetaFull,
  type RemessaDaApi,
} from "@/lib/domain/coleta-full";

/**
 * A coleta pro Full de um período, do jeito que a DRE e o Dashboard a mostram.
 *
 * A BASE é o que está salvo no Firestore — custos digitados e baixas de estoque,
 * que já trazem a data da remessa. O Mercado Livre entra como complemento
 * (remessas recentes que ainda não têm baixa nem custo). Antes era o contrário:
 * sem o ML respondendo, ou com o período fora da janela dele, a linha sumia — e
 * o custo já digitado junto. Ver lib/domain/coleta-full.ts.
 *
 * Devolve `null` só quando NENHUMA das duas fontes respondeu (aí é "não
 * consegui carregar", e a tela diz isso em vez de mostrar R$ 0,00).
 */
export async function carregarColetaFull(
  periodo: { from: string; to: string },
  opcoes: { hoje: string; forcar?: boolean },
): Promise<ColetaFull | null> {
  const diasAte = Math.ceil((Date.parse(`${opcoes.hoje}T00:00:00Z`) - Date.parse(`${periodo.from}T00:00:00Z`)) / 86400000) + 1;
  const foraDaJanela = !Number.isFinite(diasAte) || diasAte > JANELA_MAX_DIAS_FULL;

  const buscarNoMl = async (): Promise<{ api: RemessaDaApi[] | null; motivo?: "fora_da_janela" | "falhou" }> => {
    if (foraDaJanela) return { api: null, motivo: "fora_da_janela" };
    try {
      const r = await authedFetch(
        `/api/ml/gestao-full?dias=${Math.max(diasAte, 1)}${opcoes.forcar ? "&forcar=1" : ""}`,
        { cache: "no-store" },
      );
      if (!r.ok) return { api: null, motivo: "falhou" };
      const j = (await r.json()) as { remessas?: RemessaDaApi[] };
      return { api: j.remessas ?? [] };
    } catch {
      return { api: null, motivo: "falhou" };
    }
  };

  const [fonte, ml] = await Promise.all([
    carregarFonteDaColetaFull(periodo).catch(() => null),
    buscarNoMl(),
  ]);

  if (!fonte && ml.motivo === "falhou") return null;
  return montarColetaFull({
    periodo,
    api: ml.api,
    motivoSemApi: ml.motivo,
    guardados: fonte?.guardados ?? [],
    baixas: fonte?.baixas ?? [],
  });
}
