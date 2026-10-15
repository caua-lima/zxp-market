"use client";

import { useMemo, useState } from "react";
import { mensagemDeErroDeSalvamento } from "@/lib/domain/salvar-formulario";
import { criarEnvioAgendado, editarEnvioAgendado, mudarStatusEnvioAgendado } from "@/lib/firebase/data";
import {
  disponivelParaAgencias,
  planejarDestino,
  quandoFalta,
  rotuloDoDia,
  type ReservaDoProduto,
} from "@/lib/domain/envio-full-agendado";
import type { Product } from "@/lib/domain/types";
import { hojeBR } from "@/components/tabs/estoque/estoque-compartilhado";
import { CAMPO, novoIdDeEnvio } from "@/components/tabs/estoque/EnviosAgendados";

/**
 * Destinação: do que está em casa, quanto vai pro Full e quanto fica pras
 * agências. Pode ser refeita a qualquer hora, conforme a empresa se mexe — o
 * estoque mudou, muda o destino. O que gravar (criar, editar ou encerrar um
 * envio) sai de `planejarDestino`, com teste.
 */

function LinhaDestino({
  produto, emCasa, noAnuncio, reserva, podeEditar,
}: {
  produto: Product;
  emCasa: number;
  /** Quanto o(s) anúncio(s) fora do Full declaram hoje. */
  noAnuncio: number;
  reserva: ReservaDoProduto | null;
  podeEditar: boolean;
}) {
  const hoje = hojeBR();
  const [qtd, setQtd] = useState(reserva && reserva.reservado > 0 ? String(reserva.reservado) : "");
  const [dia, setDia] = useState(reserva?.proximaData ?? "");
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const alvo = qtd.trim() === "" ? 0 : Number(qtd);
  const plano = planejarDestino(reserva, alvo, dia, hoje);
  const mudou = plano.acao === "criar" || plano.acao === "editar" || plano.acao === "encerrar";
  const precisaDia = Number.isInteger(alvo) && alvo > 0;
  const d = disponivelParaAgencias(emCasa, precisaDia ? alvo : 0);
  const varios = (reserva?.envios.filter((e) => e.restante > 0).length ?? 0) > 1;

  async function salvar() {
    if (saving) return;
    setErro(null);
    if (plano.acao === "invalido") { setErro(plano.motivo); return; }
    if (plano.acao === "varios") { setErro("Este produto tem mais de um envio agendado. Ajuste cada um na lista “Envios agendados”."); return; }
    if (plano.acao === "nada") return;
    setSaving(true);
    try {
      if (plano.acao === "criar") await criarEnvioAgendado({ productId: produto.id, quantidade: plano.quantidade, data: plano.data }, novoIdDeEnvio());
      else if (plano.acao === "editar") await editarEnvioAgendado(plano.id, { quantidade: plano.quantidade, data: plano.data });
      else await mudarStatusEnvioAgendado(plano.id, plano.status);
    } catch (err) {
      setErro(mensagemDeErroDeSalvamento(err));
    } finally {
      setSaving(false);
    }
  }

  const anuncioAcima = noAnuncio > d.livre;
  const nome = produto.name || "produto";

  return (
    <tr>
      <td data-label="Produto" style={{ textAlign: "left", fontWeight: 600 }}>
        {produto.name || "Sem nome"}
        {produto.sku && <div style={{ fontWeight: 400, fontSize: ".75rem", color: "var(--muted)" }}>SKU {produto.sku}</div>}
        {varios && <div style={{ fontWeight: 400, fontSize: ".75rem", color: "var(--warning)" }}>mais de um envio agendado</div>}
      </td>
      <td data-label="Em casa" style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{Math.max(emCasa, 0)} un</td>
      <td data-label="Vai pro Full" style={{ textAlign: "right" }}>
        <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="number" min="0" step="1" inputMode="numeric" aria-label={`Unidades de ${nome} que vão pro Full`}
            value={qtd} placeholder="0" disabled={!podeEditar || saving}
            onChange={(e) => setQtd(e.target.value)}
            style={{ ...CAMPO, width: 84, textAlign: "right", padding: "6px 8px" }}
          />
          {precisaDia && (
            <input
              type="date" min={hoje} value={dia} aria-label={`Dia do envio de ${nome}`}
              disabled={!podeEditar || saving} onChange={(e) => setDia(e.target.value)}
              style={{ ...CAMPO, padding: "6px 8px" }}
            />
          )}
        </div>
        {precisaDia && dia && <div style={{ fontSize: ".75rem", color: "var(--muted)", marginTop: 2 }}>{rotuloDoDia(dia)} · {quandoFalta(dia, hoje)}</div>}
        </div>
      </td>
      <td data-label="Fica pras agências" style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 800, color: d.livre > 0 ? "var(--green)" : "var(--red-text)" }}>
        <div style={{ minWidth: 0 }}>
          {d.livre} un
          {d.faltam > 0 && <div style={{ fontSize: ".75rem", fontWeight: 700 }}>faltam {d.faltam} em casa</div>}
        </div>
      </td>
      <td data-label="Anúncio hoje" style={{ textAlign: "right", whiteSpace: "nowrap", color: anuncioAcima ? "var(--warning)" : "var(--muted)" }}>
        <div style={{ minWidth: 0 }}>
          {noAnuncio} un
          {anuncioAcima && <div style={{ fontSize: ".75rem", fontWeight: 700 }}>ajuste o anúncio p/ {d.livre}</div>}
        </div>
      </td>
      {podeEditar && (
        <td data-label="Ações" data-cell="acoes">
          <div className="row-actions" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-success btn-xs" disabled={!mudou || saving} onClick={salvar}>
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </div>
          {erro && <div role="alert" style={{ color: "var(--red-text)", fontSize: ".75rem", marginTop: 4, textAlign: "right" }}>{erro}</div>}
        </td>
      )}
    </tr>
  );
}

