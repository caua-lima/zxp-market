"use client";

import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/api/authed-fetch";
import { watchVigiasAgendaFull, type VigiaAgendaFull } from "@/lib/firebase/data";
import { datasPorExtenso } from "@/lib/domain/agenda-full";

/**
 * "Avise quando abrir data": o envio pro Full foi criado no ML mas está sem
 * data pra agendar. O servidor confere a cada ~5 min e manda push quando abrir
 * (lib/ml/vigia-agenda-full.ts). Aqui aparece o que o ML respondeu na última
 * consulta — inclusive quando ele não deixa consultar.
 */
const ROTULO: Record<VigiaAgendaFull["estado"], { texto: string; cor: string }> = {
  aguardando: { texto: "Consultando…", cor: "var(--muted)" },
  datas_liberadas: { texto: "DATA LIBERADA — agende já", cor: "var(--green)" },
  sem_datas: { texto: "Ainda sem data", cor: "var(--muted)" },
  sem_acesso: { texto: "O ML não deixou o app consultar este envio", cor: "var(--red-text)" },
  indefinido: { texto: "Resposta do ML sem agenda legível", cor: "var(--warning)" },
};

/** O que o iPhone viu (script Vigia Full). É a fonte que vale: o ML recusa o servidor. */
const ROTULO_IPHONE: Record<string, { texto: string; cor: string }> = {
  datas: { texto: "iPhone viu DATA LIBERADA — agende já", cor: "var(--green)" },
  sem_datas: { texto: "iPhone: ainda sem data", cor: "var(--muted)" },
  login: { texto: "iPhone: precisa entrar no ML no Scriptable", cor: "var(--red-text)" },
  indefinido: { texto: "iPhone: não conseguiu ler a página", cor: "var(--warning)" },
};

/** O passo a passo e o script da vigia pelo iPhone. */
function VigiaPeloIphone() {
  const [aberto, setAberto] = useState(false);
  const [script, setScript] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const gerar = async () => {
    setOcupado(true);
    setMsg(null);
    try {
      const r = await authedFetch("/api/widget/token?uso=vigia", { method: "POST" });
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
    try { await navigator.clipboard.writeText(script); setMsg("Script copiado. Agora cole no Scriptable."); }
    catch { setMsg("Não consegui copiar sozinho: toque no texto, selecione tudo e copie."); }
  };
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, marginBottom: 12 }}>
      <button type="button" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}
        style={{ width: "100%", display: "flex", justifyContent: "space-between", background: "none", border: 0, color: "var(--text)", font: "inherit", fontWeight: 700, padding: "10px 12px", cursor: "pointer", textAlign: "left" }}>
        <span>Vigiar pelo iPhone (grátis) — funciona com o computador desligado</span><span aria-hidden>{aberto ? "▾" : "▸"}</span>
      </button>
      {aberto && (
        <div style={{ padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 8, fontSize: ".88rem" }}>
          <p style={{ margin: 0, color: "var(--muted)" }}>O ML só mostra a agenda pra quem está logado no navegador, então quem olha é o seu iPhone, pelo app grátis Scriptable.</p>
          <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.55 }}>
            <li>Toque em <b>Gerar script da vigia</b> e depois em <b>Copiar script</b>.</li>
            <li>No Scriptable, toque em <b>+</b>, cole, dê o nome <b>Vigia Full</b> e salve.</li>
            <li>Rode o script uma vez (toque nele). Vai abrir o Mercado Livre: <b>entre na sua conta</b> e feche a janela.</li>
            <li>Adicione um widget <b>Scriptable</b> na tela inicial e escolha <b>Vigia Full</b>. É ele que confere a cada poucos minutos.</li>
            <li>Permita notificações do Scriptable (Ajustes › Notificações › Scriptable).</li>
          </ol>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={gerar} disabled={ocupado}>{script ? "Gerar outro (revoga o anterior)" : "Gerar script da vigia"}</button>
            {script && <button type="button" className="btn btn-ghost btn-sm" onClick={copiar}>Copiar script</button>}
          </div>
          {script && <textarea readOnly value={script} rows={4} aria-label="Script da vigia" onFocus={(e) => e.currentTarget.select()}
            style={{ width: "100%", boxSizing: "border-box", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--muted)", font: ".72rem/1.4 ui-monospace, monospace", padding: 10 }} />}
          {msg && <div role="status" style={{ color: "var(--green)", fontSize: ".82rem" }}>{msg}</div>}
        </div>
      )}
    </div>
  );
}

