"use client";

import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/api/authed-fetch";
import { normalizarTenantId, validarNovoCliente } from "@/lib/domain/onboarding";

/**
 * Painel do admin master — criar contas de cliente e gerir licenças.
 *
 * ─── POR QUE ISTO EXISTE, SE JÁ HÁ SCRIPT ───────────────────────────────
 *
 * `scripts/criar-cliente.mjs` faz o mesmo, mas exige a chave de serviço na
 * máquina e rodar node. Vender é o ciclo principal daqui pra frente, e ele
 * acontece no celular, na rua, na hora que o cliente fecha — não no terminal.
 *
 * A aba só aparece pra quem é master (`saas_admins`). Não é segurança de
 * verdade — essa está na rota, que recusa quem não é. Aqui é só pra não
 * mostrar botão que não funciona.
 */

type Cliente = {
  tenantId: string;
  nome: string;
  ownerEmail: string;
  criadoEm: number | null;
  licenca: { status: string; expiresAt: number | null } | null;
  mlConectado: boolean;
};

const dataBR = (ms: number | null | undefined) =>
  ms ? new Date(ms).toLocaleDateString("pt-BR") : "—";

/** Dias até vencer. null = sem prazo. Negativo = já venceu. */
function diasAteVencer(expiresAt: number | null | undefined): number | null {
  if (expiresAt == null) return null;
  return Math.ceil((expiresAt - Date.now()) / 86400000);
}

function SituacaoLicenca({ lic }: { lic: Cliente["licenca"] }) {
  if (!lic) return <span style={{ color: "var(--muted)" }}>sem licença</span>;
  if (lic.status === "suspenso") {
    return <span style={{ color: "var(--red)", fontWeight: 700 }}>Suspensa</span>;
  }
  const dias = diasAteVencer(lic.expiresAt);
  if (dias == null) return <span style={{ color: "var(--green)", fontWeight: 700 }}>Ativa · sem prazo</span>;
  if (dias < 0) return <span style={{ color: "var(--red)", fontWeight: 700 }}>Vencida há {-dias}d</span>;
  // Sete dias é o ponto em que ainda dá pra cobrar antes de cortar o acesso.
  const cor = dias <= 7 ? "var(--warning)" : "var(--green)";
  return <span style={{ color: cor, fontWeight: 700 }}>Ativa · vence em {dias}d</span>;
}

