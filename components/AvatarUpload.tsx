"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { uploadProfilePhoto } from "@/lib/firebase/avatar";
import { watchAccessEntry } from "@/lib/firebase/data";

/**
 * Avatar da barra lateral com um botão "+" no canto que abre o seletor
 * nativo de arquivo. `accept="image/*"` sem `capture` é de propósito: no
 * celular o navegador oferece Câmera, Galeria E Arquivos; no PC abre o
 * explorador de arquivos direto — cobre os dois pedidos sem precisar de UI
 * própria pra escolher a origem.
 *
 * A foto fica salva no Firestore (não no Firebase Auth) — este projeto não
 * tem Cloud Storage habilitado, então a fonte de verdade é o registro de
 * acesso do usuário, acompanhado em tempo real. Sem foto customizada ainda,
 * cai pra foto do Google (se houver).
 */
export function AvatarUpload({ size = 28 }: { size?: number }) {
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  /**
   * ─── SEM E-MAIL NÃO É 'LIMPAR', É 'NÃO HÁ' ──────────────────────────
   *
   * O efeito começava com `if (!email) { setPhotoURL(null); setEntryName(null); return; }`
   * — reset síncrono dentro do efeito, um quadro depois da pintura. Na
   * troca de conta, o avatar da conta anterior fica visível por um quadro.
   *
   * Com o e-mail guardado junto, a entrada de outra conta não é a entrada
   * desta, e a decisão acontece no render.
   */
  const [entrada, setEntrada] = useState<{ email: string; photoURL: string | null; nome: string | null } | null>(null);

  const emailAtual = user?.email?.toLowerCase() ?? null;
  const daConta = entrada?.email === emailAtual ? entrada : null;
  const photoURL = daConta?.photoURL ?? null;
  const entryName = daConta?.nome ?? null;
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const email = emailAtual;
    if (!email) return;
    return watchAccessEntry(email, (entry) => {
      setEntrada({
        email,
        photoURL: entry?.photoURL || user?.photoURL || null,
        nome: entry?.displayName || null,
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite escolher o mesmo arquivo de novo depois, se precisar
    const email = user?.email?.toLowerCase();
    if (!file || !email) return;

    setUploading(true);
    setError("");
    try {
      const url = await uploadProfilePhoto(email, file);
      // Feedback imediato; o listener do Firestore confirma logo em seguida.
      // Carrega o e-mail junto, como o listener faz — senão a foto nova
      // apareceria sob a conta errada se a troca acontecesse no meio do envio.
      setEntrada((a) => ({ email, photoURL: url, nome: a?.email === email ? a.nome : null }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar a foto.");
    } finally {
      setUploading(false);
    }
  }

  const initials = (entryName || user?.displayName || user?.email || "?").trim().charAt(0).toUpperCase();
  const badgeSize = Math.max(14, Math.round(size * 0.5));

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      {photoURL ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoURL}
          alt=""
          style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", display: "block", opacity: uploading ? 0.5 : 1 }}
        />
      ) : (
        <div
          style={{
            width: size, height: size, borderRadius: "50%", background: "var(--surface2)",
            border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: size * 0.42, fontWeight: 700, color: "var(--muted)", opacity: uploading ? 0.5 : 1,
          }}
        >
          {initials}
        </div>
      )}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        title="Trocar foto de perfil"
        aria-label="Trocar foto de perfil"
        style={{
          position: "absolute", bottom: -2, right: -2, width: badgeSize, height: badgeSize, borderRadius: "50%",
          background: "var(--accent)", border: "2px solid var(--surface)", display: "flex", alignItems: "center",
          justifyContent: "center", cursor: uploading ? "wait" : "pointer", padding: 0,
        }}
      >
        {uploading ? (
          <span style={{ width: badgeSize * 0.5, height: badgeSize * 0.5, borderRadius: "50%", border: "2px solid rgba(255,255,255,.4)", borderTopColor: "#fff", animation: "spin .7s linear infinite" }} />
        ) : (
          <svg width={badgeSize * 0.55} height={badgeSize * 0.55} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
        )}
      </button>

      <input ref={inputRef} type="file" accept="image/*" onChange={onFile} style={{ display: "none" }} />

      {error && (
        <div style={{ position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", marginTop: 6, fontSize: ".75rem", color: "var(--red-text)", width: 150, textAlign: "center", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 6px", zIndex: 5 }}>
          {error}
        </div>
      )}
    </div>
  );
}