const hora = (ms: number) => (ms ? new Date(ms).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

export default function VigiaAgendaFull({ podeEditar }: { podeEditar: boolean }) {
  const [vigias, setVigias] = useState<VigiaAgendaFull[] | null>(null);
  const [erroLeitura, setErroLeitura] = useState(false);
  const [numero, setNumero] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => watchVigiasAgendaFull((v) => { setVigias(v); setErroLeitura(false); }, () => setErroLeitura(true)), []);

  const ligar = async () => {
    setOcupado(true);
    setMsg(null);
    try {
      const r = await authedFetch("/api/full/vigia-agenda", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inboundId: numero }) });
      const j = (await r.json().catch(() => ({}))) as { mensagem?: string };
      if (!r.ok) throw new Error(j.mensagem ?? "Não consegui ligar a vigia.");
      setNumero("");
      setMsg("Vigia ligada. Você recebe push assim que o ML abrir data pra este envio.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Não consegui ligar a vigia.");
    } finally {
      setOcupado(false);
    }
  };

  const parar = async (id: string) => {
    setOcupado(true);
    try { await authedFetch(`/api/full/vigia-agenda?id=${encodeURIComponent(id)}`, { method: "DELETE" }); } finally { setOcupado(false); }
  };

  return (
    <section className="panel" aria-labelledby="vigia-agenda-titulo" style={{ marginBottom: 16 }}>
      <div className="panel-head">
        <span className="panel-title" id="vigia-agenda-titulo">Avise quando abrir data no Full</span>
        <span className="panel-sub">o app confere o envio a cada ~5 min e manda push quando o ML liberar agenda</span>
      </div>

      <VigiaPeloIphone />

      {podeEditar && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <input
            type="text" inputMode="numeric" placeholder="Nº do envio (ex.: 80517703)" value={numero}
            onChange={(e) => setNumero(e.target.value)} aria-label="Número do envio pro Full"
            style={{ flex: "1 1 220px", minWidth: 0, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", font: "inherit" }}
          />
          <button type="button" className="btn btn-primary btn-sm" disabled={ocupado || !numero.trim()} onClick={ligar}>{ocupado ? "Ligando…" : "Vigiar"}</button>
        </div>
      )}
      {msg && <div className="note" role="status" style={{ marginBottom: 10 }}>{msg}</div>}
      {erroLeitura && <div className="note" role="alert">Não consegui ler as vigias. Se é a primeira vez, as regras do Firestore precisam ser publicadas.</div>}

      {vigias && vigias.length === 0 && !erroLeitura && <p style={{ margin: 0, color: "var(--muted)", fontSize: ".88rem" }}>Nenhum envio vigiado.</p>}
      {vigias && vigias.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {vigias.map((v) => {
            // Com o iPhone vigiando, é ele que vale (o ML recusa a consulta do servidor).
            const iph = v.iphone ? ROTULO_IPHONE[v.iphone.estado] : null;
            const r = iph ?? ROTULO[v.estado] ?? ROTULO.indefinido;
            return (
              <li key={v.inboundId} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>Envio #{v.inboundId}</div>
                  <div style={{ color: r.cor, fontWeight: 700, fontSize: ".88rem" }}>
                    {r.texto}{!iph && v.estado === "datas_liberadas" && v.datas.length ? `: ${datasPorExtenso(v.datas)}` : ""}
                  </div>
                  <div style={{ color: "var(--muted)", fontSize: ".75rem" }}>
                    {v.iphone ? `iPhone conferiu ${hora(v.iphone.em)} · ` : ""}servidor {hora(v.ultimaConsulta)}{v.consultas ? ` · ${v.consultas} consultas` : ""}{v.avisadoEm ? ` · avisado ${hora(v.avisadoEm)}` : ""}
                  </div>
                  {v.detalhe && <div style={{ color: "var(--muted)", fontSize: ".72rem", fontFamily: "ui-monospace, monospace", overflowWrap: "anywhere" }}>ML: {v.detalhe}</div>}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <a className="btn btn-ghost btn-xs" href={`https://vendedores.mercadolivre.com.br/shipping/inbounds/${v.inboundId}/appointment-v2`} target="_blank" rel="noreferrer">Abrir no ML</a>
                  {podeEditar && <button type="button" className="btn btn-danger btn-xs" disabled={ocupado} onClick={() => parar(v.inboundId)}>Parar</button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
