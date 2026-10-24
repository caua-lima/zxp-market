"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { authedFetch } from "@/lib/api/authed-fetch";
import { onForegroundPush } from "@/lib/firebase/push";
import { watchSinalAoVivo } from "@/lib/firebase/data";
import { fmtBRL } from "@/lib/domain/calc";
import { relogioBR, ritmoVsOntem } from "@/lib/domain/ao-vivo";
import { comVendasNovas, vendasAindaPendentes, type VendaNova } from "@/lib/domain/ao-vivo-tempo-real";
import { placarDe } from "@/lib/domain/painel-fixo";
import { mostrarPainelFixo } from "@/lib/painel-fixo";
import { gravarChaveApp, lerChaveApp } from "@/lib/storage";
import PainelAoVivo, { type DadosAoVivo } from "@/components/PainelAoVivo";
import s from "./BarraAoVivo.module.css";

/**
 * A barra "Ao vivo": uma linha, logo abaixo do topo, em todas as telas — o dia
 * de hoje de relance. Tocar nela abre o painel completo (PainelAoVivo), o do
 * Mercado Livre: valor do dia, métricas, tendência por hora e produtos.
 *
 * ─── TEMPO REAL ─────────────────────────────────────────────────────────
 *
 * A venda aparece NA HORA: o webhook do ML grava o pedido e publica um sinal
 * (`ao_vivo/sinal`) que esta barra escuta. A venda entra no número no mesmo
 * instante (somada ao que a rota já tinha — ver comVendasNovas) e a rota é
 * relida logo em seguida já com aquele pedido, trocando o número "otimista"
 * pelo oficial. O aviso de venda (push com o app aberto) faz o mesmo, pra quem
 * ainda não tem o sinal. Sem nenhum dos dois, a barra continua relendo sozinha
 * (a cada minuto, a cada 30 s com o painel aberto).
 *
 * Some enquanto não há dado: uma faixa com "R$ 0,00" por falha de rede seria
 * pior que faixa nenhuma.
 */

const CICLO_MS = 30_000;
const INTERVALO_BARRA_MS = 55_000;
const CHAVE_RECOLHIDA = "ao-vivo-recolhida";
/** O app abre direto no painel quando vem do toque no painel fixo (?tipo=ao_vivo). */
export const EVENTO_ABRIR_AO_VIVO = "zxp:abrir-ao-vivo";
/** O PDV avisa que registrou ou cancelou uma venda presencial: a barra relê na hora. */
export const EVENTO_PDV_MUDOU = "zxp:pdv-mudou";

type PedidoQueMudou = { orderId: string; valida: boolean };

