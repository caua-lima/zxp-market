"use client";

import { useEffect, useRef, useState } from "react";
import { authedFetch } from "@/lib/api/authed-fetch";
import { onForegroundPush } from "@/lib/firebase/push";
import { fmtBRL } from "@/lib/domain/calc";
import { haQuantoTempo, relogioBR, ritmoVsOntem, type ResumoAoVivo } from "@/lib/domain/ao-vivo";
import { gravarChaveApp, lerChaveApp } from "@/lib/storage";

/**
 * A barra "Ao vivo": o dia de hoje em andamento, logo abaixo do topo, em todas
 * as telas — o painel Ao vivo do Mercado Livre sem precisar abrir o Seller
 * Center nem voltar pro Dashboard.
 *
 * Atualiza sozinha (a cada minuto com a aba visível, e na hora quando chega o
 * aviso de uma venda). Some enquanto não há dado: uma faixa vazia ou com
 * "R$ 0,00" por falha de rede seria pior que faixa nenhuma.
 */

type Dados = ResumoAoVivo & { fonte: "ml" | "banco"; atualizadoEm: number };

const INTERVALO_MS = 60_000;
/** Depois do aviso de venda: o ML leva alguns segundos pra listar o pedido na busca. */
const ESPERA_APOS_AVISO_MS = 4_000;
const CHAVE_RECOLHIDA = "ao-vivo-recolhida";

const COR_DO_TOM = { bom: "var(--green)", ruim: "var(--red-text)", neutro: "var(--muted)" } as const;