export default function ClientesTab() {
  const [clientes, setClientes] = useState<Cliente[] | null>(null);
  const [erro, setErro] = useState("");
  const [criando, setCriando] = useState(false);
  const [novo, setNovo] = useState({ nome: "", email: "", dias: "" });
  const [resultado, setResultado] = useState<{ tenantId: string; senhaInicial: string | null } | null>(null);
  const [ocupado, setOcupado] = useState("");

  /**
   * Encadeada em `.then` de propósito, em vez de `async/await`: o efeito abaixo
   * chama isto na montagem, e o react-hooks recusa setState no corpo síncrono
   * de um efeito. Dentro de callback de promessa é o caminho que a regra
   * permite — mesma forma que os outros painéis usam com onSnapshot.
   */
  const carregar = useCallback(() => {
    return authedFetch("/api/saas/clientes", { cache: "no-store" })
      .then((r) => r.json().then((j) => [r.ok, j] as const))
      .then(([ok, j]) => {
        if (!ok) {
          setErro(j?.error === "nao_e_master" ? "Só o admin master vê esta aba." : "Não consegui carregar.");
          return;
        }
        setErro("");
        setClientes(j.clientes ?? []);
      })
      .catch(() => setErro("Não consegui carregar os clientes."));
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  // O id sai do nome, mas o usuário vê antes de criar — é ele que vira o
  // caminho de todos os dados daquele cliente, e não muda depois.
  const tenantId = normalizarTenantId(novo.nome);
  const validacao = validarNovoCliente({
    tenantId, nome: novo.nome, email: novo.email, diasLicenca: Number(novo.dias) || 0,
  });

  async function criar() {
    if (criando || !validacao.ok) return;
    setCriando(true);
    setErro("");
    setResultado(null);
    try {
      const r = await authedFetch("/api/saas/clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, nome: novo.nome, email: novo.email, diasLicenca: Number(novo.dias) || 0 }),
      });
      const j = await r.json();
      if (!r.ok) { setErro((j?.erros ?? [j?.error ?? "Falhou"]).join(" · ")); return; }
      setResultado({ tenantId: j.tenantId, senhaInicial: j.senhaInicial ?? null });
      setNovo({ nome: "", email: "", dias: "" });
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falhou ao criar.");
    } finally {
      setCriando(false);
    }
  }

  async function acaoLicenca(email: string, acao: string, dias?: number) {
    if (ocupado) return;
    setOcupado(email + acao);
    setErro("");
    try {
      const r = await authedFetch("/api/saas/licenca", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, acao, dias }),
      });
      if (!r.ok) { const j = await r.json().catch(() => null); setErro(j?.error ?? "Falhou."); return; }
      await carregar();
    } finally {
      setOcupado("");
    }
  }

  return (
    <div className="dash">
      <div className="tab-head">
        <div className="tab-head-left"><h2 className="tab-title">Clientes</h2></div>
        <button type="button" className="btn btn-sm btn-ghost" onClick={carregar}>⟳ Atualizar</button>
      </div>

      {erro && <div className="note note-warn">{erro}</div>}

      {/* ── Nova conta ── */}
      <div className="panel">
        <div className="panel-head" style={{ marginBottom: 10 }}>
          <span className="panel-title">Criar conta de cliente</span>
          <span className="panel-sub">o cliente conecta o Mercado Livre dele depois — só ele pode autorizar</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
          <label style={{ fontSize: ".78rem" }}>
            Nome da operação
            <input
              className="inp" value={novo.nome} placeholder="Loja do João"
              onChange={(e) => setNovo((s) => ({ ...s, nome: e.target.value }))}
            />
            {tenantId && (
              <span style={{ display: "block", fontSize: ".68rem", color: "var(--muted)", marginTop: 3 }}>
                identificador: <b>{tenantId}</b> — vira o caminho dos dados e não muda depois
              </span>
            )}
          </label>
          <label style={{ fontSize: ".78rem" }}>
            E-mail do dono
            <input
              className="inp" type="email" value={novo.email} placeholder="joao@loja.com"
              onChange={(e) => setNovo((s) => ({ ...s, email: e.target.value }))}
            />
          </label>
          <label style={{ fontSize: ".78rem" }}>
            Dias de licença
            <input
              className="inp" type="number" min="0" value={novo.dias} placeholder="0 = sem prazo"
              onChange={(e) => setNovo((s) => ({ ...s, dias: e.target.value }))}
            />
          </label>
        </div>

        {novo.nome && !validacao.ok && (
          <div style={{ marginTop: 8, fontSize: ".74rem", color: "var(--warning)" }}>
            {validacao.erros.join(" · ")}
          </div>
        )}

        <button
          type="button" className="btn btn-success" style={{ marginTop: 12 }}
          onClick={criar} disabled={criando || !validacao.ok}
        >
          {criando ? "Criando…" : "Criar conta"}
        </button>

        {resultado && (
          <div style={{
            marginTop: 12, padding: "12px 14px", borderRadius: 10,
            background: "var(--success-soft,rgba(60,203,131,.12))", border: "1px solid rgba(60,203,131,.35)",
          }}>
            <b>Conta {resultado.tenantId} criada.</b>
            {resultado.senhaInicial ? (
              <div style={{ marginTop: 6, fontSize: ".84rem", lineHeight: 1.6 }}>
                Senha inicial: <b style={{ fontFamily: "ui-monospace,monospace" }}>{resultado.senhaInicial}</b>
                {/* Aparece uma vez e não fica salva: senha guardada em banco é
                    senha vazada mais cedo ou mais tarde. */}
                <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>
                  Anote agora — ela não fica salva e não aparece de novo. Peça pro cliente trocar no primeiro acesso.
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 6, fontSize: ".82rem", color: "var(--muted)" }}>
                Esse e-mail já tinha conta — o cliente entra com a senha que já usa.
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Clientes ── */}
      <div className="panel">
        <div className="panel-head" style={{ marginBottom: 8 }}>
          <span className="panel-title">Contas ativas</span>
          <span className="panel-sub">{clientes?.length ?? 0} cliente(s)</span>
        </div>

        {clientes == null ? (
          <div style={{ color: "var(--muted)", fontSize: ".82rem" }}>Carregando…</div>
        ) : clientes.length === 0 ? (
          <div className="empty-state">Nenhum cliente ainda.</div>
        ) : (
          <div className="table-wrapper" style={{ border: "none" }}>
            <table className="tbl-modern tbl-cards">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Cliente</th>
                  <th style={{ textAlign: "left" }}>Licença</th>
                  <th title="O cliente já autorizou a conta dele do Mercado Livre? É o único passo que você não pode fazer por ele.">Mercado Livre</th>
                  <th style={{ textAlign: "right" }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {clientes.map((c) => (
                  <tr key={c.tenantId}>
                    <td style={{ textAlign: "left", fontWeight: 600 }}>
                      {c.nome}
                      <span style={{ display: "block", fontSize: ".68rem", color: "var(--muted)", fontWeight: 400 }}>
                        {c.ownerEmail || "sem dono"} · desde {dataBR(c.criadoEm)}
                      </span>
                    </td>
                    <td data-label="Licença" style={{ textAlign: "left", fontSize: ".82rem" }}>
                      <SituacaoLicenca lic={c.licenca} />
                      {c.licenca?.expiresAt != null && (
                        <span style={{ display: "block", fontSize: ".68rem", color: "var(--muted)" }}>
                          até {dataBR(c.licenca.expiresAt)}
                        </span>
                      )}
                    </td>
                    <td data-label="Mercado Livre" style={{ whiteSpace: "nowrap" }}>
                      {c.mlConectado
                        ? <span style={{ color: "var(--green)", fontWeight: 700 }}>Conectado</span>
                        : <span style={{ color: "var(--warning)", fontWeight: 700 }} title="A conta funciona, mas sem dados até o cliente conectar.">Aguardando</span>}
                    </td>
                    <td data-cell="acoes" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {c.ownerEmail && (
                        <>
                          <button
                            type="button" className="btn btn-ghost btn-xs"
                            disabled={!!ocupado}
                            onClick={() => acaoLicenca(c.ownerEmail, "renovar", 30)}
                            title="Empurra o vencimento 30 dias. Se estiver suspensa, reativa junto."
                          >
                            +30 dias
                          </button>
                          {c.licenca?.status === "suspenso" ? (
                            <button
                              type="button" className="btn btn-ghost btn-xs" style={{ marginLeft: 6 }}
                              disabled={!!ocupado}
                              onClick={() => acaoLicenca(c.ownerEmail, "reativar")}
                            >
                              Reativar
                            </button>
                          ) : (
                            <button
                              type="button" className="btn btn-ghost btn-xs" style={{ marginLeft: 6, color: "var(--red)" }}
                              disabled={!!ocupado}
                              onClick={() => acaoLicenca(c.ownerEmail, "suspender")}
                              title="Corta o acesso sem apagar nada — dá pra reativar depois."
                            >
                              Suspender
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
