"use client";

import { useMemo, useState } from "react";
import { fmtBRL, fmtPct } from "@/lib/domain/calc";
import { classificarABC, CORTE_A, CORTE_B, type ClasseABC } from "@/lib/domain/curva-abc";
import type { VendaBrutaDoAnuncio } from "@/lib/domain/vendas-brutas";

/**
 * Curva ABC (Pareto) do período do Dashboard, em duas leituras:
 *
 *   · Vendas brutas — quem puxa o FATURAMENTO. A base é a mesma do "Vendas
 *     brutas" do Seller Center (pedidos válidos, sem cancelados/devolvidos),
 *     todos os anúncios, com ou sem produto vinculado.
 *   · Lucro — quem puxa o RESULTADO. Só anúncios vinculados a produto (é onde
 *     há custo) e some pra quem não vê o financeiro (o servidor não manda).
 *
 * As duas passam pela MESMA classificação (lib/domain/curva-abc.ts): um anúncio
 * pode ser A em vendas e C em lucro — é justamente a leitura que interessa.
 */

type AnuncioDeLucro = { item_id: string; title: string; lucro: number; semVenda?: boolean };

type Props = {
  curvaBruta?: VendaBrutaDoAnuncio[];
  /** O "Vendas brutas" do período vindo da conciliação — pra conferir que a soma da curva fecha. */
  vendasBrutasDoPeriodo?: number;
  anuncios?: AnuncioDeLucro[];
};

type Visao = "vendas" | "lucro";

const COR: Record<ClasseABC, string> = { A: "var(--green)", B: "var(--yellow)", C: "var(--muted)" };
const LINHAS_INICIAIS = 15;

export default function CurvaABC({ curvaBruta, vendasBrutasDoPeriodo, anuncios = [] }: Props) {
  const temVendas = (curvaBruta?.length ?? 0) > 0;
  const lucroVendidos = useMemo(() => anuncios.filter((a) => !a.semVenda), [anuncios]);
  const temLucro = lucroVendidos.length > 0;
  const [escolhida, setEscolhida] = useState<Visao>("vendas");
  const [todas, setTodas] = useState(false);

  if (!temVendas && !temLucro) return null;
  // Visão que não existe (member sem financeiro; payload velho sem a curva) cai na outra.
  const visao: Visao = escolhida === "vendas" && temVendas ? "vendas" : escolhida === "lucro" && temLucro ? "lucro" : temVendas ? "vendas" : "lucro";

  return (
    <div className="panel">
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
        <div className="panel-title" style={{ margin: 0 }}>
          Curva ABC — {visao === "vendas" ? "quem puxa as vendas" : "quem puxa o lucro"}
        </div>
        {temVendas && temLucro && (
          <div className="seg" role="group" aria-label="Base da curva ABC">
            <button type="button" className={`seg-btn ${visao === "vendas" ? "active" : ""}`} aria-pressed={visao === "vendas"} onClick={() => { setEscolhida("vendas"); setTodas(false); }}>Vendas brutas</button>
            <button type="button" className={`seg-btn ${visao === "lucro" ? "active" : ""}`} aria-pressed={visao === "lucro"} onClick={() => { setEscolhida("lucro"); setTodas(false); }}>Lucro</button>
          </div>
        )}
      </div>
      <div style={{ fontSize: ".75rem", color: "var(--muted)", marginBottom: 12, lineHeight: 1.5 }}>
        A = topo (até {CORTE_A}% {visao === "vendas" ? "das vendas" : "do lucro"}) · B = {CORTE_A}–{CORTE_B}% · C = restante{visao === "lucro" ? " / prejuízo" : ""}.
        {visao === "vendas" && " Vendas brutas como no Seller Center: sem cancelados e devolvidos, antes de taxas, frete, custo e imposto."}
      </div>
      {visao === "vendas"
        ? <TabelaDeVendas curva={curvaBruta ?? []} totalDoPeriodo={vendasBrutasDoPeriodo} todas={todas} onTodas={setTodas} />
        : <TabelaDeLucro anuncios={lucroVendidos} todas={todas} onTodas={setTodas} />}
    </div>
  );
}

function Resumo({ resumo, itensRotulo }: { resumo: Record<ClasseABC, { itens: number; share: number }>; itensRotulo: string }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
      {(["A", "B", "C"] as const).map((c) => (
        <span key={c} className="tag" style={{ background: "transparent", color: COR[c], border: `1px solid ${COR[c]}`, fontSize: ".78rem" }}>
          <b>{c}</b> · {resumo[c].itens} {itensRotulo} · {fmtPct(resumo[c].share, 0)}
        </span>
      ))}
    </div>
  );
}

function Barra({ valor, classe }: { valor: number; classe: ClasseABC }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <div aria-hidden="true" style={{ width: 60, height: 6, borderRadius: 99, background: "var(--surface2)", overflow: "hidden" }}>
        <div style={{ width: `${Math.min(valor, 100)}%`, height: "100%", background: COR[classe] }} />
      </div>
      <span style={{ color: "var(--muted)", fontSize: ".82rem" }}>{fmtPct(valor, 0)}</span>
    </div>
  );
}

