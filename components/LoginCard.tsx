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
  const [verSenha, setVerSenha] = useState(false);
  /** O erro do formulário de e-mail fica perto dos campos; o do Google, perto dos botões. */
  const [errForm, setErrForm] = useState<string | null>(null);

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
      setErrForm("Informe e-mail e senha.");
      return;
    }
    setBusy(true);
    setErr(null);
    setErrForm(null);
    try {
      await signInWithEmail(email, password);
    } catch (e) {
      // O e-mail digitado fica: quem errou a senha não deve digitar tudo de novo.
      setErrForm(mensagemErroLogin(e));
    } finally {
      setBusy(false);
    }
  }

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

        {/*
          Rótulos VISÍVEIS e associados. Eram só `placeholder`, que some ao
          digitar (quem preenche à noite não lembra qual campo é qual) e não é
          um nome confiável pra leitor de tela. O `outline: none` inline também
          saiu: quem navega por teclado não via onde estava o foco.
        */}
        <form onSubmit={handleEmail} noValidate style={{ textAlign: "left", marginBottom: 6 }}>
          <div className="login-field">
            <label htmlFor="login-email">E-mail</label>
            <input
              id="login-email" name="email" type="email" className="login-input" value={email}
              onChange={(e) => setEmail(e.target.value)} autoComplete="username" inputMode="email"
              autoCapitalize="none" spellCheck={false}
              aria-invalid={errForm ? true : undefined} aria-describedby={errForm ? "login-erro" : undefined}
            />
          </div>
          <div className="login-field">
            <label htmlFor="login-senha">Senha</label>
            <div className="login-senha">
              <input
                id="login-senha" name="password" type={verSenha ? "text" : "password"} className="login-input"
                value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
                aria-invalid={errForm ? true : undefined} aria-describedby={errForm ? "login-erro" : undefined}
              />
              <button
                type="button" className="login-ver" onClick={() => setVerSenha((v) => !v)}
                aria-pressed={verSenha} aria-label={verSenha ? "Ocultar senha" : "Mostrar senha"}
              >
                {verSenha ? "Ocultar" : "Mostrar"}
              </button>
            </div>
          </div>
          {errForm && <p id="login-erro" role="alert" className="login-erro">{errForm}</p>}
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

        {err && <p role="alert" className="login-erro" style={{ marginTop: 12 }}>{err}</p>}
      </div>
    </div>
  );
}
