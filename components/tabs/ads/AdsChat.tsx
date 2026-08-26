"use client";

import { useMemo, useRef, useState } from "react";
import { fmtBRL } from "@/lib/domain/calc";
import { interpretarPergunta, type Intencao } from "@/lib/domain/ads-chat";
import { analisarAnuncio, ordenarPorUrgencia, type VeredictoAds } from "@/lib/domain/ads-consultor";
import { num, type LinhaAds } from "./ads-types";
import ChatFlutuante from "@/components/ChatFlutuante";

/**
 * Consultor de Ads em forma de conversa.
 *
 * Toda a inteligência mora em dois módulos puros e testados:
 * `ads-chat.ts` (entender a pergunta) e `ads-consultor.ts` (decidir). Aqui é
 * só apresentação — o que garante que nenhum número exibido seja diferente do
 * que a tabela ao lado mostra.
 *
 * Não usa IA de propósito; o porquê está no cabeçalho de ads-chat.ts. Em
 * resumo: número de dinheiro não pode ser gerado por modelo de linguagem, e
 * este domínio é fechado o bastante pra não precisar.
 */

type Msg = { de: "voce" | "consultor"; texto: string; blocos?: BlocoResposta[] };

type BlocoResposta = {
  titulo: string;
  tone: VeredictoAds["tone"];
  motivo: string;
  metricas: { rotulo: string; valor: string; destaque?: boolean }[];
};

const TOM_COR: Record<VeredictoAds["tone"], string> = {
  pos: "var(--green)",
  warn: "var(--warning)",
  critical: "var(--red)",
  info: "var(--muted)",
};

const EXEMPLOS = [
  "O que fazer com o Menta Stronger?",
  "O que está dando prejuízo?",
  "Me traga os dados do Eucalipto",
  "Como está o Ads no geral?",
];

/** As métricas que o operador pediu, na ordem em que ele decide. */
function metricasDe(l: LinhaAds): BlocoResposta["metricas"] {
  return [
    { rotulo: "Investido", valor: fmtBRL(l.i.cost) },
    { rotulo: "Vendas", valor: fmtBRL(l.v) },
    { rotulo: "ROAS", valor: l.i.cost > 0 ? `${num(l.r, 2)}x` : "—" },
    { rotulo: "Lucro", valor: l.lucroAtual != null ? fmtBRL(l.lucroAtual) : "sem dado", destaque: true },
    { rotulo: "Margem", valor: l.margemAtual != null ? `${num(l.margemAtual, 1)}%` : "sem dado" },
    // A métrica que o operador chamou de mais importante: quanto da venda
    // deste produto depende do Ads.
    { rotulo: "% da venda via Ads", valor: l.i.totalSales > 0 ? `${num(l.pctAds, 1)}%` : "sem venda", destaque: true },
  ];
}

function blocoDe(l: LinhaAds, metaMargem: number): BlocoResposta {
  const v = analisarAnuncio({
    titulo: l.i.title,
    vendas: l.v,
    custo: l.i.cost,
    lucro: l.lucroAtual,
    margem: l.margemAtual,
    roas: l.r,
    pctAds: l.i.totalSales > 0 ? l.pctAds : null,
    lucroAntesAds: l.i.lucroAntesAds,
    cliques: l.i.clicks,
    metaMargem,
  });
  return { titulo: `${l.i.title} — ${v.titulo}`, tone: v.tone, motivo: v.motivo, metricas: metricasDe(l) };
}

