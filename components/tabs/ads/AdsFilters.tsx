"use client";

import { useId, useState } from "react";
import type { Modo, StatusAnuncio } from "./ads-types";
import { faixaAtiva, faixaInvertida, resumoDaFaixa } from "@/lib/domain/ads-faixas";
import {
  COLUNAS_ORDENAVEIS, ORDEM_DAS_OPCOES, descreverOrdem, escolherColuna,
  type ColunaOrdenavel, type OrdemAds,
} from "@/lib/domain/ads-ordenacao";

export type FiltrosAdsState = {
  busca: string; setBusca: (v: string) => void;
  statusFiltro: StatusAnuncio | ""; setStatusFiltro: (v: StatusAnuncio | "") => void;
  lucroFiltro: "" | "lucro" | "prejuizo"; setLucroFiltro: (v: "" | "lucro" | "prejuizo") => void;
  roasMin: string; setRoasMin: (v: string) => void;
  roasMax: string; setRoasMax: (v: string) => void;
  acosMin: string; setAcosMin: (v: string) => void;
  acosMax: string; setAcosMax: (v: string) => void;
  investMin: string; setInvestMin: (v: string) => void;
  investMax: string; setInvestMax: (v: string) => void;
};

/** Contadores por status pra virar botão de filtro rápido, igual já existia. */
export function AdsStatusQuickFilters({
  items, statusFiltro, setStatusFiltro, lucroFiltro, setLucroFiltro,
}: {
  items: { status: StatusAnuncio }[];
  statusFiltro: StatusAnuncio | ""; setStatusFiltro: (v: StatusAnuncio | "") => void;
  lucroFiltro: "" | "lucro" | "prejuizo"; setLucroFiltro: (v: "" | "lucro" | "prejuizo") => void;
}) {
  const STATUS_META_LOCAL: Record<StatusAnuncio, { label: string; cor: string; bg: string }> = {
    ativo: { label: "Ativa", cor: "var(--green)", bg: "rgba(54,179,126,.12)" },
    pausado: { label: "Pausada", cor: "var(--warning)", bg: "var(--warning-soft)" },
    sem_campanha: { label: "Sem campanha", cor: "var(--muted)", bg: "rgba(185,181,166,.14)" },
    config_indisponivel: { label: "Campanha ?", cor: "var(--warning)", bg: "var(--warning-soft)" },
  };
  if (items.length === 0) return null;
  return (
    <span className="ads-quick" role="group" aria-label="Filtros rápidos por status e resultado">
      {(["ativo", "pausado", "config_indisponivel", "sem_campanha"] as const).map((s) => {
        const n = items.filter((i) => i.status === s).length;
        if (!n) return null;
        const m = STATUS_META_LOCAL[s];
        const ativo = statusFiltro === s;
        return (
          <button
            key={s} type="button" title={`Filtrar: só ${m.label.toLowerCase()}`}
            className="ads-quick-btn" aria-pressed={ativo}
            onClick={() => setStatusFiltro(ativo ? "" : s)}
            style={{ color: m.cor, background: m.bg, borderColor: ativo ? m.cor : "transparent" }}
          >
            {n} {m.label.toLowerCase()}
          </button>
        );
      })}
      {(["lucro", "prejuizo"] as const).map((f) => {
        const ativo = lucroFiltro === f;
        const cor = f === "lucro" ? "var(--success,var(--green))" : "var(--danger,var(--red))";
        return (
          <button
            key={f} type="button" className="ads-quick-btn" aria-pressed={ativo}
            onClick={() => setLucroFiltro(ativo ? "" : f)}
            style={{ color: cor, background: "transparent", borderColor: ativo ? cor : "var(--border)" }}
          >
            {f === "lucro" ? "lucrativos" : "prejuízo"}
          </button>
        );
      })}
      {(statusFiltro || lucroFiltro) && (
        <button type="button" className="ads-quick-btn ads-quick-limpar" onClick={() => { setStatusFiltro(""); setLucroFiltro(""); }}>
          limpar filtro
        </button>
      )}
    </span>
  );
}

/**
 * "Ordenar por" FORA da tabela.
 *
 * No celular a tabela vira cartões e o cabeçalho — onde ficavam os botões de
 * ordenar — some. Este seletor é a ordenação daquela tela, e vale nos dois
 * tamanhos: mexe no MESMO estado que os botões do cabeçalho.
 */
export function AdsOrdenar({ ordem, onOrdem }: { ordem: OrdemAds; onOrdem: (o: OrdemAds) => void }) {
  const m = COLUNAS_ORDENAVEIS[ordem.col];
  return (
    <div className="ads-ordenar">
      <label htmlFor="ads-ordenar-coluna">Ordenar por</label>
      <select
        id="ads-ordenar-coluna" value={ordem.col}
        onChange={(e) => onOrdem(escolherColuna(ordem, e.target.value as ColunaOrdenavel))}
      >
        {ORDEM_DAS_OPCOES.map((c) => <option key={c} value={c}>{COLUNAS_ORDENAVEIS[c].rotulo}</option>)}
      </select>
      <button
        type="button" className="btn btn-ghost btn-sm"
        onClick={() => onOrdem({ col: ordem.col, dir: (ordem.dir * -1) as 1 | -1 })}
        aria-label={`Sentido da ordem: ${ordem.dir === 1 ? m.crescente : m.decrescente}. Tocar para inverter.`}
      >
        {ordem.dir === 1 ? "↑" : "↓"} {ordem.dir === 1 ? m.crescente : m.decrescente}
      </button>
      {/* Lido pelo leitor de tela quando a ordem muda; visível como a "ordem ativa". */}
      <span className="ads-ordenar-ativa" role="status">
        Ordem atual: {descreverOrdem(ordem)}. Sem dado vai sempre pro fim.
      </span>
    </div>
  );
}

