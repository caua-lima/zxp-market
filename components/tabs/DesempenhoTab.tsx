"use client";

import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/api/authed-fetch";
import TelaHeader from "@/components/TelaHeader";
import ReputacaoPanel from "./desempenho/ReputacaoPanel";
import ProximaMedalhaPanel from "@/components/tabs/desempenho/ProximaMedalhaPanel";
import RequisitosMercadoLiderPanel from "./desempenho/RequisitosMercadoLiderPanel";
import CompradoresPanel from "./desempenho/CompradoresPanel";
import HeatmapVendas from "./desempenho/HeatmapVendas";
import EntregasPanel from "./desempenho/EntregasPanel";
import BackfillHistorico from "./desempenho/BackfillHistorico";
import type { DesempenhoResponse } from "./desempenho/desempenho-types";
import { dataBR, diasCobrindoMesPassado, diasDesdeInicioDoMes, hojeNaOperacao, limitesDoMes, rotuloDesdeMesPassado } from "@/lib/domain/periodos";

const OPCOES_MESES = [3, 6, 12, 24];
/**
 * Janelas curtas, em dias. Existem pra dar pra CONFERIR o numero contra o
 * painel "Detalhe dos compradores" do proprio Mercado Livre, que trabalha em
 * periodos curtos — sem isso nao havia como saber se a nossa taxa bate com a
 * deles. 7 dias e o padrao que o ML abre.
 */
const OPCOES_DIAS = [7, 15, 30];


/*
 * Os períodos "este mês" e "desde o mês passado" vêm de lib/domain/periodos, que conta o
 * dia em Brasília e não depende do relógio do navegador. A rota recebe `dias=N` (dias pra
 * trás a partir de hoje), então "mês passado" NÃO é um intervalo fechado: cobre o mês
 * passado inteiro MAIS o mês em curso até hoje. O botão diz isso no próprio rótulo.
 */

/**
 * Uma seção da aba, com o título e — o que importa — a ORIGEM do que vem
 * embaixo.
 *
 * Sem a origem, um requisito que o ML não expõe por API aparece do lado de
 * uma métrica oficial com o mesmo peso visual, e a tela passa a parecer que
 * está afirmando coisas que não mediu.
 */
