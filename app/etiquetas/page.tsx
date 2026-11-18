"use client";

import Link from "next/link";
import { useAuth } from "@/lib/firebase/auth-context";
import LoginCard from "@/components/LoginCard";
import { AccessGuard, useAccess } from "@/components/tabs/AccessGuard";
import EtiquetasTab from "@/components/tabs/EtiquetasTab";

/**
 * /etiquetas — o conversor pra quem não entra no painel.
 *
 * O Colaborador (papel "equipe") mora no /tarefas e não vê as abas do painel;
 * a expedição dele é aqui: abre o ZIP do ML, imprime e separa. Mesma tela da
 * aba Etiquetas, mesma regra (`usar_etiquetas`).
 */
export default function PaginaDeEtiquetas() {
  const { user, loading } = useAuth();
  if (loading) {
    return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", color: "var(--muted)" }}>Carregando…</div>;
  }
  if (!user) return <LoginCard />;
  return (
    <AccessGuard>
      <TelaDeEtiquetas />
    </AccessGuard>
  );
}

function TelaDeEtiquetas() {
  const { signOut } = useAuth();
  const { papel, podeVer } = useAccess();
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <header
        style={{
          position: "sticky", top: 0, zIndex: 20, display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 10, padding: "calc(env(safe-area-inset-top) + 10px) 16px 10px", background: "var(--surface)", borderBottom: "1px solid var(--border)",
        }}
      >
        <div style={{ fontWeight: 900, letterSpacing: ".02em" }}>ZXP <span style={{ color: "var(--accent)" }}>Etiquetas</span></div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {podeVer("tarefas") && <Link className="btn btn-ghost btn-sm" href="/tarefas">Tarefas</Link>}
          {papel !== "equipe" && <Link className="btn btn-ghost btn-sm" href="/?tab=etiquetas">Painel</Link>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void signOut()}>Sair</button>
        </div>
      </header>
      <main style={{ maxWidth: 1400, margin: "0 auto", padding: "12px 16px 48px" }}>
        {podeVer("etiquetas")
          ? <EtiquetasTab />
          : <div className="empty-state" style={{ marginTop: 40 }}>Este acesso não inclui etiquetas. <Link href="/">Voltar</Link></div>}
      </main>
    </div>
  );
}
