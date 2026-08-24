"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { useAuth } from "@/lib/firebase/auth-context";
import { saveNotificationPreferences, watchNotificationPreferences } from "@/lib/firebase/data";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
  type NotificationTogglesKey,
} from "@/lib/domain/notification-preferences";

const TOGGLE_LABEL: Record<NotificationTogglesKey, string> = {
  sale_paid: "Venda padrão",
  sale_high_value: "Venda de alto valor",
  sale_low_margin: "Venda com margem baixa",
  sale_negative_margin: "Venda com prejuízo estimado",
  sale_cancelled: "Pedido cancelado",
  return_completed: "Devolução concluída",
  sales_summary: "Resumo de vendas agrupadas",
  sync_warning: "Alertas de sincronização",
  task_assigned: "Tarefa atribuída a mim",
  stock_low: "Full no mínimo (agendar coleta)",
};

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

  useEffect(() => {
    if (!open || !user?.uid) return;
    const unsub = watchNotificationPreferences(user.uid, (data) => {
      setPrefs(data ? { ...DEFAULT_NOTIFICATION_PREFERENCES, ...data, toggles: { ...DEFAULT_NOTIFICATION_PREFERENCES.toggles, ...((data.toggles as object) ?? {}) } } as NotificationPreferences : DEFAULT_NOTIFICATION_PREFERENCES);
      setLoaded(true);
    });
    return unsub;
  }, [open, user?.uid]);

  function toggle(key: NotificationTogglesKey) {
    setPrefs((p) => ({ ...p, toggles: { ...p.toggles, [key]: !p.toggles[key] } }));
  }

  async function salvar() {
    if (!user?.uid) return;
    setSaving(true);
    try {
      await saveNotificationPreferences(user.uid, prefs);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} wide>
      <div className="modal-title">Configurações de notificação</div>
      <div className="modal-sub">Só valem pra você — owner e colaborador podem configurar diferente.</div>

      {!loaded ? (
        <div style={{ padding: 20, textAlign: "center", color: "var(--muted)" }}>Carregando…</div>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
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
            <div className="hint">Com isto ativo, o resto acima ainda aparece na Central, só não vira push.</div>
          </div>

          <div className="config-field" style={{ margin: 0 }}>
            <label>Venda de alto valor a partir de (R$)</label>
            <input
              type="number" min="0" step="10" value={prefs.highValueThreshold}
              onChange={(e) => setPrefs((p) => ({ ...p, highValueThreshold: parseFloat(e.target.value) || 0 }))}
            />
          </div>

          <div className="config-field" style={{ margin: 0 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={prefs.groupFastSales} onChange={() => setPrefs((p) => ({ ...p, groupFastSales: !p.groupFastSales }))} />
              Agrupar vendas rápidas (4+ em pouco tempo viram um resumo só)
            </label>
          </div>

          <div className="config-field" style={{ margin: 0 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={prefs.showFinancialValuesInPush} onChange={() => setPrefs((p) => ({ ...p, showFinancialValuesInPush: !p.showFinancialValuesInPush }))} />
              Mostrar valores financeiros no push (desative pra ver só &quot;Nova venda&quot;)
            </label>
          </div>

          <hr className="config-sep" />
          <div className="config-section-title">Horário silencioso</div>
          <div className="config-field" style={{ margin: 0 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={prefs.quietHoursEnabled} onChange={() => setPrefs((p) => ({ ...p, quietHoursEnabled: !p.quietHoursEnabled }))} />
              Ativar horário silencioso
            </label>
            <div className="hint">Notificações críticas continuam chegando mesmo dentro do horário — só as demais esperam.</div>
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
              <div className="config-field" style={{ margin: 0 }}>
                <label>Dias ativos</label>
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

          <div className="modal-btns">
            <button type="button" className="btn btn-success" onClick={salvar} disabled={saving}>{saving ? "Salvando…" : "Salvar preferências"}</button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
