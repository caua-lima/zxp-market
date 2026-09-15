"use client";

import { useMemo, useState } from "react";
import { fmtBRL } from "@/lib/domain/calc";
import { rotuloCampanha } from "@/lib/domain/ads-campaigns";
import { corAcos, corMargem, num, STATUS_META, type LinhaAds, type Modo } from "./ads-types";
import { chaveOrdenacao, corDoRoas } from "@/lib/domain/ads-cores";

/**
 * Visão analítica — uma linha por ANÚNCIO, com tudo que a decisão pede.
 *
 * ─── UM MODO SÓ, E É O COMPACTO ─────────────────────────────────────────
 *
 * Isto já foi 19 colunas em rolagem horizontal, depois virou 9 colunas com
 * uma segunda linha em cada célula e um alternador Confortável/Compacta.
 *
 * O alternador saiu. Duas densidades significavam dois lugares onde um dado
 * podia estar, e o que estava só na segunda linha sumia justamente na
 * Compacta — que é o modo em que se compara anúncio com anúncio. Um dado que
 * some no modo em que se decide não está ali de verdade.
 *
 * Agora cada número que importa tem COLUNA PRÓPRIA. Uma linha por anúncio,
 * um número por coluna, nada escondido atrás de um botão. O detalhe fino
 * (impressões, CTR, CPC, ACOS, break-even, lucro no ROAS ideal) mora no
 * tooltip de cada célula e no drawer de "Ver detalhes" — lugar de consulta,
 * não de comparação.
 *
 * A exceção é a primeira coluna: ali a segunda linha é IDENTIDADE, não
 * métrica. Sem o produto e o MLB, três anúncios da mesma campanha viram três
 * linhas idênticas e não dá pra saber em qual se está mexendo.
 *
 * ─── POR QUE A IDENTIDADE É A CAMPANHA ──────────────────────────────────
 *
 * A coluna era o título do produto. Mas o que se faz nesta tela é mexer em
 * CAMPANHA — pausar, mudar orçamento, ajustar ROAS objetivo. Ler nome de
 * produto e agir em campanha obriga a traduzir de cabeça linha por linha.
 */

type ColunaOrdenavel =
  | "campanha" | "investido" | "lucro" | "roas" | "roasobj" | "margem" | "viaads" | "decisao";

function StatusTag({ l }: { l: LinhaAds }) {
  const m = STATUS_META[l.i.status];
  // Anúncio que rodou em mais de uma campanha no período: o gasto de cada uma
  // aparece separado na "Performance por campanha", mas a linha da tabela é do
  // ANÚNCIO e soma todas — dizer isso evita a leitura de que um dos dois está
  // errado (ver AdItemFull.campanhas em lib/ml/ads.ts).
  const varias = (l.i.campanhas?.length ?? 0) > 1;
  const detalheCampanhas = varias
    ? ` Este anúncio rodou em ${l.i.campanhas.length} campanhas no período: `
      + l.i.campanhas.map((c) => `${c.campaignName || c.campaignId || "sem campanha"} (${fmtBRL(c.cost)})`).join(", ")
      + ". O investimento desta linha é a soma das duas; a lista por campanha mostra cada uma separada."
    : "";

  const tooltip = l.i.status === "config_indisponivel"
    ? `A campanha ${l.i.campaignId} deste anúncio existe e gastou, mas não apareceu na lista de campanhas do Mercado Ads — normalmente porque ela foi EXCLUÍDA ou arquivada depois de ter gasto no período. Por isso orçamento e ROAS alvo ficam vazios. Investimento, cliques e vendas continuam corretos.${detalheCampanhas}`
    : l.i.campaignId
      ? `Campanha: ${l.i.campaignName || l.i.campaignId}${l.i.mlStatus ? ` · catálogo: ${l.i.mlStatus}` : ""}${detalheCampanhas}`
      : `Não achamos a campanha deste anúncio na busca do Mercado Ads.${detalheCampanhas}`;

  return (
    <span title={tooltip} style={{ fontSize: ".75rem", fontWeight: 700, color: m.cor, background: m.bg, padding: "1px 6px", borderRadius: 5, whiteSpace: "nowrap", cursor: "help" }}>
      {m.label}{varias ? " ⧉" : ""}
    </span>
  );
}

