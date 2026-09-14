"use client";

import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { useAccess } from "@/components/tabs/AccessGuard";
import { markNotificationRead, watchNotificationEvents } from "@/lib/firebase/data";
import { NOTIFICATION_TYPE_META, type NotificationEvent } from "@/lib/domain/notifications";
import { colecaoDoNivel, nivelDoDestinatario } from "@/lib/domain/notificacao-publico";

type AbaFiltro = "todas" | "vendas" | "alertas" | "sistema";

function toMillis(v: unknown): number {
  if (v && typeof v === "object" && "toMillis" in v && typeof (v as { toMillis: unknown }).toMillis === "function") {
    return (v as { toMillis: () => number }).toMillis();
  }
  return Date.now();
}

/** "agora", "5 min atrás", "3h atrás", "12/08" — sem depender de lib externa. */
function horaRelativa(ms: number): string {
  const diffMin = Math.floor((Date.now() - ms) / 60000);
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `${diffMin} min atrás`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h atrás`;
  return new Date(ms).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function fmtBRL(v: number | undefined): string | null {
  if (v == null) return null;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function IconePorTipo({ type }: { type: NotificationEvent["type"] }) {
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (type) {
    case "sale_high_value": return <svg {...common}><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" /></svg>;
    case "sale_low_margin": case "sale_negative_margin":
      return <svg {...common}><path d="M3 20h18" /><path d="M6 20V10M12 20V4M18 20v-7" /></svg>;
    case "sale_cancelled": return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></svg>;
    case "return_opened": case "return_completed": return <svg {...common}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>;
    case "sync_warning": return <svg {...common}><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 2.4 18a1.5 1.5 0 0 0 1.3 2.3h16.6a1.5 1.5 0 0 0 1.3-2.3L13.7 3.9a1.5 1.5 0 0 0-2.6 0z" /></svg>;
    case "task_assigned": return <svg {...common}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h3" /></svg>;
    case "sale_paid": default:
      return <svg {...common}><path d="M6 8h12l-1 12H7L6 8z" /><path d="M9 8V6.5a3 3 0 0 1 6 0V8" /></svg>;
  }
}

export function NotificationCenter({ onNavigate }: { onNavigate: (deepLink: string) => void }) {
  const { email, papel } = useAccess();
  const [eventos, setEventos] = useState<NotificationEvent[]>([]);
  const [open, setOpen] = useState(false);
  const [aba, setAba] = useState<AbaFiltro>("todas");
  // Micro menu: pedido com 2+ itens ganha um "ver itens" que expande sem
  // navegar. Um Set de ids em vez de um único "expandido" — abrir um item da
  // lista não deveria fechar o que já estava aberto em outro.
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  function alternarExpandido(id: string, e: MouseEvent) {
    e.stopPropagation(); // não deixa o clique no botão também abrir/navegar o card
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  /**
   * Quem nao pode ver financeiro escuta o espelho redigido. As regras do
   * Firestore sao por documento — nao havia como liberar o evento e esconder
   * lucro e margem dentro dele, e o member via os dois.
   */
  const colecao = colecaoDoNivel(nivelDoDestinatario(papel, []));
  useEffect(() => watchNotificationEvents(setEventos, 50, colecao), [colecao]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const naoLidas = useMemo(
    () => eventos.filter((e) => !e.readBy || !(email in e.readBy)).length,
    [eventos, email],
  );

  const filtrados = useMemo(() => {
    if (aba === "todas") return eventos;
    return eventos.filter((e) => NOTIFICATION_TYPE_META[e.type]?.group === aba);
  }, [eventos, aba]);

  function abrir(evt: NotificationEvent) {
    if (email) markNotificationRead(evt.id, email, colecao);
    onNavigate(evt.deepLink);
    setOpen(false);
  }

  function marcarTodasLidas() {
    if (!email) return;
    eventos.filter((e) => !e.readBy || !(email in e.readBy)).forEach((e) => markNotificationRead(e.id, email, colecao));
  }

  return (
    <div className="notif-bell">
      <button
        type="button"
        className="btn btn-ghost btn-xs"
        onClick={() => setOpen((v) => !v)}
        aria-label={naoLidas > 0 ? `Notificações — ${naoLidas} não lida(s)` : "Notificações"}
        title="Central de notificações"
      >
        <span aria-hidden>🔔</span>
        {naoLidas > 0 && <span className="notif-bell-dot" aria-hidden>{naoLidas > 99 ? "99+" : naoLidas}</span>}
      </button>

      {open && (
        <div className="drawer-overlay" onClick={() => setOpen(false)}>
          <div className="drawer-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Central de notificações">
            <div className="drawer-head">
              <div>
                <div className="drawer-title">Notificações</div>
                <div className="drawer-sub">{naoLidas > 0 ? `${naoLidas} não lida(s)` : "Tudo em dia"}</div>
              </div>
              <button type="button" className="drawer-close" onClick={() => setOpen(false)} aria-label="Fechar central de notificações">✕</button>
            </div>

            <div className="notif-tabs">
              {(["todas", "vendas", "alertas", "sistema"] as const).map((t) => (
                <button key={t} type="button" className={`notif-tab ${aba === t ? "active" : ""}`} onClick={() => setAba(t)}>
                  {t === "todas" ? "Todas" : t === "vendas" ? "Vendas" : t === "alertas" ? "Alertas" : "Sistema"}
                </button>
              ))}
            </div>

            {naoLidas > 0 && (
              <div style={{ padding: "10px 16px 0" }}>
                <button type="button" className="btn btn-ghost btn-xs" onClick={marcarTodasLidas}>Marcar todas como lidas</button>
              </div>
            )}

            <div className="drawer-body">
              {filtrados.length === 0 ? (
                <div className="empty-state"><span className="empty-ico">🔔</span>Nenhuma notificação por aqui ainda.</div>
              ) : (
                filtrados.map((evt) => {
                  const lida = !!email && !!evt.readBy && email in evt.readBy;
                  const gross = fmtBRL(evt.grossAmount);
                  return (
                    <div
                      key={evt.id}
                      className={`notif-item${lida ? "" : " notif-item-unread"}`}
                      onClick={() => abrir(evt)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(evt); } }}
                    >
                      <span className="notif-item-icon" style={{ color: `var(--${evt.severity === "success" ? "success" : evt.severity === "warning" ? "warning" : evt.severity === "danger" ? "danger" : "info-2"})` }}>
                        <IconePorTipo type={evt.type} />
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="notif-item-title">{evt.title}</div>
                        <div className="notif-item-body">{evt.body}{gross ? ` · ${gross}` : ""}</div>

                        {evt.itens && evt.itens.length > 1 && (
                          <>
                            <button
                              type="button"
                              className="notif-item-expand-btn"
                              onClick={(e) => alternarExpandido(evt.id, e)}
                              aria-expanded={expandidos.has(evt.id)}
                            >
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ transform: expandidos.has(evt.id) ? "rotate(90deg)" : "none", transition: "transform .15s" }}><path d="M9 6l6 6-6 6" /></svg>
                              {expandidos.has(evt.id) ? "Ocultar itens" : `Ver ${evt.itens.length} itens`}
                            </button>
                            {expandidos.has(evt.id) && (
                              <ul className="notif-item-itens" onClick={(e) => e.stopPropagation()}>
                                {evt.itens.map((it, i) => (
                                  <li key={i}>
                                    <span>{it.title}</span>
                                    <span className="tabular-nums">{it.quantity > 1 ? `×${it.quantity}` : ""}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </>
                        )}

                        <div className="notif-item-time">{horaRelativa(toMillis(evt.createdAt))}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
