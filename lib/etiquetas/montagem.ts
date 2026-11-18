/**
 * Do lote lido + o que o servidor resolveu → o que sai pra impressora e pra
 * lista de separação. Puro (sem `@/`), pra tela e teste usarem igual.
 *
 * Regras:
 *  · marca só envio PRONTO (todas as siglas conhecidas); pendente sai como veio;
 *  · sem lugar livre na etiqueta → original intacta + etiqueta auxiliar logo
 *    depois (nunca cobre o que o ML desenhou);
 *  · a ordem é a do arquivo (é a ordem da pilha na impressora).
 */

import type { EtiquetaZpl } from "./lote-zpl";
import { etiquetaAuxiliar, marcarEtiqueta } from "./marcacao";
import type { LinhaDaLista } from "./pdf";

export type ItemResolvido = { mlb: string | null; sku: string | null; titulo: string; quantidade: number };
export type EnvioResolvido = {
  envio: string;
  status: "ok" | "pendente" | "nao_encontrado";
  pedidos?: string[];
  itens: ItemResolvido[];
  porSigla?: { sigla: string; quantidade: number }[];
  texto?: string;
  motivo?: string;
};

export type EtiquetaDeSaida = {
  /** Estável entre renders (prévia em cache). */
  chave: string;
  /** Índice da etiqueta no arquivo original. */
  origem: number;
  tipo: "original" | "marcada" | "auxiliar";
  zpl: string;
  envio: string | null;
  texto: string | null;
  aviso: string | null;
};

function situacao(e: EtiquetaZpl, r: EnvioResolvido | undefined, duplicados: ReadonlySet<string>): { texto: string | null; aviso: string | null } {
  if (!e.envio) return { texto: null, aviso: e.problema ?? "envio não identificado" };
  const dup = duplicados.has(e.envio) ? "envio repetido no arquivo" : null;
  if (!r) return { texto: null, aviso: dup ?? "ainda sem consulta do envio" };
  if (r.status === "ok" && r.texto) return { texto: r.texto, aviso: dup };
  return { texto: null, aviso: [r.motivo ?? (r.status === "nao_encontrado" ? "envio não encontrado" : "pendente"), dup].filter(Boolean).join(" · ") };
}

export function montarSaida(
  etiquetas: readonly EtiquetaZpl[],
  resolvidos: ReadonlyMap<string, EnvioResolvido>,
  opcoes: { marcar: boolean; duplicados?: readonly string[] },
): EtiquetaDeSaida[] {
  const dups = new Set(opcoes.duplicados ?? []);
  const out: EtiquetaDeSaida[] = [];
  for (const e of etiquetas) {
    const { texto, aviso } = situacao(e, e.envio ? resolvidos.get(e.envio) : undefined, dups);
    const base = { origem: e.indice, envio: e.envio, texto };
    if (opcoes.marcar && texto) {
      const m = marcarEtiqueta(e.zpl, texto);
      if (m.ok) {
        out.push({ ...base, chave: `${e.indice}:m:${texto}`, tipo: "marcada", zpl: m.zpl, aviso });
        continue;
      }
      out.push({ ...base, chave: `${e.indice}:o`, tipo: "original", zpl: e.zpl, aviso: [aviso, `${m.motivo} — vai etiqueta auxiliar junto`].filter(Boolean).join(" · ") });
      out.push({ ...base, chave: `${e.indice}:a:${texto}`, tipo: "auxiliar", zpl: etiquetaAuxiliar(texto, e.envio ?? "", e.indice + 1), aviso: null });
      continue;
    }
    out.push({ ...base, chave: `${e.indice}:o`, tipo: "original", zpl: e.zpl, aviso });
  }
  return out;
}

/** Linhas da lista de separação, na ordem do arquivo. */
export function linhasDaLista(
  etiquetas: readonly EtiquetaZpl[],
  resolvidos: ReadonlyMap<string, EnvioResolvido>,
  duplicados: readonly string[] = [],
): LinhaDaLista[] {
  const dups = new Set(duplicados);
  return etiquetas.map((e) => {
    const r = e.envio ? resolvidos.get(e.envio) : undefined;
    const { texto, aviso } = situacao(e, r, dups);
    return {
      ordem: e.indice + 1,
      envio: e.envio,
      texto,
      itens: (r?.itens ?? []).map((i) => ({ titulo: i.titulo || i.mlb || "item", quantidade: i.quantidade, sku: i.sku })),
      problema: texto ? null : aviso,
    };
  });
}

/** O arquivo ZPL que vai pra impressora: as etiquetas de saída, uma após a outra. */
export function zplDeSaida(saida: readonly EtiquetaDeSaida[], prefixo = ""): string {
  return [prefixo.trim(), ...saida.map((s) => s.zpl.trim())].filter(Boolean).join("\n") + "\n";
}