function SecaoDesempenho({ titulo, origem, children }: {
  titulo: string;
  origem: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginTop: 18 }}>
      <div style={{ marginBottom: 8 }}>
        <h3 style={{
          margin: 0, fontSize: ".78rem", fontWeight: 700,
          letterSpacing: ".07em", textTransform: "uppercase", color: "var(--text)",
        }}>
          {titulo}
        </h3>
        <div style={{ fontSize: ".75rem", color: "var(--muted)", marginTop: 2 }}>{origem}</div>
      </div>
      {children}
    </section>
  );
}
export default function DesempenhoTab() {
  const [months, setMonths] = useState(12);
  // null = periodo em meses; numero = periodo em dias (tem prioridade).
  const [dias, setDias] = useState<number | null>(7);
  const [dados, setDados] = useState<DesempenhoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const carregar = useCallback(async (fresh = false) => {
    if (fresh) setRefreshing(true); else setLoading(true);
    setErro(false);
    try {
      const q = dias != null ? `dias=${dias}` : `months=${months}`;
      const r = await authedFetch(`/api/ml/desempenho?${q}${fresh ? "&fresh=1" : ""}`, { cache: "no-store" });
      if (!r.ok) { setErro(true); return; }
      const j = await r.json();
      setDados(j);
    } catch {
      setErro(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [months, dias]);

  // Falso positivo comprovado (mesmo padrão do resto do app): fetch no
  // mount/troca de período — carregar() faz setState de forma assíncrona,
  // não o corpo do efeito em si.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { carregar(); }, [carregar]);

  // O dia em Brasília, lido a cada pintura: o botão "ativo" acompanha a virada do dia.
  const hoje = hojeNaOperacao();
  const diasEsteMes = diasDesdeInicioDoMes(hoje);
  const diasDesdeMesPassado = diasCobrindoMesPassado(hoje);
  const rotuloMesPassado = rotuloDesdeMesPassado(hoje);

  return (
    <div className="dash">
      <TelaHeader
        titulo="Desempenho"
        extra={(
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {/* Atalhos de mês, antes dos dias avulsos: "este mês" e "mês passado"
              são o recorte que o usuário usa pra fechar resultado, e sem eles
              era preciso contar dias na mão pra chegar no mesmo lugar. */}
          <div className="seg" role="group" aria-label="Este mês ou desde o mês passado">
            <button
              type="button"
              className={`seg-btn ${dias === diasEsteMes ? "active" : ""}`}
              aria-pressed={dias === diasEsteMes}
              onClick={() => setDias(diasEsteMes)}
              title={`De ${dataBR(limitesDoMes(hoje).de)} até hoje (${dataBR(hoje)})`}
            >
              Este mês
            </button>
            <button
              type="button"
              className={`seg-btn ${dias === diasDesdeMesPassado ? "active" : ""}`}
              aria-pressed={dias === diasDesdeMesPassado}
              onClick={() => setDias(diasDesdeMesPassado)}
              title={rotuloMesPassado.longo}
            >
              {rotuloMesPassado.curto}
            </button>
          </div>
          <div className="seg">
            {OPCOES_DIAS.map((d) => (
              <button key={`d${d}`} type="button" className={`seg-btn ${dias === d ? "active" : ""}`} onClick={() => setDias(d)}>
                {d}d
              </button>
            ))}
            {/* Inclui a janela recomendada pelo painel de compradores quando ela
                não é uma das opções fixas — senão o botão trocaria o período e
                nenhum item ficaria marcado como ativo. */}
            {Array.from(new Set([...OPCOES_MESES, months])).sort((a, b) => a - b).map((m) => (
              <button key={m} type="button" className={`seg-btn ${dias == null && months === m ? "active" : ""}`} onClick={() => { setDias(null); setMonths(m); }}>
                {m}m
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => carregar(true)} disabled={refreshing}>
            {refreshing ? "Atualizando…" : "⟳ Atualizar"}
          </button>
        </div>
        )}
      />
      <div style={{ fontSize: ".8rem", color: "var(--muted)", marginTop: -6 }}>
        Reputação/selo Mercado Líder, taxa de recompra, concentração de vendas por dia/horário e entregas no
        prazo — tudo derivado de dados reais (pedidos sincronizados e reputação da API do ML), sem inventar
        número que a gente não tem como confirmar.
      </div>

      {loading ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--muted)" }}>Carregando…</div>
      ) : erro || !dados ? (
        <div style={{ padding: 20, color: "var(--red-text)", fontSize: ".85rem" }}>
          Não consegui carregar os dados de desempenho agora. Tente atualizar.
        </div>
      ) : (
        <>
          {/*
            ─── A ORDEM VIROU PRECEDÊNCIA, E NÃO O QUE O VIEWPORT DECIDIR ──

            Os quatro painéis viviam num `auto-fit` de minmax(min(320px,100%),1fr):
            numa tela larga viravam quatro colunas lado a lado, todas com o
            mesmo peso; numa estreita, uma fila. Em nenhum dos dois casos a
            tela dizia qual ler primeiro.

            E há uma ordem certa, porque os quatro têm origens diferentes e
            confiabilidades diferentes:

              1. o que o ML AFIRMA sobre a conta (medido por eles);
              2. o que ainda falta pra próxima medalha (deles + meta nossa);
              3. o que o ML NÃO expõe e não dá pra verificar por API;
              4. o que a gente calcula por conta própria a partir dos pedidos.

            Ler o 3 antes do 1 é o caminho pra confundir requisito não
            verificável com métrica oficial — e o app passa a parecer que
            está afirmando coisas que não mediu.

            Os cabeçalhos de seção existem pra isso: dizem DE ONDE vem o que
            está embaixo deles.
          */}

          <SecaoDesempenho titulo="Estado oficial" origem="medido e publicado pelo Mercado Livre">
            <ReputacaoPanel reputation={dados.reputacao} indisponivel={dados.reputacaoIndisponivel} />
          </SecaoDesempenho>

          <SecaoDesempenho
            titulo="Próxima medalha"
            origem="qualidade medida pelo ML; o alvo de faturamento é digitado por você — o ML não expõe o limiar"
          >
            <ProximaMedalhaPanel
              metrics={dados.reputacao?.metrics}
              nivelAtual={dados.reputacao?.power_seller_status}
            />
          </SecaoDesempenho>

          <SecaoDesempenho
            titulo="Requisitos que não dá pra verificar por aqui"
            origem="o ML não expõe estes por API — confira no Seller Center"
          >
            <RequisitosMercadoLiderPanel
              requisitos={dados.requisitosMercadoLider}
              registrationDate={dados.registrationDate}
              vendasConcluidas={dados.reputacao?.transactions?.completed}
              jaEhLider={!!dados.reputacao?.power_seller_status}
            />
          </SecaoDesempenho>

          <SecaoDesempenho
            titulo="Cálculo local"
            origem="apurado aqui, a partir dos pedidos sincronizados — pode divergir do painel do ML"
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px,100%),1fr))", gap: 16 }}>
              <CompradoresPanel
                compradores={dados.compradores}
                months={dados.months}
                periodoInicio={dados.from}
                historicoDesde={dados.historicoDesde}
                to={dados.to}
                dias={dados.dias}
                semComprador={dados.semComprador}
                onUsarJanela={(m) => { setDias(null); setMonths(m); }}
              />
              <EntregasPanel entregas={dados.entregas} />
            </div>
          </SecaoDesempenho>

          {/* Fica logo abaixo do painel de compradores: e onde a falta de
              historico se manifesta (recompra travada). */}
          <BackfillHistorico onConcluir={() => carregar(true)} />

          {/*
            Entregas subiu pra seção de cálculo local, junto de compradores:
            os dois saem dos pedidos sincronizados, e separá-los fazia parecer
            que tinham origens diferentes.
          */}
          <HeatmapVendas heatmap={dados.heatmap} from={dados.from} to={dados.to} />
        </>
      )}
    </div>
  );
}
