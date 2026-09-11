"use client";

import { useState } from "react";
import { diasNoMes, fmtBRL, todayStr } from "@/lib/domain/calc";
import { COST_CATEGORIA_LABEL, type Cost, type CostCategoria } from "@/lib/domain/types";
import { logAudit, upsertCost } from "@/lib/firebase/data";
import {
  ESCOPO_META,
  FREQUENCIA_META,
  NOME_MAX,
  custoDe,
  impactoNoMes,
  lerValorEmReais,
  mesDeReferencia,
  podeSalvar,
  rascunhoDe,
  rascunhoVazio,
  validarCusto,
  type Escopo,
  type Frequencia,
  type RascunhoCusto,
} from "@/lib/domain/custo-form";

/**
 * O formulário de custo — o MESMO na aba de Custos e na DRE.
 *
 * ─── POR QUE UM SÓ ──────────────────────────────────────────────────────
 *
 * A DRE ganhou um jeito de cadastrar custo sem sair dela. Um segundo
 * formulário lá teria as mesmas regras (valor em pt-BR, data do avulso, onde
 * o custo conta) escritas de novo, e as duas cópias divergiriam na primeira
 * correção. As regras moram em lib/domain/custo-form.ts; esta tela só pergunta.
 *
 * ─── NADA É GRAVADO ATÉ CLICAR EM SALVAR ────────────────────────────────
 *
 * A aba antiga gravava a cada tecla, sem aviso, e engolia o erro. Aqui o
 * custo só vai pro banco no clique, o botão diz "Salvando…" enquanto grava,
 * e se a gravação falhar o formulário FICA ABERTO com o erro escrito e os
 * dados preservados — em vez de fechar e fingir que deu certo.
 */

function novoIdDeCusto() {
  return "c" + Date.now() + Math.random().toString(36).slice(2, 6);
}

function nomeDoMes(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  if (!y || !m) return mes;
  return new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(new Date(y, m - 1, 1));
}

/** Mensal primeiro: é o padrão novo e o caso mais comum (contador, sistema). */
const ORDEM_FREQ: Frequencia[] = ["mensal", "diario", "avulso"];
const ORDEM_ESCOPO: Escopo[] = ["dash", "dre"];

const rotuloCampo: React.CSSProperties = {
  fontSize: ".68rem", color: "var(--muted)", textTransform: "uppercase",
  letterSpacing: ".05em", fontWeight: 700, marginBottom: 5, display: "block",
};
const textoErro: React.CSSProperties = { color: "var(--red)", fontSize: ".74rem", marginTop: 4 };

