"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { useAuth } from "@/lib/firebase/auth-context";
import {
  bootstrapAccessOwner,
  checkAccess,
  getAccessBootstrap,
} from "@/lib/firebase/data";
import type { AccessEntry, PermissionTab } from "@/lib/domain/types";
import type { SituacaoConta } from "@/lib/domain/tenant";
import { carregarMembro } from "@/lib/firebase/tenant-client";
import { authedFetch } from "@/lib/api/authed-fetch";

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
  /** Edição granular por aba — sempre true pro owner; pro colaborador, depende de permissoesEdicao. */
  canEditTab: (tab: PermissionTab) => boolean;
  /**
   * true só pra quem passou pelo fluxo LEGADO (controleAcesso). Um owner do
   * SaaS (tenant_membros) também vira `isOwner`, mas a aba Acesso gerencia
   * uma coleção GLOBAL sem escopo de tenant — mostrá-la pra ele abriria a
   * lista de colaboradores de operações que não são a dele. Até essa aba
   * ganhar uma versão por tenant, ela só aparece pra quem é dono no modelo
   * antigo. Ver o mesmo raciocínio em lib/api-auth.ts (requireAccess).
   */
  gerenciaAcessoLegado: boolean;
};
const AccessCtx = createContext<AccessInfo>({
  role: "colaborador", email: "", isOwner: false, displayName: "", canEdit: false, canEditTab: () => false,
  gerenciaAcessoLegado: false,
});
export function useAccess() {
  return useContext(AccessCtx);
}