/**
 * Mesma escala de lerParticipacao (lib/domain/ads-participacao.ts): quanto
 * maior a fatia que depende de verba, maior o risco se ela parar.
 */
function corParticipacao(pct: number): string {
  if (pct >= 70) return "var(--red)";
  if (pct >= 40) return "var(--warning)";
  return "var(--green)";
}

function corDaDecisao(l: LinhaAds): string {
  if (l.reco.acao === "escalar") return "var(--green)";
  if (l.reco.acao === "pausar" || l.reco.acao === "reduzir") return "var(--red)";
  return "var(--muted)";
}

/**
 * Frase da decisão — texto explicável, não um badge solto (a antiga coluna
 * "Ação" removida de propósito). "Sem conclusão" é o próprio texto do
 * getAdRecommendation quando não há dado/volume suficiente.
 */
function textoDecisao(l: LinhaAds): string {
  if (l.reco.acao === "sem-dados") {
    if (!l.i.diretoDisponivel) return "Sem conclusão: sem venda vinculada no período pra calcular a margem direta.";
    if (l.i.status === "sem_campanha") return "Sem conclusão: campanha não encontrada.";
    return l.reco.label;
  }
  if (l.reco.acao === "escalar") return `Saudável: margem ${num(l.margemAtual ?? 0, 1)}% e ROAS ${num(l.r, 2)}x${l.breakEven != null ? ` acima do equilíbrio (${num(l.breakEven, 2)}x)` : ""}.`;
  if (l.breakEven != null) return `${l.reco.label}: ROAS ${num(l.r, 2)}x ${l.abaixoDoBreakEven ? "abaixo" : "acima"} do break-even de ${num(l.breakEven, 2)}x.`;
  return l.reco.label;
}

/** A linha de identidade sob o nome da campanha — produto e MLB. */
function Identidade({ l }: { l: LinhaAds }) {
  return (
    <span
      title={`${l.i.title || l.i.itemId} · ${l.i.itemId}`}
      style={{ display: "block", fontSize: ".75rem", fontWeight: 400, color: "var(--muted)", cursor: "help" }}
    >
      {l.i.title || l.i.itemId} · {l.i.itemId}
    </span>
  );
}

type OrdemAds = { col: ColunaOrdenavel; dir: 1 | -1 };

/**
 * Cabeçalho ordenável — acessível.
 *
 * ─── O QUE HAVIA ───────────────────────────────────────────────────────
 *
 * `<th style={{ cursor: "pointer" }} onClick={...}>`. Três problemas, e
 * nenhum deles aparece pra quem usa mouse:
 *
 *   · `th` não é focável, então a ordenação era INALCANÇÁVEL por teclado;
 *   · a seta ↑/↓ era a única indicação da ordem, e leitor de tela não lê
 *     seta como estado — quem não enxerga não sabia por onde a tabela
 *     estava ordenada;
 *   · a única pista de que a coluna é clicável era o cursor, que não existe
 *     em toque nem em teclado.
 *
 * `aria-sort` resolve o segundo. O botão interno resolve os outros dois: ele
 * entra na ordem de tabulação e responde a Enter e Espaço de graça, sem
 * handler de tecla próprio.
 *
 * Fica FORA do componente de propósito — declarado dentro do render, ele
 * seria recriado a cada pintura e perderia estado (o lint pega isso).
 */
