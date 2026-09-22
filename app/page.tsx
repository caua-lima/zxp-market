"use client";

import { Suspense, useEffect, useState, useMemo, useRef, Fragment } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/firebase/auth-context";
import { initForegroundPush, registrarCliqueDoAviso } from "@/lib/firebase/push";
import { validarDeepLink } from "@/lib/domain/deep-link";
import { PushNotificationToggle } from "@/components/PushNotificationToggle";
import { NotificationCenter } from "@/components/NotificationCenter";
import AjudaChat from "@/components/AjudaChat";
import { useUserData } from "@/components/useUserData";
import dynamic from "next/dynamic";
import { AccessGuard, useAccess } from "@/components/tabs/AccessGuard";
import { abaEhEditavel } from "@/lib/domain/types";
/**
 * ─── AS ABAS SÓ BAIXAM QUANDO SÃO ABERTAS ───────────────────────────────
 *
 * As onze eram `import` estático no topo. Como o componente que as usa é
 * um só, tudo caía no mesmo pedaço: abrir o Dashboard baixava EstoqueTab
 * (~2.400 linhas), AdsTab, DreTab, DesempenhoTab e mais sete — inclusive as
 * que o papel da pessoa nem deixa abrir.
 *
 * Elas já eram renderizadas com `{activeTab === 'x' && <X/>}`, então nunca
 * chegavam à tela antes da hora — só ao NAVEGADOR. `next/dynamic` fecha essa
 * diferença: cada uma vira um pedaço próprio, buscado no primeiro clique e
 * guardado depois disso.
 *
 * O Dashboard fica de fora de propósito: é a aba padrão, a primeira coisa
 * que todo mundo vê. Adiá-lo trocaria bytes por um spinner na abertura, que
 * é o oposto do que se quer.
 *
 * `loading` existe pra que a troca de aba não pisque em branco na primeira
 * vez — sem ele, o vão entre o clique e o pedaço chegar parece travamento.
 */
const aoCarregar = () => (
  <div className="panel" style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
    Carregando…
  </div>
);

const MetasTab = dynamic(() => import("@/components/tabs/MetasTab"), { loading: aoCarregar });
const PedidosTab = dynamic(() => import("@/components/tabs/PedidosTab"), { loading: aoCarregar });
const AdsTab = dynamic(() => import("@/components/tabs/AdsTab"), { loading: aoCarregar });
const CustosTab = dynamic(() => import("@/components/tabs/CustosTab"), { loading: aoCarregar });
const EstoqueTab = dynamic(() => import("@/components/tabs/EstoqueTab"), { loading: aoCarregar });
const FullTab = dynamic(() => import("@/components/tabs/FullTab"), { loading: aoCarregar });
const DesempenhoTab = dynamic(() => import("@/components/tabs/DesempenhoTab"), { loading: aoCarregar });
const AccessControlTab = dynamic(() => import("@/components/tabs/AccessControlTab"), { loading: aoCarregar });
const DreTab = dynamic(() => import("@/components/tabs/DreTab"), { loading: aoCarregar });
const PrecoTab = dynamic(() => import("@/components/tabs/PrecoTab"), { loading: aoCarregar });
const TarefasTab = dynamic(() => import("@/components/tabs/TarefasTab"), { loading: aoCarregar });

import LoginCard from "@/components/LoginCard";
import Dashboard from "@/components/dashboard/Dashboard";
import { MlAccountStatus } from "@/components/MlAccountStatus";
import { ZxpMark } from "@/components/ZxpMark";
import { AvatarUpload } from "@/components/AvatarUpload";
import MyProfileModal from "@/components/MyProfileModal";
import CommandPalette from "@/components/CommandPalette";
import { SaleNotificationProvider } from "@/components/SaleNotificationProvider";
import { marcarAberturaDeGrupo } from "@/lib/domain/nav-grupos";
import {
  lerContexto, sincronizarUrl, CONTEXTO_VAZIO,
  type ContextoUrl,
} from "@/lib/domain/contexto-url";

type Tab = "dashboard" | "pedidos" | "ads" | "preco" | "metas" | "custos" | "estoque" | "full" | "desempenho" | "dre" | "tarefas" | "acesso";

