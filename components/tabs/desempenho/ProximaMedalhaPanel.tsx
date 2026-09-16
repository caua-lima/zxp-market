"use client";

import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/api/authed-fetch";
import { fmtBRL, fmtPct } from "@/lib/domain/calc";
import { metricasDeQualidade } from "@/lib/domain/proxima-medalha";
import { projetarMedalha } from "@/lib/domain/projecao-medalha";
import type { DiaDeVendas } from "@/lib/domain/reputacao-vendas";
import { janelaDeDias } from "@/lib/domain/janela-dias";
import type { MetricaML } from "@/lib/domain/limites-reputacao";
import {
  REQUISITOS_COMUNS,
  janelaDaMedalha,
  progressoMercadoLider,
  type EixoMedalha,
} from "@/lib/domain/mercadolider-metas";

/**
 * "Quanto falta pra próxima medalha."
 *
 * ─── O ALVO DEIXOU DE SER DIGITADO ──────────────────────────────────────
 *
 * Este painel pedia o limiar de faturamento na mão, porque a API não devolve
 * e chutar seria pior que não ter. A tabela oficial foi localizada em
 * 07/09/2026 na página "Tudo sobre ser MercadoLíder" e agora mora em
 * lib/domain/mercadolider-metas.ts — 230/575/1.725 vendas e
 * R$ 37.000/118.400/296.000.
 *
 * ─── DUAS JANELAS DIFERENTES, DE PROPÓSITO ──────────────────────────────
 *
 * A qualidade é medida em 60 dias (janela da REPUTAÇÃO). A medalha é medida
 * em "3 meses mais os dias do mês vigente" — 97 dias em 05/09. São critérios
 * distintos do ML, e misturá-los subestimava o acumulado em ~40%: foi o que
 * fez R$ 76.490 do painel parecer meta quando era progresso.
 *
 * Por isso duas buscas. A alternativa — uma janela só — daria um número
 * errado nos dois lados.
 */
