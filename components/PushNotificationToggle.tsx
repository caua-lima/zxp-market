"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { useAccess } from "@/components/tabs/AccessGuard";
import { authedFetch } from "@/lib/api/authed-fetch";
import {
  aguardarRecebimento,
  aoMudarVinculoDoPush,
  coletarDiagnosticoLocal,
  disablePushNotifications,
  enablePushNotifications,
  getDeviceId,
  getPushStatus,
  precisaDeOrientacaoIOS,
} from "@/lib/firebase/push";
import {
  montarDiagnostico,
  type DiagnosticoLocal,
  type DiagnosticoServidor,
  type SecaoDoDiagnostico,
} from "@/lib/domain/diagnostico-push";
import NotificationSettings from "@/components/NotificationSettings";
import Modal from "@/components/Modal";

const CENARIOS: { id: string; label: string }[] = [
  { id: "sale_paid", label: "Venda padrão" },
  { id: "sale_high_value", label: "Venda de alto valor" },
  { id: "sale_low_margin", label: "Venda com margem baixa" },
  { id: "sale_negative_margin", label: "Venda com prejuízo" },
  { id: "sale_cancelled", label: "Cancelamento" },
  { id: "return_completed", label: "Devolução concluída" },
  { id: "sales_summary", label: "Resumo agrupado" },
  { id: "unavailable", label: "Dados financeiros indisponíveis" },
];

type ResultadoTeste = {
  ok: boolean;
  scenario: string;
  eventId?: string;
  title?: string; body?: string; horario?: string;
  resultado?: "aceito" | "pendente" | "suprimido" | "falha" | "sem_registro";
  explicacao?: string;
  error?: string;
};

/** O que o SERVICE WORKER deste aparelho viu do push do teste. */
type Observacao =
  | { estado: "aguardando" }
  | { estado: "exibido"; em: number }
  | { estado: "recebido_sem_exibir"; erro: string }
  | { estado: "nao_observado" };

const COR_DO_NIVEL: Record<SecaoDoDiagnostico["nivel"], string> = {
  ok: "var(--green)",
  atencao: "var(--warning)",
  problema: "var(--red)",
  desconhecido: "var(--muted)",
};

/**
 * Botão pra ligar/desligar notificação de venda NESTE dispositivo, mais um
 * menu único com os cenários de teste e o atalho pra configurações — os
 * dois viviam em botões separados, e somados ao sino da Central de
 * Notificações (componente irmão, no topbar) a barra ficava com dois ícones
 * de sino visualmente idênticos e sem espaço pra todo mundo no celular
 * (ver globals.css .topbar-actions). Reduzido pra 2 botões: o toggle em si
 * (ícone de aparelho, não de sino — não é a Central, é "neste dispositivo")
 * e um "⋯" que abre tanto o teste quanto as configurações.
 *
 * Tem um indicador visual sempre visível (a bolinha no canto do ícone)
 * porque o rótulo de texto some no celular pra não estourar a barra — sem a
 * bolinha, não sobraria nenhum jeito de ver o estado lá.
 */
