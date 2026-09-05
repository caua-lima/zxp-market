"use client";

import { useMemo, useState } from "react";
import { fmtBRL } from "@/lib/domain/calc";
import { rotuloCampanha } from "@/lib/domain/ads-campaigns";
import { corAcos, corMargem, corRoas, num, STATUS_META, type LinhaAds, type Modo } from "./ads-types";

/**
 * Visão analítica — uma linha por ANÚNCIO, com tudo que a decisão pede.
 *
 * ─── POR QUE ELA MUDOU DE FORMA ─────────────────────────────────────────
 *
 * Eram 19 colunas em rolagem horizontal. Cada uma existia por um motivo real,
 * e ainda assim a tela não servia: pra comparar dois anúncios era preciso
 * rolar de lado e voltar, perdendo de vista qual linha era qual. Informação
 * que não cabe no olho de uma vez não é informação, é arquivo.
 *
 * O formato agora é o da "Performance por campanha" — 8 colunas de dado, sem
 * rolagem —, e nada foi perdido: o que era coluna própria virou SEGUNDA LINHA
 * da célula com que tem parentesco. Impressões e cliques moram no investimento
 * (é o que ele comprou), vendas atribuídas e ACOS moram na receita (é o que
 * ela custou), break-even e ROAS ideal moram no ROAS (são metas dele).
 *
 * "Compacta" some com as segundas linhas — vira a mesma tabela, só os números
 * que mandam.
 *
 * ─── POR QUE A IDENTIDADE É A CAMPANHA ──────────────────────────────────
 *
 * A coluna era o título do produto. Mas o que se faz nesta tela é mexer em
 * CAMPANHA — pausar, mudar orçamento, ajustar ROAS objetivo. Ler nome de
 * produto e agir em campanha obriga a traduzir de cabeça linha por linha. O
 * produto continua ali, na segunda linha, porque é ele que se reconhece.
 */

type ColunaOrdenavel = "campanha" | "investido" | "lucro" | "roas" | "margem" | "decisao";
type Densidade = "confortavel" | "compacta";

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
    <span title={tooltip} style={{ fontSize: ".6rem", fontWeight: 700, color: m.cor, background: m.bg, padding: "1px 6px", borderRadius: 5, whiteSpace: "nowrap", cursor: "help" }}>
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

/** A segunda linha de uma célula: o dado que explica o número de cima. */
function Sub({ children, title, cor }: { children: React.ReactNode; title?: string; cor?: string }) {
  return (
    <span
      title={title}
      style={{ display: "block", fontSize: ".64rem", fontWeight: 400, color: cor ?? "var(--muted)", cursor: title ? "help" : undefined }}
    >
      {children}
    </span>
  );
}

