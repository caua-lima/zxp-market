"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogo } from "@/components/useDialogo";
import { fmtBRL } from "@/lib/domain/calc";
import { haQuantoTempo, relogioBR, ritmoVsOntem, type MetaDoDia, type ProdutoAoVivo, type ResumoAoVivo } from "@/lib/domain/ao-vivo";
import { caminhoSuave, escalaRedonda } from "@/lib/domain/grafico-linha";
import WidgetIphone from "@/components/WidgetIphone";
import s from "./PainelAoVivo.module.css";

/**
 * O painel "Vendas de hoje ao vivo" — o do Mercado Livre, dentro do app: o valor
 * do dia em destaque, as métricas-chave, a tendência hora a hora contra ontem e
 * os produtos que mais faturaram.
 *
 * Os números vêm de /api/ml/ao-vivo, com as MESMAS regras do Dashboard (só venda
 * válida), então este painel e o card "Vendas — Hoje" nunca discordam.
 */

export type ProdutoDoDia = ProdutoAoVivo & { imagem: string | null; estoque: number | null };
export type DadosAoVivo = Omit<ResumoAoVivo, "topProdutos"> & {
  topProdutos: ProdutoDoDia[];
  /** Visitas de hoje (API do ML). `null` = não consegui perguntar — nunca zero. */
  visitas: number | null;
  /** A meta de hoje. Ausente (rota antiga) ou null = sem meta configurada. */
  metaDoDia?: MetaDoDia | null;
  fonte: "ml" | "banco";
  /** Vendas presenciais (PDV) de hoje, já somadas no dia. Ausente/null = nenhuma. */
  presencial?: { faturamento: number; vendas: number } | null;
  atualizadoEm: number;
};

const FUSO = "America/Sao_Paulo";
const ESTOQUE_BAIXO = 5;

const fmtInt = (n: number) => n.toLocaleString("pt-BR");
const fmtDia = (ms: number) => new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: FUSO }).format(ms);
const fmtHora = (ms: number) => new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: FUSO }).format(ms);

/** Largura do contêiner, acompanhando o redimensionamento (o gráfico desenha em pixels, com fonte legível). */
function useLargura(ref: React.RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

function GraficoHoras({ hoje, ontem, horaAtual }: { hoje: number[]; ontem: number[]; horaAtual: number }) {
  const caixa = useRef<HTMLDivElement | null>(null);
  const largura = useLargura(caixa);
  const [foco, setFoco] = useState<number | null>(null);

  const ALTURA = 240;
  const M = { e: 46, d: 14, t: 14, b: 28 };
  // Antes da primeira medição (ou com a janela escondida, onde o ResizeObserver não dispara) desenha numa largura
  // padrão — `max-width:100%` no CSS encolhe se for preciso. Gráfico em branco seria pior.
  const w = Math.max(largura || 560, 240);
  const pw = w - M.e - M.d;
  const ph = ALTURA - M.t - M.b;

  const maior = Math.max(0, ...hoje.slice(0, horaAtual + 1), ...ontem);
  const escala = escalaRedonda(maior);
  const x = (h: number) => M.e + (h / 23) * pw;
  const y = (v: number) => M.t + ph * (1 - v / escala.max);

  const ptsOntem = ontem.map((v, h) => ({ x: x(h), y: y(v) }));
  const ptsHoje = hoje.slice(0, horaAtual + 1).map((v, h) => ({ x: x(h), y: y(v) }));
  const ultimo = ptsHoje.at(-1);

  const horaDoPonteiro = (clientX: number): number => {
    const r = caixa.current?.getBoundingClientRect();
    if (!r) return 0;
    return Math.min(23, Math.max(0, Math.round(((clientX - r.left - M.e) / pw) * 23)));
  };

  return (
    <div
      ref={caixa}
      className={s.grafico}
      onPointerMove={(e) => setFoco(horaDoPonteiro(e.clientX))}
      onPointerDown={(e) => setFoco(horaDoPonteiro(e.clientX))}
      onPointerLeave={(e) => { if (e.pointerType === "mouse") setFoco(null); }}
    >
      {(
        <svg width={w} height={ALTURA} viewBox={`0 0 ${w} ${ALTURA}`} role="img" aria-label={`Vendas por hora, hoje contra ontem. Hoje até as ${horaAtual} horas, ontem o dia todo.`}>
          {escala.passos.map((p) => (
            <g key={p}>
              <line x1={M.e} x2={w - M.d} y1={y(p)} y2={y(p)} className={s.grade} />
              <text x={M.e - 8} y={y(p) + 4} textAnchor="end" className={s.eixo}>{fmtInt(p)}</text>
            </g>
          ))}
          {Array.from({ length: 12 }, (_, i) => i * 2).map((h) => (
            <text key={h} x={x(h)} y={ALTURA - 8} textAnchor="middle" className={s.eixo}>{String(h).padStart(2, "0")}</text>
          ))}
          <path d={caminhoSuave(ptsOntem)} className={s.linhaOntem} fill="none" />
          {ptsHoje.length > 1 && (
            <path d={`${caminhoSuave(ptsHoje)} L${ultimo!.x} ${M.t + ph} L${ptsHoje[0].x} ${M.t + ph} Z`} className={s.areaHoje} />
          )}
          <path d={caminhoSuave(ptsHoje)} className={s.linhaHoje} fill="none" />
          {ultimo && <circle cx={ultimo.x} cy={ultimo.y} r={5} className={s.pontoHoje} />}
          {foco != null && <line x1={x(foco)} x2={x(foco)} y1={M.t} y2={M.t + ph} className={s.guia} />}
        </svg>
      )}
      {foco != null && (
        <div className={s.dica} style={{ left: Math.min(Math.max(x(foco), 70), w - 70) }} role="status">
          <b>{String(foco).padStart(2, "0")}h</b>
          <span className={s.dicaHoje}>Hoje {foco <= horaAtual ? fmtBRL(hoje[foco]) : "—"}</span>
          <span className={s.dicaOntem}>Ontem {fmtBRL(ontem[foco])}</span>
        </div>
      )}
    </div>
  );
}

/**
 * A meta de HOJE dentro do cartão do valor: quanto falta pra ela e a barra. Mesma
 * conta do Dashboard (o que falta do mês até ontem ÷ dias que restam).
 */
function MetaDeHoje({ m, vendido }: { m: MetaDoDia; vendido: number }) {
  if (m.mesBatido) {
    return <div className={s.meta}><div className={s.metaLinha}><span>Meta {m.metaIndex} do mês já batida ✓</span></div></div>;
  }
  const largura = Math.min(Math.max(m.pct, 0), 100);
  return (
    <div className={s.meta}>
      <div className={s.metaLinha}>
        <span>Meta de hoje <b>{fmtBRL(m.alvo)}</b></span>
        <span className={s.metaPct} data-batida={m.batida ? "true" : undefined}>{Math.round(m.pct)}%</span>
      </div>
      <div
        className={s.metaTrilho} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(largura)}
        aria-valuetext={`${fmtBRL(vendido)} de ${fmtBRL(m.alvo)} da meta de hoje`}
      >
        <i style={{ width: `${largura}%` }} data-batida={m.batida ? "true" : undefined} />
      </div>
      <div className={s.metaRodape}>{m.batida ? `✓ Batida — ${fmtBRL(vendido - m.alvo)} acima` : `Faltam ${fmtBRL(m.falta)} pra meta de hoje`}</div>
    </div>
  );
}

