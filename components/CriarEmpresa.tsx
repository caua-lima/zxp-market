"use client";

import { useState } from "react";
import type { User } from "firebase/auth";
import { useAuth } from "@/lib/firebase/auth-context";
import { authedFetch } from "@/lib/api/authed-fetch";
import { recarregarPagina } from "@/lib/ir-para";
import { TERMOS_VERSAO } from "@/lib/domain/cadastro";

/**
 * Primeiro acesso de quem ainda não tem empresa, com o cadastro aberto (S24).
 *
 *   1. E-mail ainda não confirmado → pede a confirmação (o Firebase manda o
 *      link). Conta Google já chega confirmada.
 *   2. Confirmado → nome da empresa + aceite dos termos → a empresa nasce
 *      com a pessoa como dona, em teste grátis, e a tela recarrega já dentro.
 *
 * Quem foi CONVIDADO por um dono não passa por aqui: já tem empresa.
 */

const ERROS: Record<string, string> = {
  email_nao_verificado: "Confirme o e-mail antes (o link foi enviado pra sua caixa de entrada).",
  termos_nao_aceitos: "É preciso aceitar os termos de uso e a política de privacidade.",
  ja_tem_empresa: "Esta conta já pertence a uma empresa. Recarregue a página.",
  cadastro_fechado: "O cadastro de empresas está fechado no momento.",
};

export default function CriarEmpresa({ user, onSair }: { user: User; onSair: () => void }) {
  const { reenviarConfirmacao, recarregarSessao } = useAuth();
  const [confirmado, setConfirmado] = useState(user.emailVerified);
  const [nome, setNome] = useState("");
  const [aceite, setAceite] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ erro: boolean; texto: string } | null>(null);

  async function jaConfirmei() {
    setOcupado(true);
    setMsg(null);
    try {
      const ok = await recarregarSessao();
      if (ok) setConfirmado(true);
      else setMsg({ erro: true, texto: "Ainda não aparece confirmado. Abra o link do e-mail e tente de novo." });
    } catch {
      setMsg({ erro: true, texto: "Falha de conexão." });
    } finally {
      setOcupado(false);
    }
  }

  async function reenviar() {
    setOcupado(true);
    try {
      await reenviarConfirmacao();
      setMsg({ erro: false, texto: `Enviado de novo pra ${user.email}. Confira também o spam.` });
    } catch {
      setMsg({ erro: true, texto: "O Firebase limitou os envios. Espere alguns minutos." });
    } finally {
      setOcupado(false);
    }
  }

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    if (!aceite) { setMsg({ erro: true, texto: ERROS.termos_nao_aceitos }); return; }
    setOcupado(true);
    setMsg(null);
    try {
      const r = await authedFetch("/api/empresa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, termos: TERMOS_VERSAO }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string; details?: string };
      if (r.ok) { recarregarPagina(); return; }
      setMsg({ erro: true, texto: j.details ?? ERROS[j.error ?? ""] ?? `Não foi possível criar (${r.status}).` });
    } catch {
      setMsg({ erro: true, texto: "Falha de conexão." });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card" style={{ textAlign: "left" }}>
        {!confirmado ? (
          <>
            <h2 style={{ fontSize: "1.15rem", fontWeight: 700, marginBottom: 8, color: "var(--text)" }}>Confirme seu e-mail</h2>
            <p style={{ fontSize: ".86rem", color: "var(--muted)", lineHeight: 1.6, marginBottom: 16 }}>
              Enviamos um link pra <strong style={{ color: "var(--text)" }}>{user.email}</strong>. Clique nele e volte aqui.
            </p>
            <button type="button" className="btn btn-primary" disabled={ocupado} onClick={jaConfirmei} style={{ width: "100%", justifyContent: "center", marginBottom: 8 }}>
              Já confirmei
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={ocupado} onClick={reenviar} style={{ width: "100%", justifyContent: "center" }}>
              Reenviar o e-mail
            </button>
          </>
        ) : (
          <form onSubmit={criar} noValidate>
            <h2 style={{ fontSize: "1.15rem", fontWeight: 700, marginBottom: 6, color: "var(--text)" }}>Crie sua empresa</h2>
            <p style={{ fontSize: ".84rem", color: "var(--muted)", lineHeight: 1.6, marginBottom: 14 }}>
              Você entra como dono(a) e começa com 14 dias de teste grátis, sem cartão. Depois, é você quem convida o time.
            </p>
            <div className="login-field">
              <label htmlFor="empresa-nome">Nome da empresa ou da loja</label>
              <input id="empresa-nome" className="login-input" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} autoComplete="organization" />
            </div>
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: ".8rem", color: "var(--muted)", margin: "10px 0 14px", lineHeight: 1.5 }}>
              <input type="checkbox" checked={aceite} onChange={(e) => setAceite(e.target.checked)} style={{ marginTop: 3 }} />
              <span>
                Li e aceito os <a href="/termos" target="_blank" rel="noopener">termos de uso</a> e a{" "}
                <a href="/privacidade" target="_blank" rel="noopener">política de privacidade</a>.
              </span>
            </label>
            <button type="submit" className="btn btn-primary" disabled={ocupado} style={{ width: "100%", justifyContent: "center" }}>
              {ocupado ? "Criando…" : "Criar empresa"}
            </button>
            <p style={{ fontSize: ".76rem", color: "var(--muted)", marginTop: 12, lineHeight: 1.5 }}>
              Foi convidado(a) por alguém? Não crie empresa: peça pra essa pessoa conferir se o seu e-mail ({user.email}) está em Acesso.
            </p>
          </form>
        )}
        {msg && <p role={msg.erro ? "alert" : "status"} className={msg.erro ? "login-erro" : undefined} style={msg.erro ? { marginTop: 10 } : { fontSize: ".8rem", color: "var(--muted)", marginTop: 10 }}>{msg.texto}</p>}
        <button type="button" className="login-link" onClick={onSair} style={{ marginTop: 14, fontSize: ".78rem" }}>Sair / trocar de conta</button>
      </div>
    </div>
  );
}
