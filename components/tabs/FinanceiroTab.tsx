"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { authedFetch } from "@/lib/api/authed-fetch";
import TelaHeader from "@/components/TelaHeader";
import Modal from "@/components/Modal";
import { formatarBRL, paraCentavos } from "@/lib/financeiro/dinheiro";
import {
  celulaCsv, devidoDe, posicaoDaConta, resultadoDoPeriodo, situacaoDe,
  type Conta, type Movimento, type Natureza, type Obrigacao, type Recorrencia, type SituacaoObrigacao,
} from "@/lib/financeiro/modelo";

/**
 * Financeiro — exclusivo do owner.
 *
 * Tudo vem de /api/financeiro (servidor, sem cache no navegador). Nada aqui é
 * dinheiro de verdade se mexendo: "Registrar pagamento" é anotação interna.
 * Saldo só aparece pra conta com saldo de abertura comprovado; sem ele, a
 * tela diz "movimentação", nunca "saldo".
 */

type Dados = { contas: Conta[]; movimentos: Movimento[]; obrigacoes: Obrigacao[]; recorrencias: Recorrencia[]; hoje: string };
type Visao = "geral" | "pagar" | "movimentos" | "contas";

const NATUREZA_ROTULO: Record<Natureza, string> = {
  receita: "Receita", despesa: "Despesa", compra_estoque: "Compra de estoque",
  retirada: "Retirada do dono", transferencia: "Transferência", ajuste: "Ajuste",
};
const SITUACAO: Record<SituacaoObrigacao, { rotulo: string; cor: string }> = {
  vencida: { rotulo: "Vencida", cor: "var(--red-text)" },
  a_vencer: { rotulo: "A vencer", cor: "var(--muted)" },
  parcial: { rotulo: "Paga em parte", cor: "var(--warning)" },
  paga: { rotulo: "Paga", cor: "var(--green)" },
  cancelada: { rotulo: "Cancelada", cor: "var(--muted)" },
};
const CATEGORIAS = ["Estoque", "Embalagens", "Fretes", "Ads", "Full", "Impostos", "Equipe", "Softwares", "Contador", "Serviços", "Estrutura", "Retirada", "Outros"];

