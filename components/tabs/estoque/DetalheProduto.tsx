"use client";

import { fmtBRL } from "@/lib/domain/calc";
import { CUSTO_FAIXA_SENTINELA, custoNaData, type Product } from "@/lib/domain/types";
import {
  anunciosDe, custoMedioDe, fullDe, parseNum,
} from "@/components/tabs/estoque/estoque-compartilhado";
import type { EstoqueML } from "@/components/tabs/estoque/estoque-compartilhado";
import { ehFullLogistic } from "@/lib/domain/estoque";

/**
 * O detalhe de um produto: anúncios, memória de cálculo e de onde vem cada
 * número da linha.
 *
 * ─── TRÊS LUGARES PRA UM PRODUTO ─────────────────────────────────────────
 *
 * Pra entender um produto era preciso juntar três telas: a linha da tabela
 * (os números), o modal "Agências" (os MLBs fora do Full, com preço) e a
 * gaveta (o histórico de movimentação). Nenhuma delas dizia COMO o custo
 * médio chegou no valor que está lá.
 *
 * O brief pede que MLBs, preços por anúncio, histórico e detalhes de cálculo
 * fiquem num painel lateral. Isto é esse painel — e a gaveta já existia, só
 * estava com o histórico sozinho dentro.
 *
 * ─── POR QUE A MEMÓRIA DE CÁLCULO IMPORTA AQUI ───────────────────────────
 *
 * O custo médio é o número que decide preço, margem e valor de estoque, e ele
 * é DERIVADO: sai das entradas registradas e das faixas de vigência. Quem
 * estranha a margem de um produto não tem como conferir se o custo está certo
 * sem ver de onde ele veio — e a resposta "abra o razão e some de cabeça" é a
 * razão de ninguém conferir.
 */
