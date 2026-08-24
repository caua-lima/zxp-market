"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/firebase/auth-context";
import { authedFetch } from "@/lib/api/authed-fetch";
import { initForegroundPush } from "@/lib/firebase/push";
import { PushNotificationToggle } from "@/components/PushNotificationToggle";
import { NotificationCenter } from "@/components/NotificationCenter";
import { useUserData } from "@/components/useUserData";
import { AccessGuard, useAccess } from "@/components/tabs/AccessGuard";
import LoginCard from "@/components/LoginCard";
import MetasTab from "@/components/tabs/MetasTab";
import PedidosTab from "@/components/tabs/PedidosTab";
import AdsTab from "@/components/tabs/AdsTab";
import CustosTab from "@/components/tabs/CustosTab";
import EstoqueTab from "@/components/tabs/EstoqueTab";
import FullTab from "@/components/tabs/FullTab";
import DesempenhoTab from "@/components/tabs/DesempenhoTab";
import AccessControlTab from "@/components/tabs/AccessControlTab";
import ClientesTab from "@/components/tabs/ClientesTab";
import DreTab from "@/components/tabs/DreTab";
import PrecoTab from "@/components/tabs/PrecoTab";
import TarefasTab from "@/components/tabs/TarefasTab";
import Dashboard from "@/components/dashboard/Dashboard";
import { MlAccountStatus } from "@/components/MlAccountStatus";
import { ZxpMark } from "@/components/ZxpMark";
import { AvatarUpload } from "@/components/AvatarUpload";
import MyProfileModal from "@/components/MyProfileModal";
import CommandPalette from "@/components/CommandPalette";
import { SaleNotificationProvider } from "@/components/SaleNotificationProvider";

type Tab = "dashboard" | "pedidos" | "ads" | "preco" | "metas" | "custos" | "estoque" | "full" | "desempenho" | "dre" | "tarefas" | "acesso" | "clientes";

// Owner e colaborador veem tudo, exceto Acesso — essa é só do owner (a aba
// nem aparece na navegação pra colaborador). Tarefas é a única aba em que o
// colaborador também EDITA (ver isOwner mais abaixo) — as demais continuam
// somente leitura pra ele, garantido pelas regras do Firestore.
const NAV_ITEMS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "pedidos", label: "Pedidos" },
  { id: "ads", label: "Ads" },
  { id: "preco", label: "Preço" },
  { id: "metas", label: "Metas" },
  { id: "custos", label: "Custos" },
  { id: "estoque", label: "Estoque" },
  { id: "full", label: "Full" },
  { id: "desempenho", label: "Desempenho" },
  { id: "dre", label: "DRE" },
  { id: "tarefas", label: "Tarefas" },
  { id: "acesso", label: "Acesso" },
  { id: "clientes", label: "Clientes" },
];

// Ícones em linha (herdam a cor via currentColor) — visual limpo e profissional.
const ICON_PATHS: Record<Tab, React.ReactNode> = {
  dashboard: (<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>),
  pedidos: (<><path d="M6 8h12l-1 12H7L6 8z" /><path d="M9 8V6.5a3 3 0 0 1 6 0V8" /></>),
  ads: (<><path d="M4 10v4a1 1 0 0 0 1 1h2l5 3.5V6.5L7 10H5a1 1 0 0 0-1 1z" /><path d="M16 9a4.5 4.5 0 0 1 0 6" /></>),
  preco: (<><path d="M3.5 12.5l8-8H20v8.5l-8 8-8.5-8.5z" /><circle cx="16" cy="8" r="1.4" /></>),
  metas: (<><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" /></>),
  custos: (<><path d="M6 3h12v18l-2-1.3L14 21l-2-1.3L10 21l-2-1.3L6 21z" /><path d="M9 8.5h6M9 12h6" /></>),
  estoque: (<><path d="M3 8l9-4 9 4-9 4-9-4z" /><path d="M3 8v8l9 4 9-4V8" /><path d="M12 12v8" /></>),
  full: (<><rect x="3" y="7" width="13" height="11" rx="1.3" /><path d="M16 10.5h3.2a1 1 0 0 1 .9.55L22 14v4h-2.5" /><circle cx="8" cy="19.5" r="1.6" /><circle cx="17.5" cy="19.5" r="1.6" /></>),
  desempenho: (<><path d="M4 16a8 8 0 0 1 16 0" /><path d="M12 16l4-5" /><circle cx="12" cy="16" r="1.3" /></>),
  dre: (<><path d="M5 3h9l5 5v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M14 3v5h5" /><path d="M8 13h8M8 17h5" /></>),
  tarefas: (<><rect x="3" y="4" width="5" height="16" rx="1.2" /><rect x="9.5" y="4" width="5" height="10" rx="1.2" /><rect x="16" y="4" width="5" height="13" rx="1.2" /></>),
  acesso: (<><circle cx="12" cy="8" r="3.5" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></>),
  clientes: (<><circle cx="9" cy="8" r="3" /><path d="M3 19a6 6 0 0 1 12 0" /><path d="M16 5.5a3 3 0 0 1 0 5.6" /><path d="M17.5 14.4A5.5 5.5 0 0 1 21 19" /></>),
};

function NavIcon({ id }: { id: Tab }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden>
      {ICON_PATHS[id]}
    </svg>
  );
}

