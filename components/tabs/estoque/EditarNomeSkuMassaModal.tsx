"use client";

import { useMemo, useState } from "react";
import Modal from "@/components/Modal";
import { atualizarNomeESku, logAudit } from "@/lib/firebase/data";
import { NOME_MAX, SKU_MAX, transformar, transformacaoVazia, validarEdicao, type LinhaDeEdicao, type Transformacao } from "@/lib/domain/edicao-em-massa";
import type { Product } from "@/lib/domain/types";
import type { TrocaDeSku } from "@/components/tabs/estoque/SincronizarSkuMlModal";

/**
 * Nome e SKU de vários produtos de uma vez. A conta (o que cada linha vira, o
 * que bloqueia e o que só avisa) mora em lib/domain/edicao-em-massa.ts.
 *
 * Duas formas de trabalhar, que se misturam: editar linha a linha, ou aplicar
 * uma regra à lista que está na tela (sufixo, prefixo, trocar um trecho) e depois
 * ajustar o que precisar à mão.
 */

type Alvo = "nome" | "sku" | "ambos";
type Valores = { nome: string; sku: string };

const CAMPO: React.CSSProperties = {
  background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8,
  padding: "7px 10px", color: "var(--text)", fontSize: ".85rem", outline: "none", width: "100%", minWidth: 0,
};