export default function BarraAoVivo() {
  const [dadosServidor, setDadosServidor] = useState<DadosAoVivo | null>(null);
  /** Vendas que chegaram pelo sinal/push e que a rota ainda não confirmou. */
  const [pendentes, setPendentes] = useState<VendaNova[]>([]);
  const [aberto, setAberto] = useState(false);
  const abertoRef = useRef(false);
  const [recolhida, setRecolhida] = useState(() => lerChaveApp(CHAVE_RECOLHIDA) === "1");
  /** Sobe a cada venda nova: reinicia a animação e alimenta o aviso do leitor de tela. */
  const [venda, setVenda] = useState<{ n: number; texto: string }>({ n: 0, texto: "" });
  const pedidosAntes = useRef<{ dia: string; pedidos: number } | null>(null);
  const abrirQuandoChegar = useRef(false);

  useEffect(() => { abertoRef.current = aberto; }, [aberto]);

  // O número na tela: o oficial + o que chegou depois dele.
  const dados = useMemo(
    () => (dadosServidor ? comVendasNovas(dadosServidor, pendentes) : null),
    [dadosServidor, pendentes],
  );

  useEffect(() => {
    let vivo = true;
    let ultima = 0;
    let buscando = false;
    /** Um pedido que mudou enquanto outra leitura estava em curso: relê de novo ao terminar. */
    let deNovo: PedidoQueMudou | null = null;

    const buscar = (urgente = false, pedido: PedidoQueMudou | null = null) => {
      if (buscando) { if (pedido) deNovo = pedido; return; }
      buscando = true;
      const q = new URLSearchParams();
      if (urgente) q.set("fresh", "1");
      if (pedido) { q.set("pedido", pedido.orderId); q.set("valida", pedido.valida ? "1" : "0"); }
      authedFetch(`/api/ml/ao-vivo${q.toString() ? `?${q}` : ""}`, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<DadosAoVivo>) : null))
        .then((j) => {
          if (!vivo || !j || !j.hoje) return;
          ultima = Date.now();
          setDadosServidor(j);
          setPendentes((p) => vendasAindaPendentes(p, j, Date.now()));
        })
        .catch(() => { /* sem rede: fica o último número */ })
        .finally(() => {
          buscando = false;
          if (deNovo && vivo) { const p = deNovo; deNovo = null; buscar(true, p); }
        });
    };

    const chegouVenda = (v: VendaNova) => {
      setPendentes((p) => (p.some((x) => x.orderId === v.orderId) ? p : [...p, v]));
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
    // Venda no balcão (PDV): o número dela entra na próxima leitura (fora do cache do ML).
    const aoVenderNoBalcao = () => buscar(true);
    window.addEventListener(EVENTO_PDV_MUDOU, aoVenderNoBalcao);

    // O sinal em tempo real. A primeira leitura é só a referência (é o sinal da
    // ÚLTIMA venda, que a rota já conta); daí em diante, cada `seq` novo é uma mudança.
    let seqVisto: number | null = null;
    const pararSinal = watchSinalAoVivo((sinal) => {
      if (!sinal) { seqVisto = seqVisto ?? 0; return; }
      if (seqVisto === null) { seqVisto = sinal.seq; return; }
      if (sinal.seq === seqVisto) return;
      seqVisto = sinal.seq;
      if (sinal.valida) {
        chegouVenda({
          orderId: sinal.orderId, valor: sinal.valor, unidades: sinal.unidades, titulo: sinal.titulo,
          dateCreated: sinal.dateCreated, recebidaEm: Date.now(),
        });
      }
      buscar(true, { orderId: sinal.orderId, valida: sinal.valida });
    }, () => { /* sem o sinal (regras ainda não publicadas, sem rede): a barra segue relendo sozinha */ });

    // O aviso de venda com o app aberto: mesma soma na hora, pra quem não tem o sinal.
    const cancelarAviso = onForegroundPush((evt) => {
      if (evt.type.startsWith("return_") || evt.type === "sale_cancelled") { buscar(true, evt.orderId ? { orderId: evt.orderId, valida: false } : null); return; }
      if (!evt.type.startsWith("sale_")) return;
      const valor = Number(evt.grossAmount);
      if (evt.orderId && Number.isFinite(valor) && valor > 0) {
        let unidades = 1;
        try {
          const itens = JSON.parse(evt.itensJson ?? "[]") as { quantity?: number }[];
          if (Array.isArray(itens) && itens.length) unidades = itens.reduce((t, it) => t + (Number(it.quantity) || 0), 0) || 1;
        } catch { /* fica 1 */ }
        chegouVenda({ orderId: evt.orderId, valor, unidades, titulo: evt.productName ?? "", dateCreated: evt.timestamp, recebidaEm: Date.now() });
      }
      buscar(true, evt.orderId ? { orderId: evt.orderId, valida: true } : null);
    });

    return () => {
      vivo = false;
      clearInterval(ciclo);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener(EVENTO_PDV_MUDOU, aoVenderNoBalcao);
      pararSinal();
      cancelarAviso();
    };
  }, []);

  // Venda NOVA (pelo sinal, pelo aviso ou pela releitura): pulso no valor e aviso pro leitor de tela.
  // Não na primeira leitura nem na virada do dia.
  useEffect(() => {
    if (!dados) return;
    const antes = pedidosAntes.current;
    if (antes && antes.dia === dados.dia && dados.hoje.pedidos > antes.pedidos && dados.ultimaVenda) {
      const texto = `Nova venda de ${fmtBRL(dados.ultimaVenda.valor)}. Vendas hoje: ${fmtBRL(dados.hoje.vendas)}.`;
      setVenda((v) => ({ n: v.n + 1, texto }));
    }
    pedidosAntes.current = { dia: dados.dia, pedidos: dados.hoje.pedidos };
  }, [dados]);

  // O mini painel fixo (se esta pessoa fixou) acompanha o que a barra mostra.
  useEffect(() => {
    if (dados) void mostrarPainelFixo(placarDe(dados));
  }, [dados]);

  // Toque no painel fixo: abre o ao vivo — com o app já aberto (evento) ou recém-aberto (?tipo=ao_vivo).
  useEffect(() => {
    const abrir = () => setAberto(true);
    window.addEventListener(EVENTO_ABRIR_AO_VIVO, abrir);
    const p = new URLSearchParams(window.location.search);
    if (p.get("tipo") === "ao_vivo" && !p.get("item")) {
      abrirQuandoChegar.current = true;
      p.delete("tipo");
      window.history.replaceState(null, "", window.location.pathname + (p.toString() ? `?${p}` : "") + window.location.hash);
    }
    return () => window.removeEventListener(EVENTO_ABRIR_AO_VIVO, abrir);
  }, []);
  useEffect(() => {
    if (dados && abrirQuandoChegar.current) { abrirQuandoChegar.current = false; setAberto(true); }
  }, [dados]);

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
          {/* Meta de hoje em %: a pergunta "já bati o dia?" sem abrir o painel. */}
          {dados.metaDoDia && !dados.metaDoDia.mesBatido && (
            <span className={s.meta} data-batida={dados.metaDoDia.batida ? "true" : undefined} title={`Meta de hoje: ${fmtBRL(dados.metaDoDia.alvo)}`}>
              {Math.round(dados.metaDoDia.pct)}% da meta do dia
            </span>
          )}
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