export default function BarraAoVivo({ onAbrir }: { onAbrir: () => void }) {
  const [dados, setDados] = useState<Dados | null>(null);
  // O relógio entra no estado (render puro): anda com cada resposta e a cada 30 s.
  const [agora, setAgora] = useState(0);
  const [recolhida, setRecolhida] = useState(() => lerChaveApp(CHAVE_RECOLHIDA) === "1");
  /** Sobe a cada venda nova: reinicia a animação e alimenta o aviso do leitor de tela. */
  const [venda, setVenda] = useState<{ n: number; texto: string }>({ n: 0, texto: "" });
  const pedidosAntes = useRef<{ dia: string; pedidos: number } | null>(null);

  useEffect(() => {
    let vivo = true;
    let ultima = 0;
    let buscando = false;

    const buscar = (urgente = false) => {
      if (buscando) return;
      buscando = true;
      authedFetch(`/api/ml/ao-vivo${urgente ? "?fresh=1" : ""}`, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<Dados>) : null))
        .then((j) => {
          if (!vivo || !j || !j.hoje) return;
          ultima = Date.now();
          const antes = pedidosAntes.current;
          // Só anuncia venda NOVA: não na primeira leitura nem na virada do dia.
          if (antes && antes.dia === j.dia && j.hoje.pedidos > antes.pedidos && j.ultimaVenda) {
            const texto = `Nova venda de ${fmtBRL(j.ultimaVenda.valor)}. Vendas hoje: ${fmtBRL(j.hoje.vendas)}.`;
            setVenda((v) => ({ n: v.n + 1, texto }));
          }
          pedidosAntes.current = { dia: j.dia, pedidos: j.hoje.pedidos };
          setDados(j);
          setAgora(ultima);
        })
        .catch(() => { /* sem rede: fica o último número, com a hora dele */ })
        .finally(() => { buscando = false; });
    };

    buscar();
    // Aba escondida não busca: ninguém está olhando, e cada busca custa uma ida ao ML.
    const ciclo = setInterval(() => { if (document.visibilityState === "visible") buscar(); }, INTERVALO_MS);
    const relogio = setInterval(() => setAgora(Date.now()), 30_000);
    const aoVoltar = () => {
      if (document.visibilityState === "visible" && Date.now() - ultima > INTERVALO_MS / 2) buscar();
    };
    document.addEventListener("visibilitychange", aoVoltar);

    let aposAviso: ReturnType<typeof setTimeout> | undefined;
    const cancelarAviso = onForegroundPush((evt) => {
      if (!evt.type.startsWith("sale_") && !evt.type.startsWith("return_")) return;
      clearTimeout(aposAviso);
      aposAviso = setTimeout(() => buscar(true), ESPERA_APOS_AVISO_MS);
    });

    return () => {
      vivo = false;
      clearInterval(ciclo);
      clearInterval(relogio);
      clearTimeout(aposAviso);
      document.removeEventListener("visibilitychange", aoVoltar);
      cancelarAviso();
    };
  }, []);

  if (!dados) return null;

  const { hoje, ontemAteAgora, ultimaVenda } = dados;
  const ritmo = ritmoVsOntem(hoje.vendas, ontemAteAgora.vendas, relogioBR(dados.atualizadoEm));
  const pico = Math.max(1, ...dados.porHora.hoje, ...dados.porHora.ontem);
  const doBanco = dados.fonte === "banco";

  const alternar = () => {
    setRecolhida((r) => {
      gravarChaveApp(CHAVE_RECOLHIDA, r ? "0" : "1");
      return !r;
    });
  };

  return (
    <section className="aovivo" aria-label="Vendas de hoje, ao vivo" data-recolhida={recolhida ? "true" : undefined}>
      <button
        type="button"
        className="aovivo-corpo"
        onClick={onAbrir}
        title={doBanco
          ? "Sem resposta do Mercado Livre agora: estes são os pedidos já sincronizados. Abrir o Dashboard"
          : `Atualizado às ${relogioBR(dados.atualizadoEm)}. Abrir o Dashboard`}
      >
        <span className="aovivo-selo" data-parado={doBanco ? "true" : undefined}>
          <span className="aovivo-ponto" aria-hidden />
          {doBanco ? "Último sync" : "Ao vivo"}
        </span>

        {/* A `key` troca a cada venda nova e reinicia a animação do valor. */}
        <span className="aovivo-valor" key={venda.n} data-pulso={venda.n > 0 ? "true" : undefined}>
          {fmtBRL(hoje.vendas)}
          <span className="aovivo-rotulo"> vendas hoje</span>
        </span>

        {ritmo && (
          <span className="aovivo-ritmo" style={{ color: COR_DO_TOM[ritmo.tom] }}>{ritmo.texto}</span>
        )}

        <span className="aovivo-item aovivo-contagem">
          <b>{hoje.pedidos}</b> {hoje.pedidos === 1 ? "venda" : "vendas"} · <b>{hoje.unidades}</b> un
        </span>

        {ultimaVenda && (
          <span className="aovivo-item aovivo-ultima">
            Última: <b>{fmtBRL(ultimaVenda.valor)}</b> {haQuantoTempo(ultimaVenda.em, agora)}
            {ultimaVenda.titulo && <span className="aovivo-titulo"> · {ultimaVenda.titulo}</span>}
          </span>
        )}

        {/* O ritmo do dia: hoje em barras, ontem em sombra atrás. Decorativo — os números estão ao lado. */}
        <svg className="aovivo-horas" viewBox="0 0 96 20" preserveAspectRatio="none" aria-hidden>
          {dados.porHora.ontem.map((v, h) => (
            <rect key={`o${h}`} x={h * 4} width={3} y={20 - (v / pico) * 20} height={(v / pico) * 20} fill="var(--border)" />
          ))}
          {dados.porHora.hoje.map((v, h) => (
            h <= dados.horaAtual && <rect key={`h${h}`} x={h * 4 + 0.75} width={1.5} y={20 - (v / pico) * 20} height={(v / pico) * 20} fill="var(--green)" />
          ))}
        </svg>
      </button>

      <button
        type="button"
        className="aovivo-recolher"
        onClick={alternar}
        aria-expanded={!recolhida}
        aria-label={recolhida ? "Mostrar os detalhes do ao vivo" : "Recolher a barra ao vivo"}
        title={recolhida ? "Mostrar detalhes" : "Recolher"}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d={recolhida ? "M6 9l6 6 6-6" : "M6 15l6-6 6 6"} />
        </svg>
      </button>

      <span className="sr-only" role="status" aria-live="polite">{venda.texto}</span>
    </section>
  );
}
