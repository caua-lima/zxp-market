"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "@/components/Modal";
import { useFormularioSujo } from "@/components/useFormularioSujo";
import { mensagemDeErroDeSalvamento } from "@/lib/domain/salvar-formulario";
import { criarEnvioAgendado, editarEnvioAgendado, mudarStatusEnvioAgendado, watchEnviosAgendados } from "@/lib/firebase/data";
import {
  disponivelParaAgencias,
  proximosDias,
  quandoFalta,
  reservasPorProduto,
  rotuloDoDia,
  validarEnvio,
  type EnvioFullAgendado,
  type ReservaDoProduto,
  type SaidaFull,
} from "@/lib/domain/envio-full-agendado";
import type { EstoqueMovimento, Product } from "@/lib/domain/types";
import { hojeBR } from "@/components/tabs/estoque/estoque-compartilhado";

/**
 * Os envios agendados pro Full: as unidades que já têm dia marcado e por isso
 * não são mais das agências. A conta (e o porquê) mora em
 * lib/domain/envio-full-agendado.ts; aqui só se lê e se grava.
 */

/** Os envios e a reserva por produto, calculados do livro. Um lugar só, pra as telas não discordarem. */
export function useReservasFull(movimentos: readonly EstoqueMovimento[]): {
  envios: EnvioFullAgendado[];
  reservas: Map<string, ReservaDoProduto>;
  carregou: boolean;
} {
  const [envios, setEnvios] = useState<EnvioFullAgendado[]>([]);
  const [carregou, setCarregou] = useState(false);
  useEffect(() => watchEnviosAgendados((l) => { setEnvios(l); setCarregou(true); }), []);

  const reservas = useMemo(() => {
    const saidas: SaidaFull[] = movimentos
      .filter((m) => m.tipo === "saida_full")
      .map((m) => ({ productId: m.productId, tipo: m.tipo, quantidade: m.quantidade, data: m.data }));
    return reservasPorProduto(envios, saidas, hojeBR());
  }, [envios, movimentos]);

  return { envios, reservas, carregou };
}

/** Id de um envio, estável enquanto a tela que o cria estiver aberta (ver criarEnvioAgendado). */
export function novoIdDeEnvio(): string {
  return "env" + Date.now() + Math.random().toString(36).slice(2, 6);
}

export const CAMPO: React.CSSProperties = {
  background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8,
  padding: "9px 12px", color: "var(--text)", fontSize: ".9rem", outline: "none",
};

/** A frase que responde "quanto sobra pras agências?" — a mesma na hora de agendar e na lista. */
export function ResumoDisponibilidade({ emCasa, reservado }: { emCasa: number; reservado: number }) {
  const d = disponivelParaAgencias(emCasa, reservado);
  return (
    <div style={{ margin: "8px 0 12px", padding: "10px 12px", borderRadius: 8, background: "var(--surface2)", border: "1px solid var(--border)", fontSize: ".85rem", lineHeight: 1.6 }}>
      <div>Em casa: <b>{Math.max(emCasa, 0)} un</b></div>
      <div>Já agendado pro Full: <b style={{ color: d.reservado > 0 ? "var(--warning)" : undefined }}>{d.reservado} un</b></div>
      <div style={{ fontWeight: 800 }}>
        Livre pras agências: <span style={{ color: d.livre > 0 ? "var(--green)" : "var(--red-text)" }}>{d.livre} un</span>
      </div>
      {d.faltam > 0 && (
        <div role="alert" style={{ marginTop: 6, color: "var(--red-text)", fontWeight: 700 }}>
          Faltam {d.faltam} un em casa pra cumprir os envios agendados — lance a entrada ou reduza o envio.
        </div>
      )}
    </div>
  );
}

/** Escolha do dia: os próximos sete como atalho, ou qualquer data. */
function SeletorDeDia({ valor, onChange, id }: { valor: string; onChange: (v: string) => void; id: string }) {
  const hoje = hojeBR();
  const atalhos = proximosDias(hoje, 8).slice(1);
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }} role="group" aria-label="Atalhos de dia">
        {atalhos.map((d) => (
          <button
            key={d} type="button"
            className={d === valor ? "btn btn-primary btn-xs" : "btn btn-ghost btn-xs"}
            aria-pressed={d === valor}
            onClick={() => onChange(d)}
          >
            {rotuloDoDia(d)}
          </button>
        ))}
      </div>
      <input id={id} type="date" min={hoje} value={valor} onChange={(e) => onChange(e.target.value)} style={CAMPO} />
    </>
  );
}

