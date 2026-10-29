"use client";

import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/api/authed-fetch";
import { watchVigiasAgendaFull, type VigiaAgendaFull } from "@/lib/firebase/data";
import { datasPorExtenso } from "@/lib/domain/agenda-full";

/**
 * "Avise quando abrir data": o envio pro Full foi criado no ML mas está sem
 * data pra agendar. Quem olha a página é a extensão do Chrome do PC (o ML
 * recusa o servidor); o servidor ainda tenta de hora em hora
 * (lib/ml/vigia-agenda-full.ts). Abriu data: push crítico no celular.
 */
const ROTULO = {
  datas_liberadas: { texto: "DATA LIBERADA — agende já", cor: "var(--green)" },
};
/** Sem leitura da extensão ainda (o que o servidor vê é sempre o 403 do ML, então não aparece). */
const ESPERANDO_A_EXTENSAO = { texto: "Esperando a extensão do Chrome conferir", cor: "var(--muted)" };

/**
 * O que a extensão do Chrome viu (pasta extensao-vigia-full). É a fonte que
 * vale: o ML recusa a consulta do servidor. O campo no banco ainda se chama
 * `iphone` (veio da tentativa com o Scriptable, que o ML bloqueou).
 */
const ROTULO_CHROME: Record<string, { texto: string; cor: string }> = {
  datas: { texto: "DATA LIBERADA — agende já", cor: "var(--green)" },
  sem_datas: { texto: "Ainda sem data", cor: "var(--muted)" },
  login: { texto: "Entre no Mercado Livre no Chrome do PC", cor: "var(--red-text)" },
  indefinido: { texto: "A extensão não conseguiu ler a página", cor: "var(--warning)" },
};

const PASTA_DA_EXTENSAO = "zxp-market\\extensao-vigia-full";

