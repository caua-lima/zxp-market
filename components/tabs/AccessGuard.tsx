"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { useAuth } from "@/lib/firebase/auth-context";
import {
  bootstrapAccessOwner,
  checkAccess,
  getAccessBootstrap,
} from "@/lib/firebase/data";
import { papelDe, podeVerAba, type AccessEntry, type Papel, type PermissionTab } from "@/lib/domain/types";

type AccessInfo = {
  role: AccessEntry["role"];
  email: string;
  isOwner: boolean;
  /**
   * Nome de exibição vindo do registro de acesso (controleAcesso), o mesmo
   * que aparece na aba Acesso — não o `displayName` do Firebase Auth, que
   * fica vazio pra quem nunca logou com Google (ex.: login por e-mail/senha
   * criado pelo owner) e nesse caso a saudação do Dashboard caía pro e-mail
   * inteiro. Cai pro e-mail só se nem o registro de acesso tiver nome.
   */
  displayName: string;
  /** Edição de tudo-ou-nada (Acesso, Tarefas via regra própria, e qualquer tela ainda não migrada pro granular). */
  canEdit: boolean;
  /** Edição granular por aba — sempre true pro owner; pro partner, depende de permissoesEdicao. */
  canEditTab: (tab: PermissionTab) => boolean;
  /** Papel efetivo, já normalizado (registros legados viram "partner"). */
  papel: Papel;
  /**
   * Este papel alcança esta aba? `member` só vê o Dashboard — a regra mora em
   * lib/domain/types (podeVerAba), pra navegação, proteção da aba ativa e as
   * regras do Firestore não terem três cópias que divergem.
   */
  podeVer: (aba: string) => boolean;
};
const AccessCtx = createContext<AccessInfo>({
  // Default do contexto é o papel de MENOR poder: se algo renderizar fora do
  // provider, não pode ser por engano que a tela abre.
  role: "member", email: "", isOwner: false, displayName: "", canEdit: false,
  canEditTab: () => false, papel: "member", podeVer: () => false,
});
export function useAccess() {
  return useContext(AccessCtx);
}

type AccessResult = {
  email: string;
  granted: boolean;
  entry: AccessEntry | null;
};

type AccessCache = AccessResult & {
  checkedAt: number;
};

// sessionStorage com TTL curto: renomear o prefixo só descarta o cache, que se
// refaz na primeira checagem. Por isso este não precisa de migração — ao
// contrário das chaves de localStorage, que guardam dado do usuário
// (ver lib/storage.ts).
const ACCESS_CACHE_PREFIX = "zxpmarket:access:";
const ACCESS_CACHE_TTL_MS = 10 * 60 * 1000;

function getAccessCacheKey(email: string) {
  return `${ACCESS_CACHE_PREFIX}${email}`;
}

function readCachedAccess(email: string): AccessResult | null {
  if (typeof window === "undefined" || !email) return null;

  try {
    const raw = window.sessionStorage.getItem(getAccessCacheKey(email));
    if (!raw) return null;

    const cached = JSON.parse(raw) as AccessCache;
    if (cached.email !== email) return null;
    if (Date.now() - cached.checkedAt > ACCESS_CACHE_TTL_MS) return null;

    return {
      email: cached.email,
      granted: cached.granted,
      entry: cached.entry,
    };
  } catch {
    return null;
  }
}

function writeCachedAccess(result: AccessResult) {
  if (typeof window === "undefined" || !result.email) return;

  try {
    const cached: AccessCache = {
      ...result,
      checkedAt: Date.now(),
    };
    window.sessionStorage.setItem(
      getAccessCacheKey(result.email),
      JSON.stringify(cached),
    );
  } catch {
    // ignore cache write failures
  }
}

/**
 * Wraps the app — only renders children when the signed-in user
 * has an entry in the accessControl collection.
 *
 * Security note: Firestore rules must also restrict reads/writes to
 * authenticated users whose email exists in /accessControl/{email}.
 * This component is a UX guard only; real security is in Firestore rules.
 */