function ThOrdenavel({ col, asc = -1, titulo, children, alinhar, ordem, onOrdenar }: {
  col: ColunaOrdenavel;
  asc?: 1 | -1;
  titulo: string;
  children: React.ReactNode;
  alinhar?: "left";
  ordem: OrdemAds;
  onOrdenar: (col: ColunaOrdenavel, asc: 1 | -1) => void;
}) {
  const ativa = ordem.col === col;
  return (
    <th
      style={alinhar ? { textAlign: alinhar } : undefined}
      // Diz a QUAL coluna a ordenação se aplica e em que sentido — a seta
      // visual sozinha não tem equivalente sonoro.
      aria-sort={ativa ? (ordem.dir === asc ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onOrdenar(col, asc)}
        title={titulo}
        style={{
          background: "none", border: "none", padding: 0, font: "inherit",
          color: "inherit", cursor: "pointer", display: "inline-flex",
          alignItems: "center", gap: 2,
        }}
      >
        {children}{ativa ? (ordem.dir === asc ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );
}
export default function AdsTable({
  modo, linhas, onAbrirAnuncio,
}: {
  modo: Modo; linhas: LinhaAds[]; onAbrirAnuncio: (itemId: string) => void;
}) {
  const pub = modo === "pub";
  const [ordem, setOrdem] = useState<{ col: ColunaOrdenavel; dir: 1 | -1 }>({ col: "investido", dir: -1 });

  const linhasOrdenadas = useMemo(() => {
    const arr = [...linhas];
    /**
     * Ordenar por campanha agrupa os anúncios da mesma verba um embaixo do
     * outro — é assim que se decide onde mexer, e a ordem por investimento
     * espalhava a mesma campanha pela tabela inteira.
     */
    if (ordem.col === "campanha") {
      arr.sort((x, y) => rotuloCampanha(x.i.campaignName).localeCompare(rotuloCampanha(y.i.campaignName), "pt-BR") * ordem.dir
        // Dentro da campanha, o maior investimento primeiro: é a linha que decide.
        || y.i.cost - x.i.cost);
      return arr;
    }
    /**
     * A chave de ordenação tem que ser o número que está NA TELA.
     *
     * A coluna ROAS ordenava por `l.r` — o ROAS do modo escolhido — enquanto a
     * célula exibe `l.roasMlAds`, o do painel do Mercado Ads. São duas
     * definições diferentes, as duas corretas, e o próprio código registra um
     * caso real de 4,71x aqui contra 10,77x lá no MESMO anúncio.
     *
     * Ou seja: clicar em ROAS pra achar o pior anúncio ordenava por um número
     * invisível que podia diferir do visível por mais de 2x. É erro de decisão,
     * não de exibição — corta-se a campanha errada.
     *
     * "Sem dado" vai pro fim nos DOIS sentidos (ver chaveOrdenacao): com
     * -Infinity fixo, inverter a ordem trazia os vazios pro topo e eles
     * ocupavam o lugar dos piores de verdade.
     */
    const chave = (l: LinhaAds): number => {
      switch (ordem.col) {
        case "investido": return l.i.cost;
        case "lucro": return chaveOrdenacao(l.lucroAtual, ordem.dir);
        case "roas": return chaveOrdenacao(l.roasMlAds, ordem.dir);
        // Campanha sem meta configurada vai pro fim: "sem meta" não é meta
        // baixa, e ordenar como zero misturaria as duas coisas.
        case "roasobj": return chaveOrdenacao(l.i.roasTarget > 0 ? l.i.roasTarget : null, ordem.dir);
        case "margem": return chaveOrdenacao(l.margemAtual, ordem.dir);
        // Sem venda no anúncio não há dependência a medir — vai pro fim em
        // vez de posar de 0%, que leria como "não depende de verba".
        case "viaads": return chaveOrdenacao(l.i.totalSales > 0 ? l.pctAds : null, ordem.dir);
        // "impacto negativo primeiro" — usa o próprio lucro (menor = pior) como ordenação de impacto.
        case "decisao": return l.lucroAtual ?? -l.i.cost;
        default: return 0;
      }
    };
    arr.sort((x, y) => (chave(x) - chave(y)) * ordem.dir);
    return arr;
  }, [linhas, ordem]);

  function alternarOrdem(col: ColunaOrdenavel, direcaoPadrao: 1 | -1) {
    setOrdem((o) => (o.col === col ? { col, dir: (o.dir * -1) as 1 | -1 } : { col, dir: direcaoPadrao }));
  }

  /** Alguma campanha tem meta abaixo do ROAS ideal? Só então a legenda aparece. */
  const temMetaCurta = linhasOrdenadas.some(
    (l) => l.i.roasTarget > 0 && l.roasIdeal != null && l.i.roasTarget < l.roasIdeal,
  );

  return (
    <div>
      <div style={{ fontSize: ".75rem", color: "var(--muted)", marginBottom: 6 }}>
        Clique no cabeçalho pra ordenar — <b>Campanha</b> agrupa os anúncios da mesma verba.
        Passe o mouse em qualquer número pra ver a conta por trás.
      </div>

      <div className="table-wrapper" style={{ border: "none" }}>
        <table className="tbl-modern tbl-cards" style={{ fontVariantNumeric: "tabular-nums" }}>
          <thead>
            <tr>
              <ThOrdenavel ordem={ordem} onOrdenar={alternarOrdem} col="campanha" asc={1} alinhar="left" titulo="Ordenar por campanha — agrupa os anúncios da mesma verba">Campanha</ThOrdenavel>
              <th title="Orçamento diário configurado na campanha deste anúncio, no painel do Mercado Ads.">Orçamento</th>
              {/* ROAS objetivo em coluna propria, ao lado do orcamento: sao os
                  dois numeros que se ajusta no ML, e ve-los junto do ROAS real
                  e o que responde "a meta que eu pus esta sendo batida?". */}
              <ThOrdenavel ordem={ordem} onOrdenar={alternarOrdem} col="roasobj" titulo="ROAS Objetivo que VOCÊ configurou na campanha, no painel do Mercado Ads. É a meta; a coluna ROAS ao lado é o resultado.">ROAS obj.</ThOrdenavel>
              <ThOrdenavel ordem={ordem} onOrdenar={alternarOrdem} col="investido" titulo="Quanto a campanha gastou com este anúncio no período. No tooltip de cada valor: impressões, cliques, CTR e CPC.">Investido</ThOrdenavel>
              <th title="Receita atribuída pelo Mercado Ads (clique direto + venda assistida) — a mesma coluna 'Receita' do painel do ML. No tooltip: vendas atribuídas e ACOS.">
                Receita
              </th>
              <ThOrdenavel ordem={ordem} onOrdenar={alternarOrdem} col="roas" titulo="ROAS do painel do Mercado Ads. No tooltip: o ROAS do modo escolhido e as metas de equilíbrio e ideal.">ROAS</ThOrdenavel>
              <ThOrdenavel ordem={ordem} onOrdenar={alternarOrdem} col="lucro" titulo="Ordenar por lucratividade. No tooltip: quanto sobraria no ROAS ideal.">Lucro após Ads</ThOrdenavel>
              <ThOrdenavel ordem={ordem} onOrdenar={alternarOrdem} col="margem" titulo="Lucro ÷ receita.">Margem</ThOrdenavel>
              <ThOrdenavel ordem={ordem} onOrdenar={alternarOrdem} col="viaads" titulo="Quanto da venda deste anúncio o Mercado Ads ATRIBUI à campanha. Alto significa que boa parte da venda passa por anúncio pago — é o teto do que se perde ao pausar, não a previsão.">Via Ads</ThOrdenavel>
              <ThOrdenavel ordem={ordem} onOrdenar={alternarOrdem} col="decisao" asc={1} alinhar="left" titulo="Ordenar por impacto — pior impacto primeiro">Decisão</ThOrdenavel>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {linhasOrdenadas.map((l) => {
              const acos = l.i.adSales > 0 ? (l.i.cost / l.i.adSales) * 100 : null;
              const metaAbaixoDoIdeal = l.i.roasTarget > 0 && l.roasIdeal != null && l.i.roasTarget < l.roasIdeal;
              const bateuAMeta = l.i.roasTarget > 0 && l.roasMlAds != null && l.roasMlAds >= l.i.roasTarget;
              return (
                <tr key={l.i.itemId} style={{ cursor: "pointer" }} onClick={() => onAbrirAnuncio(l.i.itemId)}>
                  <td className="ads-name" style={{ textAlign: "left", fontWeight: 600, maxWidth: 260 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span title={l.i.campaignName || l.i.campaignId || "Sem campanha"}>
                        {rotuloCampanha(l.i.campaignName)}
                      </span>
                      <StatusTag l={l} />
                    </span>
                    <Identidade l={l} />
                  </td>

                  <td data-label="Orçamento" style={{ whiteSpace: "nowrap", color: l.i.dailyBudget > 0 ? "var(--text)" : "var(--muted)" }}>
                    {l.i.dailyBudget > 0 ? `${fmtBRL(l.i.dailyBudget)}/dia` : "—"}
                  </td>

                  {/* ─── ROAS OBJETIVO: A META QUE VOCÊ PÔS NO ML ───────────
                      O ⚠ compara com o ROAS ideal (o que a sua margem alvo
                      exige). Meta configurada ABAIXO do que o produto precisa é
                      invisível no painel do ML, que mostra os dois em telas
                      separadas — e é o erro mais caro de configuração: bater a
                      meta e ainda assim não fechar a margem. */}
                  <td
                    data-label="ROAS obj."
                    title={l.i.roasTarget <= 0
                      ? "Nenhum ROAS Objetivo configurado nesta campanha no painel do Mercado Ads."
                      : metaAbaixoDoIdeal
                        ? `Sua meta no ML é ${num(l.i.roasTarget, 2)}x, ABAIXO do ROAS que entrega a sua margem alvo (${num(l.roasIdeal!, 2)}x). Bater a meta configurada não fecha a margem — é ela que precisa subir.`
                        : `Meta de ${num(l.i.roasTarget, 2)}x configurada por você na campanha.`
                          + (l.roasIdeal != null ? ` Cobre o ROAS ideal (${num(l.roasIdeal, 2)}x).` : "")
                          + (l.roasMlAds != null ? ` Hoje a campanha entrega ${num(l.roasMlAds, 2)}x.` : "")}
                    style={{
                      whiteSpace: "nowrap", fontWeight: 700, cursor: "help",
                      color: l.i.roasTarget <= 0 ? "var(--muted)"
                        : metaAbaixoDoIdeal ? "var(--warning)"
                          : bateuAMeta ? "var(--green)" : "var(--text)",
                    }}
                  >
                    {l.i.roasTarget > 0 ? `${num(l.i.roasTarget, 2)}x${metaAbaixoDoIdeal ? " ⚠" : ""}` : "—"}
                  </td>

                  <td
                    data-label="Investido"
                    title={`${num(l.i.prints)} impressões e ${num(l.i.clicks)} cliques — CTR de ${num(l.ctr, 2)}%. CPC médio ${fmtBRL(l.cpc)}.`}
                    style={{ color: "var(--red)", fontWeight: 600, whiteSpace: "nowrap", cursor: "help" }}
                  >
                    {fmtBRL(l.i.cost)}
                  </td>

                  <td
                    data-label="Receita"
                    title={`${num(l.i.adUnitsAtribuidas)} venda(s) atribuída(s): ${num(l.i.directUnits)} de clique direto + ${num(l.i.indirectUnits)} assistida(s). `
                      + (acos != null ? `ACOS ${num(acos, 1)}% (investido ÷ receita atribuída, a mesma conta do painel do ML). ` : "Sem ACOS: não houve receita atribuída. ")
                      + `A receita do modo "${pub ? "Publicidade direta" : "Geral"}" é ${fmtBRL(l.v)}.`}
                    style={{ color: acos != null ? corAcos(acos, true) : "var(--green)", fontWeight: 600, whiteSpace: "nowrap", cursor: "help" }}
                  >
                    {fmtBRL(l.i.adSales)}
                  </td>

                  {/* O ROAS do painel do ML é o que se confere contra o Mercado
                      Ads. Ter só o do modo já gerou "o ROAS está errado" (4,71x
                      aqui contra 10,77x lá, mesmo anúncio) — são duas
                      definições, as duas certas; a outra vive no tooltip. */}
                  <td
                    data-label="ROAS"
                    title={`Do painel do Mercado Ads: receita atribuída TOTAL (${fmtBRL(l.i.adSales)}) ÷ investido. `
                      + `No modo "${pub ? "Publicidade direta" : "Geral"}", sobre ${fmtBRL(l.v)}, dá ${num(l.r, 2)}x. `
                      + (l.breakEven != null
                        ? `Equilíbrio (não perder dinheiro): ${num(l.breakEven, 2)}x. `
                        // Sem equilíbrio, DIZER por quê: as três causas pedem ações opostas.
                        : (l.motivoSemBreakEven ? `${l.motivoSemBreakEven} ` : ""))
                      + (l.roasIdeal != null
                        ? `Ideal (fechar a margem alvo): ${num(l.roasIdeal, 2)}x. `
                        : (l.motivoSemIdeal ? `${l.motivoSemIdeal} ` : ""))
                      // A cor precisa se explicar: sem isso ela vira enigma.
                      + corDoRoas(l.roasMlAds, l.breakEven, l.roasIdeal).motivo}
                    style={{
                      fontWeight: 700, whiteSpace: "nowrap", cursor: "help",
                      /*
                        A cor sai do EQUILÍBRIO deste anúncio, não de um corte
                        fixo (era 3x verde / 1,5x amarelo pra todo mundo).
                        O ROAS que empata depende da margem do produto: com
                        margem fina, 3,2x já queima dinheiro — e aparecia verde.

                        E a cor caía num valor ALTERNATIVO (roasMlAds ?? r):
                        uma célula mostrando "—" saía pintada de verde.
                      */
                      color: corDoRoas(l.roasMlAds, l.breakEven, l.roasIdeal).cor,
                    }}
                  >
                    {l.roasMlAds != null ? `${num(l.roasMlAds, 2)}x` : "—"}
                    {l.abaixoDoBreakEven && <span title="Abaixo do ROAS de equilíbrio — este anúncio perde dinheiro."> ⚠</span>}
                  </td>

                  <td
                    data-label="Lucro após Ads"
                    title={l.lucroAtual == null
                      ? "Sem venda vinculada no período pra calcular — não é prejuízo, é falta de dado."
                      : l.lucroNoIdeal != null
                        ? `Hoje ${fmtBRL(l.lucroAtual)} → ${fmtBRL(l.lucroNoIdeal)} se atingisse o ROAS ideal, mantendo a receita atual. É teto de comparação entre anúncios, não promessa: cortar verba costuma derrubar a receita junto.`
                        : (l.motivoSemIdeal ?? "Sem ROAS ideal calculável — não há lucro alvo pra projetar.")}
                    style={{ whiteSpace: "nowrap", fontWeight: 700, cursor: "help", color: l.lucroAtual == null ? "var(--muted)" : l.lucroAtual >= 0 ? "var(--green)" : "var(--red)" }}
                  >
                    {l.lucroAtual != null ? fmtBRL(l.lucroAtual) : "—"}
                  </td>

                  <td data-label="Margem" style={{ whiteSpace: "nowrap", fontWeight: 700, color: l.margemAtual != null ? corMargem(l.margemAtual) : "var(--muted)" }}>
                    {l.margemAtual != null ? `${num(l.margemAtual, 1)}%` : "—"}
                  </td>

                  {/* Quanto desta venda depende de verba. Cor pela escala de
                      lerParticipacao: quanto maior a fatia, maior o tombo se a
                      campanha parar. */}
                  <td
                    data-label="Via Ads"
                    title={l.i.totalSales > 0
                      ? `${fmtBRL(l.i.adSales)} de ${fmtBRL(l.i.totalSales)} vendidos neste anúncio foram creditados à campanha (clique direto + venda assistida). Quanto maior, mais a venda depende da verba — pausar derruba o faturamento junto.`
                      : "Sem venda registrada neste anúncio no período — não há dependência a medir."}
                    style={{
                      whiteSpace: "nowrap", fontWeight: 700, cursor: "help",
                      color: l.i.totalSales <= 0 ? "var(--muted)" : corParticipacao(l.pctAds),
                    }}
                  >
                    {l.i.totalSales > 0 ? `${num(l.pctAds, 0)}%` : "—"}
                  </td>

                  <td
                    data-label="Decisão"
                    style={{ textAlign: "left", color: corDaDecisao(l), fontSize: ".75rem", width: 250, whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.4 }}
                  >
                    {textoDecisao(l)}
                  </td>

                  <td data-cell="acoes" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button
                      type="button" className="btn btn-ghost btn-xs"
                      onClick={(e) => { e.stopPropagation(); onAbrirAnuncio(l.i.itemId); }}
                    >
                      Ver detalhes
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 8, fontSize: ".75rem", color: "var(--muted)" }}>
        Impressões, CTR, CPC, ACOS, break-even e o histórico de cada anúncio estão no
        tooltip de cada número e em &quot;Ver detalhes&quot;.
        Em <b>Via Ads</b>, verde é abaixo de 40% e vermelho a partir de 70% — quanto
        maior, mais o faturamento do anúncio cai junto se a campanha parar.
        {temMetaCurta && (
          <>
            {" "}O <b style={{ color: "var(--warning)" }}>⚠</b> em <b>ROAS obj.</b> marca meta
            configurada no ML abaixo do ROAS que fecha a sua margem alvo: bater essa meta
            não basta.
          </>
        )}
      </div>
    </div>
  );
}