/** O passo a passo da extensão do Chrome e o endereço que ela usa. */
function VigiaPeloChrome() {
  const [aberto, setAberto] = useState(false);
  const [endereco, setEndereco] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const gerar = async () => {
    setOcupado(true);
    setMsg(null);
    try {
      const r = await authedFetch("/api/widget/token?uso=vigia", { method: "POST" });
      const j = (await r.json().catch(() => ({}))) as { url?: string };
      if (!r.ok || !j.url) throw new Error();
      setEndereco(j.url);
    } catch {
      setMsg("Não consegui gerar agora. Tente de novo.");
    } finally {
      setOcupado(false);
    }
  };
  const copiar = async () => {
    if (!endereco) return;
    try { await navigator.clipboard.writeText(endereco); setMsg("Endereço copiado. Agora cole na extensão."); }
    catch { setMsg("Não consegui copiar sozinho: clique no texto, selecione tudo e copie."); }
  };
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, marginBottom: 12 }}>
      <button type="button" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}
        style={{ width: "100%", display: "flex", justifyContent: "space-between", background: "none", border: 0, color: "var(--text)", font: "inherit", fontWeight: 700, padding: "10px 12px", cursor: "pointer", textAlign: "left" }}>
        <span>Ligar a vigia no Chrome do PC (grátis) — o push chega no celular</span><span aria-hidden>{aberto ? "▾" : "▸"}</span>
      </button>
      {aberto && (
        <div style={{ padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 8, fontSize: ".88rem" }}>
          <p style={{ margin: 0, color: "var(--muted)" }}>
            O ML só mostra a agenda pra quem está logado no navegador. Uma extensão no seu Chrome confere a cada 1 minuto, em segundo plano,
            e quando abrir data o app manda push pro celular. Basta o PC ligado com o Chrome aberto (pode minimizar e apagar a tela; não pode suspender).
          </p>
          <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.55 }}>
            <li>No Chrome do PC, abra <b>chrome://extensions</b> e ligue o <b>Modo do desenvolvedor</b> (canto de cima, à direita).</li>
            <li>Clique em <b>Carregar sem compactação</b> e escolha a pasta <code>{PASTA_DA_EXTENSAO}</code>.</li>
            <li>Aqui, clique em <b>Gerar endereço da vigia</b> e em <b>Copiar</b>.</li>
            <li>Clique no ícone da extensão (quebra-cabeça › <b>ZXP — Vigia da agenda do Full</b>), cole o endereço, <b>Salvar</b> e aceite a permissão.</li>
            <li>Confira se está logado no Mercado Livre nesse Chrome. A extensão mostra o estado de cada envio.</li>
            <li><b>Pra vigiar um envio:</b> abra a página de agendamento dele no ML nesse Chrome (a que diz “Não temos datas disponíveis”). A extensão pega o número sozinha e ele aparece aqui embaixo.</li>
          </ol>
          <p style={{ margin: 0, color: "var(--warning)", fontSize: ".8rem" }}>Já colou o endereço na extensão? Não gere outro: gerar de novo desliga o anterior e a extensão para.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={gerar} disabled={ocupado}>{endereco ? "Gerar outro (revoga o anterior)" : "Gerar endereço da vigia"}</button>
            {endereco && <button type="button" className="btn btn-ghost btn-sm" onClick={copiar}>Copiar</button>}
          </div>
          {endereco && <input readOnly value={endereco} aria-label="Endereço da vigia" onFocus={(e) => e.currentTarget.select()}
            style={{ width: "100%", boxSizing: "border-box", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--muted)", font: ".75rem/1.4 ui-monospace, monospace", padding: 10 }} />}
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
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => watchVigiasAgendaFull((v) => { setVigias(v); setErroLeitura(false); }, () => setErroLeitura(true)), []);

  // Manda o MESMO aviso (tipo e prioridade) marcado como teste: se chegar, o de verdade chega.
  const testarCelular = async () => {
    setOcupado(true);
    setMsg(null);
    try {
      const r = await authedFetch("/api/full/vigia-agenda?teste=1", { method: "POST" });
      const j = (await r.json().catch(() => ({}))) as { enviados?: number };
      if (!r.ok) throw new Error();
      setMsg(j.enviados
        ? `Teste enviado pra ${j.enviados} aparelho(s). Chegou “Teste · Agenda do Full” no celular? Então o aviso de data liberada também chega.`
        : "Nenhum aparelho com notificação ligada. No celular, abra o app (pelo ícone da tela inicial), toque no sino e ligue as notificações; depois teste de novo.");
    } catch {
      setMsg("Não consegui mandar o teste agora. Tente de novo.");
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
        <span className="panel-sub">a extensão no Chrome do PC confere a cada 1 min; sem data, um aviso discreto a cada ~5 min; abriu data, push forte</span>
      </div>

      <VigiaPeloChrome />

      {podeEditar && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <button type="button" className="btn btn-ghost btn-sm" disabled={ocupado} onClick={testarCelular}>{ocupado ? "Mandando…" : "Testar aviso no celular"}</button>
          <span style={{ color: "var(--muted)", fontSize: ".8rem" }}>manda um aviso de teste igual ao de data liberada pros aparelhos com notificação ligada</span>
        </div>
      )}
      {msg && <div className="note" role="status" style={{ marginBottom: 10 }}>{msg}</div>}
      {erroLeitura && <div className="note" role="alert">Não consegui ler as vigias. Se é a primeira vez, as regras do Firestore precisam ser publicadas.</div>}

      {vigias && vigias.length === 0 && !erroLeitura && <p style={{ margin: 0, color: "var(--muted)", fontSize: ".88rem" }}>Nenhum envio vigiado. Abra a página de agendamento do envio no ML, no Chrome com a extensão, e ele aparece aqui.</p>}
      {vigias && vigias.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {vigias.map((v) => {
            // Com a extensão vigiando, é ela que vale (o ML recusa a consulta do servidor).
            const iph = v.iphone ? ROTULO_CHROME[v.iphone.estado] : null;
            const r = iph ?? (v.estado === "datas_liberadas" ? ROTULO.datas_liberadas : ESPERANDO_A_EXTENSAO);
            return (
              <li key={v.inboundId} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>Envio #{v.inboundId}</div>
                  <div style={{ color: r.cor, fontWeight: 700, fontSize: ".88rem" }}>
                    {r.texto}{!iph && v.estado === "datas_liberadas" && v.datas.length ? `: ${datasPorExtenso(v.datas)}` : ""}
                  </div>
                  <div style={{ color: "var(--muted)", fontSize: ".75rem" }}>
                    {v.iphone ? `Chrome conferiu ${hora(v.iphone.em)}` : "a extensão ainda não conferiu"}{v.avisadoEm ? ` · avisado ${hora(v.avisadoEm)}` : ""}
                  </div>
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
