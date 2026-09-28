"use client";

import { useState } from "react";
import { FirebaseError } from "firebase/app";
import { useAuth } from "@/lib/firebase/auth-context";
import { ZxpMark } from "@/components/ZxpMark";
import { cadastroAbertoNaTela, frasesDoProduto } from "@/lib/marca";

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
    case "auth/email-already-in-use":
      return "Já existe uma conta com esse e-mail. Entre com ela — ou use \"Esqueci minha senha\".";
    case "auth/weak-password":
      return "Senha fraca: use pelo menos 8 caracteres.";
    default:
      // Erro não mapeado: mostra o código cru em vez de esconder — é o que
      // permite diagnosticar um caso novo sem precisar adivinhar de novo.
      return code ? `Falha no login (${code}).` : "Falha no login.";
  }
}

export default function LoginCard() {
  const { signIn, signInWithAccountSelection, signInWithEmail, criarConta, recuperarSenha } = useAuth();
  // S24: "criar" só existe com o cadastro aberto (modo empresa + chave ligada).
  const [modo, setModo] = useState<"entrar" | "criar">("entrar");
  const [aviso, setAviso] = useState<string | null>(null);
  const cadastroAberto = cadastroAbertoNaTela();
  const frases = frasesDoProduto();
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
    if (modo === "criar" && password.length < 8) {
      setErrForm("Use uma senha com pelo menos 8 caracteres.");
      return;
    }
    setBusy(true);
    setErr(null);
    setErrForm(null);
    setAviso(null);
    try {
      // Criada, a conta já entra; a tela seguinte pede a confirmação do e-mail.
      if (modo === "criar") await criarConta(email, password);
      else await signInWithEmail(email, password);
    } catch (e) {
      // O e-mail digitado fica: quem errou a senha não deve digitar tudo de novo.
      setErrForm(mensagemErroLogin(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleEsqueci() {
    if (!email.trim()) {
      setErrForm("Digite o e-mail da conta e clique de novo.");
      return;
    }
    setBusy(true);
    setErrForm(null);
    try {
      await recuperarSenha(email);
    } catch {
      /* A mesma mensagem com ou sem conta: não confirmar quem tem conta aqui. */
    } finally {
      setBusy(false);
      setAviso(`Se existir uma conta com ${email.trim()}, o link pra criar uma senha nova chega em alguns minutos (confira o spam).`);
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
        <p style={{ marginBottom: 2 }}>{frases.subtitulo}</p>
        <p style={{ fontSize: ".8rem" }}>
          {modo === "criar" ? "Crie sua conta com e-mail e senha, ou entre direto com o Google." : "Entre com e-mail e senha ou com sua conta Google."}
        </p>

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
                value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={modo === "criar" ? "new-password" : "current-password"}
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
          {aviso && <p role="status" style={{ fontSize: ".8rem", color: "var(--muted)", margin: "0 0 10px" }}>{aviso}</p>}
          <button type="submit" className="btn btn-primary" disabled={busy} style={{ width: "100%", justifyContent: "center" }}>
            {busy ? "Aguarde…" : modo === "criar" ? "Criar conta" : "Entrar"}
          </button>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 8, fontSize: ".78rem" }}>
            {modo === "entrar" ? (
              <button type="button" className="login-link" onClick={handleEsqueci} disabled={busy}>Esqueci minha senha</button>
            ) : <span />}
            {cadastroAberto && (
              <button type="button" className="login-link" onClick={() => { setModo(modo === "entrar" ? "criar" : "entrar"); setErrForm(null); setAviso(null); }}>
                {modo === "entrar" ? "Criar conta" : "Já tenho conta"}
              </button>
            )}
          </div>
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