const dataBR = (d: string) => (d ? d.split("-").reverse().join("/") : "—");
function somarDias(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function chamar(corpo: Record<string, unknown>): Promise<{ ok: boolean; erro?: string }> {
  const r = await authedFetch("/api/financeiro", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const j = await r.json().catch(() => ({}));
  return r.ok ? { ok: true } : { ok: false, erro: j?.error ?? `erro ${r.status}` };
}

const CAMPO: React.CSSProperties = { background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: ".9rem", width: "100%" };

export default function FinanceiroTab() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [falha, setFalha] = useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<number | null>(null);
  const [visao, setVisao] = useState<Visao>("geral");
  const [modal, setModal] = useState<null | "lancar" | "transferir" | "obrigacao" | "recorrencia" | "conta" | { baixar: Obrigacao }>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      // Gera as contas do mês das recorrências antes de ler (idempotente no servidor).
      await chamar({ acao: "gerar_recorrencias" }).catch(() => null);
      const r = await authedFetch("/api/financeiro", { cache: "no-store" });
      if (!r.ok) throw new Error(r.status === 403 ? "Só o owner acessa o Financeiro." : `erro ${r.status}`);
      setDados(await r.json());
      setFalha(null);
      setAtualizadoEm(Date.now());
    } catch (e) {
      // Falha preserva o último dado e marca desatualizado — nunca vira zero.
      setFalha(e instanceof Error ? e.message : String(e));
    } finally { setCarregando(false); }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial assíncrona (setState só depois do fetch)
  useEffect(() => { void carregar(); }, [carregar]);
  // Sair da aba não deixa o extrato em memória de componente desmontado.
  useEffect(() => () => setDados(null), []);

  const aoSalvar = useCallback(async () => { setModal(null); await carregar(); }, [carregar]);

  return (
    <div className="dash">
      <TelaHeader
        titulo="Financeiro"
        subtitulo={`Só você vê esta aba · fonte: lançamentos manuais${atualizadoEm ? ` · atualizado às ${new Date(atualizadoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""}${falha && dados ? " · DESATUALIZADO" : ""}`}
        acao={{ rotulo: "Novo lançamento", onClick: () => setModal("lancar"), desabilitada: !dados?.contas.length }}
        secundarias={[
          { rotulo: "Nova conta a pagar", onClick: () => setModal("obrigacao") },
          { rotulo: "Despesa que se repete", onClick: () => setModal("recorrencia") },
          { rotulo: "Transferir entre contas", onClick: () => setModal("transferir"), desabilitada: (dados?.contas.length ?? 0) < 2 },
          { rotulo: "Nova conta", onClick: () => setModal("conta") },
          { rotulo: "Atualizar", onClick: () => void carregar() },
        ]}
      />

      {falha && (
        <div className="note note-accent" style={{ marginBottom: 12 }}>
          {dados ? "Não consegui atualizar agora — os números abaixo são da última leitura. " : "Não consegui carregar o Financeiro. "}{falha}
        </div>
      )}

      {!dados && carregando && <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Carregando…</div>}

      {dados && (
        <>
          <div className="seg" style={{ marginBottom: 14 }}>
            {([["geral", "Visão geral"], ["pagar", "Contas a pagar"], ["movimentos", "Movimentações"], ["contas", "Contas"]] as [Visao, string][]).map(([v, r]) => (
              <button key={v} type="button" className={`seg-btn ${visao === v ? "active" : ""}`} onClick={() => setVisao(v)}>{r}</button>
            ))}
          </div>

          {dados.contas.length === 0 && (
            <div className="panel" style={{ marginBottom: 14 }}>
              <div className="panel-title" style={{ marginBottom: 6 }}>Comece cadastrando onde o dinheiro fica</div>
              <div style={{ color: "var(--muted)", fontSize: ".85rem", marginBottom: 10 }}>
                Mercado Pago, banco e caixa. Com o saldo de um dia que você comprova (extrato, print), o app passa a mostrar o saldo de verdade.
              </div>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setModal("conta")}>Cadastrar conta</button>
            </div>
          )}

          {visao === "geral" && <VisaoGeral dados={dados} onPagar={(o) => setModal({ baixar: o })} />}
          {visao === "pagar" && <ContasAPagar dados={dados} onPagar={(o) => setModal({ baixar: o })} onMudou={carregar} />}
          {visao === "movimentos" && <Movimentacoes dados={dados} onMudou={carregar} />}
          {visao === "contas" && <ListaDeContas dados={dados} onNova={() => setModal("conta")} />}
        </>
      )}

      {modal === "conta" && <FormConta onClose={() => setModal(null)} onSalvo={aoSalvar} />}
      {modal === "lancar" && dados && <FormLancamento contas={dados.contas} hoje={dados.hoje} onClose={() => setModal(null)} onSalvo={aoSalvar} />}
      {modal === "transferir" && dados && <FormTransferencia contas={dados.contas} hoje={dados.hoje} onClose={() => setModal(null)} onSalvo={aoSalvar} />}
      {modal === "obrigacao" && dados && <FormObrigacao hoje={dados.hoje} onClose={() => setModal(null)} onSalvo={aoSalvar} />}
      {modal === "recorrencia" && dados && <FormRecorrencia hoje={dados.hoje} onClose={() => setModal(null)} onSalvo={aoSalvar} />}
      {modal && typeof modal === "object" && dados && (
        <FormBaixa obrigacao={modal.baixar} contas={dados.contas} hoje={dados.hoje} onClose={() => setModal(null)} onSalvo={aoSalvar} />
      )}
    </div>
  );
}

// ── Visão geral ──────────────────────────────────────────────────────────

function VisaoGeral({ dados, onPagar }: { dados: Dados; onPagar: (o: Obrigacao) => void }) {
  const { hoje } = dados;
  const mes = { de: `${hoje.slice(0, 7)}-01`, ate: hoje };
  const r = resultadoDoPeriodo(dados.movimentos, mes.de, mes.ate);
  const abertas = dados.obrigacoes.filter((o) => devidoDe(o) > 0);
  const vencidas = abertas.filter((o) => o.vencimento < hoje);
  const em7 = abertas.filter((o) => o.vencimento >= hoje && o.vencimento <= somarDias(hoje, 7));
  const soma = (os: Obrigacao[]) => os.reduce((s, o) => s + devidoDe(o), 0);
  const urgentes = [...vencidas, ...em7].sort((a, b) => a.vencimento.localeCompare(b.vencimento)).slice(0, 6);

  return (
    <>
      <section className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-head"><span className="panel-title">Contas</span><span className="panel-sub">posição atual — não muda com filtro de período</span></div>
        {dados.contas.filter((c) => c.ativa).map((c) => {
          const p = posicaoDaConta(c, dados.movimentos);
          return (
            <div key={c.id} className="cost-row">
              <span className="c-lbl">{c.nome}</span>
              <span style={{ textAlign: "right" }}>
                <b style={{ color: p.centavos < 0 ? "var(--red-text)" : "var(--text)" }}>{formatarBRL(p.centavos)}</b>
                <span style={{ display: "block", fontSize: ".72rem", color: "var(--muted)" }}>
                  {p.tipo === "saldo" ? `saldo · abertura em ${dataBR(p.desde)}` : "só a movimentação lançada — sem saldo de abertura"}
                </span>
              </span>
            </div>
          );
        })}
      </section>

      <div className="kpi-grid" style={{ marginBottom: 14 }}>
        <div className={`kpi ${vencidas.length ? "k-neg" : "k-pos"}`}><div className="k-lbl">Vencidas</div><div className="k-val">{formatarBRL(soma(vencidas))}</div><div className="k-sub">{vencidas.length} conta(s)</div></div>
        <div className="kpi k-warn"><div className="k-lbl">Vencem em 7 dias</div><div className="k-val">{formatarBRL(soma(em7))}</div><div className="k-sub">{em7.length} conta(s)</div></div>
        <div className="kpi k-acc"><div className="k-lbl">Total a pagar</div><div className="k-val">{formatarBRL(soma(abertas))}</div><div className="k-sub">{abertas.length} em aberto</div></div>
        <div className={`kpi ${r.resultado >= 0 ? "k-pos" : "k-neg"}`}><div className="k-lbl">Resultado de caixa do mês</div><div className="k-val">{formatarBRL(r.resultado)}</div><div className="k-sub">receitas − despesas lançadas</div></div>
      </div>

      {(r.compraEstoque !== 0 || r.retiradas !== 0) && (
        <div style={{ fontSize: ".8rem", color: "var(--muted)", marginBottom: 14 }}>
          Fora do resultado: compra de estoque {formatarBRL(r.compraEstoque)} · retiradas {formatarBRL(r.retiradas)}.
        </div>
      )}

      {urgentes.length > 0 && (
        <section className="panel">
          <div className="panel-head"><span className="panel-title">Pagar primeiro</span><span className="panel-sub">vencidas e dos próximos 7 dias</span></div>
          {urgentes.map((o) => (
            <div key={o.id} className="cost-row">
              <span className="c-lbl">{o.descricao}{o.parcela ? ` (${o.parcela.numero}/${o.parcela.de})` : ""}<span style={{ display: "block", fontSize: ".72rem", color: o.vencimento < hoje ? "var(--red-text)" : "var(--muted)" }}>vence {dataBR(o.vencimento)}</span></span>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <b>{formatarBRL(devidoDe(o))}</b>
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => onPagar(o)}>Registrar pagamento</button>
              </span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

// ── Contas a pagar ───────────────────────────────────────────────────────

function ContasAPagar({ dados, onPagar, onMudou }: { dados: Dados; onPagar: (o: Obrigacao) => void; onMudou: () => void }) {
  const [mostrar, setMostrar] = useState<"abertas" | "todas">("abertas");
  const lista = dados.obrigacoes
    .filter((o) => mostrar === "todas" || devidoDe(o) > 0)
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  async function cancelar(o: Obrigacao) {
    if (!confirm(`Cancelar "${o.descricao}"? Ela sai das contas a pagar.`)) return;
    const r = await chamar({ acao: "cancelar_obrigacao", obrigacaoId: o.id });
    if (!r.ok) alert(r.erro); else onMudou();
  }
  return (
    <section className="panel">
      <div className="panel-head" style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <span className="panel-title">Contas a pagar</span>
        <div className="seg">
          <button type="button" className={`seg-btn ${mostrar === "abertas" ? "active" : ""}`} onClick={() => setMostrar("abertas")}>Em aberto</button>
          <button type="button" className={`seg-btn ${mostrar === "todas" ? "active" : ""}`} onClick={() => setMostrar("todas")}>Todas</button>
        </div>
      </div>
      {lista.length === 0 && <div style={{ color: "var(--muted)", fontSize: ".85rem" }}>Nada {mostrar === "abertas" ? "em aberto" : "cadastrado"}.</div>}
      {lista.map((o) => {
        const s = SITUACAO[situacaoDe(o, dados.hoje)];
        return (
          <div key={o.id} className="cost-row" style={{ flexWrap: "wrap", gap: 8 }}>
            <span className="c-lbl" style={{ minWidth: 200 }}>
              {o.descricao}{o.parcela ? ` (${o.parcela.numero}/${o.parcela.de})` : ""}
              <span style={{ display: "block", fontSize: ".72rem", color: "var(--muted)" }}>
                {o.categoria}{o.favorecido ? ` · ${o.favorecido}` : ""} · venc. {dataBR(o.vencimento)} · <b style={{ color: s.cor }}>{s.rotulo}</b>
              </span>
            </span>
            <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ textAlign: "right" }}>
                <b>{formatarBRL(devidoDe(o))}</b>
                {o.baixas.length > 0 && <span style={{ display: "block", fontSize: ".72rem", color: "var(--muted)" }}>de {formatarBRL(o.centavos)}</span>}
              </span>
              {devidoDe(o) > 0 && <button type="button" className="btn btn-ghost btn-xs" onClick={() => onPagar(o)}>Registrar pagamento</button>}
              {devidoDe(o) > 0 && o.baixas.length === 0 && <button type="button" className="btn btn-ghost btn-xs" onClick={() => void cancelar(o)}>Cancelar</button>}
            </span>
          </div>
        );
      })}
      {dados.recorrencias.length > 0 && (
        <div style={{ marginTop: 12, fontSize: ".78rem", color: "var(--muted)" }}>
          Se repetem todo mês: {dados.recorrencias.map((r) => `${r.descricao} (${formatarBRL(r.centavos)}, dia ${r.diaVencimento})`).join(" · ")}
        </div>
      )}
    </section>
  );
}

// ── Movimentações ────────────────────────────────────────────────────────

function Movimentacoes({ dados, onMudou }: { dados: Dados; onMudou: () => void }) {
  const { hoje } = dados;
  const [periodo, setPeriodo] = useState<"hoje" | "7" | "30" | "mes" | "custom">("mes");
  const [de, setDe] = useState(`${hoje.slice(0, 7)}-01`);
  const [ate, setAte] = useState(hoje);
  const [conta, setConta] = useState("");
  const [busca, setBusca] = useState("");
  const faixa = periodo === "hoje" ? { de: hoje, ate: hoje }
    : periodo === "7" ? { de: somarDias(hoje, -6), ate: hoje }
      : periodo === "30" ? { de: somarDias(hoje, -29), ate: hoje }
        : periodo === "mes" ? { de: `${hoje.slice(0, 7)}-01`, ate: hoje }
          : { de, ate };
  const nomeConta = useMemo(() => new Map(dados.contas.map((c) => [c.id, c.nome])), [dados.contas]);
  const lista = dados.movimentos
    .filter((m) => m.data >= faixa.de && m.data <= faixa.ate && (!conta || m.contaId === conta))
    .filter((m) => !busca || `${m.descricao} ${m.categoria}`.toLowerCase().includes(busca.toLowerCase()))
    .sort((a, b) => b.data.localeCompare(a.data));
  const total = lista.reduce((s, m) => s + m.centavos, 0);

  function exportar() {
    const linhas = [["Data", "Conta", "Natureza", "Categoria", "Descrição", "Valor (R$)"].join(";")];
    for (const m of lista) {
      linhas.push([m.data, celulaCsv(nomeConta.get(m.contaId) ?? m.contaId), NATUREZA_ROTULO[m.natureza], celulaCsv(m.categoria), celulaCsv(m.descricao), (m.centavos / 100).toFixed(2).replace(".", ",")].join(";"));
    }
    const url = URL.createObjectURL(new Blob(["﻿" + linhas.join("\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `financeiro-${faixa.de}-a-${faixa.ate}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function excluir(m: Movimento) {
    if (!confirm(`Excluir o lançamento "${m.descricao || NATUREZA_ROTULO[m.natureza]}" de ${dataBR(m.data)}?`)) return;
    const r = await chamar({ acao: "excluir_movimento", movimentoId: m.id });
    if (!r.ok) alert(r.erro); else onMudou();
  }

  return (
    <section className="panel">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <div className="seg">
          {([["hoje", "Hoje"], ["7", "7 dias"], ["30", "30 dias"], ["mes", "Este mês"], ["custom", "Personalizado"]] as const).map(([v, r]) => (
            <button key={v} type="button" className={`seg-btn ${periodo === v ? "active" : ""}`} onClick={() => setPeriodo(v)}>{r}</button>
          ))}
        </div>
        {periodo === "custom" && (<><input type="date" value={de} onChange={(e) => setDe(e.target.value)} style={{ ...CAMPO, width: "auto" }} /><input type="date" value={ate} onChange={(e) => setAte(e.target.value)} style={{ ...CAMPO, width: "auto" }} /></>)}
        <select value={conta} onChange={(e) => setConta(e.target.value)} style={{ ...CAMPO, width: "auto" }}>
          <option value="">Todas as contas</option>
          {dados.contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <input placeholder="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ ...CAMPO, width: 160 }} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={exportar} disabled={!lista.length}>Exportar CSV</button>
      </div>
      <div style={{ fontSize: ".78rem", color: "var(--muted)", marginBottom: 8 }}>
        Pela data do dinheiro · {lista.length} lançamento(s) · soma {formatarBRL(total)}
      </div>
      {lista.map((m) => (
        <div key={m.id} className="cost-row">
          <span className="c-lbl">
            {m.descricao || NATUREZA_ROTULO[m.natureza]}
            <span style={{ display: "block", fontSize: ".72rem", color: "var(--muted)" }}>
              {dataBR(m.data)} · {nomeConta.get(m.contaId) ?? "conta removida"} · {NATUREZA_ROTULO[m.natureza]} · {m.categoria}
            </span>
          </span>
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <b style={{ color: m.centavos < 0 ? "var(--red-text)" : "var(--green)" }}>{formatarBRL(m.centavos)}</b>
            {m.origem === "manual" && !m.obrigacaoId && !m.transferenciaId && (
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => void excluir(m)} aria-label="Excluir lançamento">✕</button>
            )}
          </span>
        </div>
      ))}
      {lista.length === 0 && <div style={{ color: "var(--muted)", fontSize: ".85rem" }}>Nenhum lançamento no período.</div>}
    </section>
  );
}

// ── Contas ───────────────────────────────────────────────────────────────

function ListaDeContas({ dados, onNova }: { dados: Dados; onNova: () => void }) {
  return (
    <section className="panel">
      <div className="panel-head"><span className="panel-title">Contas acompanhadas</span><button type="button" className="btn btn-ghost btn-xs" onClick={onNova}>Nova conta</button></div>
      {dados.contas.map((c) => (
        <div key={c.id} className="cost-row">
          <span className="c-lbl">{c.nome}<span style={{ display: "block", fontSize: ".72rem", color: "var(--muted)" }}>{c.tipo === "mercado_pago" ? "Mercado Pago" : c.tipo === "banco" ? "Banco" : "Caixa"}{c.ativa ? "" : " · inativa"}</span></span>
          <span style={{ fontSize: ".78rem", color: "var(--muted)", textAlign: "right" }}>
            {c.abertura ? <>abertura {formatarBRL(c.abertura.centavos)} em {dataBR(c.abertura.data)}<br />({c.abertura.comprovacao})</> : "sem saldo de abertura"}
          </span>
        </div>
      ))}
      <div style={{ marginTop: 12, fontSize: ".78rem", color: "var(--muted)" }}>
        Conexão automática com o Mercado Pago: ainda não. Por enquanto os valores entram à mão — nada aqui é puxado nem enviado ao MP.
      </div>
    </section>
  );
}

// ── Formulários ──────────────────────────────────────────────────────────

function Formulario({ titulo, onClose, onEnviar, children, nota }: { titulo: string; onClose: () => void; onEnviar: () => Promise<{ ok: boolean; erro?: string }>; children: React.ReactNode; nota?: string }) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} titulo={titulo}>
      <div className="modal-title">{titulo}</div>
      <form onSubmit={async (e) => { e.preventDefault(); if (salvando) return; setSalvando(true); setErro(null); const r = await onEnviar(); setSalvando(false); if (!r.ok) setErro(r.erro ?? "não consegui salvar"); }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>
        {nota && <div style={{ fontSize: ".78rem", color: "var(--muted)", marginTop: 10 }}>{nota}</div>}
        {erro && <div style={{ color: "var(--red-text)", fontSize: ".82rem", marginTop: 10 }}>{erro}</div>}
        <div className="modal-btns">
          <button type="submit" className="btn btn-primary" disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={salvando}>Cancelar</button>
        </div>
      </form>
    </Modal>
  );
}

const Campo = ({ rotulo, children }: { rotulo: string; children: React.ReactNode }) => (
  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: ".8rem", color: "var(--muted)" }}>{rotulo}{children}</label>
);

