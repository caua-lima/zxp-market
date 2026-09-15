"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { authedFetch } from "@/lib/api/authed-fetch";
import { fmtBRL } from "@/lib/domain/calc";
import type { Product } from "@/lib/domain/types";

type MlItem = { available: number; status: string; price: number; logistic: string };
type EstoqueML = Record<string, MlItem>;

type Simulacao = {
  anuncio: { mlb: string; titulo: string; precoAtual: number; categoria: string; tipoAnuncio: string; logistica: string };
  produto: { nome: string; vinculado: boolean; custo: number; impostoPct: number };
  taxas: { comissaoPercentual: number; comissaoFixa: number; cepFrete: string; freteIndisponivel: boolean };
  simulacao: {
    preco: number; comissao: number; frete: number; custo: number; imposto: number;
    ads: number; outros: number; lucro: number; margem: number; markup: number; repasse: number;
  };
  precoSugerido: number | null;
  margemAlvo: number | null;
};

const TIPO_LABEL: Record<string, string> = {
  gold_special: "Clássico", gold_pro: "Premium", gold_premium: "Diamante", free: "Grátis",
};

function num(v: string): number {
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Calculadora de preço: escolhe um anúncio ativo, testa um preço e vê o lucro
 * real — com a comissão que o Mercado Livre de fato cobraria NAQUELE preço.
 *
 * Por que não é uma conta local: a comissão do ML muda de faixa conforme o
 * preço (medido na conta: 14% a R$99, 11% a R$150) e a taxa fixa varia por
 * categoria. Estimar aqui erraria justamente onde a decisão acontece — então
 * cada simulação consulta as taxas reais (ver app/api/ml/simular-preco).
 */
export default function PrecoTab({ products }: { products: Product[] }) {
  const [estoqueML, setEstoqueML] = useState<EstoqueML>({});
  const [carregandoLista, setCarregandoLista] = useState(true);
  const [mlb, setMlb] = useState("");
  const [preco, setPreco] = useState("");
  const [ads, setAds] = useState("");
  const [outros, setOutros] = useState("");
  const [imposto, setImposto] = useState("");
  const [margemAlvo, setMargemAlvo] = useState("");
  const [cep, setCep] = useState("01001000");
  const [sim, setSim] = useState<Simulacao | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    authedFetch("/api/ml/estoque-ml", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.estoque) setEstoqueML(j.estoque); })
      .catch(() => {})
      .finally(() => setCarregandoLista(false));
  }, []);

  /** Nome do produto cadastrado por MLB — o título do ML é longo demais pro select. */
  const nomePorMlb = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products) {
      const lista = p.mlbs?.length ? p.mlbs : p.mlb ? [p.mlb] : [];
      for (const x of lista) m.set(String(x).trim().toUpperCase(), p.name || "");
    }
    return m;
  }, [products]);

  const anuncios = useMemo(() => {
    return Object.entries(estoqueML)
      .filter(([, v]) => v.status === "active")
      .map(([id, v]) => ({ mlb: id, preco: v.price, nome: nomePorMlb.get(id) || id, logistic: v.logistic }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [estoqueML, nomePorMlb]);

  const simular = useCallback(async () => {
    if (!mlb) { setErro("Escolha um anúncio."); return; }
    setCarregando(true);
    setErro("");
    try {
      const q = new URLSearchParams({ mlb, cep });
      if (num(preco) > 0) q.set("preco", String(num(preco)));
      if (ads.trim()) q.set("ads", String(num(ads)));
      if (outros.trim()) q.set("outros", String(num(outros)));
      if (imposto.trim()) q.set("imposto", String(num(imposto)));
      if (num(margemAlvo) > 0) q.set("margemAlvo", String(num(margemAlvo)));

      const r = await authedFetch(`/api/ml/simular-preco?${q}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setErro(j?.details || j?.error || `Falhou (HTTP ${r.status})`); setSim(null); return; }
      setSim(j as Simulacao);
      // Preenche o campo com o preço simulado (útil quando abriu no preço atual).
      if (!preco.trim()) setPreco(String((j as Simulacao).simulacao.preco));
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setSim(null);
    } finally {
      setCarregando(false);
    }
  }, [mlb, preco, ads, outros, imposto, margemAlvo, cep]);

  const s = sim?.simulacao;
  const lucrativo = (s?.lucro ?? 0) > 0;

  return (
    <div className="dash">
      <div className="tab-head">
        <div className="tab-head-left"><h2 className="tab-title">Calculadora de Preço</h2></div>
      </div>
      <div style={{ fontSize: ".8rem", color: "var(--muted)", marginTop: -6 }}>
        Escolha o anúncio, teste um preço e veja o lucro real — com a comissão que o Mercado Livre
        cobraria <b>naquele preço</b>, buscada na hora, não estimada.
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <div className="panel-head" style={{ marginBottom: 10 }}>
          <span className="panel-title">Simulação</span>
          <span className="panel-sub">taxas ao vivo do Mercado Livre</span>
        </div>

        <div className="form-grid">
          <div className="config-field" style={{ margin: 0 }}>
            <label>Anúncio ativo</label>
            {/* Limpa no EVENTO, não num efeito: trocar de anúncio deixando na
                tela o lucro do anterior seria enganoso, mas isso é reação a
                uma ação do usuário — não sincronização com sistema externo. */}
            <select
              value={mlb}
              onChange={(e) => { setMlb(e.target.value); setSim(null); setPreco(""); setErro(""); }}
              disabled={carregandoLista}
            >
              <option value="">{carregandoLista ? "Carregando anúncios…" : "Selecione…"}</option>
              {anuncios.map((a) => (
                <option key={a.mlb} value={a.mlb}>
                  {a.nome} — {fmtBRL(a.preco)} ({a.mlb})
                </option>
              ))}
            </select>
            {!carregandoLista && anuncios.length === 0 && (
              <div className="hint">Nenhum anúncio ativo encontrado. Cadastre os MLBs na aba Estoque.</div>
            )}
          </div>

          <div className="config-field" style={{ margin: 0 }}>
            <label>Preço que quero testar</label>
            <input
              type="number" inputMode="decimal" step="0.01" value={preco}
              onChange={(e) => setPreco(e.target.value)}
              placeholder={mlb ? "Vazio = preço atual do anúncio" : "Escolha o anúncio primeiro"}
              onKeyDown={(e) => { if (e.key === "Enter") simular(); }}
            />
          </div>
        </div>

        <div className="form-grid" style={{ marginTop: 12 }}>
          <div className="config-field" style={{ margin: 0 }}>
            <label>Imposto (%)</label>
            <input
              type="number" inputMode="decimal" step="0.01" value={imposto}
              onChange={(e) => setImposto(e.target.value)}
              placeholder={sim ? `Cadastrado: ${sim.produto.impostoPct}%` : "Vazio = o do produto"}
            />
            <div className="hint">Vazio usa a alíquota cadastrada no Estoque, com a vigência da data de hoje.</div>
          </div>

          <div className="config-field" style={{ margin: 0 }}>
            <label>Ads por unidade (R$)</label>
            <input
              type="number" inputMode="decimal" step="0.01" value={ads}
              onChange={(e) => setAds(e.target.value)} placeholder="Opcional"
            />
            <div className="hint">Só entra se você informar — não é estimado.</div>
          </div>
        </div>

        <div className="form-grid" style={{ marginTop: 12 }}>
          <div className="config-field" style={{ margin: 0 }}>
            <label>Outros custos por unidade (R$)</label>
            <input
              type="number" inputMode="decimal" step="0.01" value={outros}
              onChange={(e) => setOutros(e.target.value)} placeholder="Embalagem, etiqueta…"
            />
          </div>

          <div className="config-field" style={{ margin: 0 }}>
            <label>CEP de destino (frete)</label>
            <input
              type="text" inputMode="numeric" value={cep}
              onChange={(e) => setCep(e.target.value)} placeholder="01001000"
            />
            <div className="hint">O frete varia por destino. Padrão: São Paulo capital.</div>
          </div>
        </div>

        <div className="config-field" style={{ marginTop: 12 }}>
          <label>Quero margem de (%) — opcional</label>
          <input
            type="number" inputMode="decimal" step="0.1" value={margemAlvo}
            onChange={(e) => setMargemAlvo(e.target.value)}
            placeholder="Ex: 25 — calcula o preço mínimo pra essa margem"
            onKeyDown={(e) => { if (e.key === "Enter") simular(); }}
          />
        </div>

        {erro && <div className="note note-danger" role="alert" style={{ marginTop: 12 }}>{erro}</div>}

        <div className="row-actions" style={{ marginTop: 14 }}>
          <button type="button" className="btn btn-primary" onClick={simular} disabled={carregando || !mlb}>
            {carregando ? "Consultando o Mercado Livre…" : "Simular"}
          </button>
        </div>
      </div>

      {sim && s && (
        <>
          <div className="kpi-grid" style={{ marginTop: 14 }}>
            <div className={lucrativo ? "kpi k-pos" : "kpi k-neg"}>
              <div className="k-lbl">Lucro por unidade</div>
              <div className="k-val tabular-nums" style={{ color: lucrativo ? "var(--green)" : "var(--red)" }}>
                {fmtBRL(s.lucro)}
              </div>
              <div className="k-sub">vendendo a {fmtBRL(s.preco)}</div>
            </div>
            <div className={lucrativo ? "kpi k-pos" : "kpi k-neg"}>
              <div className="k-lbl">Margem</div>
              <div className="k-val tabular-nums" style={{ color: lucrativo ? "var(--green)" : "var(--red)" }}>
                {s.margem.toFixed(1)}%
              </div>
              <div className="k-sub">lucro ÷ preço de venda</div>
            </div>
            <div className="kpi k-acc">
              <div className="k-lbl">Markup</div>
              <div className="k-val tabular-nums">{s.markup > 0 ? `${s.markup.toFixed(0)}%` : "—"}</div>
              <div className="k-sub">{s.markup > 0 ? "retorno sobre o custo" : "sem custo cadastrado"}</div>
            </div>
            <div className="kpi k-acc">
              <div className="k-lbl">Repasse do ML</div>
              <div className="k-val tabular-nums">{fmtBRL(s.repasse)}</div>
              <div className="k-sub">preço − comissão − frete</div>
            </div>
          </div>

          {sim.taxas.freteIndisponivel && (
            <div className="note note-accent" style={{ marginTop: 12 }}>
              <b>O Mercado Livre não devolveu o frete deste anúncio.</b> O lucro acima está
              <b> sem o custo de frete</b> — ou seja, otimista. Confira o frete no anúncio antes de decidir.
            </div>
          )}

          {!sim.produto.vinculado && (
            <div className="note note-accent" style={{ marginTop: 12 }}>
              <b>Este anúncio não está vinculado a nenhum produto do Estoque.</b> O custo entrou como
              R$ 0,00, então o lucro acima está inflado. Vincule o MLB ao produto na aba Estoque.
            </div>
          )}

          <div className="panel" style={{ marginTop: 14 }}>
            <div className="panel-head" style={{ marginBottom: 8 }}>
              <span className="panel-title">De onde sai cada real</span>
              <span className="panel-sub">{sim.anuncio.titulo}</span>
            </div>

            <div className="table-wrapper" style={{ border: "1px solid var(--border)" }}>
              <table className="tbl-modern tbl-cards">
                <tbody>
                  <Linha rotulo="Preço de venda" valor={s.preco} tom="neutro" />
                  <Linha
                    rotulo={`Comissão do ML (${sim.taxas.comissaoPercentual}%${sim.taxas.comissaoFixa > 0 ? ` + ${fmtBRL(sim.taxas.comissaoFixa)} fixa` : ""})`}
                    valor={-s.comissao} tom="saida"
                  />
                  <Linha rotulo={`Frete que você paga (CEP ${sim.taxas.cepFrete})`} valor={-s.frete} tom="saida" />
                  <Linha rotulo="Custo do produto" valor={-s.custo} tom="saida" />
                  <Linha rotulo={`Imposto (${sim.produto.impostoPct}%)`} valor={-s.imposto} tom="saida" />
                  {s.ads > 0 && <Linha rotulo="Ads por unidade" valor={-s.ads} tom="saida" />}
                  {s.outros > 0 && <Linha rotulo="Outros custos" valor={-s.outros} tom="saida" />}
                  <Linha rotulo="Sobra pra você" valor={s.lucro} tom={lucrativo ? "entrada" : "saida"} destaque />
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 10, fontSize: ".75rem", color: "var(--muted)", lineHeight: 1.5 }}>
              Anúncio <b>{TIPO_LABEL[sim.anuncio.tipoAnuncio] ?? sim.anuncio.tipoAnuncio}</b> · categoria{" "}
              {sim.anuncio.categoria} · preço atual {fmtBRL(sim.anuncio.precoAtual)}
              {sim.produto.vinculado && <> · produto <b>{sim.produto.nome}</b></>}
              <br />
              A comissão foi consultada no Mercado Livre <b>para este preço</b> — ela muda por faixa de
              preço e por categoria, então não é uma porcentagem fixa.
            </div>
          </div>

          {sim.margemAlvo != null && (
            <div className="panel" style={{ marginTop: 14 }}>
              <div className="panel-head" style={{ marginBottom: 8 }}>
                <span className="panel-title">Para margem de {sim.margemAlvo}%</span>
              </div>
              {sim.precoSugerido != null ? (
                <div>
                  <div style={{ fontSize: "1.6rem", fontWeight: 800, color: "var(--brand)" }} className="tabular-nums">
                    {fmtBRL(sim.precoSugerido)}
                  </div>
                  <div style={{ fontSize: ".82rem", color: "var(--muted)", marginTop: 4 }}>
                    É o <b>menor</b> preço que entrega {sim.margemAlvo}% com os custos informados.
                    {sim.precoSugerido > sim.anuncio.precoAtual
                      ? ` Hoje o anúncio está ${fmtBRL(sim.anuncio.precoAtual)} — ${fmtBRL(sim.precoSugerido - sim.anuncio.precoAtual)} abaixo disso.`
                      : ` O preço atual (${fmtBRL(sim.anuncio.precoAtual)}) já supera essa margem.`}
                  </div>
                </div>
              ) : (
                <div className="note note-danger">
                  <b>Não há preço que atinja {sim.margemAlvo}% com estes custos.</b> Comissão, imposto e
                  frete consomem uma parte do preço que cresce junto com ele — para essa margem, seria
                  preciso baixar o custo do produto.
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Linha({ rotulo, valor, tom, destaque }: {
  rotulo: string; valor: number; tom: "entrada" | "saida" | "neutro"; destaque?: boolean;
}) {
  const cor = tom === "entrada" ? "var(--green)" : tom === "saida" ? "var(--red)" : "var(--text)";
  return (
    <tr>
      <td style={{ textAlign: "left", fontWeight: destaque ? 700 : 400 }}>{rotulo}</td>
      <td
        className="tabular-nums"
        style={{ textAlign: "right", color: cor, fontWeight: destaque ? 800 : 600, fontSize: destaque ? "1.05rem" : undefined }}
      >
        {valor < 0 ? `− ${fmtBRL(Math.abs(valor))}` : fmtBRL(valor)}
      </td>
    </tr>
  );
}
