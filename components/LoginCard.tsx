"use client";

import { useState } from "react";
import { FirebaseError } from "firebase/app";
import { useAuth } from "@/lib/firebase/auth-context";
import { ZxpMark } from "@/components/ZxpMark";

/**
 * Traduz o código de erro do Firebase Auth pra algo que ajuda a diagnosticar
 * de verdade — a versão anterior mostrava "E-mail ou senha inválidos" pra
 * QUALQUER falha (senha errada, conta que nunca foi criada, provedor de
 * e-mail/senha desligado no console, limite de tentativas), o que escondia
 * a causa real tanto do usuário quanto de quem for investigar depois.
 *
 * `auth/invalid-credential` (SDKs recentes) e `auth/wrong-password` /
 * `auth/user-not-found` (mais antigos) são tratados juntos de propósito: o
 * Firebase não diferencia "senha errada" de "essa conta não existe" por
 * segurança, então a mensagem cobre os dois casos em vez de inventar certeza
 * que a gente não tem.
 */
function mensagemErroLogin(err: unknown): string {
  const code = err instanceof FirebaseError ? err.code : "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "E-mail ou senha incorretos — ou essa conta de e-mail/senha ainda não foi criada. Peça pro owner conferir em Acesso.";
    case "auth/operation-not-allowed":
      return "Login por e-mail/senha está desativado nas configurações do Firebase (Authentication → Sign-in method). Precisa habilitar lá.";
    case "auth/user-disabled":
      return "Essa conta foi desativada no Firebase.";
    case "auth/too-many-requests":
      return "Muitas tentativas seguidas — o Firebase bloqueou temporariamente. Espere alguns minutos e tente de novo.";
    case "auth/invalid-email":
      return "E-mail em formato inválido.";
    case "auth/network-request-failed":
      return "Falha de conexão — confira a internet e tente de novo.";
    default:
      // Erro não mapeado: mostra o código cru em vez de esconder — é o que
      // permite diagnosticar um caso novo sem precisar adivinhar de novo.
      return code ? `Falha no login (${code}).` : "Falha no login.";
  }
}

export default function LoginCard() {
  const { signIn, signInWithAccountSelection, signInWithEmail } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleGoogle(useAccountSelection: boolean) {
    setBusy(true);
    setErr(null);
    try {
      if (useAccountSelection) await signInWithAccountSelection();
      else await signIn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha no login");
    } finally {
      setBusy(false);
    }
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setErr("Informe e-mail e senha.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await signInWithEmail(email, password);
    } catch (e) {
      setErr(mensagemErroLogin(e));
    } finally {
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", background: "var(--surface2)", border: "1px solid var(--border)",
    borderRadius: 8, padding: "10px 12px", color: "var(--text)", fontSize: ".9rem", outline: "none",
    marginBottom: 10, boxSizing: "border-box",
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <ZxpMark size={46} />
        </div>
        <h2 className="font-display" style={{ fontWeight: 700, letterSpacing: ".03em", color: "var(--text)" }}>
          ZXP MARKET
        </h2>
        {/* Nome do PRODUTO, não da matriz: ZXP Solutions (matriz) > VAZXPRESS
            (a loja) > ZXP Market (este dashboard). A assinatura da matriz fica
            no rodapé, onde ela pertence. */}
        <p style={{ marginBottom: 2 }}>Dashboard da VAZXPRESS no Mercado Livre</p>
        <p style={{ fontSize: ".8rem" }}>Entre com e-mail e senha ou com sua conta Google.</p>

        <form onSubmit={handleEmail} style={{ textAlign: "left", marginBottom: 6 }}>
          <input type="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} autoComplete="username" />
          <input type="password" placeholder="Senha" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} autoComplete="current-password" />
          <button type="submit" className="btn btn-primary" disabled={busy} style={{ width: "100%", justifyContent: "center" }}>
            {busy ? "Entrando…" : "Entrar"}
          </button>
        </form>

        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "14px 0", color: "var(--muted)", fontSize: ".75rem" }}>
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
          ou
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
        </div>

        <button type="button" className="btn btn-ghost" onClick={() => handleGoogle(false)} disabled={busy} style={{ width: "100%", justifyContent: "center", marginBottom: 8 }}>
          {busy ? "Entrando…" : "Entrar com Google"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleGoogle(true)} disabled={busy} style={{ width: "100%", justifyContent: "center" }}>
          Usar outra conta Google
        </button>

        {err && <p style={{ color: "var(--red-text)", fontSize: ".82rem", marginTop: 12 }}>{err}</p>}
      </div>
    </div>
  );
}
