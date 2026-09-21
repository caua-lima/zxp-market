"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { useAuth } from "@/lib/firebase/auth-context";
import { saveNotificationPreferences, watchNotificationPreferences } from "@/lib/firebase/data";
import {
  CRITICAL_NOTIFICATION_TYPES,
  DEFAULT_NOTIFICATION_PREFERENCES,
  FUSO_DA_OPERACAO,
  interpretarPreferencias,
  type NotificationPreferences,
  type NotificationTogglesKey,
} from "@/lib/domain/notification-preferences";

const TOGGLE_LABEL: Record<NotificationTogglesKey, string> = {
  sale_paid: "Venda padrão",
  sale_high_value: "Venda de alto valor",
  sale_low_margin: "Venda com margem baixa",
  sale_negative_margin: "Venda com prejuízo estimado",
  sale_cancelled: "Pedido cancelado",
  return_opened: "Devolução aberta",
  return_completed: "Devolução concluída",
  sales_summary: "Resumo de vendas agrupadas",
  sync_warning: "Alertas de sincronização",
  task_assigned: "Tarefas: atribuídas a mim e prazos",
  stock_low: "Full no mínimo (agendar coleta)",
  milestone: "Marcos e conquistas 🏆",
};

/** Os fusos oferecidos: os do Brasil e Lisboa. Qualquer nome IANA válido gravado antes continua funcionando. */
const FUSOS: { id: string; rotulo: string }[] = [
  { id: "America/Sao_Paulo", rotulo: "Brasília (São Paulo, Rio, Belo Horizonte…)" },
  { id: "America/Manaus", rotulo: "Amazonas (Manaus)" },
  { id: "America/Cuiaba", rotulo: "Mato Grosso (Cuiabá)" },
  { id: "America/Fortaleza", rotulo: "Nordeste (Fortaleza, Recife, Salvador)" },
  { id: "America/Rio_Branco", rotulo: "Acre (Rio Branco)" },
  { id: "America/Noronha", rotulo: "Fernando de Noronha" },
  { id: "Europe/Lisbon", rotulo: "Lisboa" },
];

/** Os tipos que atravessam o silêncio, em português — vem da MESMA lista que o servidor usa. */
const CRITICOS_EM_TEXTO = [...CRITICAL_NOTIFICATION_TYPES]
  .map((t) => ({ sale_negative_margin: "venda com prejuízo", sale_cancelled: "pedido cancelado", return_completed: "devolução concluída" } as Record<string, string>)[t])
  .filter(Boolean)
  .join(", ");

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/**
 * Área de configurações de notificação — o botão "⚙" no sino/toggle abre
 * isto. Cada usuário (owner e colaborador) tem a própria preferência,
 * gravada em usuarios/{uid}/preferences/notifications e aplicada pelo
 * backend na hora de decidir quem recebe cada push (ver
 * lib/notification-preferences.ts). Sem preferência salva ainda, os campos
 * já nascem preenchidos com o DEFAULT — mudar aqui é sempre uma escolha
 * explícita, nunca some nada por padrão.
 */