/** Um par mínimo/máximo, com nome, unidade e aviso de faixa invertida. */
function CampoFaixa({ id, nome, unidade, min, max, onMin, onMax, larg }: {
  id: string; nome: string; unidade: string;
  min: string; max: string; onMin: (v: string) => void; onMax: (v: string) => void;
  larg?: number;
}) {
  const invertida = faixaInvertida({ min, max });
  const erroId = `${id}-erro`;
  return (
    <fieldset className="ads-faixa" aria-describedby={invertida ? erroId : undefined}>
      <legend>{nome} <span className="ads-faixa-un">({unidade})</span></legend>
      <div className="ads-faixa-campos">
        <input
          type="number" inputMode="decimal" step="any" min="0" placeholder="mín."
          aria-label={`${nome} mínimo, em ${unidade}`} aria-invalid={invertida || undefined}
          value={min} onChange={(e) => onMin(e.target.value)} style={larg ? { width: larg } : undefined}
        />
        <span aria-hidden="true">–</span>
        <input
          type="number" inputMode="decimal" step="any" min="0" placeholder="máx."
          aria-label={`${nome} máximo, em ${unidade}`} aria-invalid={invertida || undefined}
          value={max} onChange={(e) => onMax(e.target.value)} style={larg ? { width: larg } : undefined}
        />
      </div>
      {invertida && (
        <div id={erroId} className="ads-faixa-erro" role="alert">
          O mínimo é maior que o máximo — nenhum anúncio passa por esta faixa.
        </div>
      )}
    </fieldset>
  );
}

export default function AdsFilters({
  modo, f, ordem, onOrdem,
}: {
  modo: Modo; f: FiltrosAdsState; ordem: OrdemAds; onOrdem: (o: OrdemAds) => void;
}) {
  const acosNome = modo === "pub" ? "ACOS" : "TACOS";
  const roas = { min: f.roasMin, max: f.roasMax };
  const acos = { min: f.acosMin, max: f.acosMax };
  const invest = { min: f.investMin, max: f.investMax };

  const aplicados = [
    resumoDaFaixa("ROAS", roas, { depois: "x" }),
    resumoDaFaixa(acosNome, acos, { depois: "%" }),
    resumoDaFaixa("Investido", invest, { antes: "R$ " }),
  ].filter(Boolean);
  const algumaFaixa = faixaAtiva(roas) || faixaAtiva(acos) || faixaAtiva(invest);

  /**
   * As faixas (ROAS, ACOS/TACOS, investido) ficam RECOLHIDAS no celular: eram três
   * grupos de campos entre a busca e o primeiro anúncio, e empurravam a lista pra
   * fora da primeira tela. No computador começam abertas. Com alguma faixa em uso
   * elas ficam sempre visíveis — filtro ligado e escondido é o que faz um anúncio
   * "sumir" sem explicação.
   */
  const [faixasAbertas, setFaixasAbertas] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 721px)").matches,
  );
  const faixasId = useId();
  const mostrarFaixas = faixasAbertas || algumaFaixa;
  const nFaixasAtivas = [roas, acos, invest].filter(faixaAtiva).length;

  return (
    <div className="ads-filtros">
      <div className="ads-filtros-linha">
        <div className="ads-busca">
          <label htmlFor="ads-busca">Buscar produto</label>
          <input
            id="ads-busca" type="search" placeholder="Nome do produto ou código MLB…" value={f.busca}
            onChange={(e) => f.setBusca(e.target.value)} autoComplete="off"
          />
        </div>
        <AdsOrdenar ordem={ordem} onOrdem={onOrdem} />
      </div>

      <div>
        <button
          type="button" className="btn btn-ghost btn-sm" aria-expanded={mostrarFaixas} aria-controls={faixasId}
          onClick={() => setFaixasAbertas((v) => !v)} disabled={algumaFaixa}
          title={algumaFaixa ? "Há faixa em uso — limpe as faixas pra recolher" : undefined}
        >
          {mostrarFaixas ? "▾" : "▸"} Faixas de ROAS, {acosNome} e investido{nFaixasAtivas > 0 ? ` (${nFaixasAtivas} em uso)` : ""}
        </button>
      </div>

      {mostrarFaixas && (
        <div id={faixasId} className="ads-filtros-linha ads-faixas">
          <CampoFaixa id="ads-roas" nome="ROAS" unidade="x" min={f.roasMin} max={f.roasMax} onMin={f.setRoasMin} onMax={f.setRoasMax} larg={78} />
          <CampoFaixa id="ads-acos" nome={acosNome} unidade="%" min={f.acosMin} max={f.acosMax} onMin={f.setAcosMin} onMax={f.setAcosMax} larg={78} />
          <CampoFaixa id="ads-invest" nome="Investido" unidade="R$" min={f.investMin} max={f.investMax} onMin={f.setInvestMin} onMax={f.setInvestMax} larg={92} />
        </div>
      )}

      {algumaFaixa && (
        <div className="ads-filtros-resumo" role="status">
          <span><b>Faixas aplicadas:</b> {aplicados.join(" · ")}</span>
          <button
            type="button" className="btn btn-xs btn-ghost"
            onClick={() => { f.setRoasMin(""); f.setRoasMax(""); f.setAcosMin(""); f.setAcosMax(""); f.setInvestMin(""); f.setInvestMax(""); }}
          >
            Limpar faixas
          </button>
        </div>
      )}
    </div>
  );
}
