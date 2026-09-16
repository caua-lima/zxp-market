"use client";

import { fmtBRL } from "@/lib/domain/calc";
import type { AdsAlteracao } from "@/lib/domain/types";
import { formatarResumoAlteracao } from "@/lib/domain/ads-changelog";
import { num, type LinhaAds } from "./ads-types";
import {
  ordenarPorPrioridade, prioridadeDaDecisao, type BaseDaDecisao,
} from "@/lib/domain/ads-prioridade";

// Mesmos limiares de "relevante" usados em lib/domain/ads.ts (getAdRecommendation)
// pra não classificar como "sem retorno" um teste de R$3 que não significa nada.
const INVESTIMENTO_RELEVANTE = 20;
const CLIQUES_MIN_SEM_RETORNO = 10;
const MAX_POR_GRUPO = 3;

type Grupo = "escalar" | "revisar" | "sem-retorno" | "incompleto";

/**
 * null = anúncio não entra em NENHUM grupo (ex.: recomendação "escalar" mas
 * campanha pausada, ou "sem-dados" sem nenhum motivo concreto de dado
 * incompleto pra apontar) — a missão pede no máximo 3 itens por grupo, os
 * mais relevantes; anúncio pequeno e sem sinal forte não precisa aparecer
 * em lugar nenhum do painel.
 */
function classificar(l: LinhaAds): Grupo | null {
  const semRetorno = l.i.cost >= INVESTIMENTO_RELEVANTE && l.v === 0 && l.i.clicks >= CLIQUES_MIN_SEM_RETORNO;
  if (semRetorno) return "sem-retorno";
  if (l.reco.acao === "escalar" && l.i.status === "ativo") return "escalar";
  if (l.reco.acao === "pausar" || l.reco.acao === "reduzir") return "revisar";
  // "sem-dados" da recomendação vira "incompleto" só quando há um motivo
  // concreto pra apontar (campanha não encontrada/indisponível, ou modo
  // Publicidade sem venda vinculada pra calcular a margem direta) — anúncio
  // pequeno e saudável sem nenhum desses sinais não precisa aparecer aqui.
  const motivoIncompleto = l.i.status === "sem_campanha" || l.i.status === "config_indisponivel" || !l.i.diretoDisponivel;
  if (l.reco.acao === "sem-dados" && motivoIncompleto) return "incompleto";
  return null;
}

function motivoIncompletoTexto(l: LinhaAds): string {
  if (l.i.status === "sem_campanha") return "Campanha não encontrada pra este anúncio.";
  if (l.i.status === "config_indisponivel") return "Mercado Ads não devolveu a configuração da campanha (orçamento/ROAS alvo vazios).";
  if (!l.i.diretoDisponivel) return "Sem venda vinculada no período — não dá pra calcular a margem do lucro direto.";
  return "Dado insuficiente pra concluir.";
}

function ultimaAlteracao(entries: AdsAlteracao[], campaignId: string): AdsAlteracao | null {
  const doCampanha = entries.filter((e) => e.campaignId === campaignId);
  if (!doCampanha.length) return null;
  return doCampanha.reduce((mais, e) => (e.createdAt > mais.createdAt ? e : mais));
}