export default function NotificationSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  /** A leitura falhou: NÃO se sabe o que está salvo, então salvar por cima seria apagar às cegas. */
  const [erroDeLeitura, setErroDeLeitura] = useState(false);
  const [erroAoSalvar, setErroAoSalvar] = useState("");
  /** Campos salvos que estavam inválidos e voltaram ao padrão. */
  const [camposCorrigidos, setCamposCorrigidos] = useState<string[]>([]);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    if (!open || !user?.uid) return;
    const unsub = watchNotificationPreferences(user.uid, (data) => {
      // A MESMA validação que o servidor aplica ao enviar: o que a tela mostra é o que vale.
      const leitura = interpretarPreferencias(data);
      setPrefs(leitura.prefs);
      setCamposCorrigidos(leitura.estado === "invalida" ? leitura.problemas : []);
      setErroDeLeitura(false);
      setLoaded(true);
    }, () => setErroDeLeitura(true));
    return unsub;
  }, [open, user?.uid, tentativa]);

  function toggle(key: NotificationTogglesKey) {
    setPrefs((p) => ({ ...p, toggles: { ...p.toggles, [key]: !p.toggles[key] } }));
  }

  async function salvar() {
    if (!user?.uid) return;
    setSaving(true);
    setErroAoSalvar("");
    try {
      // Só grava o que passa na validação — campo inválido nunca chega ao banco.
      const valida = interpretarPreferencias(prefs);
      await saveNotificationPreferences(user.uid, valida.prefs);
      onClose();
    } catch {
      // Antes o erro sumia: o modal ficava aberto sem dizer que nada foi salvo.
      setErroAoSalvar("Não consegui salvar agora. Suas alterações continuam aqui — tente de novo.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} wide>
      <div className="modal-title">Configurações de notificação</div>
      <div className="modal-sub">Só valem pra você — cada pessoa configura as suas.</div>

      {erroDeLeitura ? (
        <div role="alert" style={{ padding: 16, display: "grid", gap: 10 }}>
          <div style={{ color: "var(--red)", fontWeight: 600 }}>Não consegui ler suas preferências.</div>
          <div className="hint">
            Sem isso não dá pra mostrar o que você configurou — e salvar agora apagaria as suas escolhas sem
            você ver. Confira a conexão e tente de novo. Enquanto isso, o servidor segue usando o que está salvo.
          </div>
          <div className="modal-btns">
            <button type="button" className="btn btn-warning" onClick={() => { setErroDeLeitura(false); setLoaded(false); setTentativa((n) => n + 1); }}>Tentar de novo</button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Fechar</button>
          </div>
        </div>
      ) : !loaded ? (
        <div style={{ padding: 20, textAlign: "center", color: "var(--muted)" }}>Carregando…</div>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          {camposCorrigidos.length > 0 && (
            <div role="status" className="hint" style={{ color: "var(--warning)" }}>
              Alguns campos salvos estavam inválidos e voltaram ao padrão ({camposCorrigidos.join(", ")}). Salvar corrige de vez.
            </div>
          )}
          <div>
            <div className="config-section-title">Quais avisos você quer receber</div>
            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              {(Object.keys(TOGGLE_LABEL) as NotificationTogglesKey[]).map((key) => (
                <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: ".86rem", cursor: "pointer" }}>
                  <input type="checkbox" checked={prefs.toggles[key]} onChange={() => toggle(key)} />
                  {TOGGLE_LABEL[key]}
                </label>
              ))}
            </div>
          </div>

          <hr className="config-sep" />

          <div className="config-field" style={{ margin: 0 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={prefs.onlyCritical} onChange={() => setPrefs((p) => ({ ...p, onlyCritical: !p.onlyCritical }))} />
              Somente notificações críticas (prejuízo, cancelamento, devolução)
            </label>
            <div className="hint">Com isto ativo, o resto acima ainda aparece na Central, só não vira push. Os críticos são: {CRITICOS_EM_TEXTO}.</div>
          </div>

          <div className="config-field" style={{ margin: 0 }}>
            <label>Venda de alto valor a partir de (R$)</label>
            <input
              type="number" min="0" step="10" value={prefs.highValueThreshold}
              onChange={(e) => setPrefs((p) => ({ ...p, highValueThreshold: parseFloat(e.target.value) || 0 }))}
            />
            <div className="hint">
              Vale só pra você, e só pro <b>push</b>: uma venda desse valor pra cima chega como &quot;alto valor&quot;
              (e segue o seu toggle de alto valor); abaixo disso chega como venda comum. A Central guarda a
              classificação da operação e não muda.
            </div>
          </div>

          <div className="config-field" style={{ margin: 0 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={prefs.groupFastSales} onChange={() => setPrefs((p) => ({ ...p, groupFastSales: !p.groupFastSales }))} />
              Agrupar vendas rápidas (4+ em pouco tempo viram um resumo só)
            </label>
            <div className="hint">
              Ligado: as 3 primeiras vendas de uma rajada (90 s) chegam uma a uma; da 4ª em diante você recebe um
              resumo — que é atualizado com o número final quando a rajada termina. Desligado: cada venda chega
              sozinha. Precisa de &quot;Resumo de vendas agrupadas&quot; ligado acima.
            </div>
          </div>

          <div className="config-field" style={{ margin: 0 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={prefs.showFinancialValuesInPush} onChange={() => setPrefs((p) => ({ ...p, showFinancialValuesInPush: !p.showFinancialValuesInPush }))} />
              Mostrar valores financeiros no push
            </label>
            <div className="hint">
              Desligado, o push traz só o aviso (&quot;Nova venda confirmada&quot; e o produto), sem valor, lucro nem margem —
              é o que aparece na tela de bloqueio. Dentro do app você continua vendo tudo.
            </div>
          </div>

          <hr className="config-sep" />
          <div className="config-section-title">Horário silencioso</div>
          <div className="config-field" style={{ margin: 0 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={prefs.quietHoursEnabled} onChange={() => setPrefs((p) => ({ ...p, quietHoursEnabled: !p.quietHoursEnabled }))} />
              Ativar horário silencioso
            </label>
            <div className="hint">
              Dentro do horário, os avisos comuns <b>não viram push</b> — eles ficam só na Central e{" "}
              <b>não são reenviados</b> depois. Não há fila esperando o fim do silêncio.
            </div>
          </div>
          {prefs.quietHoursEnabled && (
            <>
              <div className="form-grid">
                <div className="config-field" style={{ margin: 0 }}>
                  <label>Início</label>
                  <input type="time" value={prefs.quietHoursStart} onChange={(e) => setPrefs((p) => ({ ...p, quietHoursStart: e.target.value }))} />
                </div>
                <div className="config-field" style={{ margin: 0 }}>
                  <label>Fim</label>
                  <input type="time" value={prefs.quietHoursEnd} onChange={(e) => setPrefs((p) => ({ ...p, quietHoursEnd: e.target.value }))} />
                </div>
              </div>
              {prefs.quietHoursStart === prefs.quietHoursEnd && (
                <div role="status" className="hint" style={{ color: "var(--warning)" }}>
                  Início e fim iguais não silenciam nada. Para cobrir a noite, use por exemplo 22:30 → 07:30.
                </div>
              )}
              <div className="config-field" style={{ margin: 0 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input
                    type="checkbox" checked={prefs.quietHoursCriticalBypass}
                    onChange={() => setPrefs((p) => ({ ...p, quietHoursCriticalBypass: !p.quietHoursCriticalBypass }))}
                  />
                  Avisos críticos atravessam o silêncio
                </label>
                <div className="hint">Críticos: {CRITICOS_EM_TEXTO}. Se você desligou o aviso daquele tipo lá em cima, ele não chega nem assim.</div>
              </div>
              <div className="config-field" style={{ margin: 0 }}>
                <label>Fuso do horário</label>
                <select
                  value={prefs.quietHoursTimezone}
                  onChange={(e) => setPrefs((p) => ({ ...p, quietHoursTimezone: e.target.value }))}
                >
                  {!FUSOS.some((f) => f.id === prefs.quietHoursTimezone) && (
                    <option value={prefs.quietHoursTimezone}>{prefs.quietHoursTimezone}</option>
                  )}
                  {FUSOS.map((f) => <option key={f.id} value={f.id}>{f.rotulo}{f.id === FUSO_DA_OPERACAO ? " — padrão" : ""}</option>)}
                </select>
              </div>
              <div className="config-field" style={{ margin: 0 }}>
                <label>Dias em que a noite COMEÇA</label>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {DIAS.map((label, idx) => (
                    <label key={idx} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: ".82rem", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={prefs.quietHoursDays.includes(idx)}
                        onChange={() => setPrefs((p) => ({
                          ...p,
                          quietHoursDays: p.quietHoursDays.includes(idx) ? p.quietHoursDays.filter((d) => d !== idx) : [...p.quietHoursDays, idx],
                        }))}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          {erroAoSalvar && <div role="alert" style={{ color: "var(--red)", fontSize: ".85rem" }}>{erroAoSalvar}</div>}
          <div className="modal-btns">
            <button type="button" className="btn btn-success" onClick={salvar} disabled={saving}>{saving ? "Salvando…" : "Salvar preferências"}</button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
