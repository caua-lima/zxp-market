"use client";

import { useMemo } from "react";
import { fmtBRL } from "@/lib/domain/calc";
import { corMargem, num, STATUS_META, type LinhaAds, type Modo } from "./ads-types";
import { rotuloCampanha } from "@/lib/domain/ads-campaigns";
import { corDoRoas } from "@/lib/domain/ads-cores";
import { larguraDaBarra, seloDaDecisao } from "@/lib/domain/ads-decisao";
import {
  explicacaoInvestido, explicacaoLucro, explicacaoReceita, explicacaoRoas, explicacaoRoasObjetivo, explicacaoViaAds,
} from "./ads-explicacoes";
import { alternarOrdem, ariaSort, ordenarLinhas, type ColunaOrdenavel, type OrdemAds } from "@/lib/domain/ads-ordenacao";
import s from "./AdsTable.module.css";

/**
 * Visão analítica — uma linha por ANÚNCIO, com tudo que a decisão pede.
 *
 * ─── O QUE MUDOU NA LEITURA ─────────────────────────────────────────────
 *
 * Eram onze colunas em largura automática: o nome do produto invadia a coluna
 * do orçamento, cada número tinha uma cor (o investido vermelho, a receita
 * verde, a margem amarela) e a decisão era uma frase cinza igual em toda linha.
 * Nada se destacava, e o caso que pede ação se perdia no meio.
 *
 * Agora:
 *   · colunas de largura FIXA no computador — texto comprido corta com "…"
 *     (o inteiro fica no tooltip), nunca por cima do vizinho;
 *   · cor só onde ela quer dizer algo: ROAS contra o equilíbrio, lucro positivo
 *     ou negativo, a barra do "Via Ads" e o selo da decisão;
 *   · pares que se leem juntos na mesma célula: orçamento + meta de ROAS,
 *     lucro + margem;
 *   · a decisão vira um SELO de uma palavra (lib/domain/ads-decisao.ts), com a
 *     frase completa embaixo, menor — e a borda esquerda da linha na cor dela,
 *     pra achar o prejuízo de relance.
 *
 * O detalhe fino (impressões, CTR, CPC, ACOS, break-even) continua no tooltip
 * de cada número e no "Ver detalhes".
 *
 * ─── POR QUE A IDENTIDADE É A CAMPANHA ──────────────────────────────────
 *
 * O que se faz nesta tela é mexer em CAMPANHA — pausar, mudar orçamento,
 * ajustar ROAS objetivo. O produto e o MLB vêm embaixo, pra três anúncios da
 * mesma campanha não virarem três linhas idênticas.
 */

function StatusTag({ l }: { l: LinhaAds }) {
  const m = STATUS_META[l.i.status];
  // Anúncio que rodou em mais de uma campanha no período: a linha é do ANÚNCIO e
  // soma todas — dizer isso evita a leitura de que um dos números está errado.
  const varias = (l.i.campanhas?.length ?? 0) > 1;
  const detalheCampanhas = varias
    ? ` Este anúncio rodou em ${l.i.campanhas.length} campanhas no período: `
      + l.i.campanhas.map((c) => `${c.campaignName || c.campaignId || "sem campanha"} (${fmtBRL(c.cost)})`).join(", ")
      + ". O investimento desta linha é a soma; a lista por campanha mostra cada uma separada."
    : "";

  const tooltip = l.i.status === "config_indisponivel"
    ? `A campanha ${l.i.campaignId} deste anúncio existe e gastou, mas não apareceu na lista de campanhas do Mercado Ads — normalmente porque foi EXCLUÍDA ou arquivada depois de ter gasto no período. Por isso orçamento e ROAS alvo ficam vazios. Investimento, cliques e vendas continuam corretos.${detalheCampanhas}`
    : l.i.campaignId
      ? `Campanha: ${l.i.campaignName || l.i.campaignId}${l.i.mlStatus ? ` · catálogo: ${l.i.mlStatus}` : ""}${detalheCampanhas}`
      : `Não achamos a campanha deste anúncio na busca do Mercado Ads.${detalheCampanhas}`;

  return (
    <span className={s.status} title={tooltip} style={{ color: m.cor, background: m.bg }}>
      {m.label}{varias ? " ⧉" : ""}
    </span>
  );
}