export default function Page() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          color: "var(--muted)",
          fontSize: ".9rem",
        }}
      >
        Carregando…
      </div>
    );
  }

  if (!user) return <LoginCard />;

  return (
    <AccessGuard>
      {/* useSearchParams (deep link ?tab=&order= de uma notificação de venda)
          exige um limite de Suspense em volta — sem isto o Next reclamaria
          da falta dele, mesmo esta página inteira já sendo renderizada só no
          cliente (atrás do gate de auth acima). */}
      <Suspense fallback={null}>
        <AppShell />
      </Suspense>
    </AccessGuard>
  );
}

const VALID_TABS: readonly Tab[] = ["dashboard", "pedidos", "ads", "preco", "metas", "custos", "estoque", "full", "desempenho", "dre", "tarefas", "acesso", "clientes"];

function AppShell() {
  const { user, signOut, signInWithAccountSelection } = useAuth();
  const searchParams = useSearchParams();
  // Deep link de notificação de venda (?tab=pedidos&order=...) — só lido na
  // primeira montagem; depois disso a navegação é sempre por estado local
  // (setTab/setOpenOrderId), igual ao resto do app, que não usa rota de URL.
  const [tab, setTab] = useState<Tab>(() => {
    const t = searchParams.get("tab");
    return (VALID_TABS as readonly string[]).includes(t ?? "") ? (t as Tab) : "dashboard";
  });
  const [openOrderId, setOpenOrderId] = useState<string | undefined>(() => searchParams.get("order") ?? undefined);
  const [openTaskId, setOpenTaskId] = useState<string | undefined>(() => searchParams.get("task") ?? undefined);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [swappingAccount, setSwappingAccount] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  /** CTA de toast/central de notificações: pula direto pra aba Pedidos com o drawer do pedido já aberto. */
  function navigateToOrder(orderId: string) {
    setTab("pedidos");
    setOpenOrderId(orderId);
  }

  /** Mesma ideia, pra tarefa atribuída: pula pra Tarefas com o modal já aberto. */
  function navigateToTask(taskId: string) {
    setTab("tarefas");
    setOpenTaskId(taskId);
  }

  /**
   * Toast e Central de Notificações só sabem o `deepLink` (ex.:
   * "/?tab=pedidos&order=123" ou "/?tab=tarefas&task=456") — traduz pra
   * navegação de estado local, que é como o app inteiro navega (sem router
   * de verdade, ver Tab acima).
   */
  function abrirDeepLink(deepLink: string) {
    const url = new URL(deepLink, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    const orderId = url.searchParams.get("order");
    const taskId = url.searchParams.get("task");
    const t = url.searchParams.get("tab");
    if (orderId) { navigateToOrder(orderId); return; }
    if (taskId) { navigateToTask(taskId); return; }
    if (t && (VALID_TABS as readonly string[]).includes(t)) setTab(t as Tab);
  }

  // Ctrl/Cmd+K abre a busca rápida de qualquer lugar do app — atalho comum
  // (VS Code, Linear, Notion) que dispensa clicar na sidebar pra trocar de aba.
  // Escape fecha a sidebar mobile aberta — sem isto só dava pra fechar
  // clicando no overlay, o que exclui quem navega só de teclado.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (e.key === "Escape" && sidebarOpen) setSidebarOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [sidebarOpen]);

  const data = useUserData(user?.uid);
  const { isOwner, gerenciaAcessoLegado, displayName } = useAccess();

  /**
   * Admin master do SaaS — quem cria contas de cliente. NÃO é o mesmo que
   * `isOwner`, que é o dono de UMA loja (ver lib/domain/tenant.ts). Descoberto
   * perguntando ao servidor, nunca deduzido do e-mail: a lista de masters vive
   * numa coleção que o cliente não consegue escrever.
   *
   * Isto só ESCONDE a aba. A segurança de verdade está nas rotas
   * /api/saas/*, que recusam quem não é master — esconder botão nunca foi
   * controle de acesso.
   */
  const [masterUid, setMasterUid] = useState<string | null>(null);
  useEffect(() => {
    // Espera o login RESOLVER. Sem o uid na dependência, isto dispararia na
    // primeira renderização, quando `getAuth().currentUser` ainda é null — a
    // rota devolveria 401 e o master nunca mais veria a aba nessa sessão.
    const uid = user?.uid;
    if (!uid) return;
    let vivo = true;
    authedFetch("/api/saas/clientes", { cache: "no-store" })
      .then((r) => { if (vivo && r.ok) setMasterUid(uid); })
      .catch(() => { /* sem resposta, segue sem a aba */ });
    return () => { vivo = false; };
  }, [user?.uid]);
  // Guardar o UID em vez de um booleano faz a permissão CAIR sozinha ao trocar
  // de conta: um `true` solto sobreviveria à troca até o efeito responder.
  const ehMasterSaas = !!user?.uid && masterUid === user.uid;
  const [profileOpen, setProfileOpen] = useState(false);

  // Sem isto, uma venda que chega com o app ABERTO não mostra notificação
  // nenhuma — o navegador só faz isso sozinho quando o app está em segundo
  // plano (via Service Worker). Idempotente, sem custo chamar de novo.
  useEffect(() => {
    initForegroundPush();
  }, []);

  // Acesso é só do owner — colaborador nem vê o item na navegação.
  const navItems = NAV_ITEMS.filter((n) => {
    // Acesso gerencia controleAcesso, uma coleção GLOBAL sem escopo de
    // tenant — mostrar pra owner do SaaS abriria a lista de outra operação
    // (ver gerenciaAcessoLegado em AccessGuard.tsx).
    if (n.id === "acesso") return gerenciaAcessoLegado;
    if (n.id === "clientes") return ehMasterSaas;
    return true;
  });
  // Defesa extra: se por algum motivo o tab ativo for "acesso" sem ser owner
  // (ex.: papel rebaixado com a aba já aberta), cai pro Dashboard.
  // Defesa extra, igual à de "acesso": tab escolhida na URL não pode driblar
  // a checagem de master.
  const activeTab: Tab =
    (tab === "acesso" && !gerenciaAcessoLegado) || (tab === "clientes" && !ehMasterSaas) ? "dashboard" : tab;

  if (!user) return null;

  const dateLabel = new Date().toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });

  async function handleSwapAccount() {
    if (!confirm('Desconectar da conta Google atual e fazer login com outra?\n\nVocê poderá escolher qual conta Google usar.')) return;
    
    setSwappingAccount(true);
    try {
      // Primeiro faz logout da conta atual
      await signOut();
      
      // Depois redireciona para login com seleção de conta
      // Usa um pequeno delay para garantir que o logout foi processado
      setTimeout(async () => {
        try {
          await signInWithAccountSelection();
        } catch (err) {
          console.error('Erro ao fazer login com seleção de conta', err);
          setSwappingAccount(false);
        }
      }, 300);
    } catch (err) {
      console.error('Erro ao trocar conta', err);
      setSwappingAccount(false);
    }
  }

  return (
    <>
      {/* Sidebar overlay on mobile */}
      {sidebarOpen && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Fechar menu"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.6)",
            zIndex: 40,
            border: "none",
            cursor: "default",
          }}
          onClick={() => setSidebarOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSidebarOpen(false); }
          }}
        />
      )}

      <div
        style={{
          display: "flex",
          minHeight: "100vh",
          background: "var(--bg)",
        }}
      >
        {/* ── Sidebar ── */}
        <aside
          style={{
            width: 220,
            flexShrink: 0,
            background: "var(--sidebar)",
            borderRight: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            position: "fixed",
            top: 0,
            left: sidebarOpen ? 0 : -220,
            bottom: 0,
            zIndex: 50,
            transition: "left .22s ease",
          }}
          className="app-sidebar"
        >
          {/* Logo */}
          <div
            style={{
              padding: "20px 20px 16px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <ZxpMark size={30} />
              <div style={{ lineHeight: 1.15 }}>
                <div
                  className="font-display"
                  style={{
                    fontWeight: 700,
                    fontSize: ".92rem",
                    letterSpacing: ".02em",
                    color: "var(--text)",
                  }}
                >
                  ZXP MARKET
                </div>
                <div style={{ fontSize: ".68rem", color: "var(--muted)", marginTop: 1 }}>
                  VAZXPRESS · Mercado Livre
                </div>
              </div>
            </div>
            <div style={{ fontSize: ".72rem", color: "var(--muted)", marginTop: 8, textTransform: "capitalize" }}>
              {dateLabel}
            </div>
          </div>

          {/* Nav items */}
          <nav style={{ flex: 1, padding: "10px 10px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setTab(item.id);
                    setSidebarOpen(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 11,
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 9,
                    border: "none",
                    background: active ? "var(--surface2)" : "transparent",
                    color: active ? "var(--text)" : "var(--muted)",
                    boxShadow: active ? "inset 3px 0 0 var(--brand)" : "none",
                    fontSize: ".9rem",
                    fontWeight: active ? 700 : 500,
                    cursor: "pointer",
                    transition: "background .15s, color .15s",
                    textAlign: "left",
                  }}
                  onMouseEnter={(e) => {
                    if (!active) {
                      (e.currentTarget as HTMLButtonElement).style.background = "var(--surface2)";
                      (e.currentTarget as HTMLButtonElement).style.color = "var(--text)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                      (e.currentTarget as HTMLButtonElement).style.color = "var(--muted)";
                    }
                  }}
                >
                  <span style={{ color: active ? "var(--brand)" : "inherit", display: "inline-flex" }}>
                    <NavIcon id={item.id} />
                  </span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* User / signout */}
          <div
            style={{
              padding: "14px 16px",
              borderTop: "1px solid var(--border)",
            }}
          >
            <button
              type="button"
              onClick={() => setProfileOpen(true)}
              title="Editar meu perfil"
              aria-label="Editar meu perfil"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 10,
                width: "100%",
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <AvatarUpload size={28} />
              <span
                style={{
                  fontSize: ".75rem",
                  color: "var(--muted)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: 1,
                }}
              >
                {displayName}
              </span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: "var(--muted)" }} aria-hidden>
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
            {profileOpen && <MyProfileModal onClose={() => setProfileOpen(false)} />}
            <button
              type="button"
              className="btn btn-primary btn-xs"
              onClick={handleSwapAccount}
              disabled={swappingAccount}
              style={{ width: "100%", justifyContent: "center", marginBottom: 6, opacity: swappingAccount ? 0.6 : 1, cursor: swappingAccount ? 'not-allowed' : 'pointer' }}
            >
              {swappingAccount ? 'Trocando...' : 'Trocar conta'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={signOut}
              disabled={swappingAccount}
              style={{ width: "100%", justifyContent: "center", opacity: swappingAccount ? 0.6 : 1, cursor: swappingAccount ? 'not-allowed' : 'pointer' }}
            >
              Sair
            </button>
          </div>
        </aside>

        {/* ── Main content ── */}
        <div
          style={{
            flex: 1,
            marginLeft: 220,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
          }}
          className="app-main"
        >
          {/* Topbar — layout em classe (não style inline) porque precisa de
              media query pra compactar no celular; ver .topbar em globals.css */}
          <header className="topbar">
            {/* Hamburger for mobile */}
            <button
              type="button"
              className="btn btn-ghost btn-xs sidebar-toggle"
              onClick={() => setSidebarOpen(true)}
              aria-label="Abrir menu"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            {/*
              A sidebar (onde mora o logo) fica fora da tela no celular por
              padrão — só abre pelo hamburger. Sem isto, a marca simplesmente
              não aparece em lugar nenhum até o usuário abrir o menu.
            */}
            <span className="mobile-brand">
              <ZxpMark size={22} />
            </span>

            {/* flex:1 + minWidth:0 para truncar em vez de empurrar o status
                da conta ML pra fora da tela em telas bem estreitas. */}
            <div className="topbar-title">
              <span style={{ color: "var(--brand)", display: "inline-flex", flexShrink: 0 }}><NavIcon id={activeTab} /></span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {NAV_ITEMS.find((n) => n.id === activeTab)?.label}
              </span>
            </div>

            <div className="topbar-actions">
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => setPaletteOpen(true)}
                aria-label="Busca rápida (Ctrl+K)"
                title="Busca rápida (Ctrl+K)"
              >
                🔎 <span className="cmdk-hint">Ctrl+K</span>
              </button>
              <NotificationCenter onNavigate={abrirDeepLink} />
              <PushNotificationToggle />
              <MlAccountStatus />
            </div>
          </header>

          {/* Tab content */}
          <main className="app-content" style={{ flex: 1, minWidth: 0 }}>
            {!data.ready ? (
              <div
                style={{
                  textAlign: "center",
                  padding: 48,
                  color: "var(--muted)",
                  fontSize: ".9rem",
                }}
              >
                Carregando dados…
              </div>
            ) : (
              <>
                {/* Tarefas é a exceção: colaborador edita lá igual ao owner, então o
                    aviso de "somente leitura" seria falso ali. */}
                {!isOwner && activeTab !== "tarefas" && (
                  <div style={{ marginBottom: 14, padding: "8px 14px", background: "rgba(185,181,166,.12)", border: "1px solid var(--border)", borderRadius: 8, fontSize: ".8rem", color: "var(--muted)" }}>
                    Modo <b>somente leitura</b> — você pode ver tudo, mas alterações são permitidas apenas ao owner.
                  </div>
                )}
                {activeTab === "dashboard" && (
                  <Dashboard
                    data={data}
                    onVerEstoque={() => setTab("estoque")}
                    onVerMetas={() => setTab("metas")}
                    onNavigate={(t) => setTab(t as Tab)}
                  />
                )}
                {activeTab === "pedidos" && <PedidosTab metaMargem={data.goals?.metaMargem ?? undefined} openOrderId={openOrderId} />}
                {activeTab === "ads" && <AdsTab metaMargem={data.goals?.metaMargem ?? undefined} products={data.products} />}
                {activeTab === "preco" && <PrecoTab products={data.products} />}
                {activeTab === "metas" && <MetasTab uid={user.uid} data={data} />}
                {activeTab === "custos" && <CustosTab uid={user.uid} data={data} />}
                {activeTab === "estoque" && <EstoqueTab uid={user.uid} data={data} />}
                {activeTab === "full" && <FullTab products={data.products} />}
                {activeTab === "desempenho" && <DesempenhoTab />}
                {activeTab === "dre" && <DreTab />}
                {activeTab === "tarefas" && <TarefasTab openTaskId={openTaskId} />}
                {activeTab === "acesso" && gerenciaAcessoLegado && <AccessControlTab uid={user.uid} data={data} />}
                {activeTab === "clientes" && ehMasterSaas && <ClientesTab />}
              </>
            )}
          </main>
        </div>
      </div>

      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          items={navItems.map((n) => ({ id: n.id, label: n.label, icon: <NavIcon id={n.id} /> }))}
          onSelect={(id) => setTab(id as Tab)}
        />
      )}

      <SaleNotificationProvider onNavigate={abrirDeepLink} />
    </>
  );
}
