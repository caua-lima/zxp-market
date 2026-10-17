"use client";

import { useMemo, useState } from "react";
import Modal from "@/components/Modal";
import { useFormularioSujo } from "@/components/useFormularioSujo";
import { mensagemDeErroDeSalvamento } from "@/lib/domain/salvar-formulario";
import { transferirEstoque } from "@/lib/firebase/data";
import { fmtBRL } from "@/lib/domain/calc";
import { ROTULO_CANAL, irmaosDe } from "@/lib/domain/grupo-produto";
import { planejarTransferencia, type LadoDaTransferencia } from "@/lib/domain/transferencia-estoque";
import { estoqueForaDoFull } from "@/lib/domain/estoque";
import type { Product } from "@/lib/domain/types";
import { custoMedioDe, fullDe, hojeBR, type EstoqueML } from "@/components/tabs/estoque/estoque-compartilhado";

/**
 * "Enviar estoque ao mesmo produto, em outro anúncio": move unidades do cadastro
 * de um canal pro do outro (agências ↔ Full) num lançamento só. A conta e o
 * porquê estão em lib/domain/transferencia-estoque.ts.
 */

const CAMPO: React.CSSProperties = {
  background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8,
  padding: "9px 12px", color: "var(--text)", fontSize: ".9rem", outline: "none",
};

function ladoDe(p: Product, estoqueML: EstoqueML): LadoDaTransferencia {
  const f = fullDe(p, estoqueML);
  const casa = p.qtdLocal ?? 0;
  return {
    id: p.id,
    nome: p.name || "Sem nome",
    emCasa: casa,
    // O mesmo total do lançamento avulso: Full + o que está fora dele.
    estoqueTotal: f.qtd + estoqueForaDoFull(casa, f.proprio, f.ehFull),
    custoMedio: custoMedioDe(p),
  };
}

const rotulo = (p: Product) => `${p.name || "Sem nome"}${p.sku ? ` · ${p.sku}` : ""}${p.canal ? ` · ${ROTULO_CANAL[p.canal]}` : ""} — ${p.qtdLocal ?? 0} un em casa`;