export default function DestinacaoPanel({
  produtos, reservas, podeEditar, emCasaDe, noAnuncioDe, busca,
}: {
  produtos: readonly Product[];
  reservas: Map<string, ReservaDoProduto>;
  podeEditar: boolean;
  emCasaDe: (p: Product) => number;
  noAnuncioDe: (p: Product) => number;
  busca: string;
}) {
  const termo = busca.trim().toLowerCase();
  const linhas = useMemo(() => {
    return produtos
      .filter((p) => p.ativo)
      .filter((p) => !termo || (p.name ?? "").toLowerCase().includes(termo) || (p.sku ?? "").toLowerCase().includes(termo))
      // Quem já tem destino marcado primeiro; depois quem tem estoque em casa; depois por nome.
      .sort((a, b) =>
        (reservas.get(b.id)?.reservado ?? 0) - (reservas.get(a.id)?.reservado ?? 0)
        || emCasaDe(b) - emCasaDe(a)
        || (a.name ?? "").localeCompare(b.name ?? ""))
      .map((p) => ({ p, reserva: reservas.get(p.id) ?? null }));
  }, [produtos, reservas, termo, emCasaDe]);

  const totalFull = linhas.reduce((s, l) => s + (l.reserva?.reservado ?? 0), 0);
  const totalCasa = linhas.reduce((s, l) => s + Math.max(emCasaDe(l.p), 0), 0);

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 6 }}>
        <span className="panel-title">Destinação do estoque em casa</span>
        <span className="panel-sub">{totalFull} un vão pro Full · {Math.max(totalCasa - totalFull, 0)} un ficam pras agências</span>
      </div>
      <div style={{ fontSize: ".82rem", color: "var(--muted)", lineHeight: 1.55, marginBottom: 10 }}>
        Do que está <b>em casa</b>, diga quanto vai pro <b>Full</b> e em que dia. O resto fica automaticamente pras{" "}
        <b>agências</b> — é o número que você pode anunciar. Mude quando quiser: se o estoque ou o plano mudar, é só
        editar e salvar. A entrada continua sendo lançada inteira; quando a baixa do envio sair, a reserva some sozinha.
      </div>

      {linhas.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: ".85rem", padding: "8px 0" }}>Nenhum produto ativo encontrado.</div>
      ) : (
        <div className="table-wrapper" style={{ border: "none" }}>
          <table className="tbl-modern tbl-cards">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Produto</th>
                <th style={{ textAlign: "right" }}>Em casa</th>
                <th style={{ textAlign: "right" }}>Vai pro Full</th>
                <th style={{ textAlign: "right" }}>Fica pras agências</th>
                <th style={{ textAlign: "right" }}>Anúncio hoje</th>
                {podeEditar && <th style={{ textAlign: "right" }}>Ações</th>}
              </tr>
            </thead>
            <tbody>
              {linhas.map(({ p, reserva }) => (
                <LinhaDestino
                  key={`${p.id}|${reserva?.reservado ?? 0}|${reserva?.proximaData ?? ""}`}
                  produto={p}
                  emCasa={emCasaDe(p)}
                  noAnuncio={noAnuncioDe(p)}
                  reserva={reserva}
                  podeEditar={podeEditar}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