type AccessResult = {
  email: string;
  granted: boolean;
  entry: AccessEntry | null;
  /** Presente só quando o bloqueio é de LICENÇA (vínculo existe, mas não vale) — distingue de "nunca teve acesso". */
  bloqueio?: { situacao: Exclude<SituacaoConta, "ok">; expiresAt: number | null };
  /** true quando `granted` veio do fluxo legado (controleAcesso) — ver gerenciaAcessoLegado em AccessInfo. */
  viaLegado?: boolean;
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

        /**
         * Resolve o TENANT antes de qualquer leitura de dado.
         *
         * sCol/sDoc (lib/firebase/data.ts) montam o caminho a partir do
         * tenantId e lançam sem ele — então isto precisa acontecer antes de
         * qualquer aba tentar ler. É a primeira coisa depois de saber quem é
         * o usuário, de propósito.
         *
         * UNIFICADO: quando existe vínculo em `tenant_membros`, ELE decide
         * papel e permissoesEdicao — sem tocar em `controleAcesso`. Esse
         * fallback abaixo (bootstrap/checkAccess) só roda pra quem AINDA não
         * foi migrado pro modelo novo (ver comentário abaixo).
         */
        const membro = await carregarMembro(u.uid);
        if (cancelled) return;

        if (membro) {
          // Cliente do SaaS (ou já migrado): tenant_membros já tem tudo que
          // este componente precisa. NÃO cai no fluxo de controleAcesso —
          // essa coleção é global, sem escopo de tenant, e usá-la aqui abriria
          // a Central de Acesso de um cliente pros dados de outro (ver o
          // porquê completo em lib/api-auth.ts, requireAccess()).
          const entry: AccessEntry = {
            email,
            role: membro.papel === "owner" ? "owner" : "colaborador",
            displayName: membro.displayName,
            permissoesEdicao: membro.permissoesEdicao,
          };

          /**
           * Vínculo existe, mas isso não basta: sem licença válida, TODA
           * leitura direta do Firestore em tenants/{tid}/… é negada pelas
           * regras (licencaAtiva() em firestore.rules.saas). Sem esta
           * checagem, um cliente suspenso ou vencido ficaria preso num
           * "carregando" infinito — cada painel esperando um onSnapshot que
           * nunca chega, sem nenhuma explicação na tela.
           */
          let bloqueio: AccessResult["bloqueio"];
          try {
            const r = await authedFetch("/api/conta/status", { cache: "no-store" });
            if (r.ok) {
              const j = await r.json();
              if (j.situacao && j.situacao !== "ok") {
                bloqueio = { situacao: j.situacao, expiresAt: j.licenca?.expiresAt ?? null };
              }
            }
            // Falha de rede/servidor na checagem: não é o papel dela travar o
            // app quando o problema é ELA, não a licença — segue liberado.
          } catch {
            /* mesma decisão acima */
          }
          if (cancelled) return;

          if (bloqueio) {
            // Não cacheia o bloqueio: se o master renovar a licença, o
            // próximo reload já libera — cachear até 10min manteria alguém
            // recém-renovado vendo tela de bloqueio por engano.
            const nextAccess: AccessResult = { email, granted: false, entry: null, bloqueio };
            setAccess((prev) =>
              prev && prev.email === email && prev.bloqueio?.situacao === bloqueio!.situacao ? prev : nextAccess,
            );
            return;
          }

          const nextAccess = { email, granted: true, entry };
          writeCachedAccess(nextAccess);
          setAccess((prev) =>
            prev && prev.email === email && prev.granted === true && prev.entry?.role === entry.role
              ? prev
              : nextAccess,
          );
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
            const nextAccess: AccessResult = { email, granted: true, entry: newEntry, viaLegado: true };
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
            const nextAccess: AccessResult = { email, granted: true, entry: found, viaLegado: true };
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
  if (access.bloqueio)
    return <LicenseBlockedScreen onLogout={signOut} userEmail={user.email ?? ""} bloqueio={access.bloqueio} />;
  if (!access.granted)
    return <DeniedScreen onLogout={signOut} userEmail={user.email ?? ""} />;

  const role = access.entry?.role ?? "colaborador";
  const isOwner = role === "owner"; // só o owner edita tudo; colaborador é somente-leitura por padrão
  const permissoes = access.entry?.permissoesEdicao ?? [];
  const canEditTab = (tab: PermissionTab) => isOwner || permissoes.includes(tab);
  const displayName = access.entry?.displayName || user.displayName || currentEmail;
  const gerenciaAcessoLegado = isOwner && !!access.viaLegado;
  return (
    <AccessCtx.Provider value={{ role, email: currentEmail, isOwner, displayName, canEdit: isOwner, canEditTab, gerenciaAcessoLegado }}>
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

const dataBR = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString("pt-BR") : "");

/** Copy por situação — "fale com o suporte" não ajuda quem só precisa renovar. */
function textoBloqueio(bloqueio: NonNullable<AccessResult["bloqueio"]>): { titulo: string; corpo: string } {
  switch (bloqueio.situacao) {
    case "suspenso":
      return {
        titulo: "Assinatura suspensa",
        corpo: "Sua conta foi suspensa. Fale com quem te vendeu o acesso pra reativar.",
      };
    case "vencido":
      return {
        titulo: "Assinatura vencida",
        corpo: bloqueio.expiresAt
          ? `Sua licença venceu em ${dataBR(bloqueio.expiresAt)}. Renove pra voltar a usar o sistema.`
          : "Sua licença venceu. Renove pra voltar a usar o sistema.",
      };
    default:
      return {
        titulo: "Conta sem licença",
        corpo: "Essa conta ainda não tem uma licença ativa. Fale com quem te vendeu o acesso.",
      };
  }
}

function LicenseBlockedScreen({
  onLogout,
  userEmail,
  bloqueio,
}: {
  onLogout: () => void;
  userEmail: string;
  bloqueio: NonNullable<AccessResult["bloqueio"]>;
}) {
  const { titulo, corpo } = textoBloqueio(bloqueio);
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "0 16px" }}>
      <div style={{
        background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16,
        padding: "40px 32px", maxWidth: 400, width: "100%", textAlign: "center",
      }}>
        <div style={{ fontSize: "3rem", marginBottom: 16 }}>⏳</div>
        <h2 style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: 8, color: "var(--text)" }}>{titulo}</h2>
        <p style={{ fontSize: ".88rem", color: "var(--muted)", lineHeight: 1.6, marginBottom: 24 }}>{corpo}</p>
        <p style={{ fontSize: ".76rem", color: "var(--muted)", marginBottom: 16 }}>
          Conectado como <strong style={{ color: "var(--text)" }}>{userEmail}</strong>
        </p>
        <button type="button" className="btn btn-primary" onClick={onLogout} style={{ width: "100%", justifyContent: "center" }}>
          Trocar conta / Sair
        </button>
      </div>
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