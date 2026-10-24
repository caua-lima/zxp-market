"use client";

import { useState } from "react";
import { authedFetch } from "@/lib/api/authed-fetch";
import s from "./PainelAoVivo.module.css";

/**
 * "Widget no iPhone (grátis)": gera o código secreto e o script pronto pro app
 * Scriptable, que desenha o painel na tela de bloqueio e na tela inicial. O
 * código aparece UMA vez (o servidor só guarda o hash); gerar outro revoga o
 * anterior. Ver lib/domain/widget-script.ts.
 */
export default function WidgetIphone() {
  const [aberto, setAberto] = useState(false);
  const [script, setScript] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const gerar = async () => {
    setOcupado(true);
    setMsg(null);
    try {
      const r = await authedFetch("/api/widget/token", { method: "POST" });
      const j = (await r.json().catch(() => ({}))) as { script?: string };
      if (!r.ok || !j.script) throw new Error();
      setScript(j.script);
    } catch {
      setMsg("Não consegui gerar agora. Tente de novo.");
    } finally {
      setOcupado(false);
    }
  };

  const copiar = async () => {
    if (!script) return;
    try {
      await navigator.clipboard.writeText(script);
      setMsg("Script copiado. Agora cole no Scriptable.");
    } catch {
      setMsg("Não consegui copiar sozinho: toque no texto, selecione tudo e copie.");
    }
  };

  const revogar = async () => {
    setOcupado(true);
    try {
      await authedFetch("/api/widget/token", { method: "DELETE" });
      setScript(null);
      setMsg("Widget desligado: o código antigo parou de funcionar.");
    } catch {
      setMsg("Não consegui desligar agora. Tente de novo.");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <section className={s.widgetCartao} aria-labelledby="pav-widget">
      <button type="button" className={s.widgetTopo} aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>
        <span id="pav-widget">Widget no iPhone (grátis)</span>
        <span aria-hidden>{aberto ? "▾" : "▸"}</span>
      </button>
      {aberto && (
        <div className={s.widgetCorpo}>
          <ol className={s.widgetPassos}>
            <li>Instale o app gratuito <b>Scriptable</b> na App Store.</li>
            <li>Toque em <b>Gerar meu widget</b> e depois em <b>Copiar script</b>.</li>
            <li>No Scriptable, toque em <b>+</b>, cole o script e salve.</li>
            <li>Na tela de bloqueio ou inicial: segure, <b>Personalizar</b>, adicione o widget <b>Scriptable</b> e escolha o script.</li>
          </ol>
          <p className={s.widgetNota}>O iPhone atualiza o widget a cada poucos minutos (não é na hora). O código é só seu: não compartilhe o script.</p>
          <div className={s.widgetAcoes}>
            <button type="button" className="btn btn-primary btn-sm" onClick={gerar} disabled={ocupado}>{script ? "Gerar outro (revoga o atual)" : "Gerar meu widget"}</button>
            {script && <button type="button" className="btn btn-ghost btn-sm" onClick={copiar}>Copiar script</button>}
            <button type="button" className="btn btn-danger btn-sm" onClick={revogar} disabled={ocupado}>Desligar widget</button>
          </div>
          {script && <textarea className={s.widgetTexto} readOnly value={script} rows={4} aria-label="Script do widget" onFocus={(e) => e.currentTarget.select()} />}
          {msg && <div className={s.widgetMsg} role="status">{msg}</div>}
        </div>
      )}
    </section>
  );
}
