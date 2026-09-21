"use client";

import { useEffect, useMemo, useReducer, useSyncExternalStore } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { onForegroundPush, type ForegroundPushEvent } from "@/lib/firebase/push";
import {
  CONFIG_PADRAO,
  ajustarLimite,
  chegou,
  dispensar,
  estadoInicial,
  passar,
  pausar,
  prioridadeDoTipo,
  proximoPrazo,
  retomar,
  retomarSuspensos,
  suspender,
  type ConfigDeToasts,
  type EstadoDeToasts,
  type NovoToast,
} from "@/lib/domain/toast-fila";
import { SaleNotificationToast } from "./SaleNotificationToast";

/**
 * Duração antes do fechamento automático, por tipo — margem negativa fica
 * até fechar manualmente (ou 15s, o que vier primeiro: ainda fecha sozinho
 * pra não empilhar toast esquecido na tela, só demora mais por ser o aviso
 * mais importante). Tipo sem entrada aqui (ex.: sync_warning/system) cai no
 * padrão de venda normal.
 */
const DURACAO_MS: Partial<Record<string, number>> = {
  sale_paid: 8000,
  sale_high_value: 12000,
  sale_low_margin: 10000,
  sale_negative_margin: 15000,
  sale_cancelled: 12000,
  return_completed: 12000,
  return_opened: 12000,
  task_assigned: 10000,
  task_due: 12000,
};
const DURACAO_PADRAO = 8000;

type Acao =
  | { tipo: "chegou"; novo: NovoToast<ForegroundPushEvent>; agora: number; cfg: ConfigDeToasts }
  | { tipo: "dispensar"; id: string; agora: number; cfg: ConfigDeToasts }
  | { tipo: "pausar"; id: string; agora: number }
  | { tipo: "retomar"; id: string; agora: number }
  | { tipo: "passar"; agora: number; cfg: ConfigDeToasts }
  | { tipo: "suspender"; agora: number }
  | { tipo: "retomarSuspensos"; agora: number };

/**
 * PURO: o instante vem na ação, nunca de `Date.now()` aqui dentro, e nada é
 * mutado. O React pode executar este redutor mais de uma vez (Strict Mode faz de
 * propósito) e o resultado tem que ser o mesmo — era exatamente o que a versão
 * com `filaRef.current.push` dentro do atualizador não garantia.
 */
function reduzir(e: EstadoDeToasts<ForegroundPushEvent>, a: Acao): EstadoDeToasts<ForegroundPushEvent> {
  switch (a.tipo) {
    // O limite pode ter mudado (girou o celular): aplica antes de tratar a ação.
    case "chegou": return chegou(ajustarLimite(e, a.agora, a.cfg), a.novo, a.agora, a.cfg);
    case "dispensar": return dispensar(ajustarLimite(e, a.agora, a.cfg), a.id, a.agora, a.cfg);
    case "pausar": return pausar(e, a.id, a.agora);
    case "retomar": return retomar(e, a.id, a.agora);
    case "passar": return passar(ajustarLimite(e, a.agora, a.cfg), a.agora, a.cfg);
    case "suspender": return suspender(e, a.agora);
    case "retomarSuspensos": return retomarSuspensos(e, a.agora);
  }
}

const CONSULTA_CELULAR = "(max-width: 640px)";

/** Há um diálogo aberto? O Modal marca o <body> (ver `sinalizarModalAberto`). */
function modalEstaAberto(): boolean {
  return document.body.hasAttribute("data-modal-aberto");
}

/** Avisa quando o <body> ganha ou perde a marca de diálogo aberto. */
function observarModal(aoMudar: (aberto: boolean) => void): () => void {
  const obs = new MutationObserver(() => aoMudar(modalEstaAberto()));
  obs.observe(document.body, { attributes: true, attributeFilter: ["data-modal-aberto"] });
  return () => obs.disconnect();
}

/** Celular? Lido do navegador por useSyncExternalStore — sem estado espelhado nem efeito. */
function useCelular(): boolean {
  return useSyncExternalStore(
    (avisar) => {
      const m = window.matchMedia(CONSULTA_CELULAR);
      m.addEventListener("change", avisar);
      return () => m.removeEventListener("change", avisar);
    },
    () => window.matchMedia(CONSULTA_CELULAR).matches,
    () => false,
  );
}