export default function AdsDecisionPanel({
  linhas, changelog, onAbrirAnuncio, diasDoPeriodo = 30,
}: {
  linhas: LinhaAds[];
  changelog: AdsAlteracao[];
  onAbrirAnuncio: (itemId: string) => void;
  /**
   * Dias do período apurado — entra na CONFIANÇA, não no cálculo. Dois dias
   * de dados não sustentam decisão de verba por maior que seja o número.
   */
  diasDoPeriodo?: number;
}) {
  const grupos: Record<Grupo, LinhaAds[]> = { escalar: [], revisar: [], "sem-retorno": [], incompleto: [] };
  for (const l of linhas) {
    const g = classificar(l);
    if (g) grupos[g].push(l);
  }

  /**
   * ─── IMPACTO × CONFIANÇA, E NÃO SÓ IMPACTO ──────────────────────────
   *
   * Cada grupo era ordenado por UM número: lucro nos que mandavam escalar,
   * gasto nos sem retorno. O efeito é que um anúncio com 3 cliques e R$ 400
   * gastos aparecia acima de um com 3.000 cliques e R$ 380 — e o ROAS do
   * primeiro não significa quase nada: três cliques podem virar uma venda
   * ou nenhuma por acaso, e isso muda o ROAS de 0 pra 12.
   *
   * A recomendação no topo é a que tem mais chance de ser seguida. Ordenar
   * sem confiança colocava lá justamente os anúncios sobre os quais menos
   * se sabia.
   *
   * `prioridadeDaDecisao` MULTIPLICA os dois — somar deixaria um impacto
   * enorme com confiança quase nula subir do mesmo jeito, que é o caso
   * perigoso: o anúncio que gastou muito em poucos dias.
   */
  const baseDe = (l: LinhaAds): BaseDaDecisao => ({
    cliques: l.i.clicks,
    investido: l.i.cost,
    lucro: l.lucroAtual ?? null,
    dias: diasDoPeriodo,
    atribuicaoCompleta: l.i.diretoDisponivel,
  });
  const porPrioridade = (g: LinhaAds[]) => ordenarPorPrioridade(g, baseDe, (l) => l.i.itemId);

  grupos.escalar = porPrioridade(grupos.escalar);
  grupos.revisar = porPrioridade(grupos.revisar);
  grupos["sem-retorno"] = porPrioridade(grupos["sem-retorno"]);
  grupos.incompleto = porPrioridade(grupos.incompleto);

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 10 }}>
        <span className="panel-title">Decisões de Ads</span>
        <span className="panel-sub">o que fazer agora, e por quê</span>
      </div>
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <GrupoEscalar itens={grupos.escalar.slice(0, MAX_POR_GRUPO)} base={baseDe} onAbrir={onAbrirAnuncio} />
        <GrupoRevisar itens={grupos.revisar.slice(0, MAX_POR_GRUPO)} base={baseDe} onAbrir={onAbrirAnuncio} />
        <GrupoSemRetorno itens={grupos["sem-retorno"].slice(0, MAX_POR_GRUPO)} base={baseDe} changelog={changelog} onAbrir={onAbrirAnuncio} />
        <GrupoIncompleto itens={grupos.incompleto.slice(0, MAX_POR_GRUPO)} base={baseDe} onAbrir={onAbrirAnuncio} />
      </div>
    </div>
  );
}

function Cartao({ titulo, cor, vazio, children }: { titulo: string; cor: string; vazio: boolean; children: React.ReactNode }) {
  return (
    <div style={{ border: `1px solid ${cor}44`, borderRadius: 10, padding: "10px 12px", background: "var(--surface2)" }}>
      <div style={{ fontSize: ".82rem", fontWeight: 800, color: cor, marginBottom: 8, textTransform: "uppercase", letterSpacing: ".03em" }}>{titulo}</div>
      {vazio ? (
        <div style={{ fontSize: ".82rem", color: "var(--muted)" }}>Nenhum anúncio exige ação crítica neste período.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
      )}
    </div>
  );
}