/** Mesma escala de lerParticipacao (lib/domain/ads-participacao.ts): quanto maior a fatia paga, maior o tombo se a verba parar. */
function corParticipacao(pct: number): string {
  if (pct >= 70) return "var(--red)";
  if (pct >= 40) return "var(--warning)";
  return "var(--green)";
}

/** A frase da decisão — o "porquê" sob o selo. "Sem conclusão" é o próprio texto do getAdRecommendation. */
function textoDecisao(l: LinhaAds): string {
  if (l.reco.acao === "sem-dados") {
    if (!l.i.diretoDisponivel) return "Sem venda vinculada no período pra calcular a margem direta.";
    if (l.i.status === "sem_campanha") return "Campanha não encontrada.";
    return l.reco.label;
  }
  if (l.reco.acao === "escalar") return `Margem ${num(l.margemAtual ?? 0, 1)}% e ROAS ${num(l.r, 2)}x${l.breakEven != null ? `, acima do equilíbrio (${num(l.breakEven, 2)}x)` : ""}.`;
  if (l.breakEven != null) return `ROAS ${num(l.r, 2)}x ${l.abaixoDoBreakEven ? "abaixo" : "acima"} do equilíbrio de ${num(l.breakEven, 2)}x.`;
  return l.reco.label;
}

/**
 * Cabeçalho ordenável e acessível: `aria-sort` diz a ordem pro leitor de tela, e
 * o botão interno entra na tabulação e responde a Enter/Espaço. Fica fora do
 * componente — declarado no render, seria recriado a cada pintura.
 */