function FormConta({ onClose, onSalvo }: { onClose: () => void; onSalvo: () => void }) {
  const [nome, setNome] = useState(""), [tipo, setTipo] = useState("mercado_pago");
  const [comAbertura, setComAbertura] = useState(false), [valor, setValor] = useState(""), [data, setData] = useState(""), [comprovacao, setComprovacao] = useState("");
  return (
    <Formulario titulo="Nova conta" onClose={onClose} nota="Sem saldo de abertura, a conta mostra só a movimentação lançada — o app não inventa saldo."
      onEnviar={async () => { const r = await chamar({ acao: "salvar_conta", nome, tipo, ...(comAbertura ? { abertura: { valor, data, comprovacao } } : {}) }); if (r.ok) onSalvo(); return r; }}>
      <Campo rotulo="Nome"><input style={CAMPO} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Mercado Pago VAZXPRESS" required /></Campo>
      <Campo rotulo="Tipo"><select style={CAMPO} value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="mercado_pago">Mercado Pago</option><option value="banco">Banco</option><option value="caixa">Caixa (dinheiro)</option></select></Campo>
      <label style={{ fontSize: ".85rem" }}><input type="checkbox" checked={comAbertura} onChange={(e) => setComAbertura(e.target.checked)} /> Informar saldo de abertura comprovado</label>
      {comAbertura && (<>
        <Campo rotulo="Saldo (R$)"><input style={CAMPO} value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Ex: 6.802,88" required /></Campo>
        <Campo rotulo="No fim do dia"><input type="date" style={CAMPO} value={data} onChange={(e) => setData(e.target.value)} required /></Campo>
        <Campo rotulo="De onde veio"><input style={CAMPO} value={comprovacao} onChange={(e) => setComprovacao(e.target.value)} placeholder="Ex: extrato do app MP" required /></Campo>
      </>)}
    </Formulario>
  );
}