export function PushNotificationToggle() {
  const { user } = useAuth();
  const { isOwner } = useAccess();
  const [status, setStatus] = useState<"unsupported" | "off" | "on" | "denied" | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [menuAberto, setMenuAberto] = useState(false);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoTeste | null>(null);
  const [observacao, setObservacao] = useState<Observacao | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [diagnosticando, setDiagnosticando] = useState(false);
  const [diagnostico, setDiagnostico] = useState<{ secoes: SecaoDoDiagnostico[]; bruto: Record<string, unknown> } | null>(null);
  const [admin, setAdmin] = useState<{ carregando: boolean; dados: Record<string, unknown> | null } | null>(null);

  // O estado é DA PESSOA na tela neste aparelho: recalcula quando ela muda e
  // quando o registro é reconciliado (login, troca de conta, token rodado).
  const emailAtual = user?.email ?? null;
  useEffect(() => {
    let vivo = true;
    const atualizar = () => { getPushStatus(emailAtual).then((s) => { if (vivo) setStatus(s); }); };
    atualizar();
    const solta = aoMudarVinculoDoPush(atualizar);
    return () => { vivo = false; solta(); };
  }, [emailAtual]);

  async function toggle() {
    if (!user?.email || busy) return;
    setBusy(true);
    setError("");
    setResultado(null);
    try {
      if (status === "on") {
        const res = await disablePushNotifications(user.email.toLowerCase());
        if (res.ok) {
          setStatus("off");
          if (res.pendente) setError("Desativado neste aparelho. O servidor será atualizado quando houver conexão.");
        } else {
          // Continua ativo: dizer "desligado" com o registro ainda no servidor
          // era o que fazia o push seguir chegando depois de a pessoa desligar.
          setError(res.error);
        }
      } else {
        const res = await enablePushNotifications(user.email.toLowerCase());
        if (res.ok) {
          setStatus("on");
        } else {
          setError(res.error);
          setStatus(await getPushStatus(user.email));
        }
      }
    } finally {
      setBusy(false);
    }
  }

  /**
   * Diagnóstico por CAMADA: aparelho, vínculo, conta, outros aparelhos, servidor e
   * o que este aparelho observou. Cada uma diz o que sabe e o que não sabe — e
   * nenhuma manda reinstalar como primeiro passo (isso apaga o armazenamento do
   * aparelho e não corrige erro do servidor).
   */
  async function rodarDiagnostico() {
    if (diagnosticando || !user?.email) return;
    setDiagnosticando(true);
    setMenuAberto(false);
    try {
      const local: DiagnosticoLocal = await coletarDiagnosticoLocal(user.email);
      let servidor: DiagnosticoServidor | null = null;
      try {
        const res = await authedFetch(`/api/push/diagnostico?deviceId=${encodeURIComponent(getDeviceId())}`, { cache: "no-store" });
        if (res.ok) servidor = (await res.json()) as DiagnosticoServidor;
        // 403: o servidor recusou por falta de acesso — é uma resposta, e é a certa.
        else if (res.status === 403) servidor = { acesso: "sem_acesso", preferencias: "ausente", aparelhos: { total: 0, esteRegistrado: null }, ultimosEnvios: [] };
      } catch { /* sem resposta: as camadas do servidor ficam "desconhecido" */ }
      setDiagnostico({ secoes: montarDiagnostico(local, servidor), bruto: { aparelho: local, servidor } });
    } catch (err) {
      setDiagnostico({
        secoes: [{ id: "aparelho", titulo: "Diagnóstico", nivel: "desconhecido", linhas: [err instanceof Error ? err.message : "Falha ao diagnosticar."] }],
        bruto: {},
      });
    } finally {
      setDiagnosticando(false);
    }
  }

  /** Só o dono: o diagnóstico da CADEIA de vendas (webhook do ML, cron, aparelhos do time). Não é sobre este aparelho. */
  async function rodarDiagnosticoDoSistema() {
    setAdmin({ carregando: true, dados: null });
    try {
      const res = await authedFetch("/api/ml/diagnostico-push", { cache: "no-store" });
      setAdmin({ carregando: false, dados: res.ok ? await res.json() : { erro: `HTTP ${res.status}` } });
    } catch {
      setAdmin({ carregando: false, dados: { erro: "sem resposta" } });
    }
  }

  /**
   * Dispara um push de TESTE — só pro aparelho que você está usando —, e mostra o
   * que aconteceu com ESSE aparelho: o que o servidor fez, e depois o que o
   * aparelho observou (o Service Worker recebeu? exibiu?). Não é uma venda: é um
   * aviso do tipo "teste", marcado como TESTE, que não vai pra Central do time.
   */
  async function testarCenario(scenario: string) {
    if (enviando) return;
    setEnviando(scenario);
    setMenuAberto(false);
    setObservacao(null);
    try {
      const res = await authedFetch("/api/push/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario, deviceId: getDeviceId() }),
      });
      const json = (await res.json().catch(() => null)) as ResultadoTeste | null;
      setResultado(json ?? { ok: false, scenario, error: "Resposta inválida" });

      // O servidor só sabe que o Firebase ACEITOU. Quem sabe se chegou é o aparelho.
      if (json?.ok && json.resultado === "aceito" && json.eventId) {
        setObservacao({ estado: "aguardando" });
        const visto = await aguardarRecebimento(json.eventId);
        setObservacao(!visto ? { estado: "nao_observado" }
          : visto.erro ? { estado: "recebido_sem_exibir", erro: visto.erro }
          : { estado: "exibido", em: visto.exibidoEm ?? visto.recebidoEm });
      }
    } catch (err) {
      setResultado({ ok: false, scenario, error: err instanceof Error ? err.message : "Falha ao enviar" });
    } finally {
      setEnviando(null);
      // Sem auto-fechar: é um Modal de verdade (não a caixinha flutuante de antes,
      // que sumia sozinha em 12s e podia levar o usuário a achar que "não apareceu
      // nada" quando na real só piscou rápido demais). Fecha só quando tocar em "Fechar".
    }
  }

  if (status === "unsupported" || status === "loading") return null;

  // 📱, não 🔔 — o sino já é o ícone da Central de Notificações (histórico
  // de vendas/alertas). Este botão é sobre ESTE aparelho especificamente;
  // usar o mesmo glifo dos dois lado a lado parecia um sino duplicado.
  const icone = status === "denied" ? "🔕" : "📱";
  const texto = status === "on" ? "Notificações ativas" : status === "denied" ? "Bloqueado" : "Ativar notificações";
  const title = status === "denied"
    ? "Notificações bloqueadas nas configurações do navegador/site — libere lá antes de tentar de novo."
    : status === "on"
      ? "Você recebe uma notificação neste dispositivo a cada venda nova. Clique pra desativar."
      : "Ativa notificação neste dispositivo toda vez que sair uma venda nova.";

  // Cor da bolinha: verde = ativo, vermelho = bloqueado, cinza = ainda não ativado.
  const corBolinha = status === "on" ? "var(--green)" : status === "denied" ? "var(--red)" : "var(--muted)";

  const veredito = resultado?.resultado;
  const corDoVeredito = veredito === "aceito" ? "var(--green)" : veredito === "pendente" ? "var(--warning)" : "var(--red)";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ position: "relative" }}>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={toggle}
          disabled={busy || status === "denied"}
          title={title}
          aria-label={`${texto} — clique pra ${status === "on" ? "desativar" : "ativar"}`}
        >
          {busy ? "…" : (
            <>
              <span style={{ position: "relative", display: "inline-flex" }}>
                <span aria-hidden>{icone}</span>
                {/* Indicador sempre visível — sobrevive ao rótulo de texto
                    sumindo no celular (.push-label, ver globals.css). */}
                <span
                  aria-hidden
                  style={{
                    position: "absolute", bottom: -2, right: -2, width: 7, height: 7,
                    borderRadius: "50%", background: corBolinha, border: "1.5px solid var(--surface)",
                  }}
                />
              </span>
              <span className="push-label">{texto}</span>
            </>
          )}
        </button>
        {error && (
          <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 6, fontSize: ".75rem", color: "var(--red-text)", width: 220, textAlign: "right", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", zIndex: 20 }}>
            {error}
          </div>
        )}
      </div>

      <div style={{ position: "relative" }}>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={() => setMenuAberto(true)}
          disabled={!!enviando}
          title="Testar notificação e configurações"
          aria-label="Mais ações de notificação"
          aria-expanded={menuAberto}
        >
          {enviando ? "…" : "⋯"}
        </button>
      </div>

      {/* Modal em vez de dropdown ancorado no botão: no celular, a barra de
          ações do topo tem overflow-x:auto (pra poder rolar quando não cabe
          tudo) — e por regra do CSS, definir overflow só num eixo faz o
          navegador cortar o outro eixo também (overflow-y vira "auto"
          escondido). O menu abria, mas ficava CORTADO pelo container,
          invisível mesmo estando no DOM. Modal usa position:fixed, que
          escapa desse corte. */}
      {menuAberto && (
        <Modal open onClose={() => setMenuAberto(false)}>
          <div className="modal-title">Notificações</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
            {/* iOS: o web push só existe no app instalado E pede um gesto na hora de ativar (WebKit). */}
            {precisaDeOrientacaoIOS() && (
              <div role="note" style={{ fontSize: ".8rem", lineHeight: 1.5, padding: "10px 12px", borderRadius: 8, background: "var(--surface-raised,var(--surface2))", borderLeft: "3px solid var(--warning)" }}>
                <b>iPhone/iPad:</b> as notificações só funcionam com o app na Tela de Início. Toque em Compartilhar →
                <i> Adicionar à Tela de Início</i>, abra o app por lá e toque em 📱 — o iOS só permite ativar
                notificações a partir de um toque seu dentro do app instalado (iOS 16.4 ou superior).
              </div>
            )}
            <button
              type="button"
              onClick={() => testarCenario("sale_paid")}
              disabled={!!enviando}
              className="btn btn-warning"
              style={{ justifyContent: "flex-start" }}
            >
              {enviando === "sale_paid" ? "Enviando…" : "🔔 Testar agora"}
            </button>
            <div style={{ fontSize: ".78rem", color: "var(--muted)", lineHeight: 1.4 }}>
              O teste vai só pra ESTE aparelho, aparece marcado como TESTE e não entra na Central do time.
              {status !== "on" && " Este aparelho ainda não está ativo — o teste roda mesmo assim e diz o motivo se não chegar."}
            </div>

            <div style={{ fontSize: ".75rem", fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--muted)", marginTop: 8 }}>
              Ver como fica cada tipo de aviso
            </div>
            {CENARIOS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => testarCenario(c.id)}
                disabled={!!enviando}
                className="btn btn-ghost"
                style={{ justifyContent: "flex-start" }}
              >
                {enviando === c.id ? "Enviando…" : c.label}
              </button>
            ))}

            <hr className="config-sep" style={{ margin: "4px 0" }} />
            <button
              type="button"
              onClick={rodarDiagnostico}
              disabled={diagnosticando}
              className="btn btn-ghost"
              style={{ justifyContent: "flex-start" }}
            >
              {diagnosticando ? "Verificando…" : "🩺 Diagnosticar notificações"}
            </button>
            <button
              type="button"
              onClick={() => { setMenuAberto(false); setSettingsOpen(true); }}
              className="btn btn-ghost"
              style={{ justifyContent: "flex-start" }}
            >
              ⚙ Configurações
            </button>
          </div>
          <div className="modal-btns">
            <button type="button" className="btn btn-ghost" onClick={() => setMenuAberto(false)}>Fechar</button>
          </div>
        </Modal>
      )}

      {/* Modal em vez de caixinha flutuante perto do botão: no celular, com a
          barra de topo lotada, uma caixinha ancorada no botão facilmente saía
          da tela ou ficava atrás de outro elemento — resultado do teste
          parecia "não aparece nada" mesmo quando o servidor respondeu certo. */}
      {resultado && (
        <Modal open onClose={() => { setResultado(null); setObservacao(null); }}>
          <div className="modal-title">{resultado.ok ? "Resultado do teste" : "Falha no teste"}</div>
          {resultado.ok ? (
            <div style={{ fontSize: ".88rem", lineHeight: 1.6 }}>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontWeight: 700 }}>{resultado.title}</div>
                <div style={{ color: "var(--muted)" }}>{resultado.body}</div>
              </div>

              <div style={{ padding: "10px 12px", borderRadius: 8, marginBottom: 10, border: `1px solid ${corDoVeredito}`, borderLeftWidth: 3 }}>
                <div style={{ fontWeight: 700, color: corDoVeredito }}>
                  {veredito === "aceito" ? "O servidor entregou ao Firebase"
                    : veredito === "pendente" ? "O Firebase não aceitou ainda"
                    : veredito === "suprimido" ? "O servidor não enviou"
                    : veredito === "sem_registro" ? "Este aparelho não está registrado"
                    : "O envio falhou"}
                </div>
                <div style={{ marginTop: 4 }}>{resultado.explicacao}</div>
              </div>

              {/* O que ESTE APARELHO viu. É a única prova de que chegou — o servidor só sabe que o Firebase aceitou. */}
              {observacao?.estado === "aguardando" && (
                <div role="status" style={{ color: "var(--muted)", fontSize: ".84rem" }}>Aguardando este aparelho confirmar o recebimento…</div>
              )}
              {observacao?.estado === "exibido" && (
                <div role="status" style={{ color: "var(--green)", fontSize: ".84rem", fontWeight: 600 }}>
                  ✓ O Service Worker deste aparelho recebeu e exibiu a notificação às {new Date(observacao.em).toLocaleTimeString("pt-BR")}.
                </div>
              )}
              {observacao?.estado === "recebido_sem_exibir" && (
                <div role="alert" style={{ color: "var(--red-text)", fontSize: ".84rem" }}>
                  O aparelho recebeu, mas o sistema não deixou exibir ({observacao.erro}). Confira a permissão de notificações do app nas configurações do sistema.
                </div>
              )}
              {observacao?.estado === "nao_observado" && (
                <div role="status" style={{ color: "var(--warning)", fontSize: ".84rem" }}>
                  O Firebase aceitou, mas este aparelho não registrou o recebimento em 12 s. Pode ter demorado (rede, economia de bateria) ou
                  o Service Worker está antigo — rode 🩺 Diagnosticar antes de qualquer outra coisa.
                </div>
              )}

              {resultado.horario && <div style={{ color: "var(--muted)", fontSize: ".8rem", marginTop: 8 }}>{new Date(resultado.horario).toLocaleTimeString("pt-BR")}</div>}
            </div>
          ) : (
            <div style={{ fontSize: ".88rem", color: "var(--red-text)", lineHeight: 1.6 }}>Falha ao enviar: {resultado.error}</div>
          )}
          <div className="modal-btns">
            <button type="button" className="btn btn-ghost" onClick={() => { setResultado(null); setObservacao(null); }}>Fechar</button>
          </div>
        </Modal>
      )}

      {diagnostico && (
        <Modal open onClose={() => { setDiagnostico(null); setAdmin(null); }}>
          <div className="modal-title">Diagnóstico das notificações</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
            {diagnostico.secoes.map((s) => (
              <div
                key={s.id}
                style={{
                  padding: "10px 12px", borderRadius: 8, fontSize: ".84rem", lineHeight: 1.55,
                  background: "var(--surface-raised,var(--surface2))",
                  borderLeft: `3px solid ${COR_DO_NIVEL[s.nivel]}`,
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 2 }}>
                  {s.nivel === "ok" ? "✓ " : s.nivel === "problema" ? "✕ " : s.nivel === "atencao" ? "⚠ " : "? "}{s.titulo}
                </div>
                {s.linhas.map((l, i) => <div key={i}>{l}</div>)}
              </div>
            ))}
          </div>

          {isOwner && (
            <div style={{ marginTop: 12 }}>
              <button type="button" className="btn btn-ghost btn-xs" onClick={rodarDiagnosticoDoSistema} disabled={admin?.carregando}>
                {admin?.carregando ? "Consultando…" : "Diagnóstico do sistema (webhook do ML, cron, time) — administrador"}
              </button>
              {admin?.dados && (
                <pre style={{ marginTop: 8, maxHeight: 220, overflow: "auto", fontSize: ".75rem", background: "var(--surface)", padding: 10, borderRadius: 8, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {JSON.stringify(admin.dados, null, 2)}
                </pre>
              )}
            </div>
          )}

          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", color: "var(--muted)", fontSize: ".82rem" }}>
              Dados completos (pra copiar num relato)
            </summary>
            <pre style={{
              marginTop: 8, maxHeight: 260, overflow: "auto", fontSize: ".75rem",
              background: "var(--surface)", padding: 10, borderRadius: 8, whiteSpace: "pre-wrap", wordBreak: "break-word",
            }}>
              {JSON.stringify(diagnostico.bruto, null, 2)}
            </pre>
          </details>
          <div className="modal-btns">
            <button type="button" className="btn btn-ghost" onClick={() => { setDiagnostico(null); setAdmin(null); }}>Fechar</button>
          </div>
        </Modal>
      )}

      <NotificationSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