function Tile({ rotulo, valor, dica }: { rotulo: string; valor: string; dica?: string }) {
  return (
    <div className={s.tile} title={dica}>
      <div className={s.tileRotulo}>{rotulo}</div>
      <div className={s.tileValor}>{valor}</div>
    </div>
  );
}

export default function PainelAoVivo({ dados, onFechar }: { dados: DadosAoVivo; onFechar: () => void }) {
  const painel = useRef<HTMLDivElement | null>(null);
  useDialogo(true, painel, onFechar);

  // O relógio do painel anda sozinho; os números só mudam quando uma resposta nova chega.
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const [tela, setTela] = useState(false);
  useEffect(() => {
    const aoMudar = () => setTela(document.fullscreenElement != null);
    document.addEventListener("fullscreenchange", aoMudar);
    return () => document.removeEventListener("fullscreenchange", aoMudar);
  }, []);
  const podeTelaCheia = typeof document !== "undefined" && document.fullscreenEnabled === true;
  const alternarTela = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void painel.current?.requestFullscreen().catch(() => {});
  };

  const { hoje, ontemAteAgora, ultimaVenda, visitas } = dados;
  const ritmo = ritmoVsOntem(hoje.vendas, ontemAteAgora.vendas, relogioBR(dados.atualizadoEm));
  const conversao = visitas != null && visitas > 0 ? (hoje.pedidos / visitas) * 100 : null;
  const precoMedio = hoje.unidades > 0 ? hoje.vendas / hoje.unidades : null;

  return createPortal(
    <div className={s.painel} ref={painel} role="dialog" aria-modal="true" aria-label="Vendas de hoje ao vivo" tabIndex={-1}>
      <div className={s.hero} data-com-meta={dados.metaDoDia ? "true" : undefined}>
        <div className={s.acoesTopo}>
          {podeTelaCheia && (
            <button type="button" className={s.iconeBtn} onClick={alternarTela} aria-label={tela ? "Sair da tela cheia" : "Tela cheia"} title={tela ? "Sair da tela cheia" : "Tela cheia"}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={tela ? "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" : "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"} />
              </svg>
            </button>
          )}
          <button type="button" className={s.iconeBtn} onClick={onFechar} aria-label="Fechar o painel ao vivo" title="Fechar (Esc)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <h2 className={s.titulo}>Vendas de hoje ao vivo</h2>
        <div className={s.relogio}>
          <span className={s.ponto} data-parado={dados.fonte === "banco" ? "true" : undefined} aria-hidden />
          {fmtDia(agora)}, {fmtHora(agora)}
        </div>

        <div className={s.valorCaixa}>
          <div className={s.valor}>{fmtBRL(hoje.vendas)}</div>
          {ritmo && <div className={s.ritmo} data-tom={ritmo.tom}>{ritmo.texto}</div>}
          {dados.metaDoDia && <MetaDeHoje m={dados.metaDoDia} vendido={hoje.vendas} />}
        </div>
      </div>

      {dados.fonte === "banco" && (
        <div className={s.aviso} role="status">
          O Mercado Livre não respondeu agora — estes são os pedidos já sincronizados, não o ao vivo.
        </div>
      )}

      <div className={s.grade3}>
        <section className={s.cartao} aria-labelledby="pav-metricas">
          <h3 id="pav-metricas" className={s.cartaoTitulo}>Métricas-chave</h3>
          <div className={s.tiles}>
            <Tile rotulo="Visitas" valor={visitas != null ? fmtInt(visitas) : "—"} dica="Visitas de hoje nos seus anúncios, pela API do ML (não deduplicadas por visitante)." />
            <Tile rotulo="Total de compradores" valor={fmtInt(dados.compradores)} />
            <Tile rotulo="Quantidade de vendas" valor={fmtInt(hoje.pedidos)} />
            <Tile rotulo="Conversão" valor={conversao != null ? `${conversao.toFixed(2).replace(".", ",")}%` : "—"} dica="Vendas ÷ visitas de hoje." />
            <Tile rotulo="Unidades vendidas" valor={`${fmtInt(hoje.unidades)} u.`} />
            <Tile rotulo="Preço médio" valor={precoMedio != null ? fmtBRL(precoMedio) : "—"} dica="Vendas ÷ unidades vendidas." />
          </div>
          {hoje.canceladoPedidos > 0 && (
            <p className={s.nota}>
              Fora da conta: {hoje.canceladoPedidos} {hoje.canceladoPedidos === 1 ? "pedido cancelado ou devolvido" : "pedidos cancelados ou devolvidos"} ({fmtBRL(hoje.canceladoValor)}).
            </p>
          )}
        </section>

        <section className={`${s.cartao} ${s.cartaoGrafico}`} aria-labelledby="pav-tendencia">
          <div className={s.cartaoCabeca}>
            <h3 id="pav-tendencia" className={s.cartaoTitulo}>Tendências em vendas brutas</h3>
            <div className={s.legenda} aria-hidden>
              <span><i className={s.legHoje} /> Hoje</span>
              <span><i className={s.legOntem} /> Ontem</span>
            </div>
          </div>
          <GraficoHoras hoje={dados.porHora.hoje} ontem={dados.porHora.ontem} horaAtual={dados.horaAtual} />
          <p className={s.nota}>
            Vendas por hora (R$). Hoje até as {dados.horaAtual}h: {fmtBRL(hoje.vendas)} · ontem no mesmo horário: {fmtBRL(ontemAteAgora.vendas)}.
          </p>
        </section>

        <section className={s.cartao} aria-labelledby="pav-top">
          <h3 id="pav-top" className={s.cartaoTitulo}>Produtos mais vendidos</h3>
          {dados.topProdutos.length === 0 ? (
            <p className={s.vazio}>Nenhuma venda hoje ainda.</p>
          ) : (
            <ol className={s.lista}>
              {dados.topProdutos.map((p, i) => (
                <li key={p.itemId} className={s.produto} data-primeiro={i === 0 ? "true" : undefined}>
                  <span className={s.posicao}>{i + 1}</span>
                  {p.imagem
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={p.imagem} alt="" className={s.foto} loading="lazy" referrerPolicy="no-referrer" />
                    : <span className={s.foto} aria-hidden />}
                  <div className={s.produtoTexto}>
                    <div className={s.produtoTitulo} title={p.titulo}>{p.titulo || p.itemId}</div>
                    <div>Vendas do dia: <b>{fmtBRL(p.receita)}</b> · {fmtInt(p.unidades)} {p.unidades === 1 ? "unidade" : "unidades"}</div>
                    {p.estoque != null && (
                      <div className={p.estoque <= ESTOQUE_BAIXO ? s.estoqueBaixo : undefined}>
                        Estoque: <b>{fmtInt(p.estoque)}</b> {p.estoque === 1 ? "unidade" : "unidades"}{p.estoque <= ESTOQUE_BAIXO && " — baixo"}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <WidgetIphone />

      <footer className={s.rodape}>
        Atualizado às {fmtHora(dados.atualizadoEm)}
        {ultimaVenda && <> · última venda {fmtBRL(ultimaVenda.valor)} {haQuantoTempo(ultimaVenda.em, agora)}</>}
        {dados.presencial && <> · inclui {fmtBRL(dados.presencial.faturamento)} do balcão ({dados.presencial.vendas} {dados.presencial.vendas === 1 ? "venda presencial" : "vendas presenciais"})</>}
        {" "}· só vendas válidas, a mesma base do Dashboard
      </footer>
    </div>,
    document.body,
  );
}