export default function TransferirEstoqueModal({
  origem, produtos, estoqueML, onClose, onSaved,
}: {
  origem: Product;
  produtos: readonly Product[];
  estoqueML: EstoqueML;
  onClose: () => void;
  onSaved: () => void;
}) {
  const irmaos = useMemo(() => irmaosDe(origem, produtos).filter((p) => p.ativo), [origem, produtos]);
  const outros = useMemo(
    () => produtos.filter((p) => p.ativo && p.id !== origem.id && !irmaos.some((i) => i.id === p.id))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "pt-BR")),
    [produtos, origem, irmaos],
  );

  const [destinoId, setDestinoId] = useState(irmaos[0]?.id ?? "");
  const [qtd, setQtd] = useState("");
  const [data, setData] = useState(hojeBR());
  const [obs, setObs] = useState("");
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const sujo = useFormularioSujo({ destinoId, qtd, data, obs });
  // Id fixo por abertura: repetir (timeout, duplo clique) grava nos mesmos documentos.
  const [idBase] = useState(() => `${Date.now()}${Math.random().toString(36).slice(2, 6)}`);

  const destino = produtos.find((p) => p.id === destinoId) ?? null;
  const de = ladoDe(origem, estoqueML);
  const plano = destino
    ? planejarTransferencia({ de, para: ladoDe(destino, estoqueML), quantidade: Number(qtd), data, obs, idBase })
    : null;
  const digitou = qtd.trim() !== "";

  async function salvar() {
    if (saving || !destino) return;
    setErro(null);
    if (!plano || !plano.ok) { setErro(plano && !plano.ok ? plano.motivo : "Escolha o produto de destino."); return; }
    setSaving(true);
    try {
      await transferirEstoque(plano, { de: origem.name || origem.id, para: destino.name || destino.id });
      onSaved();
    } catch (err) {
      setErro(mensagemDeErroDeSalvamento(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} titulo="Transferir estoque" confirmarDescarte={sujo && !saving}>
      <div className="modal-title">Transferir estoque</div>
      <div className="modal-sub">de <b>{origem.name || "Sem nome"}</b> · {origem.qtdLocal ?? 0} un em casa <span style={{ color: "var(--muted)" }}>(pelo livro)</span></div>

      <div style={{ fontSize: ".82rem", color: "var(--muted)", marginBottom: 10, lineHeight: 1.5 }}>
        Move unidades pro <b>mesmo produto em outro anúncio</b> (agências ↔ Full). Sai de um estoque e entra no outro num lançamento só,
        levando o custo médio junto — não é compra nem venda.
      </div>

      {irmaos.length === 0 && (
        <div className="note note-accent" style={{ marginBottom: 10, fontSize: ".82rem" }}>
          Este produto ainda não tem um par no mesmo grupo. Use <b>＋ Outro anúncio</b> na linha do produto pra criar o do outro canal,
          ou escolha qualquer produto abaixo.
        </div>
      )}

      <div className="config-field">
        <label htmlFor="trf-destino">Enviar para</label>
        <select id="trf-destino" value={destinoId} onChange={(e) => setDestinoId(e.target.value)} style={CAMPO}>
          <option value="">Escolha o produto…</option>
          {irmaos.length > 0 && (
            <optgroup label="Mesmo produto (mesmo grupo)">
              {irmaos.map((p) => <option key={p.id} value={p.id}>{rotulo(p)}</option>)}
            </optgroup>
          )}
          {outros.length > 0 && (
            <optgroup label="Outros produtos">
              {outros.map((p) => <option key={p.id} value={p.id}>{rotulo(p)}</option>)}
            </optgroup>
          )}
        </select>
      </div>

      <div className="config-field">
        <label htmlFor="trf-qtd">Quantas unidades</label>
        <input id="trf-qtd" type="number" min="1" step="1" inputMode="numeric" placeholder="Ex: 50" value={qtd} onChange={(e) => setQtd(e.target.value)} />
      </div>

      <div className="config-field">
        <label htmlFor="trf-data">Data</label>
        <input id="trf-data" type="date" value={data} onChange={(e) => setData(e.target.value)} style={CAMPO} />
      </div>

      <div className="config-field">
        <label htmlFor="trf-obs">Motivo (opcional)</label>
        <input id="trf-obs" type="text" placeholder="Ex: sobrou nas agências, reforço do Full" value={obs} onChange={(e) => setObs(e.target.value)} />
      </div>

      {destino && digitou && plano && plano.ok && (
        <div style={{ margin: "4px 0 12px", padding: "10px 12px", borderRadius: 8, background: "var(--surface2)", border: "1px solid var(--border)", fontSize: ".85rem", lineHeight: 1.6 }}>
          <div><b>{origem.name}</b>: {origem.qtdLocal ?? 0} → <b>{plano.sobraNaOrigem}</b> un em casa</div>
          <div><b>{destino.name}</b>: {destino.qtdLocal ?? 0} → <b>{(destino.qtdLocal ?? 0) + Number(qtd)}</b> un em casa</div>
          <div style={{ color: "var(--muted)" }}>
            {plano.custoUnit != null
              ? <>Leva o custo de {fmtBRL(plano.custoUnit)}/un · custo médio do destino: {fmtBRL(custoMedioDe(destino))} → <b style={{ color: "var(--text)" }}>{fmtBRL(plano.novoCustoDestino)}</b></>
              : <>A origem não tem custo médio: o destino recebe sem custo e a média dele não muda.</>}
          </div>
        </div>
      )}
      {destino && digitou && plano && !plano.ok && (
        <div className="note note-danger" role="alert" style={{ marginBottom: 10, fontSize: ".82rem" }}>{plano.motivo}</div>
      )}

      {erro && <div className="note note-danger" role="alert" style={{ marginBottom: 10 }}>{erro}</div>}

      <div className="modal-btns">
        <button type="button" className="btn btn-success" onClick={salvar} disabled={saving || !destino || !plano || !plano.ok}>
          {saving ? "Transferindo…" : erro ? "Tentar de novo" : "Transferir"}
        </button>
        <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => { if (sujo && !confirm("Descartar as alterações não salvas?")) return; onClose(); }}>
          Cancelar
        </button>
      </div>
    </Modal>
  );
}
