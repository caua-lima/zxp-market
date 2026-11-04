"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/firebase/auth-context";
import LoginCard from "@/components/LoginCard";
import { AccessGuard, useAccess } from "@/components/tabs/AccessGuard";
import TarefasTab from "@/components/tabs/TarefasTab";
import { PushNotificationToggle } from "@/components/PushNotificationToggle";
import { initForegroundPush } from "@/lib/firebase/push";

/**
 * O APP DE TAREFAS — /tarefas.
 *
 * O funcionário (Colaborador, papel "equipe") instala isto no celular e fica
 * logado: só as tarefas atribuídas a ele, a semana em quadros, concluir com um
 * toque e aviso de tarefa nova. Mesmo site, mesmo login e mesmo banco do
 * painel; o que separa é o papel (lib/domain/types › podeVerAba) e as regras
 * do Firestore. O dono e o sócio também podem usar: veem o que já viam.
 */
export default function AppDeTarefas() {
  const { user, loading } = useAuth();
  if (loading) {
    return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", color: "var(--muted)" }}>Carregando…</div>;
  }
  if (!user) return <LoginCard />;
  return (
    <AccessGuard>
      <Suspense fallback={null}>
        <TelaDeTarefas />
      </Suspense>
    </AccessGuard>
  );
}

function TelaDeTarefas() {
  const { signOut } = useAuth();
  const { displayName, papel, podeVer } = useAccess();
  const parametros = useSearchParams();
  const tarefa = parametros.get("task") ?? undefined;
  const primeiroNome = (displayName || "").split(/[ @]/)[0];

  // Aviso de tarefa nova com o app aberto (o Service Worker cuida do app fechado).
  useEffect(() => { void initForegroundPush(); }, []);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <header
        style={{
          position: "sticky", top: 0, zIndex: 20, display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 10, padding: "calc(env(safe-area-inset-top) + 10px) 16px 10px", background: "var(--surface)", borderBottom: "1px solid var(--border)",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 900, letterSpacing: ".02em" }}>ZXP <span style={{ color: "var(--accent)" }}>Tarefas</span></div>
          {primeiroNome && <div style={{ fontSize: ".78rem", color: "var(--muted)" }}>Olá, {primeiroNome}</div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <PushNotificationToggle />
          {papel !== "equipe" && <Link className="btn btn-ghost btn-sm" href="/">Painel</Link>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void signOut()}>Sair</button>
        </div>
      </header>
      <main style={{ maxWidth: 1400, margin: "0 auto", padding: "12px 16px 48px" }}>
        {podeVer("tarefas")
          ? <TarefasTab openTaskId={tarefa} />
          : (
            <div className="empty-state" style={{ marginTop: 40 }}>
              Este acesso não inclui tarefas. <Link href="/">Voltar ao painel</Link>
            </div>
          )}
      </main>
    </div>
  );
}