export default function DetalheProduto({ product, estoqueML }: {
  product: Product;
  estoqueML: EstoqueML;
}) {
  const anuncios = anunciosDe(product, estoqueML);
  const f = fullDe(product, estoqueML);
  const custoHoje = custoMedioDe(product);

  /**
   * As faixas, da mais recente pra mais antiga.
   *
   * A sentinela (`CUSTO_FAIXA_SENTINELA`) marca a faixa que existe só pra
   * cobrir "antes de qualquer registro" — ela aparece com esse nome, e não
   * com a data de 2000, que confundiria mais do que explica.
   */
  const faixas = [...(product.custoMedioFaixas ?? [])]
    .sort((a, b) => String(b.desde).localeCompare(String(a.desde)));

  const br = (s: string) => (s && s.length >= 10 ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : s);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* ── ANÚNCIOS ────────────────────────────────────────────────────── */}
      <section>
        <h4 style={tituloSecao}>Anúncios vinculados ({anuncios.length})</h4>

        {anuncios.length === 0 ? (
          <p style={vazio}>
            Nenhum anúncio vinculado. Sem vínculo, o app não sabe quanto este produto
            vende nem quanto tem no Mercado Livre — e as vendas dele entram com custo zero.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {anuncios.map(({ mlb, item }) => {
              // Full e próprio lado a lado: eram telas diferentes, e a pergunta
              // "onde está meu estoque deste produto" precisa das duas juntas.
              const noFull = !!item && ehFullLogistic(item.logistic);
              return (
                <div key={mlb} style={linhaAnuncio}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: "ui-monospace, monospace", fontSize: ".8rem", fontWeight: 700 }}>
                      {mlb}
                    </div>
                    <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>
                      {item
                        ? <>{noFull ? "Full" : "próprio/agência"} · {item.available} un · {item.status}</>
                        : "sem dado do ML — o anúncio não voltou na consulta"}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    {item?.price ? (
                      <>
                        <div style={{ fontWeight: 700, color: "var(--green)", whiteSpace: "nowrap" }}>
                          {fmtBRL(item.price)}
                        </div>
                        {item.hasPromo && item.regularPrice > item.price && (
                          <div style={{ fontSize: ".75rem", color: "var(--yellow)", whiteSpace: "nowrap" }}>
                            promoção · de {fmtBRL(item.regularPrice)}
                          </div>
                        )}
                      </>
                    ) : (
                      <span style={{ color: "var(--muted)", fontSize: ".78rem" }}>—</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── MEMÓRIA DE CÁLCULO ──────────────────────────────────────────── */}
      <section>
        <h4 style={tituloSecao}>De onde vem o custo médio</h4>

        <div style={caixa}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: ".82rem" }}>Custo médio hoje</span>
            <b style={{ fontVariantNumeric: "tabular-nums" }}>{fmtBRL(custoHoje)}</b>
          </div>

          {faixas.length === 0 ? (
            <p style={{ ...vazio, marginTop: 8 }}>
              Sem faixas de vigência: este produto tem um custo só, o atual. Vendas
              antigas são calculadas com ele — o que está certo enquanto o custo
              nunca mudou, e deixa de estar no dia em que mudar.
            </p>
          ) : (
            <>
              <p style={{ fontSize: ".76rem", color: "var(--muted)", margin: "8px 0 6px", lineHeight: 1.55 }}>
                Cada faixa vale a partir da data dela. A venda de um dia usa a faixa
                que valia NAQUELE dia — por isso mexer no custo de hoje não reescreve
                a margem de um mês fechado.
              </p>
              <div style={{ display: "grid", gap: 4 }}>
                {faixas.map((fx) => (
                  <div key={`${fx.desde}-${fx.custo}`} style={linhaFaixa}>
                    <span style={{ fontSize: ".78rem", color: "var(--muted)" }}>
                      {fx.desde === CUSTO_FAIXA_SENTINELA
                        ? "antes do primeiro registro"
                        : `desde ${br(String(fx.desde))}`}
                    </span>
                    <b style={{ fontSize: ".82rem", fontVariantNumeric: "tabular-nums" }}>
                      {fmtBRL(Number(fx.custo) || 0)}
                    </b>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      {/* ── DE ONDE VEM CADA NÚMERO DA LINHA ────────────────────────────── */}
      <section>
        <h4 style={tituloSecao}>De onde vêm os números da linha</h4>
        <div style={caixa}>
          <Conta rotulo="Em casa" valor={`${Math.max(product.qtdLocal ?? 0, 0)} un`}
            explica="O livro do galpão: entradas menos envios pro Full, lançados aqui." />
          <Conta rotulo="Full (ML)" valor={`${f.qtd} un`}
            explica={f.fullCompartilhado
              ? "Soma dos pools distintos do Full. Dois anúncios do MESMO pool contam uma vez só — somá-los dobraria o estoque."
              : "Disponível no Full, direto do Mercado Livre."} />
          <Conta rotulo="Custo médio" valor={fmtBRL(custoHoje)}
            explica="Ponderado pelas entradas: cada compra entra pelo preço dela e puxa a média proporcionalmente à quantidade." />
          <Conta rotulo="Imposto" valor={`${parseNum(String(product.imposto ?? "0"))}%`}
            explica="Alíquota sobre a receita. Como o custo, respeita a data da venda quando há faixas." />
          <Conta rotulo="Custo na data de hoje" valor={fmtBRL(custoNaData(product, hojeISO()))}
            explica="É o que uma venda de hoje usaria. Se divergir do custo médio acima, há faixa futura cadastrada." />
        </div>
      </section>
    </div>
  );
}

function hojeISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function Conta({ rotulo, valor, explica }: { rotulo: string; valor: string; explica: string }) {
  return (
    <div style={{ padding: "7px 0", borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
        <span style={{ fontSize: ".82rem", fontWeight: 600 }}>{rotulo}</span>
        <b style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{valor}</b>
      </div>
      <div style={{ fontSize: ".75rem", color: "var(--muted)", lineHeight: 1.5, marginTop: 2 }}>
        {explica}
      </div>
    </div>
  );
}

const tituloSecao: React.CSSProperties = {
  margin: "0 0 8px",
  fontSize: ".75rem",
  fontWeight: 700,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "var(--muted)",
};

const vazio: React.CSSProperties = {
  margin: 0,
  fontSize: ".8rem",
  color: "var(--muted)",
  lineHeight: 1.6,
};

const caixa: React.CSSProperties = {
  padding: "10px 12px",
  background: "var(--surface2)",
  border: "1px solid var(--border)",
  borderRadius: 8,
};

const linhaAnuncio: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  padding: "8px 10px",
  background: "var(--surface2)",
  borderRadius: 8,
};

const linhaFaixa: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: 10,
  padding: "5px 8px",
  background: "var(--surface)",
  borderRadius: 6,
};