function Classe({ c, perda = false }: { c: ClasseABC; perda?: boolean }) {
  const cor = perda ? "var(--red-text)" : COR[c];
  return <span className="tag" style={{ background: "transparent", color: cor, border: `1px solid ${cor}` }}>{c}</span>;
}

function VerMais({ total, todas, onTodas }: { total: number; todas: boolean; onTodas: (v: boolean) => void }) {
  if (total <= LINHAS_INICIAIS) return null;
  return (
    <button type="button" className="btn btn-ghost btn-xs" style={{ marginTop: 8 }} aria-expanded={todas} onClick={() => onTodas(!todas)}>
      {todas ? "Mostrar só os primeiros" : `Mostrar todos (${total})`}
    </button>
  );
}

function TabelaDeVendas({ curva, totalDoPeriodo, todas, onTodas }: { curva: VendaBrutaDoAnuncio[]; totalDoPeriodo?: number; todas: boolean; onTodas: (v: boolean) => void }) {
  const { linhas, total, resumo } = useMemo(() => classificarABC(curva, (a) => a.bruto), [curva]);
  const visiveis = todas ? linhas : linhas.slice(0, LINHAS_INICIAIS);
  // A soma por anúncio deve fechar com o "Vendas brutas" do período; se não fechar, diz.
  const diferenca = totalDoPeriodo != null ? total - totalDoPeriodo : 0;

  return (
    <>
      <Resumo resumo={resumo} itensRotulo="anúncio(s)" />
      <div className="table-wrapper" style={{ border: "none" }}>
        <table className="tbl-modern tbl-cards tbl-cards-plain">
          <thead><tr><th>Classe</th><th style={{ textAlign: "left" }}>Anúncio</th><th>Vendas brutas</th><th>% do total</th><th>Acumulado</th><th>Unid.</th></tr></thead>
          <tbody>
            {visiveis.map(({ item: a, share, acumulado, classe }) => (
              <tr key={a.item_id}>
                <td data-label="Classe"><Classe c={classe} /></td>
                <td data-label="Anúncio" style={{ fontWeight: 600, textAlign: "left" }}>{a.title}</td>
                <td data-label="Vendas brutas" style={{ fontWeight: 700 }}>
                  {fmtBRL(a.bruto)}
                  {a.perdido > 0 && (
                    <span style={{ display: "block", fontSize: ".72rem", fontWeight: 400, color: "var(--muted)" }}>
                      + {fmtBRL(a.perdido)} cancelado/devolvido
                    </span>
                  )}
                </td>
                <td data-label="% do total" style={{ color: "var(--muted)" }}>{fmtPct(share, 1)}</td>
                <td data-label="Acumulado"><Barra valor={acumulado} classe={classe} /></td>
                <td data-label="Unid." style={{ color: "var(--muted)" }}>{a.qty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <VerMais total={linhas.length} todas={todas} onTodas={onTodas} />
      <div style={{ marginTop: 10, fontSize: ".75rem", color: "var(--muted)", lineHeight: 1.5 }}>
        Soma da curva: <b style={{ color: "var(--text)" }}>{fmtBRL(total)}</b>
        {totalDoPeriodo != null && (
          Math.abs(diferenca) <= 1
            ? " — fecha com as Vendas brutas do período."
            : <> — as Vendas brutas do período são {fmtBRL(totalDoPeriodo)} (diferença de {fmtBRL(Math.abs(diferenca))}: pedido sem o detalhe dos itens, ou venda que o ML atualizou depois da leitura).</>
        )}
      </div>
    </>
  );
}

function TabelaDeLucro({ anuncios, todas, onTodas }: { anuncios: AnuncioDeLucro[]; todas: boolean; onTodas: (v: boolean) => void }) {
  const { linhas, resumo } = useMemo(() => classificarABC(anuncios, (a) => a.lucro), [anuncios]);
  const visiveis = todas ? linhas : linhas.slice(0, LINHAS_INICIAIS);

  return (
    <>
      <Resumo resumo={resumo} itensRotulo="anúncio(s)" />
      <div className="table-wrapper" style={{ border: "none" }}>
        <table className="tbl-modern tbl-cards tbl-cards-plain">
          <thead><tr><th>Classe</th><th style={{ textAlign: "left" }}>Anúncio</th><th>Lucro</th><th>% do lucro</th><th>Acumulado</th></tr></thead>
          <tbody>
            {visiveis.map(({ item: a, share, acumulado, classe }) => (
              <tr key={a.item_id}>
                <td data-label="Classe"><Classe c={classe} perda={a.lucro < 0} /></td>
                <td data-label="Anúncio" style={{ fontWeight: 600, textAlign: "left" }}>{a.title}</td>
                <td data-label="Lucro" style={{ color: a.lucro >= 0 ? "var(--green)" : "var(--red-text)", fontWeight: 700 }}>{fmtBRL(a.lucro)}</td>
                <td data-label="% do lucro" style={{ color: "var(--muted)" }}>{fmtPct(share, 1)}</td>
                <td data-label="Acumulado"><Barra valor={acumulado} classe={classe} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <VerMais total={linhas.length} todas={todas} onTodas={onTodas} />
    </>
  );
}
