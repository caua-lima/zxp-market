"use client";

import { useEffect, useRef, useState } from "react";
import { authedFetch } from "@/lib/api/authed-fetch";
import { onForegroundPush } from "@/lib/firebase/push";
import { fmtBRL } from "@/lib/domain/calc";
import { relogioBR, ritmoVsOntem } from "@/lib/domain/ao-vivo";
import { gravarChaveApp, lerChaveApp } from "@/lib/storage";
import PainelAoVivo, { type DadosAoVivo } from "@/components/PainelAoVivo";
import s from "./BarraAoVivo.module.css";

/**
 * A barra "Ao vivo": uma linha, logo abaixo do topo, em todas as telas — o dia
 * de hoje de relance. Tocar nela abre o painel completo (PainelAoVivo), o do
 * Mercado Livre: valor do dia, métricas, tendência por hora e produtos.
 *
 * Atualiza sozinha (a cada minuto com a aba visível — a cada 30 s com o painel
 * aberto — e na hora quando chega o aviso de uma venda). Some enquanto não há
 * dado: uma faixa com "R$ 0,00" por falha de rede seria pior que faixa nenhuma.
 */

const CICLO_MS = 30_000;
const INTERVALO_BARRA_MS = 55_000;
/** Depois do aviso de venda: o ML leva alguns segundos pra listar o pedido na busca. */
const ESPERA_APOS_AVISO_MS = 4_000;
const CHAVE_RECOLHIDA = "ao-vivo-recolhida";

export default function BarraAoVivo() {
  const [dados, setDados] = useState<DadosAoVivo | null>(null);
  const [aberto, setAberto] = useState(false);
  const abertoRef = useRef(false);
  const [recolhida, setRecolhida] = useState(() => lerChaveApp(CHAVE_RECOLHIDA) === "1");
  /** Sobe a cada venda nova: reinicia a animação e alimenta o aviso do leitor de tela. */
  const [venda, setVenda] = useState<{ n: number; texto: string }>({ n: 0, texto: "" });
  const pedidosAntes = useRef<{ dia: string; pedidos: number } | null>(null);

  useEffect(() => { abertoRef.current = aberto; }, [aberto]);

  useEffect(() => {
    let vivo = true;
    let ultima = 0;
    let buscando = false;

    const buscar = (urgente = false) => {
      if (buscando) return;
      buscando = true;
      authedFetch(`/api/ml/ao-vivo${urgente ? "?fresh=1" : ""}`, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<DadosAoVivo>) : null))
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
        })
        .catch(() => { /* sem rede: fica o último número */ })
        .finally(() => { buscando = false; });
    };

    buscar();
    // Aba escondida não busca: ninguém está olhando, e cada busca custa uma ida ao ML.
    const ciclo = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (abertoRef.current || Date.now() - ultima >= INTERVALO_BARRA_MS) buscar();
    }, CICLO_MS);
    const aoVoltar = () => {
      if (document.visibilityState === "visible" && Date.now() - ultima > INTERVALO_BARRA_MS / 2) buscar();
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
      clearTimeout(aposAviso);
      document.removeEventListener("visibilitychange", aoVoltar);
      cancelarAviso();
    };
  }, []);

  if (!dados) return null;

  const { hoje, ontemAteAgora } = dados;
  const ritmo = ritmoVsOntem(hoje.vendas, ontemAteAgora.vendas, relogioBR(dados.atualizadoEm));
  const doBanco = dados.fonte === "banco";

  const alternarRecolhida = () => {
    setRecolhida((r) => {
      gravarChaveApp(CHAVE_RECOLHIDA, r ? "0" : "1");
      return !r;
    });
  };

  return (
    <>
      <section className={s.barra} aria-label="Vendas de hoje, ao vivo" data-recolhida={recolhida ? "true" : undefined}>
        <button
          type="button"
          className={s.corpo}
          onClick={() => setAberto(true)}
          aria-haspopup="dialog"
          title={doBanco
            ? "Sem resposta do Mercado Livre agora: estes são os pedidos já sincronizados. Abrir o painel"
            : `Atualizado às ${relogioBR(dados.atualizadoEm)}. Abrir o painel ao vivo`}
        >
          <span className={s.selo} data-parado={doBanco ? "true" : undefined}>
            <span className={s.ponto} aria-hidden />
            {doBanco ? "Último sync" : "Ao vivo"}
          </span>
          {/* A `key` troca a cada venda nova e reinicia a animação do valor. */}
          <span className={s.valor} key={venda.n} data-pulso={venda.n > 0 ? "true" : undefined}>{fmtBRL(hoje.vendas)}</span>
          {!recolhida && ritmo && <span className={s.ritmo} data-tom={ritmo.tom}>{ritmo.texto}</span>}
          {!recolhida && (
            <span className={s.contagem}>
              {hoje.pedidos} {hoje.pedidos === 1 ? "venda" : "vendas"} · {hoje.unidades} un
            </span>
          )}
          <span className={s.abrir} aria-hidden>Ver painel ›</span>
        </button>

        <button
          type="button"
          className={s.recolher}
          onClick={alternarRecolhida}
          aria-expanded={!recolhida}
          aria-label={recolhida ? "Mostrar os detalhes da barra ao vivo" : "Recolher a barra ao vivo"}
          title={recolhida ? "Mostrar detalhes" : "Recolher"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={recolhida ? "M6 9l6 6 6-6" : "M6 15l6-6 6 6"} />
          </svg>
        </button>

        <span className="sr-only" role="status" aria-live="polite">{venda.texto}</span>
      </section>

      {aberto && <PainelAoVivo dados={dados} onFechar={() => setAberto(false)} />}
    </>
  );
}