function FormLancamento({ contas, hoje, onClose, onSalvo }: { contas: Conta[]; hoje: string; onClose: () => void; onSalvo: () => void }) {
  const [contaId, setContaId] = useState(contas[0]?.id ?? ""), [natureza, setNatureza] = useState<Natureza>("despesa");
  const [valor, setValor] = useState(""), [data, setData] = useState(hoje), [categoria, setCategoria] = useState("Outros"), [descricao, setDescricao] = useState("");
  return (
    <Formulario titulo="Novo lançamento" onClose={onClose} nota="Receita entra; despesa, compra de estoque e retirada saem. Compra de estoque e retirada não contam como despesa do resultado."
      onEnviar={async () => { const r = await chamar({ acao: "lancar", contaId, natureza, valor, data, categoria, descricao }); if (r.ok) onSalvo(); return r; }}>
      <Campo rotulo="Conta"><select style={CAMPO} value={contaId} onChange={(e) => setContaId(e.target.value)}>{contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></Campo>
      <Campo rotulo="Natureza"><select style={CAMPO} value={natureza} onChange={(e) => setNatureza(e.target.value as Natureza)}>{(["receita", "despesa", "compra_estoque", "retirada", "ajuste"] as Natureza[]).map((n) => <option key={n} value={n}>{NATUREZA_ROTULO[n]}</option>)}</select></Campo>
      <Campo rotulo="Valor (R$)"><input style={CAMPO} value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Ex: 150,00" required /></Campo>
      <Campo rotulo="Data"><input type="date" style={CAMPO} value={data} onChange={(e) => setData(e.target.value)} required /></Campo>
      <Campo rotulo="Categoria"><select style={CAMPO} value={categoria} onChange={(e) => setCategoria(e.target.value)}>{CATEGORIAS.map((c) => <option key={c}>{c}</option>)}</select></Campo>
      <Campo rotulo="Descrição"><input style={CAMPO} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex: Embalagens Kalunga" /></Campo>
    </Formulario>
  );
}

function FormTransferencia({ contas, hoje, onClose, onSalvo }: { contas: Conta[]; hoje: string; onClose: () => void; onSalvo: () => void }) {
  const [de, setDe] = useState(contas[0]?.id ?? ""), [para, setPara] = useState(contas[1]?.id ?? ""), [valor, setValor] = useState(""), [data, setData] = useState(hoje);
  return (
    <Formulario titulo="Transferir entre contas" onClose={onClose} nota="Anotação interna: não move dinheiro. Transferência entre suas contas não é receita nem despesa."
      onEnviar={async () => { const r = await chamar({ acao: "transferir", de, para, valor, data }); if (r.ok) onSalvo(); return r; }}>
      <Campo rotulo="De"><select style={CAMPO} value={de} onChange={(e) => setDe(e.target.value)}>{contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></Campo>
      <Campo rotulo="Para"><select style={CAMPO} value={para} onChange={(e) => setPara(e.target.value)}>{contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></Campo>
      <Campo rotulo="Valor (R$)"><input style={CAMPO} value={valor} onChange={(e) => setValor(e.target.value)} required /></Campo>
      <Campo rotulo="Data"><input type="date" style={CAMPO} value={data} onChange={(e) => setData(e.target.value)} required /></Campo>
    </Formulario>
  );
}

function FormObrigacao({ hoje, onClose, onSalvo }: { hoje: string; onClose: () => void; onSalvo: () => void }) {
  const [descricao, setDescricao] = useState(""), [categoria, setCategoria] = useState("Outros"), [favorecido, setFavorecido] = useState("");
  const [valor, setValor] = useState(""), [vencimento, setVencimento] = useState(hoje), [parcelas, setParcelas] = useState("1"), [natureza, setNatureza] = useState<Obrigacao["natureza"]>("despesa");
  return (
    <Formulario titulo="Nova conta a pagar" onClose={onClose} nota="Conta a pagar é previsão: só vira saída quando você registra o pagamento. Parcelado divide o valor total e vence um mês depois do outro."
      onEnviar={async () => { const r = await chamar({ acao: "nova_obrigacao", descricao, categoria, favorecido, valor, vencimento, parcelas, natureza }); if (r.ok) onSalvo(); return r; }}>
      <Campo rotulo="Descrição"><input style={CAMPO} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex: Compra Trot's 12% desconto" required /></Campo>
      <Campo rotulo="Tipo"><select style={CAMPO} value={natureza} onChange={(e) => setNatureza(e.target.value as Obrigacao["natureza"])}><option value="despesa">Despesa</option><option value="compra_estoque">Compra de estoque</option><option value="retirada">Retirada do dono</option></select></Campo>
      <Campo rotulo="Categoria"><select style={CAMPO} value={categoria} onChange={(e) => setCategoria(e.target.value)}>{CATEGORIAS.map((c) => <option key={c}>{c}</option>)}</select></Campo>
      <Campo rotulo="Favorecido"><input style={CAMPO} value={favorecido} onChange={(e) => setFavorecido(e.target.value)} /></Campo>
      <Campo rotulo="Valor total (R$)"><input style={CAMPO} value={valor} onChange={(e) => setValor(e.target.value)} required /></Campo>
      <Campo rotulo="Vencimento (1ª parcela)"><input type="date" style={CAMPO} value={vencimento} onChange={(e) => setVencimento(e.target.value)} required /></Campo>
      <Campo rotulo="Parcelas"><input type="number" min={1} max={48} style={CAMPO} value={parcelas} onChange={(e) => setParcelas(e.target.value)} /></Campo>
    </Formulario>
  );
}

function FormRecorrencia({ hoje, onClose, onSalvo }: { hoje: string; onClose: () => void; onSalvo: () => void }) {
  const [descricao, setDescricao] = useState(""), [categoria, setCategoria] = useState("Softwares"), [favorecido, setFavorecido] = useState("");
  const [valor, setValor] = useState(""), [dia, setDia] = useState("10"), [desde, setDesde] = useState(hoje.slice(0, 7));
  return (
    <Formulario titulo="Despesa que se repete" onClose={onClose} nota="Gera uma conta a pagar por mês (sem duplicar). Continua sendo previsão até você registrar o pagamento."
      onEnviar={async () => { const r = await chamar({ acao: "nova_recorrencia", descricao, categoria, favorecido, valor, diaVencimento: dia, desde }); if (r.ok) onSalvo(); return r; }}>
      <Campo rotulo="Descrição"><input style={CAMPO} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex: Contador" required /></Campo>
      <Campo rotulo="Categoria"><select style={CAMPO} value={categoria} onChange={(e) => setCategoria(e.target.value)}>{CATEGORIAS.map((c) => <option key={c}>{c}</option>)}</select></Campo>
      <Campo rotulo="Favorecido"><input style={CAMPO} value={favorecido} onChange={(e) => setFavorecido(e.target.value)} /></Campo>
      <Campo rotulo="Valor por mês (R$)"><input style={CAMPO} value={valor} onChange={(e) => setValor(e.target.value)} required /></Campo>
      <Campo rotulo="Dia do vencimento"><input type="number" min={1} max={31} style={CAMPO} value={dia} onChange={(e) => setDia(e.target.value)} required /></Campo>
      <Campo rotulo="A partir do mês"><input type="month" style={CAMPO} value={desde} onChange={(e) => setDesde(e.target.value)} required /></Campo>
    </Formulario>
  );
}

function FormBaixa({ obrigacao, contas, hoje, onClose, onSalvo }: { obrigacao: Obrigacao; contas: Conta[]; hoje: string; onClose: () => void; onSalvo: () => void }) {
  const devido = devidoDe(obrigacao);
  const [contaId, setContaId] = useState(contas[0]?.id ?? ""), [valor, setValor] = useState((devido / 100).toFixed(2).replace(".", ",")), [data, setData] = useState(hoje);
  const [movimentoId] = useState(() => `pag_${obrigacao.id}_${Date.now().toString(36)}`);
  const cent = paraCentavos(valor);
  return (
    <Formulario titulo={`Registrar pagamento — ${obrigacao.descricao}`} onClose={onClose}
      nota={`Anotação interna: NÃO paga nem transfere nada. Falta ${formatarBRL(devido)}${cent != null && cent < devido && cent > 0 ? ` — fica ${formatarBRL(devido - cent)} em aberto` : ""}.`}
      onEnviar={async () => { if (!contaId) return { ok: false, erro: "cadastre uma conta antes" }; const r = await chamar({ acao: "baixar", obrigacaoId: obrigacao.id, contaId, valor, data, movimentoId }); if (r.ok) onSalvo(); return r; }}>
      <Campo rotulo="Pago pela conta"><select style={CAMPO} value={contaId} onChange={(e) => setContaId(e.target.value)}>{contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></Campo>
      <Campo rotulo="Valor pago (R$)"><input style={CAMPO} value={valor} onChange={(e) => setValor(e.target.value)} required /></Campo>
      <Campo rotulo="Data do pagamento"><input type="date" style={CAMPO} value={data} onChange={(e) => setData(e.target.value)} required /></Campo>
    </Formulario>
  );
}
