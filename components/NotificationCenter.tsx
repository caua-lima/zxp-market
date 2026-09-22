"use client";

import Drawer from "@/components/Drawer";
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import type { QueryDocumentSnapshot } from "firebase/firestore";
import { useAccess } from "@/components/tabs/AccessGuard";
import {
  assistirFeed,
  carregarMais,
  marcarLido,
  marcarVariosLidos,
  type AlvoDaMarca,
  type FonteDoFeed,
  type PaginaDoFeed,
} from "@/lib/firebase/notificacoes";
import { NOTIFICATION_TYPE_META, corpoComValor, type NotificationEvent } from "@/lib/domain/notifications";
import { colecaoDoNivel, nivelDoDestinatario } from "@/lib/domain/notificacao-publico";
import {
  contarNaoLidas,
  estaLido,
  mesclarFeeds,
  situacaoDaCentral,
  textoDeHora,
  textoDoCabecalho,
  type EstadoDaFonte,
  type ItemDaCentral,
} from "@/lib/domain/central-feed";

type AbaFiltro = "todas" | "vendas" | "alertas" | "sistema";

/**
 * O estado de UMA fonte de avisos. A Central lê duas — o feed do time e o feed
 * pessoal — e cada uma pode estar carregando, falhar ou ter mais páginas por
 * conta própria; misturar as duas num só booleano era como uma falha virava
 * "Tudo em dia".
 */
type EstadoDaFonteNaTela = EstadoDaFonte & {
  /** Primeira página, ao vivo. */
  itens: NotificationEvent[];
  cursor: QueryDocumentSnapshot | null;
  /** Páginas mais antigas já carregadas (estáticas). */
  antigos: NotificationEvent[];
  cursorAntigo: QueryDocumentSnapshot | null;
  temMaisAntigas: boolean;
  carregandoMais: boolean;
};

const FONTE_INICIAL: EstadoDaFonteNaTela = {
  carregando: true, erro: null, doCache: false, temMais: false,
  itens: [], cursor: null, antigos: [], cursorAntigo: null, temMaisAntigas: false, carregandoMais: false,
};

type Feedback = { texto: string; refazer?: () => void };

function IconePorTipo({ type }: { type: NotificationEvent["type"] }) {
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (type) {
    case "sale_high_value": return <svg {...common}><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" /></svg>;
    case "sale_low_margin": case "sale_negative_margin":
      return <svg {...common}><path d="M3 20h18" /><path d="M6 20V10M12 20V4M18 20v-7" /></svg>;
    case "sale_cancelled": return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></svg>;
    case "return_opened": case "return_completed": return <svg {...common}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>;
    case "sync_warning": return <svg {...common}><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 2.4 18a1.5 1.5 0 0 0 1.3 2.3h16.6a1.5 1.5 0 0 0 1.3-2.3L13.7 3.9a1.5 1.5 0 0 0-2.6 0z" /></svg>;
    case "task_assigned": case "task_due": return <svg {...common}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h3" /></svg>;
    case "test": return <svg {...common}><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3" /></svg>;
    case "sale_paid": default:
      return <svg {...common}><path d="M6 8h12l-1 12H7L6 8z" /><path d="M9 8V6.5a3 3 0 0 1 6 0V8" /></svg>;
  }
}

/** Relógio que só corre enquanto a Central está aberta: o "há 5 min" precisa andar, sem gastar nada com o painel fechado. */
function useRelogio(ativo: boolean, passoMs = 30_000): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (!ativo) return;
    const t = setInterval(() => setAgora(Date.now()), passoMs);
    return () => clearInterval(t);
  }, [ativo, passoMs]);
  return agora;
}

function useOffline(): boolean {
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && navigator.onLine === false);
  useEffect(() => {
    const off = () => setOffline(true);
    const on = () => setOffline(false);
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    return () => { window.removeEventListener("offline", off); window.removeEventListener("online", on); };
  }, []);
  return offline;
}

