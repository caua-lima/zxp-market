"use client";

import { fmtBRL } from "@/lib/domain/calc";
import type { AdsAlteracao } from "@/lib/domain/types";
import { formatarResumoAlteracao } from "@/lib/domain/ads-changelog";
import { num, type LinhaAds } from "./ads-types";

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
  linhas, changelog, onAbrirAnuncio,
}: {
  linhas: LinhaAds[];
  changelog: AdsAlteracao[];
  onAbrirAnuncio: (itemId: string) => void;
}) {
  const grupos: Record<Grupo, LinhaAds[]> = { escalar: [], revisar: [], "sem-retorno": [], incompleto: [] };
  for (const l of linhas) {
    const g = classificar(l);
    if (g) grupos[g].push(l);
  }

  grupos.escalar.sort((a, b) => (b.lucroAtual ?? 0) - (a.lucroAtual ?? 0));
  grupos.revisar.sort((a, b) => (a.lucroAtual ?? -a.i.cost) - (b.lucroAtual ?? -b.i.cost));
  grupos["sem-retorno"].sort((a, b) => b.i.cost - a.i.cost);
  grupos.incompleto.sort((a, b) => b.i.cost - a.i.cost);

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 10 }}>
        <span className="panel-title">Decisões de Ads</span>
        <span className="panel-sub">o que fazer agora, e por quê</span>
      </div>
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <GrupoEscalar itens={grupos.escalar.slice(0, MAX_POR_GRUPO)} onAbrir={onAbrirAnuncio} />
        <GrupoRevisar itens={grupos.revisar.slice(0, MAX_POR_GRUPO)} onAbrir={onAbrirAnuncio} />
        <GrupoSemRetorno itens={grupos["sem-retorno"].slice(0, MAX_POR_GRUPO)} changelog={changelog} onAbrir={onAbrirAnuncio} />
        <GrupoIncompleto itens={grupos.incompleto.slice(0, MAX_POR_GRUPO)} onAbrir={onAbrirAnuncio} />
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

function LinhaBase({ l, onAbrir, children }: { l: LinhaAds; onAbrir: (itemId: string) => void; children: React.ReactNode }) {
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
      {children}
    </button>
  );
}

function GrupoEscalar({ itens, onAbrir }: { itens: LinhaAds[]; onAbrir: (itemId: string) => void }) {
  return (
    <Cartao titulo="Escalar com cautela" cor="var(--green)" vazio={itens.length === 0}>
      {itens.map((l) => (
        <LinhaBase key={l.i.itemId} l={l} onAbrir={onAbrir}>
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

function GrupoRevisar({ itens, onAbrir }: { itens: LinhaAds[]; onAbrir: (itemId: string) => void }) {
  return (
    <Cartao titulo="Revisar ou reduzir" cor="var(--red)" vazio={itens.length === 0}>
      {itens.map((l) => (
        <LinhaBase key={l.i.itemId} l={l} onAbrir={onAbrir}>
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

function GrupoSemRetorno({ itens, changelog, onAbrir }: { itens: LinhaAds[]; changelog: AdsAlteracao[]; onAbrir: (itemId: string) => void }) {
  return (
    <Cartao titulo="Investimento sem retorno" cor="var(--warning)" vazio={itens.length === 0}>
      {itens.map((l) => {
        const ultima = ultimaAlteracao(changelog, l.i.campaignId);
        return (
          <LinhaBase key={l.i.itemId} l={l} onAbrir={onAbrir}>
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

function GrupoIncompleto({ itens, onAbrir }: { itens: LinhaAds[]; onAbrir: (itemId: string) => void }) {
  return (
    <Cartao titulo="Dados incompletos" cor="var(--muted)" vazio={itens.length === 0}>
      {itens.map((l) => (
        <LinhaBase key={l.i.itemId} l={l} onAbrir={onAbrir}>
          <div style={{ fontSize: ".75rem", color: "var(--muted)", marginTop: 4 }}>{motivoIncompletoTexto(l)}</div>
        </LinhaBase>
      ))}
    </Cartao>
  );
}