function LinhaBase({ l, onAbrir, base, children }: {
  l: LinhaAds;
  onAbrir: (itemId: string) => void;
  /** A base da decisão — sem ela a confiança não aparece, só ordena. */
  base?: BaseDaDecisao;
  children: React.ReactNode;
}) {
  const p = base ? prioridadeDaDecisao(base) : null;
  return (
    <button
      type="button" onClick={() => onAbrir(l.i.itemId)}
      style={{
        textAlign: "left", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8,
        padding: "8px 10px", cursor: "pointer", width: "100%", color: "inherit",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
        <span style={{ fontWeight: 700, fontSize: ".82rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.i.title || l.i.itemId}</span>
        <span style={{ fontSize: ".75rem", color: "var(--muted)", whiteSpace: "nowrap" }}>{l.i.campaignName || "sem campanha"}</span>
      </div>

      {/*
        ─── A CONFIANÇA, VISÍVEL ─────────────────────────────────────────

        Ela já ordena a lista; sem aparecer, a pessoa não tem como saber por
        que um anúncio com número maior ficou embaixo. Pior: ela leria a
        recomendação de confiança baixa com o mesmo peso da outra.

        Só aparece quando NÃO é alta — um selo em toda linha vira ruído, e
        o que importa é a exceção. E leva o motivo junto: saber que a
        confiança é baixa sem saber por quê não dá o que fazer.
      */}
      {p && p.rotulo !== "alta" && (
        <div style={{
          display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap",
          marginTop: 4, fontSize: ".72rem",
          color: p.rotulo === "baixa" ? "var(--muted)" : "var(--gold)",
        }}>
          <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
            confiança {p.rotulo}
          </span>
          {p.ressalva && <span style={{ color: "var(--muted)" }}>· {p.ressalva}</span>}
        </div>
      )}
      {children}
    </button>
  );
}

function GrupoEscalar({ itens, base, onAbrir }: { itens: LinhaAds[]; base: (l: LinhaAds) => BaseDaDecisao; onAbrir: (itemId: string) => void }) {
  return (
    <Cartao titulo="Escalar com cautela" cor="var(--green)" vazio={itens.length === 0}>
      {itens.map((l) => (
        <LinhaBase key={l.i.itemId} l={l} base={base(l)} onAbrir={onAbrir}>
          <div style={{ fontSize: ".75rem", color: "var(--muted)", marginTop: 4 }}>
            Investido {fmtBRL(l.i.cost)} · ROAS {num(l.r, 2)}x · lucro {fmtBRL(l.lucroAtual ?? 0)} · margem {num(l.margemAtual ?? 0, 1)}%
          </div>
          <div style={{ fontSize: ".75rem", color: "var(--green)", marginTop: 4 }}>
            {l.breakEven != null
              ? `ROAS ${num(l.r, 2)}x está ${num(l.r / l.breakEven, 1)}x acima do ponto de equilíbrio (${num(l.breakEven, 2)}x) e a margem final é ${num(l.margemAtual ?? 0, 1)}%.`
              : `Margem final de ${num(l.margemAtual ?? 0, 1)}% com ROAS ${num(l.r, 2)}x.`}
          </div>
        </LinhaBase>
      ))}
    </Cartao>
  );
}

function GrupoRevisar({ itens, base, onAbrir }: { itens: LinhaAds[]; base: (l: LinhaAds) => BaseDaDecisao; onAbrir: (itemId: string) => void }) {
  return (
    <Cartao titulo="Revisar ou reduzir" cor="var(--red)" vazio={itens.length === 0}>
      {itens.map((l) => (
        <LinhaBase key={l.i.itemId} l={l} base={base(l)} onAbrir={onAbrir}>
          <div style={{ fontSize: ".75rem", color: "var(--muted)", marginTop: 4 }}>
            Impacto {fmtBRL(l.lucroAtual ?? -l.i.cost)} · ROAS {l.i.cost > 0 ? `${num(l.r, 2)}x` : "—"}{l.breakEven != null ? ` · break-even ${num(l.breakEven, 2)}x` : ""}
          </div>
          <div style={{ fontSize: ".75rem", color: "var(--red)", marginTop: 4 }}>
            {l.breakEven != null && l.abaixoDoBreakEven
              ? `ROAS ${num(l.r, 2)}x abaixo do break-even de ${num(l.breakEven, 2)}x. Verificar preço, criativo, segmentação ou orçamento.`
              : l.lucroAtual != null && l.lucroAtual < 0
                ? `Lucro negativo de ${fmtBRL(l.lucroAtual)} no período. Verificar preço, criativo, segmentação ou orçamento.`
                : "Abaixo do ROAS alvo configurado na campanha. Verificar preço, criativo, segmentação ou orçamento."}
          </div>
        </LinhaBase>
      ))}
    </Cartao>
  );
}

function GrupoSemRetorno({ itens, base, changelog, onAbrir }: { itens: LinhaAds[]; base: (l: LinhaAds) => BaseDaDecisao; changelog: AdsAlteracao[]; onAbrir: (itemId: string) => void }) {
  return (
    <Cartao titulo="Investimento sem retorno" cor="var(--warning)" vazio={itens.length === 0}>
      {itens.map((l) => {
        const ultima = ultimaAlteracao(changelog, l.i.campaignId);
        return (
          <LinhaBase key={l.i.itemId} l={l} base={base(l)} onAbrir={onAbrir}>
            <div style={{ fontSize: ".75rem", color: "var(--muted)", marginTop: 4 }}>
              Gasto {fmtBRL(l.i.cost)} · {num(l.i.clicks)} clique(s) · CPC {fmtBRL(l.cpc)} · zero vendas atribuídas
            </div>
            <div style={{ fontSize: ".75rem", color: "var(--warning)", marginTop: 4 }}>
              {ultima ? `Último ajuste registrado: ${formatarResumoAlteracao(ultima)}` : "Nenhum ajuste manual registrado nesta campanha ainda."}
            </div>
          </LinhaBase>
        );
      })}
    </Cartao>
  );
}

function GrupoIncompleto({ itens, base, onAbrir }: { itens: LinhaAds[]; base: (l: LinhaAds) => BaseDaDecisao; onAbrir: (itemId: string) => void }) {
  return (
    <Cartao titulo="Dados incompletos" cor="var(--muted)" vazio={itens.length === 0}>
      {itens.map((l) => (
        <LinhaBase key={l.i.itemId} l={l} base={base(l)} onAbrir={onAbrir}>
          <div style={{ fontSize: ".75rem", color: "var(--muted)", marginTop: 4 }}>{motivoIncompletoTexto(l)}</div>
        </LinhaBase>
      ))}
    </Cartao>
  );
}
