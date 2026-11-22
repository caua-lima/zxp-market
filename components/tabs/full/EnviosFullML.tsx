"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { EstoqueMovimento, Product } from "@/lib/domain/types";
import type { EstoqueML } from "@/components/tabs/estoque/estoque-compartilhado";
import { descontarDoAnuncioDeAgencias, irmaoDeAgencias, trazerDasAgencias } from "@/components/tabs/estoque/envio-full-agencias";
import { useReservasFull } from "@/components/tabs/estoque/EnviosAgendados";
import { aDescontarDoAnuncio } from "@/lib/domain/envio-full-agendado";
import {
  diaDaColeta, planejarBaixas, situacaoDoEnvio, type BaixaPendente, type EnvioFullML, type SituacaoEnvio,
} from "@/lib/domain/envios-full-ml";
import { addMovimento } from "@/lib/firebase/data";
import { authedFetch } from "@/lib/api/authed-fetch";
import { fmtBRL } from "@/lib/domain/calc";

/**
 * ENVIOS PRO FULL, COMO O ML MOSTRA.
 *
 * A extensão do Chrome lê o painel "Gestão de envios Full" de 20 em 20 min
 * (com o login do ML do PC) e o servidor já cuidou do que não precisa de
 * gente (lib/ml/envios-full-sync.ts): reserva por produto, anúncio de agência
 * descendo quando o prazo de editar passa, custo da coleta.
 *
 * O que sobra aqui é a BAIXA do livro: quando o ML recebe, a régua é o que
 * ele diz que recebeu AGORA. Recebeu mais depois (169 → 180), vira um
 * complemento de +11 — o caso que deixava o Dash parado em 169.
 */

const ROTULO: Record<SituacaoEnvio, { texto: string; cor: string }> = {
  rascunho: { texto: "Em preparação", cor: "var(--muted)" },
  agendado: { texto: "Agendado", cor: "var(--accent, var(--yellow))" },
  travado: { texto: "Prazo de editar encerrado", cor: "var(--warning)" },
  recebendo: { texto: "ML recebendo", cor: "var(--warning)" },
  finalizado: { texto: "Finalizado", cor: "var(--green)" },
  cancelado: { texto: "Cancelado", cor: "var(--muted)" },
  vencido: { texto: "Vencido", cor: "var(--muted)" },
};

const quando = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
};
const relogio = (ms: number) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const faltaPara = (iso: string | null, agora: number) => {
  if (!iso) return "";
  const h = Math.round((Date.parse(iso) - agora) / 3600000);
  if (h <= 0) return "";
  return h < 48 ? `em ${h} h` : `em ${Math.round(h / 24)} dias`;
};

type Sync = { em?: number; ultimoResultado?: { avisos?: string[]; semCadastro?: { inboundId: string; sku: string }[]; anuncios?: string[] } } | null;