export function AccessGuard({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const [access, setAccess] = useState<AccessResult | null>(null);

  useEffect(() => {
    if (!user) return;

    const email = user.email?.toLowerCase() ?? "";
    let cancelled = false;

    async function check(u: User, cached: AccessResult | null) {
      try {
        if (!email) {
          if (!cancelled) {
            setAccess((prev) =>
              prev && prev.email === "" ? prev : { email: "", granted: false, entry: null },
            );
          }
          return;
        }

        const bootstrap = await getAccessBootstrap();
        if (cancelled) return;

        if (!bootstrap) {
          const newEntry: AccessEntry = {
            email,
            role: "owner",
            displayName: u.displayName ?? undefined,
            photoURL: u.photoURL ?? undefined,
          };
          await bootstrapAccessOwner(newEntry);
          if (!cancelled) {
            const nextAccess = { email, granted: true, entry: newEntry };
            writeCachedAccess(nextAccess);
            setAccess((prev) =>
              prev && prev.email === email && prev.granted === true ? prev : nextAccess,
            );
          }
          return;
        }

        // Sincroniza o nome de exibição do Google — mas NÃO a foto: o usuário
        // pode ter subido uma foto customizada (comprimida, guardada no
        // Firestore), e sincronizar a do Google aqui sobrescreveria ela toda
        // vez que a sessão recarregasse.
        if (cached?.granted) {
          if (u.displayName) {
            import("@/lib/firebase/data").then(({ updateAccessEntry }) =>
              updateAccessEntry(email, { displayName: u.displayName ?? undefined }),
            );
          }
        }

        const found = await checkAccess(email);
        if (cancelled) return;

        if (!cancelled) {
          if (found) {
            if (u.displayName) {
              import("@/lib/firebase/data").then(({ updateAccessEntry }) =>
                updateAccessEntry(email, { displayName: u.displayName ?? undefined }),
              );
            }
            const nextAccess = { email, granted: true, entry: found };
            writeCachedAccess(nextAccess);
            setAccess((prev) =>
              prev && prev.email === email && prev.granted === true && prev.entry === found
                ? prev
                : nextAccess,
            );
          } else {
            const nextAccess = { email, granted: false, entry: null };
            writeCachedAccess(nextAccess);
            setAccess((prev) =>
              prev && prev.email === email && prev.granted === false ? prev : nextAccess,
            );
          }
        }
      } catch {
        if (!cancelled) {
          const nextAccess = { email, granted: false, entry: null };
          writeCachedAccess(nextAccess);
          setAccess((prev) =>
            prev && prev.email === email && prev.granted === false ? prev : nextAccess,
          );
        }
      }
    }

    async function hydrateAndCheck(u: User) {
      const cached = readCachedAccess(email);

      if (!cancelled) {
        setAccess(cached ?? null);
      }

      await check(u, cached);
    }

    void hydrateAndCheck(user);

    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user) return null; // LoginCard handles unauthenticated state

  const currentEmail = user.email?.toLowerCase() ?? "";
  const isPending = !access || access.email !== currentEmail;

  if (isPending) return <LoadingScreen />;
  if (!access.granted)
    return <DeniedScreen onLogout={signOut} userEmail={user.email ?? ""} />;

  const role = access.entry?.role ?? "colaborador";
  const papel = papelDe(role);
  const isOwner = papel === "owner"; // só o owner edita tudo; os demais são leitura por padrão
  const permissoes = access.entry?.permissoesEdicao ?? [];
  /**
   * Member nunca edita, mesmo que um `permissoesEdicao` tenha sobrado de
   * quando a conta era colaborador. O papel manda sobre a lista.
   */
  const canEditTab = (tab: PermissionTab) =>
    isOwner || (papel === "partner" && permissoes.includes(tab));
  const podeVer = (aba: string) => podeVerAba(papel, aba);
  const displayName = access.entry?.displayName || user.displayName || currentEmail;
  return (
    <AccessCtx.Provider value={{ role, email: currentEmail, isOwner, displayName, canEdit: isOwner, canEditTab, papel, podeVer }}>
      {children}
    </AccessCtx.Provider>
  );
}

function LoadingScreen() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        flexDirection: "column",
        gap: 16,
        color: "var(--muted)",
      }}
    >
      <div style={{ fontSize: "2rem", animation: "spin 1s linear infinite" }}>
        
      </div>
      <p style={{ fontSize: ".9rem" }}>Verificando acesso…</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function DeniedScreen({
  onLogout,
  userEmail,
}: {
  onLogout: () => void;
  userEmail: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: "0 16px",
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          padding: "40px 32px",
          maxWidth: 400,
          width: "100%",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: "3rem", marginBottom: 16 }}></div>
        <h2
          style={{
            fontSize: "1.2rem",
            fontWeight: 700,
            marginBottom: 8,
            color: "var(--text)",
          }}
        >
          Acesso não autorizado
        </h2>
        <p
          style={{
            fontSize: ".88rem",
            color: "var(--muted)",
            lineHeight: 1.6,
            marginBottom: 8,
          }}
        >
          A conta <strong style={{ color: "var(--text)" }}>{userEmail}</strong>{" "}
          não possui permissão para acessar este sistema.
        </p>
        <p
          style={{
            fontSize: ".82rem",
            color: "var(--muted)",
            marginBottom: 24,
          }}
        >
          Entre em contato com o administrador para solicitar acesso.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onLogout}
          style={{ width: "100%", justifyContent: "center" }}
        >
          Trocar conta / Sair
        </button>
      </div>
    </div>
  );
}