"use client";

import { useEffect, useState } from "react";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import Modal from "@/components/Modal";
import { authedFetch } from "@/lib/api/authed-fetch";

/**
 * "Ver senha" e "Alterar senha" (pedido do dono, 23/11/2026).
 *
 * A senha vem do cofre cifrado do servidor (lib/senhas-cofre.ts) — o Firebase
 * não guarda a senha, só hash. `email` vazio = a PRÓPRIA senha (qualquer
 * pessoa logada); preenchido = a de outra pessoa (só o Master; o servidor
 * confere). Cada visualização fica na trilha de auditoria da aba Acesso.
 *
 * `podeAlterar` mostra o "Alterar senha" — só faz sentido pra própria conta.
 */
type Lida =
  | { situacao: "ok"; senha: string; definidaEm: number; definidaPor: string }
  | { situacao: "nao_guardada" }
  | { situacao: "ilegivel" }
  | { situacao: "erro"; texto: string };

export function VerSenhaModal({ email, nome, podeAlterar, onClose }: {
  email?: string;
  nome?: string;
  podeAlterar?: boolean;
  onClose: () => void;
}) {
  const [lida, setLida] = useState<Lida | null>(null);
  const [visivel, setVisivel] = useState(false);
  const [copiada, setCopiada] = useState(false);
  const [alterando, setAlterando] = useState(false);
  const [nova, setNova] = useState("");
  const [confirma, setConfirma] = useState("");
  const [verNova, setVerNova] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  async function carregar() {
    try {
      const r = await authedFetch(`/api/acesso/senha${email ? `?email=${encodeURIComponent(email)}` : ""}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!r.ok) { setLida({ situacao: "erro", texto: r.status === 403 ? "Só o Master vê a senha de outra pessoa." : "Não consegui buscar a senha agora." }); return; }
      setLida(j as Lida);
    } catch {
      setLida({ situacao: "erro", texto: "Sem conexão. Tente de novo." });
    }
  }
  // Assíncrono de propósito: o setState acontece depois do await.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void (async () => { await carregar(); })(); }, [email]);

  async function salvarNova(e: React.FormEvent) {
    e.preventDefault();
    if (nova.length < 6) { setAviso({ ok: false, texto: "Use pelo menos 6 caracteres." }); return; }
    if (nova !== confirma) { setAviso({ ok: false, texto: "As duas senhas não são iguais." }); return; }
    setSalvando(true);
    setAviso(null);
    try {
      const r = await authedFetch("/api/conta/senha", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ senha: nova }),
      });
      const j = (await r.json().catch(() => null)) as { details?: string } | null;
      if (!r.ok) throw new Error(j?.details || "Não consegui trocar a senha agora.");
      // Trocar a senha encerra as sessões: entra de novo na hora, com a nova.
      const meu = getAuth().currentUser?.email;
      if (meu) await signInWithEmailAndPassword(getAuth(), meu, nova).catch(() => {});
      setAviso({ ok: true, texto: "Senha alterada. Use a nova no próximo login." });
      setNova(""); setConfirma(""); setAlterando(false);
      await carregar();
    } catch (err) {
      setAviso({ ok: false, texto: err instanceof Error ? err.message : "Não consegui trocar a senha agora." });
    } finally {
      setSalvando(false);
    }
  }

  const campo: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 11px", color: "var(--text)", font: "inherit", marginTop: 4 };
  const quando = (ms: number) => (ms ? new Date(ms).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

  return (
    <Modal open onClose={onClose}>
      <div className="modal-title">{email ? `Senha de ${nome || email}` : "Minha senha"}</div>
      {email && <div className="modal-sub">{email}</div>}

      <div className="note" style={{ margin: "10px 0 12px" }}>
        {!lida && <span style={{ color: "var(--muted)" }}>Buscando…</span>}
        {lida?.situacao === "ok" && (
          <>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <code style={{ fontSize: "1.05rem", fontWeight: 700, letterSpacing: ".04em", padding: "4px 8px", background: "var(--surface2)", borderRadius: 6 }}>
                {visivel ? lida.senha : "•".repeat(Math.max(lida.senha.length, 8))}
              </code>
              <button type="button" className="btn btn-ghost btn-xs" aria-pressed={visivel} onClick={() => setVisivel((v) => !v)}>
                {visivel ? "Ocultar" : "Ver senha"}
              </button>
              <button type="button" className="btn btn-primary btn-xs" onClick={() => { void navigator.clipboard.writeText(lida.senha).then(() => setCopiada(true), () => setCopiada(false)); }}>
                {copiada ? "Copiada ✓" : "Copiar"}
              </button>
            </div>
            <div style={{ fontSize: ".78rem", color: "var(--muted)", marginTop: 6 }}>
              Definida em {quando(lida.definidaEm)}{lida.definidaPor ? ` por ${lida.definidaPor}` : ""}.
            </div>
          </>
        )}
        {lida?.situacao === "nao_guardada" && (
          <span>
            Esta senha não está guardada: foi definida antes do &quot;Ver senha&quot; existir (23/11/2026), ou o acesso entra pelo Google.
            {email ? " Pra ver, gere uma nova em Editar → Gerar senha provisória → Salvar." : " Pra ver daqui pra frente, use “Alterar senha” abaixo."}
          </span>
        )}
        {lida?.situacao === "ilegivel" && <span>A senha guardada não pôde ser lida (a chave do servidor mudou). Defina uma nova.</span>}
        {lida?.situacao === "erro" && <span style={{ color: "var(--red-text)" }}>{lida.texto}</span>}
      </div>

      {aviso && <div className={`note ${aviso.ok ? "" : "note-danger"}`} role="status" style={{ marginBottom: 10 }}>{aviso.ok ? "✓ " : ""}{aviso.texto}</div>}

      {podeAlterar && (alterando ? (
        <form onSubmit={salvarNova} style={{ display: "grid", gap: 8, marginBottom: 10 }}>
          <label style={{ fontSize: ".85rem" }}>Nova senha
            <input type={verNova ? "text" : "password"} value={nova} onChange={(e) => setNova(e.target.value)} autoComplete="new-password" autoFocus style={campo} />
          </label>
          <label style={{ fontSize: ".85rem" }}>Repita a nova senha
            <input type={verNova ? "text" : "password"} value={confirma} onChange={(e) => setConfirma(e.target.value)} autoComplete="new-password" style={campo} />
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: ".8rem" }}>
            <input type="checkbox" checked={verNova} onChange={(e) => setVerNova(e.target.checked)} /> Mostrar as senhas
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="btn btn-primary btn-sm" disabled={salvando}>{salvando ? "Salvando…" : "Salvar nova senha"}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setAlterando(false); setNova(""); setConfirma(""); }}>Cancelar</button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }} onClick={() => { setAlterando(true); setAviso(null); }}>Alterar senha</button>
      ))}

      <div className="modal-btns">
        <button type="button" className="btn btn-primary" onClick={onClose}>Fechar</button>
      </div>
    </Modal>
  );
}

/** O botão "Senha" do próprio usuário — barra lateral, barra do Partner e app de Tarefas. */
export function BotaoMinhaSenha({ className = "btn btn-ghost btn-xs", style }: { className?: string; style?: React.CSSProperties }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button type="button" className={className} style={style} onClick={() => setAberto(true)} title="Ver ou alterar a sua senha">
        Senha
      </button>
      {aberto && <VerSenhaModal podeAlterar onClose={() => setAberto(false)} />}
    </>
  );
}