export default function CustoForm({ inicial, escopoPadrao = "dash", onSalvo, onCancelar }: {
  /** O custo a editar. `null` = cadastrar um novo. */
  inicial: Cost | null;
  /** Onde o custo novo nasce contando. A DRE passa "dre". */
  escopoPadrao?: Escopo;
  onSalvo: (custo: Cost) => void;
  onCancelar: () => void;
}) {
  const hoje = todayStr();
  const [r, setR] = useState<RascunhoCusto>(() =>
    inicial ? rascunhoDe(inicial, hoje) : rascunhoVazio({ hojeISO: hoje, escopo: escopoPadrao }));
  /**
   * Os erros só aparecem depois da primeira tentativa de salvar. Mostrá-los
   * desde a abertura pintaria o formulário de vermelho antes de a pessoa ter
   * digitado qualquer coisa — o jeito mais rápido de parecer que ela errou.
   */
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erroGravacao, setErroGravacao] = useState<string | null>(null);
  const [maisDetalhes, setMaisDetalhes] = useState(
    () => Boolean(inicial?.categoria || inicial?.centroCusto || inicial?.observacao),
  );

  function muda<K extends keyof RascunhoCusto>(campo: K, valor: RascunhoCusto[K]) {
    setR((atual) => ({ ...atual, [campo]: valor }));
    setErroGravacao(null);
  }

  const novo = !inicial;
  const erros = tentouSalvar ? validarCusto(r) : {};
  const mes = mesDeReferencia(r, hoje);
  const impacto = impactoNoMes(r, mes);
  const valorLido = lerValorEmReais(r.valorTexto);

  async function salvar(e?: React.FormEvent) {
    e?.preventDefault();
    setTentouSalvar(true);
    if (salvando || !podeSalvar(r)) return;
    setSalvando(true);
    setErroGravacao(null);
    try {
      const id = r.id ?? novoIdDeCusto();
      const custo = custoDe(r, id, inicial ?? undefined);
      await upsertCost("", custo);
      logAudit({
        acao: novo ? "criar" : "editar", entidade: "custo", entidadeId: id, entidadeLabel: custo.nome,
      }).catch(() => {});
      onSalvo(custo);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErroGravacao(msg);
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={salvar} noValidate>
      <div className="modal-title">{novo ? "Novo custo" : "Editar custo"}</div>
      <div className="modal-sub">Nada é gravado até você clicar em Salvar.</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 14 }}>
        {/* ── O que é ── */}
        <div>
          <label style={rotuloCampo} htmlFor="custo-nome">O que é</label>
          <input
            id="custo-nome" className="inp" type="text" maxLength={NOME_MAX + 20}
            placeholder="Ex.: Contador, embalagem, aluguel"
            value={r.nome} onChange={(e) => muda("nome", e.target.value)}
            aria-invalid={Boolean(erros.nome)}
          />
          {erros.nome && <div style={textoErro}>{erros.nome}</div>}
        </div>

        {/* ── Quanto ── */}
        <div>
          <label style={rotuloCampo} htmlFor="custo-valor">Quanto</label>
          <div style={{ position: "relative" }}>
            <span style={{
              position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
              color: "var(--muted)", fontSize: ".9rem", pointerEvents: "none",
            }}>R$</span>
            {/* Texto, não number: `type="number"` recusa a vírgula no teclado
                brasileiro, e "12,50" simplesmente não entrava. A leitura do
                que foi digitado mora em lerValorEmReais. */}
            <input
              id="custo-valor" className="inp" type="text" inputMode="decimal"
              placeholder="0,00" style={{ paddingLeft: 38, fontVariantNumeric: "tabular-nums" }}
              value={r.valorTexto} onChange={(e) => muda("valorTexto", e.target.value)}
              aria-invalid={Boolean(erros.valor)}
            />
          </div>
          {erros.valor && <div style={textoErro}>{erros.valor}</div>}
        </div>

        {/* ── Com que frequência ── */}
        <div>
          <span style={rotuloCampo}>Com que frequência</span>
          <div className="seg" role="radiogroup" aria-label="Frequência do custo">
            {ORDEM_FREQ.map((f) => (
              <button
                key={f} type="button" role="radio" aria-checked={r.freq === f}
                className={`seg-btn ${r.freq === f ? "active" : ""}`}
                onClick={() => muda("freq", f)}
              >
                {FREQUENCIA_META[f].rotulo}
              </button>
            ))}
          </div>
          <div style={{ fontSize: ".76rem", color: "var(--muted)", marginTop: 6 }}>
            {FREQUENCIA_META[r.freq].explica}
          </div>
        </div>

        {r.freq === "avulso" && (
          <div>
            <label style={rotuloCampo} htmlFor="custo-data">Em que data</label>
            <input
              id="custo-data" className="inp" type="date" style={{ maxWidth: 200 }}
              value={r.data} onChange={(e) => muda("data", e.target.value)}
              aria-invalid={Boolean(erros.data)}
            />
            {erros.data && <div style={textoErro}>{erros.data}</div>}
          </div>
        )}

        {/* ── Onde conta ──
            Duas escolhas grandes, cada uma com o exemplo do lado. Era um
            select com "Desconta no Dashboard / Só na DRE" e a explicação num
            quadro longe do campo — quem precisava entender a diferença tinha
            que achar o quadro primeiro. */}
        <div>
          <span style={rotuloCampo}>Onde esse custo conta</span>
          <div role="radiogroup" aria-label="Onde o custo conta" style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
            {ORDEM_ESCOPO.map((esc) => {
              const ativo = r.escopo === esc;
              return (
                <button
                  key={esc} type="button" role="radio" aria-checked={ativo}
                  onClick={() => muda("escopo", esc)}
                  style={{
                    textAlign: "left", padding: "10px 12px", borderRadius: 10, cursor: "pointer",
                    background: ativo ? "var(--surface2)" : "transparent",
                    border: `1px solid ${ativo ? "var(--accent)" : "var(--border)"}`,
                    color: "var(--text)", font: "inherit",
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: ".86rem", display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color: ativo ? "var(--accent)" : "var(--muted)" }}>{ativo ? "●" : "○"}</span>
                    {ESCOPO_META[esc].rotulo}
                  </div>
                  <div style={{ fontSize: ".74rem", color: "var(--muted)", marginTop: 3, lineHeight: 1.4 }}>
                    {ESCOPO_META[esc].explica}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── A prévia ──
            A consequência antes do clique. É o que responde "o que isso vai
            fazer com os meus números?" — e se o valor foi lido errado
            ("1.234" como 1,234), é aqui que aparece, antes de gravar. */}
        <div className="note note-accent" style={{ margin: 0 }} aria-live="polite">
          {impacto == null ? (
            <span>Digite o valor pra ver quanto isso pesa no mês.</span>
          ) : (
            <>
              <div>
                Vai pesar <b>{fmtBRL(impacto)}</b> em {nomeDoMes(mes)}
                {r.freq === "diario" && valorLido != null && (
                  <span style={{ color: "var(--muted)" }}> — {fmtBRL(valorLido)} × {diasNoMes(mes)} dias</span>
                )}
                .
              </div>
              <div style={{ fontSize: ".76rem", color: "var(--muted)", marginTop: 3 }}>
                {r.escopo === "dash"
                  ? "Entra no lucro do Dashboard e na DRE."
                  : "Aparece só na DRE — o lucro do Dashboard não muda."}
                {r.freq === "mensal" && " Na DRE, custo mensal só entra quando o período escolhido é o mês inteiro."}
              </div>
            </>
          )}
        </div>

        {/* ── Opcional, recolhido ──
            Categoria, centro de custo e observação não mudam número nenhum.
            Abertos o tempo todo eram metade do formulário e davam a impressão
            de que tudo era obrigatório. */}
        <div>
          <button
            type="button" className="btn btn-ghost btn-xs"
            onClick={() => setMaisDetalhes((v) => !v)} aria-expanded={maisDetalhes}
          >
            {maisDetalhes ? "▾" : "▸"} Mais detalhes (opcional)
          </button>
          {maisDetalhes && (
            <div className="form-grid" style={{ marginTop: 10 }}>
              <div className="field">
                <label htmlFor="custo-categoria">Categoria</label>
                <select
                  id="custo-categoria" className="inp" value={r.categoria}
                  onChange={(e) => muda("categoria", e.target.value as CostCategoria | "")}
                >
                  <option value="">— sem categoria —</option>
                  {(Object.keys(COST_CATEGORIA_LABEL) as CostCategoria[]).map((c) => (
                    <option key={c} value={c}>{COST_CATEGORIA_LABEL[c]}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="custo-centro">Centro de custo</label>
                <input
                  id="custo-centro" className="inp" type="text" placeholder="Ex.: Galpão, Anúncios"
                  value={r.centroCusto} onChange={(e) => muda("centroCusto", e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="custo-obs">Observação</label>
                <input
                  id="custo-obs" className="inp" type="text" placeholder="Ex.: contrato até dez/2026"
                  value={r.observacao} onChange={(e) => muda("observacao", e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        {erroGravacao && (
          <div className="note note-danger" style={{ margin: 0 }} role="alert">
            <b>Não consegui salvar — nada foi gravado.</b> Seus dados continuam aqui; tente de novo.
            <div style={{ marginTop: 4, fontFamily: "ui-monospace, monospace", fontSize: ".7rem", overflowWrap: "anywhere" }}>
              {erroGravacao}
            </div>
          </div>
        )}
      </div>

      <div className="modal-btns">
        <button type="button" className="btn btn-ghost" onClick={onCancelar} disabled={salvando}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primary" disabled={salvando}>
          {salvando ? "Salvando…" : novo ? "Salvar custo" : "Salvar alterações"}
        </button>
      </div>
    </form>
  );
}