export default function ProximaMedalhaPanel({ metrics, nivelAtual }: {
  /**
   * `seller_reputation.metrics` como a API devolve — inclusive `period` por
   * metrica, `excluded` (protecao) e `sales.completed`, que e o denominador
   * oficial de reclamacoes e cancelamentos.
   */
  metrics: {
    claims?: MetricaML;
    cancellations?: MetricaML;
    delayed_handling_time?: MetricaML;
    sales?: { period?: string | null; completed?: number | null } | null;
  } | null | undefined;
  nivelAtual: string | null | undefined;
}) {
  /** Janela da reputação — denominador das três métricas de qualidade. */
  const [reputacao, setReputacao] = useState<{ concluidas: number; faturado: number } | null>(null);
  /** Vendas por dia da janela da medalha — o que a projeção simula. */
  const [serie, setSerie] = useState<DiaDeVendas[]>([]);
  /**
   * Qual fonte falhou, se alguma. Antes o `.catch(() => null)` engolia o erro
   * e a tela mostrava zero — que lê como "não vendeu nada", o oposto de "não
   * consegui perguntar".
   */
  const [falhou, setFalhou] = useState(false);
  /** Janela da medalha — 3 meses + mês vigente. */
  const [medalha, setMedalha] = useState<{ concluidas: number; faturado: number } | null>(null);
  /**
   * Comeca em true e so cai pra false quando as duas buscas voltam.
   * Chamar setCarregando(true) DENTRO do efeito seria setState sincrono em
   * efeito — render em cascata, e o lint pega (react-hooks/set-state-in-effect).
   */
  const [carregando, setCarregando] = useState(true);

  const hoje = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const janela = janelaDaMedalha(hoje);

  /** A janela da reputação, contida na da medalha. */
  const janelaRep = janelaDeDias(60);

  useEffect(() => {
    let vivo = true;

    /**
     * UMA busca, não duas.
     *
     * A tela pedia esta rota duas vezes — reputação (60 dias) e medalha (3
     * meses + mês vigente) — e cada chamada é até 16 páginas de pedidos na API
     * do ML. Como a janela da medalha CONTÉM a da reputação, a segunda busca
     * pagava de novo pelos mesmos pedidos. A rota passou a aceitar uma
     * sub-janela e devolver os dois blocos de uma vez.
     */
    const qs = new URLSearchParams({
      from: janela.de, to: janela.ate, dias: String(janela.dias),
      subFrom: janelaRep.de, subTo: janelaRep.ate,
    });

    authedFetch(`/api/ml/reputacao-vendas?${qs}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("falhou"))))
      .then((j) => {
        if (!vivo) return;
        setMedalha(j?.bloco ?? null);
        setReputacao(j?.sub?.bloco ?? null);
        setSerie(Array.isArray(j?.serie) ? j.serie : []);
        setFalhou(!j?.bloco);
        setCarregando(false);
      })
      .catch(() => {
        if (!vivo) return;
        // Falhar não pode virar zero: a tela precisa dizer que não perguntou.
        setFalhou(true);
        setCarregando(false);
      });

    return () => { vivo = false; };
  }, [janela.de, janela.ate, janela.dias, janelaRep.de, janelaRep.ate]);

  const vendasReputacao = reputacao?.concluidas ?? 0;
  const qualidade = metricasDeQualidade(metrics, vendasReputacao);

  /**
   * A janela vem da RESPOSTA, nao de uma constante da tela.
   *
   * As tres metricas costumam compartilhar o mesmo periodo; quando divergirem,
   * mostrar os dois e mais honesto do que escolher um.
   */
  const periodos = Array.from(new Set(qualidade.map((q) => q.periodo).filter(Boolean)));
  const janelaDaQualidade = periodos.length === 0
    ? "janela informada pelo ML"
    : periodos.map((p) => (p === "60 days" ? "últimos 60 dias" : p === "365 days" ? "últimos 365 dias" : p)).join(" / ");

  const p = progressoMercadoLider(
    medalha?.concluidas ?? 0,
    medalha?.faturado ?? 0,
    nivelAtual,
    hoje,
  );

  /**
   * A projeção, simulando a janela MÓVEL.
   *
   * `progressoMercadoLider` ainda calcula `chegaEm` linearmente — some o
   * ritmo e divide. Mas a janela é "3 meses + mês vigente" e ANDA: na virada
   * do mês o mês mais antigo sai dela inteiro, e o acumulado pode CAIR. A
   * conta linear nunca subtraía isso e prometia uma data que não chega.
   *
   * Ver lib/domain/projecao-medalha.ts.
   */
  const projecao = p
    ? projetarMedalha(
        serie,
        p.meta,
        hoje,
        { vendasPorDia: p.vendasPorDia, faturamentoPorDia: p.faturamentoPorDia },
        { vendas: p.vendas.atual, faturamento: p.faturamento.atual },
      )
    : null;

  const dataBR = (iso: string) => iso.split("-").reverse().join("/");

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">
          Próxima medalha
          <span className="panel-sub"> · {p ? p.meta.label : "MercadoLíder Platinum — você está no topo"}</span>
        </span>
      </div>

      {/*
        Falhar nao pode virar zero.

        A busca engolia o erro com `.catch(() => null)` e a tela mostrava
        0 vendas, 0 faturado — que le como "nao vendeu nada", o oposto de "nao
        consegui perguntar". Atualizar tem que renovar as fontes ou dizer qual
        nao veio.
      */}
      {falhou && !carregando && (
        <div className="note note-accent" style={{ marginBottom: 10, fontSize: ".82rem" }}>
          Nao consegui buscar as vendas da janela agora. Os numeros abaixo estao
          vazios por falta de resposta, nao por falta de venda — recarregue em instantes.
        </div>
      )}

      {/* ─── OS DOIS EIXOS DA MEDALHA ───────────────────────────────────
          Vendas E faturamento, lado a lado. Acompanhar só o dinheiro esconde
          metade do critério: dá pra estar com o faturamento fechado e a
          medalha travada na contagem de vendas — e a ação nos dois casos é
          oposta (girar volume × subir margem). */}
      {p && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: ".75rem", color: "var(--muted)", marginBottom: 8 }}>
            O Mercado Livre mede os 3 meses mais os dias do mês vigente —{" "}
            <b>{dataBR(janela.de)} a {dataBR(janela.ate)}</b> ({janela.dias} dias).
            {carregando && " Carregando…"}
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            <BarraEixo
              titulo="Vendas concretizadas"
              eixo={p.vendas}
              formato={(n) => n.toLocaleString("pt-BR")}
              gargalo={p.gargalo === "vendas"}
            />
            <BarraEixo
              titulo="Faturamento"
              eixo={p.faturamento}
              formato={fmtBRL}
              gargalo={p.gargalo === "faturamento"}
            />
          </div>

          <div style={{ marginTop: 10, fontSize: ".82rem" }}>
            {p.ambosOk ? (
              <span style={{ color: "var(--green)", fontWeight: 700 }}>
                Vendas e faturamento fechados pro {p.meta.label}. O que decide agora são os
                requisitos abaixo — o ML revisa e concede.
              </span>
            ) : (
              <>
                Falta{" "}
                <b style={{ color: "var(--warning)" }}>
                  {p.gargalo === "vendas"
                    ? `${p.vendas.falta.toLocaleString("pt-BR")} venda(s)`
                    : fmtBRL(p.faturamento.falta)}
                </b>{" "}
                no que está mais atrasado.
<div style={{ color: "var(--muted)", fontSize: ".8rem", marginTop: 2 }}>
                  Ritmo de {p.vendasPorDia.toFixed(1)} venda(s)/dia e {fmtBRL(p.faturamentoPorDia)}/dia.
                  {/*
                    A data vem da SIMULAÇÃO da janela móvel, não de uma divisão.

                    A janela é "3 meses + mês vigente" e anda: na virada do mês
                    o mês mais antigo sai dela inteiro, e o acumulado pode CAIR.
                    Dividir "falta / ritmo" nunca subtraía isso e prometia uma
                    data que a conta não alcança — quanto mais longe a data,
                    pior, e a data longe é justamente a de quem está atrás.
                  */}
                  {projecao?.tipo === "chega" && (
                    <> Nesse passo, {projecao.dias} dia(s) — <b>{dataBR(projecao.chegaEm)}</b>.</>
                  )}
                  {projecao?.tipo === "nao_chega" && (
                    <> Nesse ritmo <b>não fecha</b>: o que entra por dia não cobre o que sai da janela na virada do mês.</>
                  )}
                  {projecao?.tipo === "sem_cobertura" && (
                    <> Sem histórico suficiente pra projetar a data ({projecao.diasCobertos} de {projecao.diasNecessarios} dias da janela).</>
                  )}
                  {projecao == null && " Sem vendas no período, não dá pra projetar quando chega."}
                </div>

                {/* O que SAI da janela é a diferença entre esta data e a conta
                    ingênua — dizer o número evita a pergunta "por que demorou
                    mais do que eu calculei?". */}
                {projecao?.tipo === "chega" && projecao.atravessaViradaDeMes && (
                  <div style={{ color: "var(--muted)", fontSize: ".75rem", marginTop: 4 }}>
                    Considera que {projecao.vendasQueSaem.toLocaleString("pt-BR")} venda(s) e{" "}
                    {fmtBRL(projecao.faturamentoQueSai)} saem da janela até lá — a janela anda com o mês.
                  </div>
                )}
                {/* Os dois eixos avançam juntos, mas a projeção segue o pior:
                    prometer a data do eixo adiantado erraria sempre pra menos. */}
                {p.vendas.ok !== p.faturamento.ok && (
                  <div style={{ color: "var(--muted)", fontSize: ".75rem", marginTop: 4 }}>
                    {p.gargalo === "vendas"
                      ? "O faturamento já fechou — o que trava é a contagem de vendas. Girar volume vale mais aqui que subir preço."
                      : "As vendas já fecharam — o que trava é o faturamento. Aqui ticket e mix pesam mais que volume."}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

{/*
        A qualidade tem janela propria — e o criterio da REPUTACAO, nao o da
        medalha, e os limites sao os publicados pelo ML.

        O rotulo dizia "nos ultimos 60 dias" fixo. A documentacao oficial e
        clara: no MLB o periodo e de 60 dias so pra quem teve 60 ou mais vendas
        nos ultimos 60 dias; abaixo disso o ML avalia 365 dias. Cada metrica
        vem com o proprio `period` na resposta, e e ele que a tela mostra.
      */}
      <div style={{ borderTop: p ? "1px solid var(--border)" : "none", paddingTop: p ? 12 : 0 }}>
        <div style={{ fontSize: ".75rem", color: "var(--muted)", marginBottom: 6 }}>
          Qualidade — {janelaDaQualidade} · base de {vendasReputacao} vendas concluídas
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {qualidade.map((q) => (
            <div key={q.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", fontSize: ".82rem" }}>
              <span>
                <span style={{ color: q.ok === false ? "var(--red)" : q.ok ? "var(--green)" : "var(--muted)", fontWeight: 800 }}>
                  {q.ok === false ? "✕" : q.ok ? "✓" : "—"}
                </span>{" "}
                {q.label}
                <span style={{ color: "var(--muted)", fontSize: ".75rem" }}>
                  {" "}· limite {(q.limite * 100).toFixed(q.limite < 0.01 ? 1 : 0)}%
                </span>
              </span>
              <span style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                <b>{q.taxa == null ? "—" : `${fmtPct((q.taxa * 100), 2)}`}</b>
                {/* Protegido: o ML zera o numero visivel e guarda o real em
                    `excluded`. A tela mostra o real — a protecao acaba numa
                    data, e o zero so adia a noticia. */}
                {q.protegida && (
                  <span style={{ color: "var(--warning)", fontSize: ".75rem" }} title="Valor real; a proteção de reputação está escondendo este número no painel do ML">
                    {" "}(protegida)
                  </span>
                )}
                {q.casos != null && <span style={{ color: "var(--muted)" }}> ({q.casos})</span>}
                {/* A folga em CASOS é o que dá pra agir: "0,22%" não diz se
                    está perto do limite; "cabem mais 54" diz. */}
                {q.folgaEmCasos != null ? (
                  <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>
                    cabem mais {q.folgaEmCasos}
                  </div>
                ) : q.taxa != null && (
                  /*
                    Sem a base certa, nao ha "cabem mais X".

                    O atraso no envio divide por "vendas enviadas com ME2", nao
                    pelo total de vendas, e esse numero so aparece quando ja ha
                    algum caso. Antes a tela usava o total pras tres metricas e
                    mostrava um numero que nao correspondia a nada.
                  */
                  <div style={{ fontSize: ".75rem", color: "var(--muted)" }} title="A base desta métrica não vem na resposta do ML">
                    sem base pra converter em casos
                  </div>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ─── OS REQUISITOS QUE NÃO ESCALAM ──────────────────────────────
          Valem igual pras três medalhas, e são a resposta pra "bati vendas e
          faturamento, por que não subi?". Sem eles a tela responderia só
          metade da pergunta. */}
      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: "pointer", fontSize: ".82rem", color: "var(--muted)" }}>
          Requisitos que valem pra qualquer medalha ({REQUISITOS_COMUNS.length})
        </summary>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
          {REQUISITOS_COMUNS.map((r) => (
            <div key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: ".82rem" }}>
              <span>{r.label}</span>
              <span style={{ color: "var(--muted)", textAlign: "right", whiteSpace: "nowrap" }}>{r.exigencia}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: ".75rem", color: "var(--muted)", marginTop: 8 }}>
          Fonte: página oficial &quot;Tudo sobre ser MercadoLíder&quot; do Mercado Livre, lida em 07/09/2026.
          O faturamento do critério não conta vendas vindas de anúncios Grátis.
        </div>
      </details>
    </div>
  );
}

/**
 * Uma barra por eixo, com o alvo escrito ao lado.
 *
 * O alvo aparece SEMPRE, mesmo com a barra cheia: "575" é o que transforma
 * "520 vendas" em informação — sem ele o número é só um número.
 */
function BarraEixo({ titulo, eixo, formato, gargalo }: {
  titulo: string;
  eixo: EixoMedalha;
  formato: (n: number) => string;
  gargalo: boolean;
}) {
  const pct = Math.min(100, Math.max(0, eixo.pct));
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, fontSize: ".8rem" }}>
        <span>
          {titulo}
          {gargalo && (
            <span
              className="chip chip-muted" style={{ marginLeft: 6, fontSize: ".75rem" }}
              title="É o eixo mais atrasado — é ele que está segurando a medalha."
            >
              trava aqui
            </span>
          )}
        </span>
        <span style={{ whiteSpace: "nowrap" }}>
          <b style={{ color: eixo.ok ? "var(--green)" : "var(--text)" }}>{formato(eixo.atual)}</b>
          <span style={{ color: "var(--muted)" }}> / {formato(eixo.alvo)}</span>
        </span>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: "var(--surface2)", margin: "4px 0 2px", overflow: "hidden" }}>
        <div style={{
          width: `${pct}%`, height: "100%",
          background: eixo.ok ? "var(--green)" : gargalo ? "var(--warning)" : "var(--accent)",
        }} />
      </div>
      <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>
        {eixo.ok ? "critério fechado" : `${fmtPct(eixo.pct, 0)} · faltam ${formato(eixo.falta)}`}
      </div>
    </div>
  );
}