function ThOrdenavel({ col, titulo, children, className, ordem, onOrdenar }: {
  col: ColunaOrdenavel;
  titulo: string;
  children: React.ReactNode;
  className?: string;
  ordem: OrdemAds;
  onOrdenar: (col: ColunaOrdenavel) => void;
}) {
  const ativa = ordem.col === col;
  return (
    <th className={className} aria-sort={ariaSort(ordem, col)}>
      <button type="button" className={s.ordenar} data-ativa={ativa || undefined} onClick={() => onOrdenar(col)} title={titulo}>
        {children}{ativa ? (ordem.dir === 1 ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
}

export default function AdsTable({
  modo, linhas, onAbrirAnuncio, ordem, onOrdem,
}: {
  modo: Modo; linhas: LinhaAds[]; onAbrirAnuncio: (itemId: string) => void;
  /**
   * A ordem vem de FORA: o mesmo estado é mexido pelo seletor "Ordenar por" (que
   * existe também no celular, onde o cabeçalho some) e pelos botões do cabeçalho.
   */
  ordem: OrdemAds; onOrdem: (o: OrdemAds) => void;
}) {
  const pub = modo === "pub";
  const linhasOrdenadas = useMemo(() => ordenarLinhas(linhas, ordem), [linhas, ordem]);
  const alternar = (col: ColunaOrdenavel) => onOrdem(alternarOrdem(ordem, col));

  /** Alguma campanha tem meta abaixo do ROAS ideal? Só então a legenda aparece. */
  const temMetaCurta = linhasOrdenadas.some((l) => l.i.roasTarget > 0 && l.roasIdeal != null && l.i.roasTarget < l.roasIdeal);

  return (
    <div>
      <p className={s.dica}>
        Clique no cabeçalho pra ordenar (no celular, use &quot;Ordenar por&quot;). A borda colorida da linha é a decisão — vermelho pede ação.
        Toque na linha pra ver a conta por trás de cada número.
      </p>

      <div className="table-wrapper" style={{ border: "none" }}>
        <table className={`tbl-modern tbl-cards ${s.tabela}`}>
          <thead>
            <tr>
              <ThOrdenavel className={s.cCampanha} ordem={ordem} onOrdenar={alternar} col="campanha" titulo="Ordenar por campanha — agrupa os anúncios da mesma verba">Campanha</ThOrdenavel>
              <ThOrdenavel className={s.cVerba} ordem={ordem} onOrdenar={alternar} col="roasobj" titulo="Orçamento diário e ROAS objetivo que você configurou na campanha, no Mercado Ads. Ordena pela meta de ROAS.">Verba · meta</ThOrdenavel>
              <ThOrdenavel className={s.cInvestido} ordem={ordem} onOrdenar={alternar} col="investido" titulo="Quanto a campanha gastou com este anúncio no período.">Investido</ThOrdenavel>
              <th className={s.cReceita} title="Receita atribuída pelo Mercado Ads (clique direto + venda assistida) — a coluna 'Receita' do painel do ML.">Receita</th>
              <ThOrdenavel className={s.cRoas} ordem={ordem} onOrdenar={alternar} col="roas" titulo="ROAS do painel do Mercado Ads. A cor compara com o ROAS de equilíbrio deste anúncio.">ROAS</ThOrdenavel>
              <ThOrdenavel className={s.cLucro} ordem={ordem} onOrdenar={alternar} col="lucro" titulo="Lucro depois do gasto com Ads, e a margem sobre a receita.">Lucro · margem</ThOrdenavel>
              <ThOrdenavel className={s.cVia} ordem={ordem} onOrdenar={alternar} col="viaads" titulo="Quanto da venda o Mercado Ads ATRIBUI à campanha — o teto do que se perde ao pausar, não a previsão.">Via Ads</ThOrdenavel>
              <ThOrdenavel className={`${s.cDecisao} ${s.decisao}`} ordem={ordem} onOrdenar={alternar} col="decisao" titulo="Ordenar por impacto — pior primeiro">Decisão</ThOrdenavel>
              <th className={s.cAcao}><span className="sr-only">Detalhes</span></th>
            </tr>
          </thead>
          <tbody>
            {linhasOrdenadas.map((l) => {
              const metaAbaixoDoIdeal = l.i.roasTarget > 0 && l.roasIdeal != null && l.i.roasTarget < l.roasIdeal;
              const bateuAMeta = l.i.roasTarget > 0 && l.roasMlAds != null && l.roasMlAds >= l.i.roasTarget;
              const selo = seloDaDecisao(l.reco);
              const porque = textoDecisao(l);
              const titulo = l.i.title || l.i.itemId;
              return (
                <tr key={l.i.itemId} className={s.linha} data-tom={selo.tom} onClick={() => onAbrirAnuncio(l.i.itemId)}>
                  <td className={s.campanha}>
                    <span className={s.topo}>
                      <span className={s.nome} title={l.i.campaignName || l.i.campaignId || "Sem campanha"}>{rotuloCampanha(l.i.campaignName)}</span>
                      <StatusTag l={l} />
                    </span>
                    <span className={s.produto} title={titulo}>{titulo}</span>
                    <span className={s.mlb}>{l.i.itemId}</span>
                  </td>

                  {/* Orçamento e meta de ROAS: os dois números que se ajustam no ML, lidos juntos. O ⚠ marca meta
                      abaixo do ROAS que fecha a margem alvo — bater essa meta não basta. */}
                  <td data-label="Verba · meta">
                    <div className={s.celula}>
                    <span className={s.valor} style={{ color: l.i.dailyBudget > 0 ? undefined : "var(--muted)" }}>
                      {l.i.dailyBudget > 0 ? `${fmtBRL(l.i.dailyBudget)}/dia` : "—"}
                    </span>
                    <span
                      className={`${s.sub} ${s.ajuda} ${metaAbaixoDoIdeal ? s.alerta : bateuAMeta ? s.positivo : ""}`}
                      title={explicacaoRoasObjetivo(l)}
                    >
                      {l.i.roasTarget > 0 ? `meta ${num(l.i.roasTarget, 2)}x${metaAbaixoDoIdeal ? " ⚠" : ""}` : "sem meta"}
                    </span>
                    </div>
                  </td>

                  <td data-label="Investido" className={s.ajuda} title={explicacaoInvestido(l)}>
                    <div className={s.celula}>
                    <span className={s.valor}>{fmtBRL(l.i.cost)}</span>
                    </div>
                  </td>

                  <td data-label="Receita" className={s.ajuda} title={explicacaoReceita(l, pub)}>
                    <div className={s.celula}>
                    <span className={s.valor}>{fmtBRL(l.i.adSales)}</span>
                    </div>
                  </td>

                  {/* A cor sai do EQUILÍBRIO deste anúncio, não de um corte fixo: com margem fina, 3,2x já queima dinheiro. */}
                  <td data-label="ROAS" className={s.ajuda} title={explicacaoRoas(l, pub)}>
                    <div className={s.celula}>
                    <span className={s.valor} style={{ color: corDoRoas(l.roasMlAds, l.breakEven, l.roasIdeal).cor }}>
                      {l.roasMlAds != null ? `${num(l.roasMlAds, 2)}x` : "—"}
                      {l.abaixoDoBreakEven && <span title="Abaixo do ROAS de equilíbrio — este anúncio perde dinheiro."> ⚠</span>}
                    </span>
                    {l.breakEven != null && <span className={s.sub}>equilíbrio {num(l.breakEven, 2)}x</span>}
                    </div>
                  </td>

                  <td data-label="Lucro · margem" className={s.ajuda} title={explicacaoLucro(l)}>
                    <div className={s.celula}>
                    <span className={`${s.valor} ${l.lucroAtual == null ? "" : l.lucroAtual >= 0 ? s.positivo : s.negativo}`} style={l.lucroAtual == null ? { color: "var(--muted)" } : undefined}>
                      {l.lucroAtual != null ? fmtBRL(l.lucroAtual) : "—"}
                    </span>
                    <span className={s.sub} style={l.margemAtual != null && l.margemAtual < 0 ? { color: "var(--red-text)" } : l.margemAtual != null ? { color: corMargem(l.margemAtual) } : undefined}>
                      {l.margemAtual != null ? `margem ${num(l.margemAtual, 1)}%` : "sem margem"}
                    </span>
                    </div>
                  </td>

                  {/* Quanto da venda depende de verba: a barra mostra o tamanho, a cor o risco. */}
                  <td data-label="Via Ads" className={s.ajuda} title={explicacaoViaAds(l)}>
                    <div className={s.celula}>
                    {l.i.totalSales > 0 ? (
                      <>
                        <span className={s.valor}>{num(l.pctAds, 0)}%</span>
                        <span className={s.barra} aria-hidden><i style={{ width: `${larguraDaBarra(l.pctAds)}%`, background: corParticipacao(l.pctAds) }} /></span>
                      </>
                    ) : <span className={s.valor} style={{ color: "var(--muted)" }}>—</span>}
                    </div>
                  </td>

                  <td data-label="Decisão" className={s.decisao}>
                    <div className={s.celula}>
                    <span className={s.selo} data-tom={selo.tom}>{selo.rotulo}</span>
                    <span className={s.porque} title={porque}>{porque}</span>
                    </div>
                  </td>

                  <td data-cell="acoes" className={s.acao}>
                    <button
                      type="button" className={s.abrir} aria-label={`Ver detalhes de ${rotuloCampanha(l.i.campaignName)} · ${l.i.itemId}`} title="Ver detalhes"
                      onClick={(e) => { e.stopPropagation(); onAbrirAnuncio(l.i.itemId); }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className={s.legenda}>
        <b>ROAS</b> em verde está acima do equilíbrio do anúncio; em vermelho, perde dinheiro. Em <b>Via Ads</b>, a barra verde é
        abaixo de 40% e a vermelha a partir de 70% — quanto maior, mais a venda cai junto se a campanha parar.
        {temMetaCurta && (
          <> O <b style={{ color: "var(--warning)" }}>⚠</b> na <b>meta</b> marca ROAS objetivo configurado no ML abaixo do que fecha a sua margem alvo.</>
        )}
      </div>
    </div>
  );
}