// Owner e colaborador veem tudo, exceto Acesso — essa é só do owner (a aba
// nem aparece na navegação pra colaborador). Tarefas é a única aba em que o
// colaborador também EDITA (ver isOwner mais abaixo) — as demais continuam
// somente leitura pra ele, garantido pelas regras do Firestore.
/**
 * ─── POR QUE AGRUPAR ────────────────────────────────────────────────────
 *
 * Eram doze botões numa lista só, em ordem de quando cada aba foi escrita.
 * Doze itens planos é mais do que se lê de relance: pra achar a DRE, a
 * pessoa varre a lista inteira todas as vezes, porque nada na ordem ajuda
 * a prever onde ela está.
 *
 * Os grupos são por PERGUNTA, não por parentesco de código:
 *
 *   Visão geral   — "como estamos?"
 *   Comercial     — "o que está sendo vendido, e por quanto?"
 *   Operação      — "o que precisa ser feito com o estoque?"
 *   Financeiro    — "quanto sobrou?"
 *   Desempenho    — "como o mercado nos vê?"
 *   Administração — "quem pode o quê?"
 *
 * Metas fica em Visão geral e não em Financeiro de propósito: meta é
 * acompanhamento do mês em curso, e quem abre Financeiro está atrás de
 * número fechado.
 */
export const GRUPOS_NAV = ["visao", "comercial", "operacao", "financeiro", "desempenho", "admin"] as const;
export type GrupoNav = (typeof GRUPOS_NAV)[number];

const ROTULO_GRUPO: Record<GrupoNav, string> = {
  visao: "Visão geral",
  comercial: "Comercial",
  operacao: "Operação",
  financeiro: "Financeiro",
  desempenho: "Desempenho",
  admin: "Administração",
};