export default function AdsTable({
  modo, linhas, onAbrirAnuncio,
}: {
  modo: Modo; linhas: LinhaAds[]; onAbrirAnuncio: (itemId: string) => void;
}) {
  const pub = modo === "pub";
  const [ordem, setOrdem] = useState<{ col: ColunaOrdenavel; dir: 1 | -1 }>({ col: "investido", dir: -1 });
  const [densidade, setDensidade] = useState<Densidade>("confortavel");
  const detalhado = densidade === "confortavel";

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
    const chave = (l: LinhaAds): number => {
      switch (ordem.col) {
        case "investido": return l.i.cost;
        case "lucro": return l.lucroAtual ?? -Infinity;
        case "roas": return l.r;
        case "margem": return l.margemAtual ?? -Infinity;
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

  const seta = (col: ColunaOrdenavel, asc: 1 | -1 = -1) =>
    (ordem.col === col ? (ordem.dir === asc ? " ↓" : " ↑") : "");

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: ".72rem", color: "var(--muted)" }}>
          Clique no cabeçalho pra ordenar — <b>Campanha</b> agrupa os anúncios da mesma verba.
        </span>
        <div className="seg">
          <button type="button" className={`seg-btn ${detalhado ? "active" : ""}`} onClick={() => setDensidade("confortavel")}>Confortável</button>
          <button type="button" className={`seg-btn ${!detalhado ? "active" : ""}`} onClick={() => setDensidade("compacta")}>Compacta</button>
        </div>
      </div>

      <div className="table-wrapper" style={{ border: "none" }}>
        <table className="tbl-modern tbl-cards" style={{ fontVariantNumeric: "tabular-nums" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", cursor: "pointer" }} onClick={() => alternarOrdem("campanha", 1)} title="Ordenar por campanha — agrupa os anúncios da mesma verba">
                Campanha{seta("campanha", 1)}
              </th>
              <th title="Orçamento diário da campanha deste anúncio, e o ROAS objetivo que você configurou nela.">Orçamento</th>
              <th style={{ cursor: "pointer" }} onClick={() => alternarOrdem("investido", -1)} title="Ordenar por investimento. Abaixo do valor: impressões, cliques e CTR.">
                Investido{seta("investido")}
              </th>
              <th title="Receita atribuída pelo Mercado Ads (clique direto + venda assistida) — a mesma coluna 'Receita' do painel do ML. Abaixo: vendas atribuídas e ACOS.">
                Receita
              </th>
              <th style={{ cursor: "pointer" }} onClick={() => alternarOrdem("roas", -1)} title="ROAS do painel do Mercado Ads. Abaixo: o ROAS do modo escolhido e as metas (equilíbrio e ideal).">
                ROAS{seta("roas")}
              </th>
              <th style={{ cursor: "pointer" }} onClick={() => alternarOrdem("lucro", -1)} title="Ordenar por lucratividade. Abaixo: quanto sobraria no ROAS ideal.">
                Lucro após Ads{seta("lucro")}
              </th>
              <th style={{ cursor: "pointer" }} onClick={() => alternarOrdem("margem", -1)} title="Lucro ÷ receita. Abaixo: quanto da venda deste anúncio depende de verba.">
                Margem{seta("margem")}
              </th>
              <th style={{ textAlign: "left", cursor: "pointer" }} onClick={() => alternarOrdem("decisao", 1)} title="Ordenar por impacto — pior impacto primeiro">
                Decisão{seta("decisao", 1)}
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {linhasOrdenadas.map((l) => {
              const acos = l.i.adSales > 0 ? (l.i.cost / l.i.adSales) * 100 : null;
              const metaAbaixoDoIdeal = l.i.roasTarget > 0 && l.roasIdeal != null && l.i.roasTarget < l.roasIdeal;
              return (
                <tr key={l.i.itemId} style={{ cursor: "pointer" }} onClick={() => onAbrirAnuncio(l.i.itemId)}>
                  {/* ─── IDENTIDADE: CAMPANHA EM CIMA, PRODUTO EMBAIXO ─── */}
                  <td className="ads-name" style={{ textAlign: "left", fontWeight: 600, maxWidth: 260 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span title={l.i.campaignName || l.i.campaignId || "Sem campanha"}>
                        {rotuloCampanha(l.i.campaignName)}
                      </span>
                      <StatusTag l={l} />
                    </span>
                    {detalhado && (
                      <Sub title={`${l.i.title || l.i.itemId} · ${l.i.itemId}`}>
                        {l.i.title || l.i.itemId}
                        {" · "}{l.i.itemId}
                      </Sub>
                    )}
                  </td>

                  <td data-label="Orçamento" style={{ whiteSpace: "nowrap", color: l.i.dailyBudget > 0 ? "var(--text)" : "var(--muted)" }}>
                    {l.i.dailyBudget > 0 ? `${fmtBRL(l.i.dailyBudget)}/dia` : "—"}
                    {detalhado && (
                      /* ROAS objetivo (o que VOCÊ configurou no ML) fica junto do
                         orçamento porque são a mesma coisa: o que se ajusta lá.
                         O ⚠ compara com o ROAS ideal — meta configurada abaixo do
                         que o produto precisa é invisível no painel do ML, que
                         mostra os dois em telas separadas. */
                      <Sub
                        cor={metaAbaixoDoIdeal ? "var(--warning)" : undefined}
                        title={metaAbaixoDoIdeal
                          ? `Sua meta no ML (${num(l.i.roasTarget, 2)}x) está ABAIXO do ROAS que entrega a margem alvo (${num(l.roasIdeal!, 2)}x). Bater a meta configurada não fecha a margem.`
                          : "ROAS objetivo configurado na campanha, no painel do Mercado Ads."}
                      >
                        {l.i.roasTarget > 0 ? `obj. ${num(l.i.roasTarget, 2)}x${metaAbaixoDoIdeal ? " ⚠" : ""}` : "sem ROAS obj."}
                      </Sub>
                    )}
                  </td>

                  <td data-label="Investido" style={{ color: "var(--red)", fontWeight: 600, whiteSpace: "nowrap" }}>
                    {fmtBRL(l.i.cost)}
                    {detalhado && (
                      <Sub title={`${num(l.i.prints)} impressões e ${num(l.i.clicks)} cliques — CTR de ${num(l.ctr, 2)}%. CPC médio ${fmtBRL(l.cpc)}.`}>
                        {num(l.i.clicks)} cliq · CTR {num(l.ctr, 2)}%
                      </Sub>
                    )}
                  </td>

                  <td data-label="Receita" style={{ color: "var(--green)", fontWeight: 600, whiteSpace: "nowrap" }}>
                    {fmtBRL(l.i.adSales)}
                    {detalhado && (
                      <Sub
                        cor={acos != null ? corAcos(acos, true) : undefined}
                        title={`${num(l.i.adUnitsAtribuidas)} venda(s) atribuída(s): ${num(l.i.directUnits)} de clique direto + ${num(l.i.indirectUnits)} assistida(s). `
                          + `ACOS = investido ÷ receita atribuída, a mesma conta do painel do ML. `
                          + `A receita do modo "${pub ? "Publicidade direta" : "Geral"}" é ${fmtBRL(l.v)}.`}
                      >
                        {num(l.i.adUnitsAtribuidas)} vd
                        {acos != null ? ` · ACOS ${num(acos, 1)}%` : " · sem ACOS"}
                      </Sub>
                    )}
                  </td>

                  {/* ─── ROAS: O DO ML EM CIMA, O DO MODO E AS METAS EMBAIXO ───
                      O do painel vem primeiro porque é o número que se confere
                      contra o ML. Ter só o do modo já gerou "o ROAS está errado"
                      (4,71x aqui contra 10,77x lá, mesmo anúncio) — são duas
                      definições, as duas certas. */}
                  <td data-label="ROAS" style={{ fontWeight: 700, whiteSpace: "nowrap", color: corRoas(l.roasMlAds ?? l.r) }}>
                    {l.roasMlAds != null ? `${num(l.roasMlAds, 2)}x` : "—"}
                    {detalhado && (
                      <>
                        {l.i.cost > 0 && l.roasMlAds != null && Math.abs(l.roasMlAds - l.r) > 0.01 && (
                          <Sub title={`Acima: ROAS do painel do Mercado Ads — receita atribuída TOTAL (${fmtBRL(l.i.adSales)}) ÷ investido. Aqui: o modo "${pub ? "Publicidade direta" : "Geral"}", sobre ${fmtBRL(l.v)}.`}>
                            {pub ? "direta" : "geral"} {num(l.r, 2)}x
                          </Sub>
                        )}
                        <Sub
                          cor={l.abaixoDoBreakEven ? "var(--red)" : l.abaixoDoIdeal ? "var(--warning)" : undefined}
                          title={l.roasIdeal == null
                            // O motivo é específico por caso (falta venda ×
                            // produto não fecha conta × meta inalcançável) e
                            // cada um pede ação diferente — ver motivoSemIdeal.
                            ? (l.motivoSemIdeal ?? "Sem ROAS ideal calculável para este anúncio.")
                            : "Equilíbrio: o mínimo pra não perder dinheiro. Ideal: o mínimo pra sobrar a sua margem alvo. Entre os dois o anúncio se paga mas não entrega margem."}
                        >
                          {l.breakEven != null ? `eq. ${num(l.breakEven, 2)}x` : "eq. —"}
                          {" · "}
                          {l.roasIdeal != null ? `ideal ${num(l.roasIdeal, 2)}x` : "ideal — ⓘ"}
                        </Sub>
                      </>
                    )}
                  </td>

                  <td
                    data-label="Lucro após Ads"
                    title={l.lucroAtual == null ? "Sem venda vinculada no período pra calcular — não é prejuízo, é falta de dado." : undefined}
                    style={{ whiteSpace: "nowrap", fontWeight: 700, color: l.lucroAtual == null ? "var(--muted)" : l.lucroAtual >= 0 ? "var(--green)" : "var(--red)" }}
                  >
                    {l.lucroAtual != null ? fmtBRL(l.lucroAtual) : "—"}
                    {detalhado && (
                      /* O ROAS ideal em dinheiro. "62,75x" é abstrato; "+R$ 38" decide. */
                      <Sub title={l.lucroNoIdeal == null
                        ? (l.motivoSemIdeal ?? "Sem ROAS ideal calculável — não há lucro alvo pra projetar.")
                        : `Hoje ${fmtBRL(l.lucroAtual ?? 0)} → ${fmtBRL(l.lucroNoIdeal)} no ROAS ideal, mantendo a receita atual. É teto de comparação entre anúncios, não promessa: cortar verba costuma derrubar a receita junto.`}
                      >
                        {l.lucroNoIdeal != null
                          ? `no ideal ${fmtBRL(l.lucroNoIdeal)}${l.ganhoNoIdeal != null && l.ganhoNoIdeal > 0 ? ` (+${fmtBRL(l.ganhoNoIdeal)})` : ""}`
                          : "sem alvo a projetar"}
                      </Sub>
                    )}
                  </td>

                  <td data-label="Margem" style={{ whiteSpace: "nowrap", fontWeight: 700, color: l.margemAtual != null ? corMargem(l.margemAtual) : "var(--muted)" }}>
                    {l.margemAtual != null ? `${num(l.margemAtual, 1)}%` : "—"}
                    {detalhado && (
                      /* "% via Ads" era calculado desde sempre e nunca exibido —
                         é a pergunta "quanto deste item depende da verba?", que
                         é o corte de decisão quando se pensa em pausar. */
                      <Sub
                        cor={l.i.totalSales > 0 ? corParticipacao(l.pctAds) : undefined}
                        title={l.i.totalSales > 0
                          ? `${fmtBRL(l.i.adSales)} de ${fmtBRL(l.i.totalSales)} vendidos neste anúncio foram creditados à campanha. Quanto maior, mais a venda depende da verba.`
                          : "Sem venda registrada neste anúncio no período."}
                      >
                        {l.i.totalSales > 0 ? `${num(l.pctAds, 0)}% via Ads` : "sem venda no anúncio"}
                      </Sub>
                    )}
                  </td>

                  <td
                    data-label="Decisão"
                    style={{ textAlign: "left", color: corDaDecisao(l), fontSize: ".74rem", width: 250, whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.4 }}
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

      <div style={{ marginTop: 8, fontSize: ".7rem", color: "var(--muted)" }}>
        Impressões, CPC, TACOS e o histórico de cada anúncio ficam em &quot;Ver detalhes&quot;.
        Cor de ROAS, margem e equilíbrio segue os mesmos limiares do resto do app.
      </div>
    </div>
  );
}
