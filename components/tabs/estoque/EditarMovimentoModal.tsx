"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import { fmtBRL } from "@/lib/domain/calc";
import { logAudit, updateMovimento } from "@/lib/firebase/data";
import { TIPO_MOVIMENTO_LABEL, type EstoqueMovimento, type Product } from "@/lib/domain/types";

/**
 * Corrige uma movimentação já lançada.
 *
 * ─── POR QUE EDITAR, SE JÁ DAVA PRA EXCLUIR E RELANÇAR ──────────────────
 *
 * Excluir e relançar funciona, mas custa o histórico: o novo lançamento nasce
 * com a data de hoje e o autor de hoje, e perde-se quem lançou a compra
 * original e quando. Numa operação com mais de uma pessoa mexendo no estoque,
 * é justamente esse rastro que responde "de onde veio esse custo".
 *
 * Editar preserva `createdBy`/`createdAt` e marca `updatedBy`/`updatedAt` por
 * cima (ver updateMovimento) — o registro continua sendo o mesmo evento, com
 * a correção anotada.
 *
 * ─── POR QUE O CUSTO IMPORTA MAIS QUE O RESTO ───────────────────────────
 *
 * `custoUnit` alimenta o custo médio, que vira CMV em TODO pedido daquele
 * produto. Um dígito errado aqui distorce a margem de tudo que já foi vendido
 * e do que ainda vai vender. É o campo que mais se erra e o que mais dói.
 *
 * Não é preciso recalcular a média à mão: recomputeProduto varre todas as
 * movimentações do produto de novo a cada gravação.
 */

export default function EditarMovimentoModal({
  product, mov, onClose, onSaved,
}: {
  product: Product;
  mov: EstoqueMovimento;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Só entrada e saldo inicial carregam custo — nas outras o campo não existe.
  const temCusto = mov.tipo === "entrada" || mov.tipo === "saldo_inicial";
  // Ajuste é o único que aceita negativo (perda). Nos demais o sinal é do
  // tipo, não do número — guardar negativo ali bagunçaria o recálculo.
  const aceitaNegativo = mov.tipo === "ajuste";

  const [data, setData] = useState(mov.data);
  const [qtd, setQtd] = useState(String(mov.quantidade));
  const [custo, setCusto] = useState(mov.custoUnit != null ? String(mov.custoUnit) : "");
  const [obs, setObs] = useState(mov.obs ?? "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const qNum = Number(String(qtd).replace(",", "."));
  const cNum = custo.trim() === "" ? null : Number(String(custo).replace(",", "."));

  const qtdValida = Number.isFinite(qNum) && qNum !== 0 && (aceitaNegativo || qNum > 0);
  const custoValido = !temCusto || cNum == null || (Number.isFinite(cNum) && cNum >= 0);
  const dataValida = /^\d{4}-\d{2}-\d{2}$/.test(data);
  const podeSalvar = qtdValida && custoValido && dataValida && !salvando;

  // O que de fato mudou — pra não gravar à toa e pra registrar na auditoria.
  const mudancas: string[] = [];
  if (data !== mov.data) mudancas.push(`data ${mov.data} → ${data}`);
  if (qNum !== mov.quantidade) mudancas.push(`qtd ${mov.quantidade} → ${qNum}`);
  if (temCusto && cNum !== (mov.custoUnit ?? null)) {
    mudancas.push(`custo ${mov.custoUnit != null ? fmtBRL(mov.custoUnit) : "—"} → ${cNum != null ? fmtBRL(cNum) : "—"}`);
  }
  if ((obs.trim() || undefined) !== (mov.obs || undefined)) mudancas.push("observação");

  async function salvar() {
    if (!podeSalvar || mudancas.length === 0) return;
    setSalvando(true);
    setErro("");
    try {
      await updateMovimento(mov.id, product.id, {
        data,
        quantidade: qNum,
        obs: obs.trim() || undefined,
        ...(temCusto && cNum != null ? { custoUnit: cNum } : {}),
      });
      await logAudit({
        acao: "editar", entidade: "movimento", entidadeId: mov.id,
        entidadeLabel: `${product.name || "(sem nome)"} · ${TIPO_MOVIMENTO_LABEL[mov.tipo]}`,
        detalhe: mudancas.join(" · "),
      }).catch(() => {});
      onSaved();
      onClose();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal open onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text)" }}>
          Editar {TIPO_MOVIMENTO_LABEL[mov.tipo]}
        </h3>
        <div style={{ fontSize: ".78rem", color: "var(--muted)", lineHeight: 1.6 }}>
          {product.name || "(sem nome)"}
          {temCusto && (
            <>
              {" "}· corrigir o custo aqui recalcula o <b style={{ color: "var(--text)" }}>custo médio</b> do
              produto inteiro, e com ele a margem dos pedidos.
            </>
          )}
        </div>

        <div className="form-grid">
          <div className="field">
            <label>Data</label>
            <input className="inp" type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </div>

          <div className="field">
            <label>Quantidade{aceitaNegativo && " (negativo = perda)"}</label>
            <input
              className="inp" type="number" step="1" inputMode="numeric"
              value={qtd} onChange={(e) => setQtd(e.target.value)}
            />
            {!qtdValida && qtd.trim() !== "" && (
              <span style={{ fontSize: ".7rem", color: "var(--red)" }}>
                {aceitaNegativo ? "Informe um número diferente de zero." : "Informe um número maior que zero."}
              </span>
            )}
          </div>

          {temCusto && (
            <div className="field">
              <label>Custo unitário</label>
              <div className="inp-wrap">
                <span className="inp-prefix">R$</span>
                <input
                  className="inp inp-money" type="number" min="0" step="0.01" inputMode="decimal"
                  value={custo} onChange={(e) => setCusto(e.target.value)}
                />
              </div>
              {temCusto && cNum != null && Number.isFinite(cNum) && qtdValida && (
                <span style={{ fontSize: ".7rem", color: "var(--muted)" }}>
                  total desta entrada: {fmtBRL(cNum * Math.abs(qNum))}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="field">
          <label>Observação (opcional)</label>
          <input
            className="inp" value={obs} onChange={(e) => setObs(e.target.value)}
            placeholder="Ex: Terramazonia promoção"
          />
        </div>

        {mudancas.length > 0 && (
          <div style={{
            fontSize: ".76rem", lineHeight: 1.6, padding: "8px 10px", borderRadius: 8,
            background: "var(--warning-soft)", border: "1px solid rgba(255,138,31,.35)", color: "var(--text)",
          }}>
            <b>Vai mudar:</b> {mudancas.join(" · ")}
          </div>
        )}

        {erro && <div className="note note-warn">{erro}</div>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={salvando}>Cancelar</button>
          <button
            type="button" className="btn btn-success"
            onClick={salvar}
            disabled={!podeSalvar || mudancas.length === 0}
            title={mudancas.length === 0 ? "Nada foi alterado" : undefined}
          >
            {salvando ? "Salvando…" : "Salvar correção"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