export default function EnviosFullML({ movimentos, products, podeEditar }: {
  movimentos: EstoqueMovimento[];
  products: Product[];
  podeEditar: boolean;
}) {
  const [envios, setEnvios] = useState<EnvioFullML[]>([]);
  const [sync, setSync] = useState<Sync>(null);
  const [mapa, setMapa] = useState<Map<string, string>>(new Map());
  const [carregou, setCarregou] = useState(false);
  const [erro, setErro] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);
  const [verTodos, setVerTodos] = useState(false);
  const [salvando, setSalvando] = useState("");
  const [agora, setAgora] = useState(() => Date.now());
  const { reservas } = useReservasFull(movimentos);

  const carregar = useCallback(async () => {
    try {
      const r = await authedFetch("/api/full/envios-ml", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { envios: EnvioFullML[]; sync: Sync; produtoPorMlb: Record<string, string> };
      setEnvios(j.envios ?? []);
      setSync(j.sync ?? null);
      setMapa(new Map(Object.entries(j.produtoPorMlb ?? {})));
      setErro("");
    } catch (e) {
      setErro(String(e instanceof Error ? e.message : e));
    } finally {
      setCarregou(true);
      setAgora(Date.now());
    }
  }, []);
  // Assíncrono de propósito: o setState acontece depois do await.
  useEffect(() => { void (async () => { await carregar(); })(); }, [carregar]);

  const baixas = useMemo(
    () => planejarBaixas(envios, mapa, movimentos.map((m) => ({ id: m.id, productId: m.productId, tipo: m.tipo, quantidade: m.quantidade })), agora),
    [envios, mapa, movimentos, agora],
  );
  const pendentesDe = (id: string) => baixas.pendentes.filter((p) => p.inboundId === id);
  const excessoDe = (id: string) => baixas.excesso.filter((p) => p.inboundId === id);
  const nomeDe = (productId: string) => products.find((p) => p.id === productId)?.name ?? productId;

  const ordenados = useMemo(() => {
    const peso: Record<SituacaoEnvio, number> = { travado: 0, recebendo: 1, agendado: 2, finalizado: 3, rascunho: 4, vencido: 5, cancelado: 6 };
    const limite = agora - 45 * 86400000;
    return [...envios]
      .map((e) => ({ e, sit: situacaoDoEnvio(e, agora) }))
      .filter(({ e, sit }) => verTodos
        || sit === "agendado" || sit === "travado" || sit === "recebendo"
        || (sit === "finalizado" && (Date.parse(e.recebidoEm ?? e.coletaEm ?? "") || 0) >= limite)
        || baixas.pendentes.some((p) => p.inboundId === e.id))
      .sort((a, b) => peso[a.sit] - peso[b.sit] || (b.e.coletaEm ?? "").localeCompare(a.e.coletaEm ?? ""));
  }, [envios, agora, verTodos, baixas]);

  /**
   * Baixa (ou complemento) dos produtos de um envio, pelo que o ML recebeu.
   * Mesmo caminho da baixa da aba Full (RemessasFull): traz das Agências o
   * que o livro do Full não tem, lança a saída e só desce o anúncio de
   * agência no que o agendamento ainda não tirou de lá.
   */
  async function darBaixa(e: EnvioFullML, pendentes: BaixaPendente[]) {
    if (!pendentes.length) return;
    const total = pendentes.reduce((s, p) => s + p.falta, 0);
    if (!confirm(`Lançar a saída pro Full do envio #${e.id}: ${total} un em ${pendentes.length} produto(s), pelo que o Mercado Livre recebeu?`)) return;
    setSalvando(e.id);
    const avisos: string[] = [];
    try {
      const estoqueML = await authedFetch("/api/ml/estoque-ml", { cache: "no-store" })
        .then((x) => x.json()).then((j: { estoque?: EstoqueML }) => j.estoque ?? {}).catch(() => ({} as EstoqueML));
      const data = diaDaColeta(e) ?? new Date(agora - 3 * 3600000).toISOString().slice(0, 10);
      for (const p of pendentes) {
        const produto = products.find((x) => x.id === p.productId);
        const irmao = produto ? irmaoDeAgencias(produto, products) : null;
        let trazido = 0;
        if (produto && irmao) {
          trazido = await trazerDasAgencias({ full: produto, irmao, quantidade: p.falta, data, idBase: p.idLancamento, estoqueML });
        }
        const complemento = p.baixado > 0;
        await addMovimento({
          id: p.idLancamento, productId: p.productId, tipo: "saida_full", quantidade: p.falta, data,
          obs: complemento
            ? `Envio Full #${e.id} · ML passou a ${p.recebido} recebidas: complemento de +${p.falta} (já baixadas ${p.baixado})`
            : `Envio Full #${e.id} · ML recebeu ${p.recebido}`,
        });
        const tirar = aDescontarDoAnuncio(trazido, reservas.get(p.productId) ?? null);
        if (tirar > 0 && irmao) {
          const ml = await descontarDoAnuncioDeAgencias(irmao, tirar);
          if (!ml.ok) avisos.push(ml.texto);
        }
      }
    } catch (err) {
      alert("Erro ao lançar: " + (err instanceof Error ? err.message : String(err)));
    }
    if (avisos.length) alert(avisos.join(" | "));
    setSalvando("");
  }

  const idadeSync = sync?.em ? agora - sync.em : null;
  const syncVelha = idadeSync == null || idadeSync > 90 * 60000;
  const semCadastro = sync?.ultimoResultado?.semCadastro ?? [];
  const avisos = sync?.ultimoResultado?.avisos ?? [];

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 6 }}>
        <span className="panel-title">Envios pro Full (lidos do Mercado Livre)</span>
        <span className="panel-sub">
          {sync?.em ? `lidos pela extensão às ${relogio(sync.em)}` : "ainda não lidos"}
          {" · "}
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => void carregar()}>Recarregar</button>
        </span>
      </div>
      <div style={{ fontSize: ".8rem", color: "var(--muted)", marginBottom: 10, lineHeight: 1.55 }}>
        Agenda, prazo de editar, recebido e custo da coleta vêm do painel do ML. O app já <b>reserva</b> as unidades de cada envio
        agendado, <b>desce o anúncio de agência</b> quando o prazo de editar passa e preenche o <b>custo da coleta</b>. A saída do estoque
        é lançada aqui, pelo que o ML recebeu — e se ele receber mais depois, aparece o complemento.
      </div>

      {carregou && syncVelha && (
        <div className="note note-warning" style={{ marginBottom: 10 }}>
          {sync?.em
            ? `Última leitura há ${Math.round((idadeSync ?? 0) / 60000)} min — os números podem estar velhos. `
            : "A extensão ainda não leu os envios. "}
          Precisa do Chrome aberto com o Mercado Livre logado e da extensão <b>Vigia da agenda do Full 2.6</b> (recarregue-a em
          chrome://extensions e clique “Ler envios agora”).
        </div>
      )}
      {erro && <div className="note note-danger" style={{ marginBottom: 10 }}>Não consegui carregar os envios ({erro}).</div>}
      {avisos.length > 0 && <div className="note note-warning" style={{ marginBottom: 10 }}>{avisos.join(" · ")}</div>}
      {semCadastro.length > 0 && (
        <div className="note note-warning" style={{ marginBottom: 10 }}>
          Produto de envio sem cadastro no Estoque (sem reserva e sem baixa): {[...new Set(semCadastro.map((s) => `${s.sku} (#${s.inboundId})`))].join(", ")}.
        </div>
      )}

      {carregou && ordenados.length === 0 && !erro && <div style={{ fontSize: ".82rem", color: "var(--muted)" }}>Nenhum envio em andamento.</div>}

      {ordenados.length > 0 && (
        <div className="table-wrapper" style={{ border: "none" }}>
          <table className="tbl-modern tbl-cards">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Envio</th>
                <th style={{ textAlign: "left" }}>Coleta</th>
                <th style={{ textAlign: "left" }}>Editar até</th>
                <th style={{ textAlign: "right" }}>Unidades</th>
                <th style={{ textAlign: "right" }}>Custo da coleta</th>
                <th style={{ textAlign: "right" }}>Estoque</th>
              </tr>
            </thead>
            <tbody>
              {ordenados.map(({ e, sit }) => {
                const pend = pendentesDe(e.id);
                const exc = excessoDe(e.id);
                const faltaTotal = pend.reduce((s, p) => s + p.falta, 0);
                const rot = ROTULO[sit];
                return (
                  <Fragment key={e.id}>
                    <tr onClick={() => setAberto(aberto === e.id ? null : e.id)} style={{ cursor: "pointer" }}>
                      <td data-label="Envio" style={{ textAlign: "left" }}>
                        <b>#{e.id}</b>
                        <div style={{ fontSize: ".75rem", color: rot.cor, fontWeight: 700 }}>{rot.texto}</div>
                      </td>
                      <td data-label="Coleta" style={{ textAlign: "left", whiteSpace: "nowrap" }}>
                        {quando(e.coletaEm)}
                        {sit === "agendado" && <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>{faltaPara(e.coletaEm, agora)}</div>}
                      </td>
                      <td data-label="Editar até" style={{ textAlign: "left", whiteSpace: "nowrap" }}>
                        {quando(e.editarAte)}
                        {sit === "agendado" && <div style={{ fontSize: ".75rem", color: "var(--warning)" }}>{faltaPara(e.editarAte, agora)}</div>}
                        {sit === "travado" && <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>não dá mais pra editar</div>}
                      </td>
                      <td data-label="Unidades" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {e.declarado} enviadas
                        {(sit === "recebendo" || sit === "finalizado") && (e.detalheLido ? (
                          <div style={{ fontSize: ".75rem", color: e.recebido < e.declarado ? "var(--warning)" : "var(--green)" }}>
                            {e.recebido} recebidas{e.recebido < e.declarado ? ` · faltam ${e.declarado - e.recebido}` : ""}
                          </div>
                        ) : (
                          // Sem o detalhe, a lista do ML só diz quantas ficaram À VENDA — não quantas chegaram.
                          <div style={{ fontSize: ".75rem", color: e.aVenda < e.declarado ? "var(--warning)" : "var(--green)" }}>
                            {e.aVenda} à venda{e.aVenda < e.declarado ? ` · ${e.declarado - e.aVenda} com diferença` : ""}
                          </div>
                        ))}
                      </td>
                      <td data-label="Custo da coleta" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {e.custo ? fmtBRL(e.custo.valor) : "—"}
                        {e.custo && <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>{e.custo.cobrado ? "cobrado" : "estimado pelo ML"}</div>}
                      </td>
                      <td data-label="Estoque" style={{ textAlign: "right" }} onClick={(ev) => ev.stopPropagation()}>
                        {faltaTotal > 0 ? (
                          podeEditar ? (
                            <button type="button" className="btn btn-primary btn-xs" disabled={salvando === e.id} onClick={() => void darBaixa(e, pend)}>
                              {salvando === e.id ? "Lançando…" : pend.some((p) => p.baixado > 0) ? `Complemento +${faltaTotal}` : `Dar baixa (${faltaTotal})`}
                            </button>
                          ) : <span style={{ color: "var(--warning)", fontSize: ".8rem" }}>{faltaTotal} un a baixar</span>
                        ) : sit === "agendado" || sit === "travado" ? (
                          <span style={{ fontSize: ".8rem", color: "var(--muted)" }}>reservado</span>
                        ) : sit === "finalizado" || sit === "recebendo" ? (
                          <span style={{ fontSize: ".8rem", color: exc.length ? "var(--red-text)" : "var(--green)" }}>
                            {exc.length ? "baixado a mais — confira" : e.detalheLido ? "em dia" : "—"}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                    {aberto === e.id && (
                      <tr>
                        <td colSpan={6} style={{ textAlign: "left", background: "var(--surface2)" }}>
                          {!e.detalheLido ? (
                            <span style={{ fontSize: ".8rem", color: "var(--muted)" }}>A extensão ainda não abriu o detalhe deste envio.</span>
                          ) : (
                            <table className="tbl-modern" style={{ fontSize: ".8rem" }}>
                              <thead>
                                <tr><th style={{ textAlign: "left" }}>Produto</th><th>Enviadas</th><th>Recebidas</th><th>À venda</th><th>Baixado no Dash</th></tr>
                              </thead>
                              <tbody>
                                {e.produtos.map((p) => {
                                  const productId = mapa.get(p.itemId);
                                  const pe = pend.find((x) => x.productId === productId);
                                  const ex = exc.find((x) => x.productId === productId);
                                  const baixado = pe?.baixado ?? ex?.baixado ?? (productId && (sit === "finalizado" || sit === "recebendo") ? p.recebido : null);
                                  return (
                                    <tr key={`${p.itemId}-${p.inventoryId}`}>
                                      <td style={{ textAlign: "left" }}>{productId ? nomeDe(productId) : <span style={{ color: "var(--warning)" }}>{p.sku} (sem cadastro)</span>}</td>
                                      <td style={{ textAlign: "center" }}>{p.declarado}</td>
                                      <td style={{ textAlign: "center", color: p.recebido < p.declarado && sit !== "agendado" && sit !== "travado" ? "var(--warning)" : undefined }}>{p.recebido}</td>
                                      <td style={{ textAlign: "center" }}>{p.aVenda}</td>
                                      <td style={{ textAlign: "center" }}>{baixado ?? "—"}{pe ? <span style={{ color: "var(--warning)" }}> (faltam {pe.falta})</span> : null}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: ".8rem", marginTop: 8, color: "var(--muted)" }}>
        <input type="checkbox" checked={verTodos} onChange={(e) => setVerTodos(e.target.checked)} /> Ver também cancelados, vencidos, em preparação e antigos
      </label>
    </div>
  );
}