export default function AdsChat({ linhas, metaMargem }: { linhas: LinhaAds[]; metaMargem: number }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [texto, setTexto] = useState("");
  const fimRef = useRef<HTMLDivElement>(null);

  const titulos = useMemo(() => linhas.map((l) => l.i.title), [linhas]);

  function responder(pergunta: string): Msg {
    const { intencao, alvos, termo } = interpretarPergunta(pergunta, titulos);

    const semDado = (t: string): Msg => ({ de: "consultor", texto: t });

    if (linhas.length === 0) {
      return semDado("Não há anúncios no período selecionado. Ajuste as datas no topo da aba e pergunte de novo.");
    }

    switch (intencao as Intencao) {
      case "analisar":
      case "info": {
        // Os dois casos mostram os mesmos números; a análise soma o veredito.
        const blocos = alvos.slice(0, 5).map((i) => blocoDe(linhas[i], metaMargem));
        const nomes = alvos.length > 5 ? ` (mostrando 5 de ${alvos.length})` : "";
        return {
          de: "consultor",
          texto: alvos.length === 1
            ? "Aqui está a leitura deste anúncio:"
            : `Achei ${alvos.length} anúncios que batem com "${termo}"${nomes}:`,
          blocos,
        };
      }

      case "listar-ruins": {
        const comVeredicto = linhas.map((l) => ({
          l,
          veredicto: analisarAnuncio({
            titulo: l.i.title, vendas: l.v, custo: l.i.cost, lucro: l.lucroAtual,
            margem: l.margemAtual, roas: l.r,
            pctAds: l.i.totalSales > 0 ? l.pctAds : null,
            lucroAntesAds: l.i.lucroAntesAds, cliques: l.i.clicks, metaMargem,
          }),
          lucro: l.lucroAtual,
        }));
        const problemas = ordenarPorUrgencia(comVeredicto).filter(
          (x) => x.veredicto.acao === "desligar" || x.veredicto.acao === "corrigir-produto"
            || (x.veredicto.acao === "ajustar-roas" && (x.lucro ?? 0) < 0),
        );
        if (problemas.length === 0) {
          return semDado("Nenhum anúncio no período pede ação urgente — nada dando prejuízo com dado suficiente pra concluir.");
        }
        return {
          de: "consultor",
          texto: `${problemas.length} anúncio(s) pedindo atenção, do mais urgente pro menos:`,
          blocos: problemas.slice(0, 5).map((x) => blocoDe(x.l, metaMargem)),
        };
      }

      case "listar-bons": {
        const bons = linhas
          .filter((l) => (l.lucroAtual ?? 0) > 0)
          .sort((a, b) => (b.lucroAtual ?? 0) - (a.lucroAtual ?? 0));
        if (bons.length === 0) return semDado("Nenhum anúncio com lucro apurado positivo no período.");
        return {
          de: "consultor",
          texto: `${bons.length} anúncio(s) com lucro positivo, do maior pro menor:`,
          blocos: bons.slice(0, 5).map((l) => blocoDe(l, metaMargem)),
        };
      }

      case "resumo": {
        const investido = linhas.reduce((s, l) => s + l.i.cost, 0);
        const vendas = linhas.reduce((s, l) => s + l.v, 0);
        const comLucro = linhas.filter((l) => l.lucroAtual != null);
        const lucro = comLucro.reduce((s, l) => s + (l.lucroAtual ?? 0), 0);
        const roasGeral = investido > 0 ? vendas / investido : 0;
        const negativos = comLucro.filter((l) => (l.lucroAtual ?? 0) < 0).length;
        const semVinculo = linhas.length - comLucro.length;

        return {
          de: "consultor",
          texto: "Panorama do período:",
          blocos: [{
            titulo: `${linhas.length} anúncios · ${fmtBRL(investido)} investidos`,
            tone: lucro >= 0 ? "pos" : "critical",
            motivo:
              `${fmtBRL(vendas)} de venda no Ads, ROAS geral ${num(roasGeral, 2)}x, resultado ${fmtBRL(lucro)}. `
              + (negativos > 0
                ? `${negativos} anúncio(s) estão no vermelho — pergunte "o que está dando prejuízo?" pra ver quais.`
                : "Nenhum anúncio no vermelho com dado apurado.")
              + (semVinculo > 0
                ? ` ${semVinculo} anúncio(s) sem produto vinculado no Estoque, então não entram no cálculo de lucro.`
                : ""),
            metricas: [
              { rotulo: "Investido", valor: fmtBRL(investido) },
              { rotulo: "Vendas", valor: fmtBRL(vendas) },
              { rotulo: "ROAS geral", valor: `${num(roasGeral, 2)}x` },
              { rotulo: "Resultado", valor: fmtBRL(lucro), destaque: true },
            ],
          }],
        };
      }

      case "nao-encontrado":
        return semDado(
          `Não achei nenhum anúncio com "${termo}" no período selecionado. `
          + `Confira o nome na tabela abaixo — uso o título do anúncio como está no Mercado Livre.`,
        );

      default:
        return semDado(
          "Posso responder sobre os anúncios do período selecionado. Tente algo como "
          + EXEMPLOS.map((e) => `“${e}”`).join(", ") + ".",
        );
    }
  }

  function enviar(pergunta: string) {
    const q = pergunta.trim();
    if (!q) return;
    const resposta = responder(q);
    setMsgs((m) => [...m, { de: "voce", texto: q }, resposta]);
    setTexto("");
    // Rola pro fim depois do paint — a resposta é sempre a última.
    requestAnimationFrame(() => fimRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
  }

  return (
    <ChatFlutuante
      titulo="Consultor de Ads"
      subtitulo="responde com os números desta aba"
      rotuloBotao="Abrir consultor de Ads"
      icone="✦"
      corpo={<>
      {msgs.length === 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: ".82rem", color: "var(--text)", lineHeight: 1.5, marginBottom: 2 }}>
            Pergunte em português sobre os anúncios do período. Por exemplo:
          </div>
          {EXEMPLOS.map((e) => (
            <button
              key={e} type="button" className="btn btn-ghost btn-xs"
              style={{ textAlign: "left", justifyContent: "flex-start", whiteSpace: "normal", lineHeight: 1.4 }}
              onClick={() => enviar(e)}
            >
              {e}
            </button>
          ))}
        </div>
      )}

      {msgs.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {msgs.map((m, idx) => (
            <div key={idx} style={{ alignSelf: m.de === "voce" ? "flex-end" : "flex-start", maxWidth: m.de === "voce" ? "80%" : "100%", width: m.de === "voce" ? undefined : "100%" }}>
              <div
                style={{
                  padding: "9px 12px", borderRadius: 12, fontSize: ".85rem", lineHeight: 1.55,
                  background: m.de === "voce" ? "var(--brand)" : "var(--surface2)",
                  color: m.de === "voce" ? "#10100E" : "var(--text)",
                  fontWeight: m.de === "voce" ? 600 : 400,
                }}
              >
                {m.texto}
              </div>

              {m.blocos?.map((b, bi) => (
                <div
                  key={bi}
                  style={{
                    marginTop: 8, padding: "12px 14px", borderRadius: 10,
                    background: "var(--surface2)", borderLeft: `3px solid ${TOM_COR[b.tone]}`,
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: ".85rem", color: TOM_COR[b.tone], marginBottom: 6 }}>
                    {b.titulo}
                  </div>
                  <div style={{ fontSize: ".82rem", lineHeight: 1.6, color: "var(--text)", marginBottom: 10 }}>
                    {b.motivo}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                    {b.metricas.map((met) => (
                      <div key={met.rotulo} style={{ minWidth: 92 }}>
                        <div style={{ fontSize: ".62rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em", fontWeight: 700 }}>
                          {met.rotulo}
                        </div>
                        <div style={{ fontSize: ".84rem", fontWeight: met.destaque ? 700 : 500, color: met.destaque ? "var(--text)" : "var(--muted)" }}>
                          {met.valor}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
          <div ref={fimRef} />
        </div>
      )}
      </>}
      rodape={
        <form
          onSubmit={(e) => { e.preventDefault(); enviar(texto); }}
          style={{ display: "flex", gap: 6 }}
        >
          <input
            className="inp"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Ex: o que fazer com o Menta Stronger?"
            aria-label="Pergunta sobre os anúncios"
            // 16px evita o zoom automatico do iOS ao focar o campo.
            style={{ fontSize: 16 }}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={!texto.trim()}>
            Perguntar
          </button>
        </form>
      }
    />
  );
}