/**
 * Os toasts de primeiro plano.
 *
 * É REMONTADO a cada troca de conta (a `key` abaixo): fila, ids vistos e prazos
 * são da pessoa que estava na tela, e nada disso pode aparecer pra próxima.
 */
export function SaleNotificationProvider({ onNavigate }: { onNavigate: (deepLink: string) => void }) {
  const { user } = useAuth();
  return <Toasts key={user?.email ?? "sem-sessao"} onNavigate={onNavigate} />;
}

function Toasts({ onNavigate }: { onNavigate: (deepLink: string) => void }) {
  const [estado, dispatch] = useReducer(reduzir, undefined, () => estadoInicial<ForegroundPushEvent>());
  const celular = useCelular();

  // No celular, um toast principal e um contador do resto — três empilhados cobririam a tela.
  const cfg = useMemo<ConfigDeToasts>(() => ({ ...CONFIG_PADRAO, maxVisiveis: celular ? 1 : CONFIG_PADRAO.maxVisiveis }), [celular]);

  /**
   * ─── FORMULÁRIO ABERTO: OS AVISOS ESPERAM ────────────────────────────
   *
   * A região de toasts tinha z-index acima do modal: dez vendas chegando enquanto
   * se editava um custo cobriam o título, o campo ativo e o botão de salvar. Agora,
   * com um diálogo aberto, os prazos congelam e a região some; ao fechar, os avisos
   * voltam de onde pararam. O que a fila descartar segue na Central (🔔).
   */
  useEffect(() => {
    if (modalEstaAberto()) dispatch({ tipo: "suspender", agora: Date.now() });
    return observarModal((aberto) => {
      dispatch(aberto ? { tipo: "suspender", agora: Date.now() } : { tipo: "retomarSuspensos", agora: Date.now() });
    });
  }, []);

  useEffect(() => {
    return onForegroundPush((evt) => {
      dispatch({
        tipo: "chegou", agora: Date.now(), cfg,
        novo: {
          // Sem eventId (payload incompleto), a tag + o instante ainda dão uma identidade estável.
          id: evt.eventId || `${evt.tag}-${evt.timestamp}`,
          tag: evt.tag,
          dados: evt,
          prioridade: prioridadeDoTipo(evt.type),
          duracaoMs: DURACAO_MS[evt.type] ?? DURACAO_PADRAO,
        },
      });
    });
  }, [cfg]);

  // UM temporizador, apontado pro prazo mais próximo. Só é recriado quando esse prazo muda —
  // antes, qualquer mudança na lista recriava o de TODOS e os toasts ganhavam tempo de novo.
  const prazo = proximoPrazo(estado, cfg);
  useEffect(() => {
    if (prazo == null) return;
    const t = setTimeout(() => dispatch({ tipo: "passar", agora: Date.now(), cfg }), Math.max(0, prazo - Date.now()));
    return () => clearTimeout(t);
  }, [prazo, cfg]);

  // O limite é aplicado também na renderização: girar o celular esconde o excesso na hora,
  // e o redutor o devolve à fila na próxima ação.
  const visiveis = estado.visiveis.slice(0, cfg.maxVisiveis);
  const escondidos = estado.visiveis.length - visiveis.length + estado.fila.length;

  if (visiveis.length === 0) return null;

  return (
    <div className="sale-toast-region" aria-label="Notificações" data-suspensa={estado.suspenso ? "true" : undefined}>
      {visiveis.map((t) => (
        <SaleNotificationToast
          key={t.id}
          event={t.dados}
          onClose={() => dispatch({ tipo: "dispensar", id: t.id, agora: Date.now(), cfg })}
          onNavigate={(link) => { onNavigate(link); dispatch({ tipo: "dispensar", id: t.id, agora: Date.now(), cfg }); }}
          onPausar={() => dispatch({ tipo: "pausar", id: t.id, agora: Date.now() })}
          onRetomar={() => dispatch({ tipo: "retomar", id: t.id, agora: Date.now() })}
        />
      ))}
      {escondidos > 0 && (
        <div className="sale-toast-mais" role="status" style={{ pointerEvents: "auto", fontSize: ".75rem", color: "var(--muted)", textAlign: "center", padding: "2px 0" }}>
          + {escondidos} {escondidos === 1 ? "aviso" : "avisos"} — veja na 🔔
        </div>
      )}
    </div>
  );
}