const NAV_ITEMS: { id: Tab; label: string; grupo: GrupoNav }[] = [
  { id: "dashboard", label: "Dashboard", grupo: "visao" },
  { id: "metas", label: "Metas", grupo: "visao" },

  { id: "pedidos", label: "Pedidos", grupo: "comercial" },
  { id: "ads", label: "Ads", grupo: "comercial" },
  { id: "preco", label: "Preço", grupo: "comercial" },

  { id: "estoque", label: "Estoque", grupo: "operacao" },
  { id: "full", label: "Full", grupo: "operacao" },
  { id: "tarefas", label: "Tarefas", grupo: "operacao" },

  { id: "custos", label: "Custos", grupo: "financeiro" },
  { id: "dre", label: "DRE", grupo: "financeiro" },

  { id: "desempenho", label: "Desempenho", grupo: "desempenho" },

  { id: "acesso", label: "Acesso", grupo: "admin" },
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

const VALID_TABS: readonly Tab[] = ["dashboard", "pedidos", "ads", "preco", "metas", "custos", "estoque", "full", "desempenho", "dre", "tarefas", "acesso"];

function AppShell() {
  const { user, signOut, signInWithAccountSelection } = useAuth();
  const searchParams = useSearchParams();

  /**
   * ─── A URL VOLTOU A SER O ENDEREÇO DA TELA ───────────────────────────
   *
   * Antes: a URL era lida UMA vez, na primeira montagem, e nunca escrita de
   * volta. O comentário que estava aqui dizia isso com todas as letras —
   * "depois disso a navegação é sempre por estado local". As três
   * consequências apareciam no uso diário:
   *
   *   · recarregar jogava a pessoa no Dashboard, de qualquer aba;
   *   · o botão Voltar SAÍA DO APP, porque navegação interna nenhuma
   *     criava entrada no histórico;
   *   · não dava pra mandar "olha a DRE de agosto" pra ninguém.
   *
   * Agora a aba e o item aberto vivem na URL, e `contexto-url` decide o que
   * empilha no histórico e o que só substitui: trocar de aba empilha (Voltar
   * volta pro Dashboard), mexer em filtro não (Voltar não é Desfazer).
   */
  const inicial = lerContexto(searchParams.toString(), VALID_TABS);

  const [tab, setTab] = useState<Tab>(() => (inicial.aba as Tab) ?? "dashboard");
  const [openOrderId, setOpenOrderId] = useState<string | undefined>(
    () => (inicial.tipoDoItem === "pedido" ? inicial.item ?? undefined : undefined),
  );
  const [openTaskId, setOpenTaskId] = useState<string | undefined>(
    () => (inicial.tipoDoItem === "tarefa" ? inicial.item ?? undefined : undefined),
  );
  /**
   * Sobe a cada navegação DELIBERADA (clique numa notificação, Voltar, Avançar).
   * É o que separa "chegou dado novo" de "a pessoa pediu isto de novo" para o
   * deep link de pedido/tarefa: sem ela, um link já aberto e fechado nunca mais
   * abriria, e com o efeito antigo abria a cada atualização da lista.
   */
  const [navKey, setNavKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [swappingAccount, setSwappingAccount] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  /**
   * O contexto que a URL deve mostrar AGORA, derivado do estado.
   *
   * Derivado, e não um segundo estado guardado em paralelo: dois lugares
   * guardando a mesma coisa é como as telas desta base passaram a mostrar
   * números diferentes do mesmo mês.
   */
  const contextoAtual: ContextoUrl = useMemo(() => ({
    ...CONTEXTO_VAZIO,
    aba: tab,
    item: openOrderId ?? openTaskId ?? null,
    tipoDoItem: openOrderId ? "pedido" : openTaskId ? "tarefa" : null,
  }), [tab, openOrderId, openTaskId]);

  /**
   * O que a barra de endereços mostrava na última sincronização.
   *
   * Guardado em ref e não em estado: ele só serve pra comparar na próxima
   * sincronização. Em estado, cada escrita na URL agendaria outra pintura,
   * e o efeito abaixo passaria a disparar a si mesmo.
   */
  const ultimoContexto = useRef<ContextoUrl>(contextoAtual);

  useEffect(() => {
    /**
     * Uma linha, e ela é testável: a escolha entre empilhar e substituir mora
     * em `sincronizarUrl`, com nove testes. Dentro deste efeito — num
     * componente que só monta depois do login — ela seria impossível de
     * exercitar, e foi por não dar pra testar que a URL passou tanto tempo
     * sem ser escrita de volta.
     */
    const r = sincronizarUrl({
      historico: window.history,
      caminho: window.location.pathname,
      anterior: ultimoContexto.current,
      atual: contextoAtual,
      abaPadrao: "dashboard",
    });
    if (r.acao !== "nada") ultimoContexto.current = contextoAtual;
  }, [contextoAtual]);

  /**
   * Voltar e avançar do navegador.
   *
   * Sem este ouvinte, o `pushState` acima seria pior que não ter histórico
   * nenhum: a URL mudaria ao apertar Voltar e a tela ficaria parada, e uma
   * barra de endereços que mente é pior do que uma que não diz nada.
   */
  useEffect(() => {
    function aoVoltar() {
      const c = lerContexto(window.location.search, VALID_TABS);
      ultimoContexto.current = c;
      setTab((c.aba as Tab) ?? "dashboard");
      setOpenOrderId(c.tipoDoItem === "pedido" ? c.item ?? undefined : undefined);
      setOpenTaskId(c.tipoDoItem === "tarefa" ? c.item ?? undefined : undefined);
      setNavKey((n) => n + 1);
    }
    window.addEventListener("popstate", aoVoltar);
    return () => window.removeEventListener("popstate", aoVoltar);
  }, []);

  /** CTA de toast/central de notificações: pula direto pra aba Pedidos com o drawer do pedido já aberto. */
  function navigateToOrder(orderId: string) {
    setTab("pedidos");
    setOpenOrderId(orderId);
    setNavKey((n) => n + 1);
  }

  /** Mesma ideia, pra tarefa atribuída: pula pra Tarefas com o modal já aberto. */
  function navigateToTask(taskId: string) {
    setTab("tarefas");
    setOpenTaskId(taskId);
    setNavKey((n) => n + 1);
  }

  /**
   * Toast e Central de Notificações só sabem o `deepLink` (ex.:
   * "/?tab=pedidos&order=123" ou "/?tab=tarefas&task=456") — traduz pra
   * navegação de estado local, que é como o app inteiro navega (sem router
   * de verdade, ver Tab acima).
   */
  function abrirDeepLink(deepLink: string) {
    const url = new URL(deepLink, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    // Mesmo leitor da URL de entrada, então o formato antigo (?order=) e o
    // novo (?item=&tipo=) funcionam aqui sem uma segunda regra pra manter.
    const c = lerContexto(url.searchParams, VALID_TABS);
    if (c.tipoDoItem === "pedido" && c.item) { navigateToOrder(c.item); return; }
    if (c.tipoDoItem === "tarefa" && c.item) { navigateToTask(c.item); return; }
    if (c.aba) setTab(c.aba as Tab);
  }

  /**
   * ─── O CLIQUE NA NOTIFICAÇÃO ─────────────────────────────────────────
   *
   * O Service Worker NÃO navega a janela (client.navigate recarrega a página e
   * destrói um formulário em edição): ele foca a janela e manda uma mensagem, e é
   * AQUI que se decide. Com uma janela de edição aberta (.modal-overlay), abrir o
   * destino trocaria de aba e descartaria o que a pessoa está digitando — então
   * pergunta antes.
   *
   * O clique também é REGISTRADO aqui (o app tem a sessão; o Service Worker não),
   * e é um recibo separado de "lido".
   */
  const [linkPendente, setLinkPendente] = useState<{ deepLink: string; eventId: string } | null>(null);
  const abrirDeepLinkRef = useRef(abrirDeepLink);
  useEffect(() => { abrirDeepLinkRef.current = abrirDeepLink; });

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    function aoReceber(e: MessageEvent) {
      const d = e.data as { tipo?: unknown; deepLink?: unknown; eventId?: unknown } | null;
      if (!d || d.tipo !== "abrir" || typeof d.deepLink !== "string") return;
      // Valida DE NOVO (a mesma função do Service Worker): uma mensagem não deve levar o app a lugar nenhum além das rotas dele.
      const destino = validarDeepLink(d.deepLink, window.location.origin);
      const eventId = typeof d.eventId === "string" ? d.eventId : "";
      if (eventId) registrarCliqueDoAviso(eventId);
      if (document.querySelector(".modal-overlay")) { setLinkPendente({ deepLink: destino, eventId }); return; }
      abrirDeepLinkRef.current(destino);
    }
    navigator.serviceWorker.addEventListener("message", aoReceber);
    return () => navigator.serviceWorker.removeEventListener("message", aoReceber);
  }, []);

  // App FECHADO no clique: o Service Worker abre a janela já no destino, com o eventId em ?ev=.
  // Registra o clique e tira o parâmetro do endereço (ele não é parte da tela).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const ev = p.get("ev");
    if (!ev) return;
    registrarCliqueDoAviso(ev);
    p.delete("ev");
    const resto = p.toString();
    window.history.replaceState(window.history.state, "", window.location.pathname + (resto ? `?${resto}` : ""));
  }, []);

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
  const { isOwner, displayName, podeVer, canEditTab } = useAccess();
  const [profileOpen, setProfileOpen] = useState(false);

  // Sem isto, uma venda que chega com o app ABERTO não mostra notificação
  // nenhuma — o navegador só faz isso sozinho quando o app está em segundo
  // plano (via Service Worker). Idempotente, sem custo chamar de novo.
  useEffect(() => {
    initForegroundPush();
  }, []);

  /**
   * Navegação pelo PAPEL: owner vê tudo, partner vê tudo menos Acesso, member
   * só o Dashboard. A regra vem de podeVerAba (lib/domain/types), a mesma que
   * as regras do Firestore espelham.
   */
  const navItems = NAV_ITEMS.filter((n) => podeVer(n.id));
  /**
   * Defesa extra: aba ativa que o papel não alcança cai pro Dashboard. Vale
   * pra papel rebaixado com a aba já aberta e pra link direto por ?tab=.
   */
  const activeTab: Tab = podeVer(tab) ? tab : "dashboard";

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
                <div style={{ fontSize: ".75rem", color: "var(--muted)", marginTop: 1 }}>
                  VAZXPRESS · Mercado Livre
                </div>
              </div>
            </div>
            <div style={{ fontSize: ".75rem", color: "var(--muted)", marginTop: 8, textTransform: "capitalize" }}>
              {dateLabel}
            </div>
          </div>

          {/* Nav items */}
          <nav style={{ flex: 1, padding: "10px 10px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
            {marcarAberturaDeGrupo(navItems).map((item, i) => {
              // `abreGrupo` vem de marcarAberturaDeGrupo, com teste: o cabeçalho
              // sai no PRIMEIRO item de cada grupo, e não num <section> fixo. O
              // papel filtra os itens antes, e seção fixa deixaria título vazio
              // — "Administração" sem nada embaixo diz pra pessoa que existe uma
              // tela que ela não está achando.
              const { abreGrupo } = item;
              const active = activeTab === item.id;
              return (
                <Fragment key={item.id}>
                {abreGrupo && (
                  <div style={{
                    // 12px é o piso pra metadado no padrão desta tela. Título
                    // de grupo é orientação, não informação que se lê — mas
                    // ainda precisa ser legível por quem enxerga pouco.
                    fontSize: 12, fontWeight: 700, letterSpacing: ".07em",
                    textTransform: "uppercase", color: "var(--muted)",
                    padding: i === 0 ? "2px 12px 6px" : "14px 12px 6px",
                  }}>
                    {ROTULO_GRUPO[item.grupo]}
                  </div>
                )}
                <button
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
                </Fragment>
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
            {/*
              ─── DOIS BOTÕES IRMÃOS, NÃO UM DENTRO DO OUTRO ──────────────────
              Era um botão "Editar meu perfil" com o AvatarUpload DENTRO, e o
              AvatarUpload tem o seu próprio botão ("Trocar foto de perfil"):
              botão dentro de botão é HTML inválido (o React acusava erro de
              hidratação a cada abertura), o leitor de tela não anunciava o filho,
              e o clique na foto era disputado com o do pai. Agora a foto e o nome
              são irmãos, cada um com a sua ação.
            */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, width: "100%" }}>
              <AvatarUpload size={28} />
              <button
                type="button"
                onClick={() => setProfileOpen(true)}
                title="Editar meu perfil"
                aria-label={`Editar meu perfil (${displayName})`}
                className="perfil-btn"
              >
                <span className="perfil-nome">{displayName}</span>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: "var(--muted)" }} aria-hidden>
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
            </div>
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
                {/* A mesma pergunta que EstoqueTab/CustosTab/MetasTab/Ads já fazem
                    (canEditTab, por aba) — não `!isOwner` global, que contradizia
                    os próprios botões de editar da aba quando um partner tinha
                    aquela aba especificamente liberada (S17). */}
                {!abaEhEditavel(activeTab, { isOwner, canEditTab }) && (
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
                {activeTab === "pedidos" && <PedidosTab metaMargem={data.goals?.metaMargem ?? undefined} openOrderId={openOrderId} chaveDeNavegacao={navKey} />}
                {activeTab === "ads" && <AdsTab metaMargem={data.goals?.metaMargem ?? undefined} products={data.products} />}
                {activeTab === "preco" && <PrecoTab products={data.products} />}
                {activeTab === "metas" && <MetasTab uid={user.uid} data={data} />}
                {activeTab === "custos" && <CustosTab uid={user.uid} data={data} />}
                {activeTab === "estoque" && <EstoqueTab uid={user.uid} data={data} />}
                {activeTab === "full" && <FullTab products={data.products} />}
                {activeTab === "desempenho" && <DesempenhoTab />}
                {activeTab === "dre" && <DreTab />}
                {activeTab === "tarefas" && <TarefasTab openTaskId={openTaskId} chaveDeNavegacao={navKey} />}
                {activeTab === "acesso" && isOwner && <AccessControlTab uid={user.uid} data={data} />}
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

      {/* Ajuda sobre o SISTEMA. Fica fora da aba Ads de proposito: la ja existe
          o Consultor, que responde sobre os NUMEROS — dois chats na mesma tela
          so fariam o usuario escolher errado. */}
      {activeTab !== "ads" && <AjudaChat abaAtual={activeTab} />}

      <SaleNotificationProvider onNavigate={abrirDeepLink} />

      {linkPendente && (
        <div
          role="alertdialog"
          aria-label="Abrir notificação"
          style={{ position: "fixed", left: 16, right: 16, bottom: 16, zIndex: 1300, maxWidth: 520, margin: "0 auto", padding: "12px 14px", borderRadius: 10, background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "0 8px 24px rgba(0,0,0,.35)", fontSize: ".85rem", lineHeight: 1.5 }}
        >
          Você abriu uma notificação, mas há uma janela de edição aberta. Abrir agora pode descartar o que está sendo digitado.
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary btn-xs" onClick={() => { const l = linkPendente; setLinkPendente(null); abrirDeepLink(l.deepLink); }}>Abrir mesmo assim</button>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setLinkPendente(null)}>Continuar editando</button>
          </div>
        </div>
      )}
    </>
  );
}