export function AgendarEnvioModal({
  product, emCasa, reservado, quantidadeInicial, onClose, onSaved,
}: {
  product: Product;
  /** O que está em casa agora (o mesmo número da coluna "Em casa"). */
  emCasa: number;
  /** O que já estava reservado antes deste envio. */
  reservado: number;
  quantidadeInicial?: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [qtd, setQtd] = useState(quantidadeInicial ? String(quantidadeInicial) : "");
  const [data, setData] = useState("");
  const [obs, setObs] = useState("");
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const sujo = useFormularioSujo({ qtd, data, obs });
  const idDoEnvio = useRef(novoIdDeEnvio());

  const q = Number(qtd);

  async function salvar() {
    if (saving) return;
    setErro(null);
    const invalido = validarEnvio({ productId: product.id, quantidade: q, data }, hojeBR());
    if (invalido) { setErro(invalido); return; }
    setSaving(true);
    try {
      await criarEnvioAgendado({ productId: product.id, quantidade: q, data, obs }, idDoEnvio.current);
      onSaved();
    } catch (err) {
      setErro(mensagemDeErroDeSalvamento(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} titulo="Agendar envio pro Full" confirmarDescarte={sujo && !saving}>
      <div className="modal-title">Agendar envio pro Full</div>
      <div className="modal-sub">{product.name || "Produto"}</div>

      <div style={{ fontSize: ".82rem", color: "var(--muted)", marginBottom: 10, lineHeight: 1.5 }}>
        Marca unidades que <b>já têm destino no Full</b>. O estoque não muda — elas só deixam de contar como livres pras agências
        até a baixa do envio ser lançada.
      </div>

      <div className="config-field">
        <label htmlFor="agenda-qtd">Quantas unidades vão pro Full</label>
        <input id="agenda-qtd" type="number" min="1" step="1" inputMode="numeric" placeholder="Ex: 199" value={qtd} onChange={(e) => setQtd(e.target.value)} />
      </div>

      <div className="config-field">
        <label htmlFor="agenda-dia">Dia do envio</label>
        <SeletorDeDia id="agenda-dia" valor={data} onChange={setData} />
      </div>

      <div className="config-field">
        <label htmlFor="agenda-obs">Observação (opcional)</label>
        <input id="agenda-obs" type="text" placeholder="Ex: coleta combinada, envio 3" value={obs} onChange={(e) => setObs(e.target.value)} />
      </div>

      <ResumoDisponibilidade emCasa={emCasa} reservado={reservado + (Number.isInteger(q) && q > 0 ? q : 0)} />

      {erro && <div className="note note-danger" role="alert" style={{ marginBottom: 10 }}>{erro}</div>}

      <div className="modal-btns">
        <button type="button" className="btn btn-success" onClick={salvar} disabled={saving}>
          {saving ? "Salvando…" : "Agendar"}
        </button>
        <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => { if (sujo && !confirm("Descartar as alterações não salvas?")) return; onClose(); }}>
          Cancelar
        </button>
      </div>
    </Modal>
  );
}

function EditarEnvioModal({ envio, onClose }: { envio: EnvioFullAgendado; onClose: () => void }) {
  const [qtd, setQtd] = useState(String(envio.quantidade));
  const [data, setData] = useState(envio.data);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    if (saving) return;
    setErro(null);
    const q = Number(qtd);
    // Manter o dia que já estava (mesmo vencido) não é "agendar no passado".
    const invalido = validarEnvio({ productId: envio.productId, quantidade: q, data }, data === envio.data ? envio.data : hojeBR());
    if (invalido) { setErro(invalido); return; }
    setSaving(true);
    try {
      await editarEnvioAgendado(envio.id, { quantidade: q, data });
      onClose();
    } catch (err) {
      setErro(mensagemDeErroDeSalvamento(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} titulo="Editar envio agendado">
      <div className="modal-title">Editar envio agendado</div>
      <div className="config-field">
        <label htmlFor="edit-envio-qtd">Unidades</label>
        <input id="edit-envio-qtd" type="number" min="1" step="1" inputMode="numeric" value={qtd} onChange={(e) => setQtd(e.target.value)} />
      </div>
      <div className="config-field">
        <label htmlFor="edit-envio-dia">Dia do envio</label>
        <SeletorDeDia id="edit-envio-dia" valor={data} onChange={setData} />
      </div>
      {erro && <div className="note note-danger" role="alert" style={{ marginBottom: 10 }}>{erro}</div>}
      <div className="modal-btns">
        <button type="button" className="btn btn-success" onClick={salvar} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</button>
        <button type="button" className="btn btn-ghost" disabled={saving} onClick={onClose}>Cancelar</button>
      </div>
    </Modal>
  );
}

/**
 * Todos os envios em aberto, por produto: o que vai, quando, quanto já saiu do
 * livro e o que ainda segura estoque. É o "o que está agendado" numa tela só.
 */
export function EnviosAgendadosPainel({
  produtos, reservas, podeEditar, emCasaDe,
}: {
  produtos: readonly Product[];
  reservas: Map<string, ReservaDoProduto>;
  podeEditar: boolean;
  /** O "em casa" de cada produto — o mesmo número da coluna da tabela. */
  emCasaDe: (p: Product) => number;
}) {
  const [editando, setEditando] = useState<EnvioFullAgendado | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const hoje = hojeBR();

  const linhas = useMemo(() => {
    const porId = new Map(produtos.map((p) => [p.id, p]));
    const saida: { produto: Product | null; productId: string; item: ReservaDoProduto["envios"][number] }[] = [];
    for (const [productId, r] of reservas) {
      for (const item of r.envios) {
        if (item.restante <= 0) continue;
        saida.push({ produto: porId.get(productId) ?? null, productId, item });
      }
    }
    return saida.sort((a, b) => a.item.envio.data.localeCompare(b.item.envio.data) || (a.produto?.name ?? "").localeCompare(b.produto?.name ?? ""));
  }, [produtos, reservas]);

  async function mudar(id: string, status: "enviado" | "cancelado") {
    setErro(null);
    setOcupado(id);
    try { await mudarStatusEnvioAgendado(id, status); }
    catch (err) { setErro(mensagemDeErroDeSalvamento(err)); }
    finally { setOcupado(null); }
  }

  if (linhas.length === 0) return null;

  const totalReservado = linhas.reduce((s, l) => s + l.item.restante, 0);

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-head" style={{ marginBottom: 6 }}>
        <span className="panel-title">Envios agendados pro Full</span>
        <span className="panel-sub">{totalReservado} un reservadas · saem do que as agências podem anunciar</span>
      </div>

      {erro && <div className="note note-danger" role="alert" style={{ marginBottom: 8 }}>{erro}</div>}

      <div className="table-wrapper" style={{ border: "none" }}>
        <table className="tbl-modern tbl-cards">
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Produto</th>
              <th style={{ textAlign: "left" }}>Dia</th>
              <th style={{ textAlign: "right" }}>Reservado</th>
              <th style={{ textAlign: "right" }}>Livre pras agências</th>
              {podeEditar && <th style={{ textAlign: "right" }}>Ações</th>}
            </tr>
          </thead>
          <tbody>
            {linhas.map(({ produto, productId, item }) => {
              const e = item.envio;
              const total = reservas.get(productId)?.reservado ?? item.restante;
              const d = disponivelParaAgencias(produto ? emCasaDe(produto) : 0, total);
              return (
                <tr key={e.id}>
                  <td data-label="Produto" style={{ textAlign: "left", fontWeight: 600 }}>
                    {produto?.name || productId}
                    {e.obs && <div style={{ fontWeight: 400, fontSize: ".75rem", color: "var(--muted)" }}>{e.obs}</div>}
                  </td>
                  <td data-label="Dia" style={{ textAlign: "left", whiteSpace: "nowrap" }}>
                    <div style={{ minWidth: 0 }}>
                      {rotuloDoDia(e.data)}
                      <div style={{ fontSize: ".75rem", color: item.atrasado ? "var(--red-text)" : "var(--muted)", fontWeight: item.atrasado ? 700 : 400 }}>
                        {quandoFalta(e.data, hoje)}{item.atrasado && " — sem baixa ainda"}
                      </div>
                    </div>
                  </td>
                  <td data-label="Reservado" style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>
                    <div style={{ minWidth: 0 }}>
                      {item.restante} un
                      {item.atendido > 0 && <div style={{ fontSize: ".75rem", color: "var(--muted)", fontWeight: 400 }}>{item.atendido} de {e.quantidade} já saíram</div>}
                    </div>
                  </td>
                  <td data-label="Livre pras agências" style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap", color: d.livre > 0 ? "var(--green)" : "var(--red-text)" }}>
                    <div style={{ minWidth: 0 }}>
                      {d.livre} un
                      {d.faltam > 0 && <div style={{ fontSize: ".75rem", fontWeight: 700 }}>faltam {d.faltam} em casa</div>}
                    </div>
                  </td>
                  {podeEditar && (
                    <td data-label="Ações" data-cell="acoes">
                      <div className="row-actions" style={{ justifyContent: "flex-end" }}>
                        <button type="button" className="btn btn-ghost btn-xs" disabled={ocupado === e.id} onClick={() => setEditando(e)}>Editar</button>
                        <button
                          type="button" className="btn btn-ghost btn-xs" disabled={ocupado === e.id}
                          title="Já foi enviado: solta a reserva (a baixa do estoque é lançada à parte)"
                          onClick={() => mudar(e.id, "enviado")}
                        >
                          Já enviei
                        </button>
                        <button
                          type="button" className="btn btn-danger btn-xs" disabled={ocupado === e.id}
                          onClick={() => { if (confirm(`Cancelar o envio de ${e.quantidade} un de "${produto?.name || "produto"}" marcado para ${rotuloDoDia(e.data)}?`)) void mudar(e.id, "cancelado"); }}
                        >
                          Cancelar
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editando && <EditarEnvioModal envio={editando} onClose={() => setEditando(null)} />}
    </div>
  );
}
