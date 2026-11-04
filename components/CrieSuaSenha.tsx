"use client";

import { useState } from "react";
import { getAuth, updatePassword } from "firebase/auth";
import { authedFetch } from "@/lib/api/authed-fetch";

/**
 * "CRIE SUA SENHA" — o primeiro login do Sócio.
 *
 * O Master cadastra o Sócio com uma senha aleatória (aba Acesso) e passa pra
 * ele; o registro nasce com `trocarSenha: true`. Enquanto a marca existir, o
 * app mostra só esta tela: a pessoa define a senha dela, e a rota
 * /api/acesso/senha-definida tira a marca.
 */
export default function CrieSuaSenha({ nome, onSair, onPronto }: { nome: string; onSair: () => void; onPronto: () => void }) {
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");
  const [ver, setVer] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (senha.length < 8) { setErro("Use pelo menos 8 caracteres."); return; }
    if (senha !== confirma) { setErro("As duas senhas não são iguais."); return; }
    const usuario = getAuth().currentUser;
    if (!usuario) { setErro("Sua sessão caiu. Entre de novo."); return; }
    setSalvando(true);
    setErro(null);
    try {
      await updatePassword(usuario, senha);
      const r = await authedFetch("/api/acesso/senha-definida", { method: "POST" });
      if (!r.ok) throw new Error("marca");
      onPronto();
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "";
      setErro(
        code === "auth/requires-recent-login" ? "Por segurança, saia e entre de novo com a senha que você recebeu, e crie a nova logo em seguida."
          : code === "auth/weak-password" ? "Senha fraca: use pelo menos 8 caracteres, misturando letras e números."
            : (err as Error)?.message === "marca" ? "A senha foi trocada, mas não consegui confirmar no app. Toque em Salvar de novo."
              : "Não consegui salvar agora. Tente de novo.",
      );
    } finally {
      setSalvando(false);
    }
  }

  const campo: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", color: "var(--text)", font: "inherit" };
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "var(--bg)" }}>
      <form onSubmit={salvar} className="panel" style={{ width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: "1.2rem" }}>Crie sua senha</div>
          <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: ".88rem" }}>
            {nome ? `${nome.split(/[ @]/)[0]}, você` : "Você"} entrou com uma senha provisória. Crie a sua pra continuar — é ela que vale daqui pra frente.
          </p>
        </div>
        <label style={{ fontSize: ".82rem", fontWeight: 700 }}>
          Nova senha
          <input type={ver ? "text" : "password"} value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" autoFocus style={{ ...campo, marginTop: 4 }} />
        </label>
        <label style={{ fontSize: ".82rem", fontWeight: 700 }}>
          Repita a senha
          <input type={ver ? "text" : "password"} value={confirma} onChange={(e) => setConfirma(e.target.value)} autoComplete="new-password" style={{ ...campo, marginTop: 4 }} />
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: ".82rem", cursor: "pointer" }}>
          <input type="checkbox" checked={ver} onChange={(e) => setVer(e.target.checked)} /> Mostrar as senhas
        </label>
        {erro && <div className="note note-danger" role="alert">{erro}</div>}
        <button type="submit" className="btn btn-primary" disabled={salvando}>{salvando ? "Salvando…" : "Salvar minha senha"}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onSair}>Sair</button>
      </form>
    </div>
  );
}
