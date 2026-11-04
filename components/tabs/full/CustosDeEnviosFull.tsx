"use client";

import { useEffect, useState } from "react";
import { fmtBRL, todayStr } from "@/lib/domain/calc";
import { carregarColetaFull } from "@/lib/coleta-full-cliente";
import type { ColetaFull } from "@/lib/domain/coleta-full";
import CustosColetaFull from "@/components/tabs/full/CustosColetaFull";

/**
 * CUSTOS DE ENVIOS — na aba Full, pedido do dono (03/11/2026): o custo de
 * cada envio ao Full (o "R$ 313,50" que a lista de envios do ML mostra) é
 * digitado AQUI e vai direto pra DRE, na linha "Coleta pro Full". É o mesmo
 * cadastro que a DRE já lia (CustosColetaFull + lib/coleta-full-cliente.ts):
 * um lugar só, os dois mostram o mesmo número.
 */

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function mesDe(iso: string): { from: string; to: string; rotulo: string } {
  const [a, m] = iso.split("-").map(Number);
  const ultimo = new Date(a, m, 0).getDate();
  const mm = String(m).padStart(2, "0");
  return { from: `${a}-${mm}-01`, to: `${a}-${mm}-${String(ultimo).padStart(2, "0")}`, rotulo: `${MESES[m - 1]} de ${a}` };
}

function somarMes(iso: string, n: number): string {
  const [a, m] = iso.split("-").map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export default function CustosDeEnviosFull() {
  const [mes, setMes] = useState(() => `${todayStr().slice(0, 7)}-01`);
  const periodo = mesDe(mes);
  const chave = `${periodo.from}|${periodo.to}`;
  /** Sobe a cada salvamento: relê furando o cache. */
  const [recarga, setRecarga] = useState(0);
  const [resp, setResp] = useState<{ chave: string; c: ColetaFull | null } | null>(null);

  useEffect(() => {
    let vivo = true;
    const [de, ate] = chave.split('|');
    carregarColetaFull({ from: de, to: ate }, { hoje: todayStr(), forcar: recarga > 0 })
      .then((c) => { if (vivo) setResp({ chave, c }); })
      .catch(() => { if (vivo) setResp({ chave, c: null }); });
    return () => { vivo = false; };
  }, [chave, recarga]);

  const coleta = resp && resp.chave === chave ? resp.c : null;
  const carregando = !resp || resp.chave !== chave;

  const lista = coleta?.todas ?? [];
  return (
    <section className="panel" aria-labelledby="custos-envios-titulo" style={{ marginBottom: 16 }}>
      <div className="panel-head" style={{ alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span className="panel-title" id="custos-envios-titulo">Custos de envios</span>
        <span className="panel-sub">o custo de cada envio ao Full — vai direto pra DRE (linha “Coleta pro Full”)</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <button type="button" className="btn btn-ghost btn-xs" aria-label="Mês anterior" onClick={() => setMes((x) => somarMes(x, -1))}>←</button>
        <b style={{ textTransform: "capitalize" }}>{periodo.rotulo}</b>
        <button type="button" className="btn btn-ghost btn-xs" aria-label="Próximo mês" onClick={() => setMes((x) => somarMes(x, 1))}>→</button>
        {coleta && (
          <span style={{ marginLeft: "auto", fontSize: ".88rem" }}>
            Na DRE do mês: <b>{fmtBRL(coleta.total)}</b>
            {coleta.pendentes > 0 && <span style={{ color: "var(--warning)" }}> · {coleta.pendentes} envio(s) sem custo</span>}
          </span>
        )}
      </div>

      {carregando && !coleta && <p style={{ margin: 0, color: "var(--muted)", fontSize: ".88rem" }}>Carregando os envios do mês…</p>}
      {coleta?.foraDaJanela && <p style={{ margin: "0 0 8px", color: "var(--muted)", fontSize: ".82rem" }}>Mês antigo: o ML só lista envios recentes, então aparece só o que já foi salvo.</p>}
      {coleta?.mlFalhou && <p style={{ margin: "0 0 8px", color: "var(--warning)", fontSize: ".82rem" }}>Não consegui consultar os envios no ML agora; aparece o que já foi salvo.</p>}
      {coleta && lista.length === 0 && coleta.semData.length === 0 && (
        <p style={{ margin: 0, color: "var(--muted)", fontSize: ".88rem" }}>Nenhum envio recebido pelo Full neste mês.</p>
      )}
      {coleta && (lista.length > 0 || coleta.semData.length > 0) && (
        <CustosColetaFull
          remessas={lista}
          semData={coleta.semData}
          onSalvo={() => setRecarga((n) => n + 1)}
          iniciarAberto
          titulo={`Custo de cada envio (${lista.length})`}
        />
      )}
    </section>
  );
}