export function NotificationCenter({ onNavigate }: { onNavigate: (deepLink: string) => void }) {
  const { email, papel } = useAccess();
  const [open, setOpen] = useState(false);
  const [aba, setAba] = useState<AbaFiltro>("todas");
  const [tentativa, setTentativa] = useState(0);
  const [time, setTime] = useState<EstadoDaFonteNaTela>(FONTE_INICIAL);
  const [pessoal, setPessoal] = useState<EstadoDaFonteNaTela>(FONTE_INICIAL);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [marcando, setMarcando] = useState(false);
  /**
   * O que ESTA sessão já marcou como lido com sucesso. As páginas antigas vêm de uma leitura única
   * (não são ao vivo), então a marca gravada não apareceria nelas: a pessoa marcaria tudo e ainda
   * veria itens "não lidos" que já estão lidos no banco.
   */
  const [lidosLocal, setLidosLocal] = useState<Set<string>>(new Set());
  // Micro menu: pedido com 2+ itens ganha um "ver itens" que expande sem
  // navegar. Um Set de ids em vez de um único "expandido" — abrir um item da
  // lista não deveria fechar o que já estava aberto em outro.
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  const agora = useRelogio(open);
  const offline = useOffline();

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

  const aplicar = useCallback((set: typeof setTime, p: PaginaDoFeed) => {
    set((s) => ({
      ...s, carregando: false, erro: null, doCache: p.doCache, itens: p.itens, cursor: p.cursor,
      // Se a pessoa já carregou páginas antigas, "há mais" é a resposta DELAS; senão, a da primeira página.
      temMais: s.antigos.length > 0 ? s.temMaisAntigas : p.temMais,
    }));
  }, []);
  const falhar = useCallback((set: typeof setTime, mensagem: string) => {
    set((s) => ({ ...s, carregando: false, erro: mensagem }));
  }, []);

  useEffect(() => {
    const fonte: FonteDoFeed = { tipo: "time", colecao };
    return assistirFeed(fonte, (p) => aplicar(setTime, p), (m) => falhar(setTime, m));
  }, [colecao, tentativa, aplicar, falhar]);

  useEffect(() => {
    if (!email) return;
    const fonte: FonteDoFeed = { tipo: "pessoal", email };
    return assistirFeed(fonte, (p) => aplicar(setPessoal, p), (m) => falhar(setPessoal, m));
  }, [email, tentativa, aplicar, falhar]);

  // Sem e-mail não há feed pessoal a esperar: sem isto ela ficaria "carregando" pra sempre e a Central também.
  const fontes = useMemo<EstadoDaFonte[]>(
    () => [time, email ? pessoal : { ...pessoal, carregando: false }],
    [time, pessoal, email],
  );
  const itens = useMemo(
    () => mesclarFeeds([
      { origem: "time", itens: [...time.itens, ...time.antigos] },
      { origem: "pessoal", itens: [...pessoal.itens, ...pessoal.antigos] },
    ]).map((i) => (email && lidosLocal.has(`${i.origem}:${i.id}`) && !estaLido(i, email)
      ? { ...i, readBy: { ...(i.readBy ?? {}), [email]: 1 } }
      : i)),
    [time, pessoal, lidosLocal, email],
  );
  const situacao = situacaoDaCentral(fontes, itens.length);
  const contador = useMemo(() => contarNaoLidas(itens, email, fontes), [itens, email, fontes]);
  const cabecalho = textoDoCabecalho(situacao, contador, offline);
  const temMais = time.temMais || pessoal.temMais;

  const filtrados = useMemo(() => {
    if (aba === "todas") return itens;
    return itens.filter((e) => NOTIFICATION_TYPE_META[e.type]?.group === aba);
  }, [itens, aba]);

  const alvoDe = (i: ItemDaCentral): AlvoDaMarca => ({ id: i.id, origem: i.origem });

  function avisarFalhaDeMarca(quantas: number, refazer: () => void) {
    setFeedback({
      texto: quantas === 1 ? "Não consegui marcar como lida." : `Não consegui marcar ${quantas} avisos como lidos.`,
      refazer,
    });
  }

  async function marcarESinalizar(alvos: AlvoDaMarca[]) {
    if (!email || alvos.length === 0) return;
    setMarcando(true);
    try {
      const { falhas } = await marcarVariosLidos(alvos, email);
      const falhou = new Set(falhas.map((a) => `${a.origem}:${a.id}`));
      setLidosLocal((atual) => {
        const proximo = new Set(atual);
        for (const a of alvos) if (!falhou.has(`${a.origem}:${a.id}`)) proximo.add(`${a.origem}:${a.id}`);
        return proximo;
      });
      if (falhas.length > 0) avisarFalhaDeMarca(falhas.length, () => { void marcarESinalizar(falhas); });
      else setFeedback(null);
    } finally {
      setMarcando(false);
    }
  }

  function abrir(evt: ItemDaCentral) {
    // A marca é assíncrona e PODE falhar: navegar não espera por ela, mas a falha não é engolida.
    if (email && !estaLido(evt, email)) {
      marcarLido(alvoDe(evt), email)
        .then(() => setLidosLocal((atual) => new Set(atual).add(`${evt.origem}:${evt.id}`)))
        .catch(() => avisarFalhaDeMarca(1, () => { void marcarESinalizar([alvoDe(evt)]); }));
    }
    onNavigate(evt.deepLink);
    setOpen(false);
  }

  function marcarTodasLidas() {
    // Só as CARREGADAS: com histórico por carregar, dizer "todas" seria prometer o que não se sabe.
    void marcarESinalizar(itens.filter((i) => !estaLido(i, email)).map(alvoDe));
  }

  async function carregarAntigas() {
    const pedidas: [FonteDoFeed, EstadoDaFonteNaTela, typeof setTime][] = [
      [{ tipo: "time", colecao }, time, setTime],
      [{ tipo: "pessoal", email }, pessoal, setPessoal],
    ];
    await Promise.all(pedidas.map(async ([fonte, estado, set]) => {
      const cursor = estado.antigos.length > 0 ? estado.cursorAntigo : estado.cursor;
      if (!estado.temMais || !cursor || (fonte.tipo === "pessoal" && !email)) return;
      set((s) => ({ ...s, carregandoMais: true }));
      try {
        const p = await carregarMais(fonte, cursor);
        set((s) => {
          const ids = new Set([...s.itens, ...s.antigos].map((i) => i.id));
          return {
            ...s, carregandoMais: false,
            antigos: [...s.antigos, ...p.itens.filter((i) => !ids.has(i.id))],
            cursorAntigo: p.cursor ?? s.cursorAntigo,
            temMaisAntigas: p.temMais, temMais: p.temMais,
          };
        });
      } catch {
        set((s) => ({ ...s, carregandoMais: false }));
        setFeedback({ texto: "Não consegui carregar os avisos mais antigos.", refazer: () => { void carregarAntigas(); } });
      }
    }));
  }

  function tentarDeNovo() {
    setTime(FONTE_INICIAL);
    setPessoal(FONTE_INICIAL);
    setFeedback(null);
    setTentativa((n) => n + 1);
  }

  const semLer = itens.some((i) => !estaLido(i, email));
  const emErro = situacao === "erro";
  const pontinho = emErro ? "!" : contador.n > 0 ? `${contador.n > 99 ? "99+" : contador.n}${contador.exato || contador.n > 99 ? "" : "+"}` : null;
  const rotuloDoSino = emErro
    ? "Notificações — não consegui carregar"
    : contador.n > 0 ? `Notificações — ${contador.n}${contador.exato ? "" : " ou mais"} não lida(s)` : "Notificações";

  return (
    <div className="notif-bell">
      <button
        type="button"
        className="btn btn-ghost btn-xs"
        onClick={() => setOpen((v) => !v)}
        aria-label={rotuloDoSino}
        aria-expanded={open}
        title="Central de notificações"
      >
        <span aria-hidden>🔔</span>
        {pontinho && <span className="notif-bell-dot" aria-hidden>{pontinho}</span>}
      </button>

      {/* Portal + foco + fundo inerte + rolagem + pilha: tudo do Drawer (mesmo mecanismo do Modal). */}
      <Drawer open={open} onClose={() => setOpen(false)} titulo="Central de notificações">
            <div className="drawer-head">
              <div>
                <div className="drawer-title">Notificações</div>
                {/* aria-live: a mudança de "Carregando…" pra "Tudo em dia" (ou pro erro) é anunciada. */}
                <div className="drawer-sub" role="status" aria-live="polite">{cabecalho}</div>
              </div>
              <button type="button" className="drawer-close" onClick={() => setOpen(false)} aria-label="Fechar central de notificações">✕</button>
            </div>

            <div className="notif-tabs">
              {(["todas", "vendas", "alertas", "sistema"] as const).map((t) => (
                <button key={t} type="button" className={`notif-tab ${aba === t ? "active" : ""}`} onClick={() => setAba(t)} aria-pressed={aba === t}>
                  {t === "todas" ? "Todas" : t === "vendas" ? "Vendas" : t === "alertas" ? "Alertas" : "Sistema"}
                </button>
              ))}
            </div>

            {(emErro || situacao === "parcial") && (
              <div role="alert" style={{ margin: "10px 16px 0", padding: "10px 12px", borderRadius: 8, fontSize: ".82rem", lineHeight: 1.5, background: "var(--surface2)", borderLeft: "3px solid var(--red)" }}>
                {emErro
                  ? `Não consegui carregar os avisos (${[time.erro, pessoal.erro].filter(Boolean)[0]}).`
                  : `Parte dos avisos não carregou (${[time.erro, pessoal.erro].filter(Boolean)[0]}) — o que aparece abaixo pode estar incompleto.`}
                <div style={{ marginTop: 6 }}>
                  <button type="button" className="btn btn-warning btn-xs" onClick={tentarDeNovo}>Tentar de novo</button>
                </div>
              </div>
            )}

            {situacao === "desatualizada" && (
              <div role="status" style={{ margin: "10px 16px 0", fontSize: ".78rem", color: "var(--muted)" }}>
                {offline ? "Você está sem conexão: isto é o que estava salvo neste aparelho." : "Sincronizando com o servidor…"}
              </div>
            )}

            {feedback && (
              <div role="alert" style={{ margin: "10px 16px 0", padding: "8px 12px", borderRadius: 8, fontSize: ".82rem", background: "var(--surface2)", borderLeft: "3px solid var(--warning)" }}>
                {feedback.texto}{" "}
                {feedback.refazer && <button type="button" className="btn btn-ghost btn-xs" onClick={() => { const f = feedback.refazer; setFeedback(null); f?.(); }}>Tentar de novo</button>}
              </div>
            )}

            {semLer && (
              <div style={{ padding: "10px 16px 0" }}>
                <button type="button" className="btn btn-ghost btn-xs" onClick={marcarTodasLidas} disabled={marcando}>
                  {marcando ? "Marcando…" : temMais ? "Marcar as carregadas como lidas" : "Marcar todas como lidas"}
                </button>
              </div>
            )}

            <div className="drawer-body">
              {situacao === "carregando" ? (
                <div className="empty-state" role="status"><span className="empty-ico">⏳</span>Carregando as notificações…</div>
              ) : emErro && itens.length === 0 ? (
                // Sem lista: NÃO desenha "nenhuma notificação" — seria a mesma mentira do "Tudo em dia".
                <div className="empty-state"><span className="empty-ico">⚠️</span>Não foi possível carregar.</div>
              ) : filtrados.length === 0 ? (
                <div className="empty-state"><span className="empty-ico">🔔</span>{itens.length === 0 ? "Nenhuma notificação por aqui ainda." : "Nenhuma notificação nesta aba."}</div>
              ) : (
                filtrados.map((evt) => {
                  const lida = estaLido(evt, email);
                  const ehTeste = evt.type === "test";
                  return (
                    /*
                      ─── UM ITEM, DUAS AÇÕES, NENHUMA ANINHADA ───────────────
                      Era `div role="button"` com o botão "Ver itens" DENTRO. Interativo dentro de
                      interativo: o leitor de tela não anuncia o filho, e o Enter no botão interno
                      subia pro `onKeyDown` do pai, que abria o pedido em vez de expandir.

                      Agora o item é um contêiner sem papel, com um <button> real pra abrir (o
                      texto do próprio botão é o nome dele) e o de expandir como IRMÃO. O clique do
                      mouse em qualquer parte do cartão continua abrindo, como antes.
                    */
                    <div
                      key={`${evt.origem}:${evt.id}`}
                      className={`notif-item${lida ? "" : " notif-item-unread"}`}
                      onClick={(e) => { if ((e.target as HTMLElement).closest("button, ul, a")) return; abrir(evt); }}
                    >
                      <span className="notif-item-icon" style={{ color: `var(--${evt.severity === "success" ? "success" : evt.severity === "warning" ? "warning" : evt.severity === "danger" ? "danger" : "info-2"})` }}>
                        <IconePorTipo type={evt.type} />
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <button type="button" className="notif-item-main" onClick={() => abrir(evt)}>
                          {!lida && <span className="sr-only">Não lida. </span>}
                          <span className="notif-item-title">
                            {ehTeste && !/^TESTE/i.test(evt.title) && <span style={{ fontSize: ".75rem", fontWeight: 700, padding: "1px 6px", borderRadius: 4, marginRight: 6, background: "var(--surface2)", color: "var(--muted)", border: "1px solid var(--border)" }}>TESTE</span>}
                            {evt.title}
                          </span>
                          <span className="notif-item-body">{corpoComValor(evt.body, evt.grossAmount)}</span>
                          <span className="notif-item-time">{textoDeHora(evt.criadoEmMs, agora)}</span>
                        </button>

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

                      </div>
                    </div>
                  );
                })
              )}

              {temMais && (
                <div style={{ padding: "12px 16px", textAlign: "center" }}>
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => { void carregarAntigas(); }} disabled={time.carregandoMais || pessoal.carregandoMais}>
                    {time.carregandoMais || pessoal.carregandoMais ? "Carregando…" : "Carregar avisos mais antigos"}
                  </button>
                  <div style={{ fontSize: ".75rem", color: "var(--muted)", marginTop: 6 }}>
                    Você está vendo os {itens.length} mais recentes. Há mais antigos.
                  </div>
                </div>
              )}
            </div>
      </Drawer>
    </div>
  );
}