export default function EditarNomeSkuMassaModal({ produtos, onClose, onSkusAlterados }: {
  produtos: readonly Product[];
  onClose: () => void;
  /** Os SKUs que mudaram e foram salvos — pra oferecer levar a troca pro Mercado Livre. */
  onSkusAlterados?: (trocas: TrocaDeSku[]) => void;
}) {
  const [edicoes, setEdicoes] = useState<Record<string, Valores>>({});
  const [busca, setBusca] = useState("");
  const [alvo, setAlvo] = useState<Alvo>("nome");
  const [regra, setRegra] = useState<Transformacao>({ prefixo: "", sufixo: "", localizar: "", substituir: "" });
  const [salvando, setSalvando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [falhas, setFalhas] = useState<string[]>([]);

  const atual = (p: Product): Valores => edicoes[p.id] ?? { nome: p.name ?? "", sku: p.sku ?? "" };

  const termo = busca.trim().toLowerCase();
  const visiveis = useMemo(
    () => produtos.filter((p) => !termo || (p.name ?? "").toLowerCase().includes(termo) || (p.sku ?? "").toLowerCase().includes(termo)),
    [produtos, termo],
  );

  const linhas: LinhaDeEdicao[] = useMemo(() => produtos.map((p) => {
    const v = edicoes[p.id] ?? { nome: p.name ?? "", sku: p.sku ?? "" };
    return { id: p.id, nome: p.name ?? "", sku: p.sku ?? "", novoNome: v.nome, novoSku: v.sku };
  }), [produtos, edicoes]);

  // Todos os produtos entram na conferência: o SKU novo não pode colidir com o de quem não mudou.
  const resultado = useMemo(() => validarEdicao(linhas), [linhas]);
  const mudouId = useMemo(() => new Set(resultado.mudancas.map((l) => l.id)), [resultado]);
  const temErro = resultado.erros.size > 0;

  const mudar = (p: Product, campo: keyof Valores, valor: string) =>
    setEdicoes((s) => ({ ...s, [p.id]: { ...(s[p.id] ?? { nome: p.name ?? "", sku: p.sku ?? "" }), [campo]: valor } }));

  function aplicarRegra() {
    if (transformacaoVazia(regra)) return;
    setEdicoes((s) => {
      const novo = { ...s };
      for (const p of visiveis) {
        const v = novo[p.id] ?? { nome: p.name ?? "", sku: p.sku ?? "" };
        novo[p.id] = {
          nome: alvo === "sku" ? v.nome : transformar(v.nome, regra),
          sku: alvo === "nome" ? v.sku : transformar(v.sku, regra),
        };
      }
      return novo;
    });
  }

  async function salvar() {
    if (temErro || resultado.mudancas.length === 0 || salvando) return;
    if (resultado.skusAlterados.length > 0 && !confirm(
      `Você vai mudar o SKU de ${resultado.skusAlterados.length} produto(s).\n\n`
      + "A venda só acha o produto (e o custo dele) se o SKU do anúncio no Mercado Livre for o MESMO que está aqui. "
      + "Se não for, essas vendas passam a ficar sem produto e o lucro sai inflado.\n\nConfirma?",
    )) return;

    setSalvando(true);
    setFalhas([]);
    setProgresso(0);
    const erros: string[] = [];
    const salvos = new Set<string>();
    let n = 0;
    // Um por vez e independentes: se um falhar, os outros seguem e a tela diz quais falharam.
    for (const l of resultado.mudancas) {
      try {
        await atualizarNomeESku(l.id, {
          ...(l.novoNome.trim() !== l.nome.trim() ? { name: l.novoNome } : {}),
          ...(l.novoSku.trim() !== l.sku.trim() ? { sku: l.novoSku } : {}),
        });
        const partes = [
          l.novoNome.trim() !== l.nome.trim() ? `nome “${l.nome}” → “${l.novoNome.trim()}”` : "",
          l.novoSku.trim() !== l.sku.trim() ? `SKU “${l.sku || "—"}” → “${l.novoSku.trim() || "—"}”` : "",
        ].filter(Boolean);
        // O rastro é secundário: a mudança já foi salva e não deve virar erro se ele falhar.
        salvos.add(l.id);
        logAudit({ acao: "editar", entidade: "produto", entidadeId: l.id, entidadeLabel: l.novoNome.trim() || l.nome, detalhe: `em massa · ${partes.join(" · ")}`.slice(0, 500) }).catch(() => {});
      } catch (e) {
        erros.push(`${l.nome || l.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
      setProgresso(++n);
    }
    setSalvando(false);
    if (erros.length) { setFalhas(erros); return; }
    const trocas = resultado.skusAlterados
      .filter((l) => salvos.has(l.id) && l.novoSku.trim() !== "")
      .map((l) => ({ productId: l.id, nome: l.novoNome.trim() || l.nome, skuAntigo: l.sku.trim(), skuNovo: l.novoSku.trim() }));
    onClose();
    if (trocas.length) onSkusAlterados?.(trocas);
  }

  const campoRegra = (chave: keyof Transformacao, rotulo: string, placeholder: string) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: ".75rem", color: "var(--muted)", flex: "1 1 130px", minWidth: 0 }}>
      {rotulo}
      <input
        value={regra[chave] ?? ""} placeholder={placeholder} disabled={salvando}
        onChange={(e) => setRegra((r) => ({ ...r, [chave]: e.target.value }))}
        style={CAMPO}
      />
    </label>
  );

  return (
    <Modal open wide onClose={salvando ? () => {} : onClose} titulo="Editar nome e SKU em massa" confirmarDescarte={mudouId.size > 0 && !salvando}>
      <div className="modal-title">Editar nome e SKU em massa</div>
      <div className="modal-sub">edite linha a linha ou aplique uma regra à lista — nada é gravado até você salvar</div>

      <div style={{ padding: "10px 12px", borderRadius: 10, background: "var(--surface2)", border: "1px solid var(--border)", marginBottom: 10 }}>
        <div style={{ fontWeight: 700, fontSize: ".85rem", marginBottom: 8 }}>Aplicar uma regra aos {visiveis.length} produtos da lista</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: ".75rem", color: "var(--muted)" }}>
            Em
            <select value={alvo} onChange={(e) => setAlvo(e.target.value as Alvo)} disabled={salvando} style={{ ...CAMPO, width: "auto" }}>
              <option value="nome">Nome</option>
              <option value="sku">SKU</option>
              <option value="ambos">Nome e SKU</option>
            </select>
          </label>
          {campoRegra("localizar", "Trocar o trecho", "Ex: Full")}
          {campoRegra("substituir", "por", "Ex: Agências")}
          {campoRegra("prefixo", "Começar com", "Ex: Kit ")}
          {campoRegra("sufixo", "Terminar com", "Ex:  Agências")}
          <button type="button" className="btn btn-ghost btn-xs" onClick={aplicarRegra} disabled={salvando || transformacaoVazia(regra)}>Aplicar na lista</button>
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          Troca todas as ocorrências (sem diferenciar maiúscula), depois põe o começo e o fim. Pra SKU, escreva sem espaço (ex.: <code>Ag</code>).
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        <input
          type="search" value={busca} onChange={(e) => setBusca(e.target.value)} disabled={salvando}
          placeholder="Filtrar por nome ou SKU…" aria-label="Filtrar produtos" style={{ ...CAMPO, flex: "1 1 220px", width: "auto" }}
        />
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => setEdicoes({})} disabled={salvando || mudouId.size === 0}>Desfazer tudo</button>
      </div>

      <div style={{ maxHeight: "44vh", overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
        {visiveis.length === 0 && <div style={{ padding: 16, color: "var(--muted)", fontSize: ".85rem" }}>Nenhum produto na busca.</div>}
        {visiveis.map((p) => {
          const v = atual(p);
          const mudou = mudouId.has(p.id);
          const prob = resultado.erros.get(p.id);
          return (
            <div key={p.id} style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", background: mudou ? "rgba(var(--brand-rgb),.07)" : undefined }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <label style={{ flex: "2 1 220px", minWidth: 0, display: "flex", flexDirection: "column", gap: 3, fontSize: ".72rem", color: "var(--muted)" }}>
                  Nome
                  <input
                    value={v.nome} maxLength={NOME_MAX + 50} disabled={salvando} onChange={(e) => mudar(p, "nome", e.target.value)}
                    aria-invalid={prob?.nome ? true : undefined} style={CAMPO}
                  />
                </label>
                <label style={{ flex: "1 1 150px", minWidth: 0, display: "flex", flexDirection: "column", gap: 3, fontSize: ".72rem", color: "var(--muted)" }}>
                  SKU
                  <input
                    value={v.sku} maxLength={SKU_MAX + 20} disabled={salvando} onChange={(e) => mudar(p, "sku", e.target.value)}
                    aria-invalid={prob?.sku ? true : undefined} style={CAMPO} placeholder="sem SKU"
                  />
                </label>
              </div>
              {mudou && (
                <div style={{ fontSize: ".72rem", color: "var(--muted)", marginTop: 3, overflowWrap: "anywhere" }}>
                  era: {p.name || "sem nome"}{p.sku ? ` · SKU ${p.sku}` : " · sem SKU"}
                </div>
              )}
              {prob?.nome && <div role="alert" style={{ fontSize: ".75rem", color: "var(--red-text)", marginTop: 3 }}>{prob.nome}</div>}
              {prob?.sku && <div role="alert" style={{ fontSize: ".75rem", color: "var(--red-text)", marginTop: 3 }}>{prob.sku}</div>}
            </div>
          );
        })}
      </div>

      {resultado.skusAlterados.length > 0 && (
        <div className="note note-accent" style={{ marginTop: 10, fontSize: ".82rem", lineHeight: 1.5 }}>
          <b>{resultado.skusAlterados.length} SKU(s) vão mudar.</b> A venda só acha o produto (e o custo dele) se o SKU do anúncio no
          Mercado Livre for o mesmo que está aqui — confira os anúncios.
        </div>
      )}
      {falhas.length > 0 && (
        <div className="hint" style={{ color: "var(--red-text)", marginTop: 8 }}>
          <b>Estes NÃO foram salvos (os demais foram):</b>
          {falhas.map((f) => <div key={f}>• {f}</div>)}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: ".84rem" }} aria-live="polite">
          <b>{resultado.mudancas.length}</b> produto(s) alterado(s)
          {temErro && <span style={{ color: "var(--red-text)" }}> · {resultado.erros.size} com problema</span>}
        </div>
        <div className="modal-btns" style={{ margin: 0 }}>
          <button type="button" className="btn btn-success" onClick={salvar} disabled={salvando || temErro || resultado.mudancas.length === 0}>
            {salvando ? `Salvando ${progresso}/${resultado.mudancas.length}…` : `Salvar ${resultado.mudancas.length || ""}`.trim()}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={salvando}>Cancelar</button>
        </div>
      </div>
    </Modal>
  );
}
