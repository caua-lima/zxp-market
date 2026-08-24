"use client";

import { useEffect, useRef, useState } from "react";
import type { EstoqueMovimento } from "@/lib/domain/types";
import { movIdRemessa, remessaTemBaixa, type Remessa } from "@/lib/domain/remessas";
import CustosColetaFull from "@/components/tabs/full/CustosColetaFull";
import { separarParaAutoBaixa } from "@/lib/domain/full-auto-baixa";
import { addMovimento, ignorarRemessaFull, reabrirRemessaFull, salvarCustoRemessaFull, watchRemessasIgnoradas } from "@/lib/firebase/data";
import { authedFetch } from "@/lib/api/authed-fetch";
import { fmtBRL } from "@/lib/domain/calc";

// ── Remessas pro Full: baixa a partir do que o ML recebeu ─────────────────
export default function RemessasFull({ movimentos }: { movimentos: EstoqueMovimento[] }) {
  const [dados, setDados] = useState<{
    opStatus?: number; opErro?: string; remessas?: Remessa[]; dias?: number;
    janela?: { from: string; to: string };
    totalDisponivel?: number; totalVendido?: number;
    custoTotalRemessas?: number; custoRemessaIndisponivel?: number;
    duplicadasIgnoradas?: number;
  } | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [qtds, setQtds] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState("");
  const [erro, setErro] = useState("");
  const [ignoradas, setIgnoradas] = useState<Set<string>>(new Set());
  const [mostrarResolvidas, setMostrarResolvidas] = useState(false);
  // Custo da coleta digitado a mao, por remessa. A API publica do ML nao expoe
  // esse valor (ver salvarCustoRemessaFull) — sem isto ele nunca chega na DRE.
  const [custos, setCustos] = useState<Record<string, string>>({});
  const [salvandoCusto, setSalvandoCusto] = useState("");
  /**
   * Ligada por padrão, mas desligável e lembrada no aparelho: baixa de estoque
   * mexe em dinheiro, e quem não quiser automação precisa conseguir sair dela
   * sem depender de deploy.
   */
  const [autoBaixaLigada, setAutoBaixaLigada] = useState(true);
  // Lido no efeito, e nao na inicializacao do useState, de proposito:
  // localStorage nao existe no servidor, e inicializar com o valor salvo
  // faria o HTML do servidor (sempre "ligada") divergir do cliente. Mesmo
  // padrao dos filtros salvos em PedidosTab.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { setAutoBaixaLigada(localStorage.getItem("full:auto-baixa") !== "0"); } catch { /* sem storage: segue ligada */ }
  }, []);
  function alternarAutoBaixa(v: boolean) {
    setAutoBaixaLigada(v);
    try { localStorage.setItem("full:auto-baixa", v ? "1" : "0"); } catch { /* ignora */ }
  }

  useEffect(() => watchRemessasIgnoradas(setIgnoradas), []);

  async function marcarResolvida(remessa: string) {
    try {
      await ignorarRemessaFull(remessa);
    } catch (e) {
      alert(
        "Não consegui marcar como resolvida. Se o erro fala em permissão, " +
        "as regras do Firestore precisam ser republicadas com a coleção full_remessas.\n\n" +
        (e instanceof Error ? e.message : String(e)),
      );
    }
  }

  async function buscar(forcar = false) {
    setAberto(true);
    setCarregando(true);
    setErro("");
    try {
      const r = await authedFetch(`/api/ml/gestao-full${forcar ? "?forcar=1" : ""}`, { cache: "no-store" });
      const txt = await r.text();
      if (!r.ok) setErro(`HTTP ${r.status} — ${txt.slice(0, 300)}`);
      else setDados(JSON.parse(txt));
    } catch (e) {
      setErro(`Falhou: ${String(e).slice(0, 200)}`);
    }
    setCarregando(false);
  }

  const todas = dados?.remessas ?? [];
  // Envio seu tira estoque de casa; transferência entre centros do ML, não.
  const remessas = todas.filter((r) => !r.ehTransferencia);
  const transferencias = todas.filter((r) => r.ehTransferencia);
  /**
   * Unidades que chegaram no centro mas NÃO viraram estoque vendável
   * (avaria, divergência de conferência). É o equivalente da coluna
   * "Diferenças" da tela de envio do Seller Center: se este número for
   * maior que zero, o que você enviou e o que virou venda não batem, e a
   * diferença é prejuízo silencioso — sai do seu estoque e nunca vende.
   */
  const divergencia = remessas.reduce((s, r) => s + (r.problema ?? 0), 0);
  // Produto específico já com baixa gravada nesta remessa (não a remessa
  // inteira). Sem isso, reabrir a página depois de uma baixa parcial (falhou
  // no meio do loop) reapresentava TODOS os produtos editáveis com o valor
  // default do ML — reenviar sobrescreveria uma correção que já tinha dado
  // certo, voltando ela pro valor recebido em vez do que você digitou.
  const movDoProduto = (r: Remessa, productId: string) =>
    productId ? movimentos.find((m) => m.id === movIdRemessa(r.remessa, productId)) : undefined;
  // Total que será baixado agora — só o que falta, já com as correções digitadas.
  const totalDaRemessa = (r: Remessa) =>
    r.produtos.reduce((s, p) => {
      if (!p.productId || movDoProduto(r, p.productId)) return s;
      return s + Math.max(Math.round(Number(qtds[`${r.remessa}|${p.productId}`] ?? p.qtd) || 0), 0);
    }, 0);
  const jaBaixada = (r: Remessa) => remessaTemBaixa(r, movimentos);
  // Resolvida = deu baixa por aqui, ou foi marcada como lançada à mão.
  const resolvida = (r: Remessa) => jaBaixada(r) || ignoradas.has(r.remessa);
  const pendentes = remessas.filter((r) => !resolvida(r));
  const resolvidas = remessas.filter(resolvida);

  /**
   * Baixa automática das remessas que não têm NADA pra decidir (ver
   * lib/domain/full-auto-baixa.ts): recebimento sem divergência, todo produto
   * cadastrado, não é transferência. Nesse caso conferir era só ritual — o
   * número já vinha certo e o clique só atrasava o lançamento.
   *
   * O que tem divergência ou produto sem cadastro continua na lista pra você
   * decidir: é onde o olho humano vale, e automatizar erraria caro (baixa
   * errada entra silenciosa no custo médio e contamina a margem das vendas
   * seguintes).
   */
  const { automaticas } = separarParaAutoBaixa(remessas, resolvida);
  // Guarda o que já foi disparado nesta sessão: o efeito reroda quando
  // `movimentos` chega de volta e sem isto lançaria duas vezes a mesma
  // remessa antes do Firestore refletir a primeira.
  const autoEmCurso = useRef<Set<string>>(new Set());
  const [autoFeitas, setAutoFeitas] = useState<string[]>([]);

  useEffect(() => {
    if (!autoBaixaLigada || !aberto) return;
    for (const r of automaticas) {
      if (autoEmCurso.current.has(r.remessa)) continue;
      autoEmCurso.current.add(r.remessa);
      (async () => {
        try {
          for (const prod of r.produtos) {
            if (!prod.productId) continue;
            await addMovimento({
              id: movIdRemessa(r.remessa, prod.productId),
              productId: prod.productId,
              tipo: "saida_full",
              quantidade: prod.qtd,
              data: r.data,
              obs: `Remessa Full #${r.remessa} · baixa automática (recebimento sem divergência)`,
            });
          }
          setAutoFeitas((s) => (s.includes(r.remessa) ? s : [...s, r.remessa]));
        } catch {
          // Solta o cadeado pra tentar de novo na próxima carga, em vez de
          // ficar travado achando que já lançou.
          autoEmCurso.current.delete(r.remessa);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [automaticas.map((r) => r.remessa).join(","), autoBaixaLigada, aberto]);

  async function darBaixa(r: Remessa) {
    // Pula quem já tem baixa gravada: reenviar de novo é inofensivo (mesmo id,
    // sobrescreve com o mesmo valor), mas melhor nem tocar no que já está certo.
    const alvos = r.produtos.filter((p) => p.productId && !movDoProduto(r, p.productId));
    if (!alvos.length) { alert("Nada pendente: os produtos com cadastro já têm baixa nesta remessa."); return; }
    setSalvando(r.remessa);
    try {
      for (const p of alvos) {
        const chave = `${r.remessa}|${p.productId}`;
        const qtd = Math.round(Number(qtds[chave] ?? p.qtd) || 0);
        if (qtd <= 0) continue;
        const dif = qtd - p.qtd;
        await addMovimento({
          id: movIdRemessa(r.remessa, p.productId),
          productId: p.productId,
          tipo: "saida_full",
          quantidade: qtd,
          data: r.data,
          obs: `Remessa Full #${r.remessa} · ML recebeu ${p.qtd}${dif !== 0 ? ` · você informou ${qtd} (${dif > 0 ? "+" : ""}${dif})` : ""}`,
        });
      }
    } catch (e) {
      alert("Erro ao dar baixa: " + (e instanceof Error ? e.message : String(e)));
    }
    setSalvando("");
  }

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 6 }}>
        <span className="panel-title">Remessas pro Full</span>
        <span className="panel-sub">baixa de estoque a partir do que o Mercado Livre recebeu</span>
      </div>
      <div style={{ fontSize: ".8rem", color: "var(--muted)", marginBottom: 10, lineHeight: 1.55 }}>
        Busca as remessas que chegaram no Full e dá baixa no estoque de casa. A quantidade vem
        preenchida com o que o ML recebeu — <b>ajuste para o que você enviou</b> se houver diferença.
        Cada remessa só dá baixa uma vez.
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => buscar()} disabled={carregando}>
          {carregando ? "Buscando…" : aberto ? "Buscar de novo" : "Buscar remessas"}
        </button>
        <label
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: ".8rem", cursor: "pointer" }}
          title="Aplica a baixa sozinho só quando a remessa não tem nada pra decidir: recebimento sem divergência e todo produto cadastrado. Divergência ou produto sem cadastro continua vindo pra você."
        >
          <input type="checkbox" checked={autoBaixaLigada} onChange={(e) => alternarAutoBaixa(e.target.checked)} />
          Baixa automática quando não há divergência
        </label>
      </div>

      {autoFeitas.length > 0 && (
        <div className="note note-accent" style={{ marginTop: 10 }}>
          <b>{autoFeitas.length} remessa(s) baixada(s) automaticamente</b> — recebimento bateu sem divergência
          e todos os produtos estavam cadastrados: {autoFeitas.map((r) => `#${r}`).join(", ")}.
          <div style={{ marginTop: 4, fontSize: ".72rem" }}>
            Aparecem em &quot;já resolvidas&quot; abaixo, e cada lançamento está no histórico do produto no Estoque.
          </div>
        </div>
      )}

      {erro && (
        <div style={{
          marginTop: 10, padding: 8, borderRadius: 6,
          background: "rgba(214,90,74,.12)", border: "1px solid rgba(214,90,74,.4)",
          fontFamily: "ui-monospace, monospace", fontSize: ".7rem", whiteSpace: "pre-wrap",
        }}>{erro}</div>
      )}

      {aberto && !carregando && !erro && (
        <div style={{ marginTop: 12 }}>
          {remessas.length === 0 && (
            <div style={{ fontSize: ".8rem", color: "var(--muted)" }}>
              Nenhuma remessa nos últimos {dados?.dias ?? 25} dias.
            </div>
          )}

          {remessas.length > 0 && pendentes.length === 0 && (
            <div style={{ fontSize: ".82rem", color: "var(--green)", marginBottom: 10 }}>
              Nenhuma remessa pendente — tudo que chegou já foi resolvido.
            </div>
          )}

          {/* Panorama do Full com o que a API de fato entrega. Nada aqui é
              estimativa: unidades vêm do estoque ao vivo do ML, remessas e
              divergência vêm das operações de recebimento, custo vem do
              shipment. Reaproveita a MESMA resposta já buscada — zero chamada
              extra ao Mercado Livre. */}
          {dados && (
            <div className="kpi-grid" style={{ marginBottom: 14 }}>
              {/* Rótulo diz "da conta inteira" de propósito: esta rota varre
                  TODOS os anúncios do vendedor (/users/{id}/items/search),
                  enquanto o card do Estoque conta só os MLBs cadastrados lá.
                  Os dois números são certos e diferentes — chamar os dois de
                  "Disponível no Full" fazia parecer divergência de dado. */}
              <div className="kpi k-pos">
                <div className="k-lbl">No Full · conta inteira</div>
                <div className="k-val" style={{ color: "var(--green)" }}>{dados.totalDisponivel ?? 0} un</div>
                <div className="k-sub" title="Inclui anúncios que não estão cadastrados na aba Estoque. Lá o total considera só os produtos cadastrados, por isso costuma ser menor.">
                  todos os anúncios · ao vivo do ML
                </div>
              </div>
              <div className="kpi k-acc">
                <div className="k-lbl">Recebido no período</div>
                <div className="k-val">{remessas.reduce((s, r) => s + r.recebido, 0)} un</div>
                <div className="k-sub">{remessas.length} remessa(s) sua(s)</div>
              </div>
              <div className="kpi k-neg">
                <div className="k-lbl">Custo das coletas</div>
                <div className="k-val" style={{ color: (dados.custoTotalRemessas ?? 0) > 0 ? "var(--red)" : "var(--muted)" }}>
                  {fmtBRL(dados.custoTotalRemessas ?? 0)}
                </div>
                <div className="k-sub">
                  {(dados.custoRemessaIndisponivel ?? 0) > 0
                    ? `${dados.custoRemessaIndisponivel} sem custo na API — valor é o mínimo`
                    : "entra no Resultado líquido da DRE"}
                </div>
              </div>
              <div className={divergencia > 0 ? "kpi k-warn" : "kpi k-pos"}>
                <div className="k-lbl">Unidades com divergência</div>
                <div className="k-val" style={{ color: divergencia > 0 ? "var(--warning)" : "var(--green)" }}>{divergencia}</div>
                <div className="k-sub">
                  {divergencia > 0 ? "chegaram mas não ficaram vendáveis" : "tudo que chegou virou estoque"}
                </div>
              </div>
            </div>
          )}

          {!!dados?.janela && (
            <div style={{ fontSize: ".74rem", color: "var(--muted)", marginBottom: 10 }}>
              Buscando de {dados.janela.from.split("-").reverse().join("/")} a{" "}
              {dados.janela.to.split("-").reverse().join("/")}. Uma remessa só aparece
              depois que o ML processa o recebimento — o que leva alguns dias depois da coleta.
            </div>
          )}

          {pendentes.length > 1 && (
            <div style={{ marginBottom: 10 }}>
              <button
                type="button" className="btn btn-ghost btn-sm"
                onClick={async () => {
                  if (!confirm(`Marcar ${pendentes.length} remessas como já resolvidas? Não mexe no estoque.`)) return;
                  for (const r of pendentes) await marcarResolvida(r.remessa);
                }}
              >
                Marcar as {pendentes.length} como já lançadas
              </button>
            </div>
          )}

          {pendentes.map((r) => {
            const feita = jaBaixada(r);
            const semCadastro = r.produtos.filter((p) => !p.productId);
            return (
              <div key={r.remessa} style={{
                background: "var(--surface2)", border: `1px solid ${feita ? "var(--border)" : "rgba(59,130,246,.35)"}`,
                borderRadius: 12, padding: 14, marginBottom: 12,
              }}>
                {/* Cabeçalho da remessa */}
                <div style={{
                  display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center",
                  justifyContent: "space-between", paddingBottom: 10, marginBottom: 10,
                  borderBottom: "1px solid var(--border)",
                }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                    <span style={{
                      fontFamily: "ui-monospace, monospace", fontSize: ".82rem", fontWeight: 700,
                      background: "var(--surface)", border: "1px solid var(--border)",
                      borderRadius: 6, padding: "3px 8px",
                    }}>#{r.remessa}</span>
                    <span style={{ color: "var(--muted)", fontSize: ".8rem" }}>
                      {r.data.split("-").reverse().join("/")}
                    </span>
                    <span style={{ color: "var(--muted)", fontSize: ".8rem" }}>
                      {r.produtos.length} produto{r.produtos.length === 1 ? "" : "s"} · {r.recebido} un recebidas
                    </span>
                    {/* Taxa da coleta: custo real que o ML cobra pra levar do seu
                        galpão ao centro do Full. null = a API não devolveu —
                        mostrado como "sem custo informado", nunca como R$ 0,00. */}
                    <CustoColeta
                      remessa={r}
                      valor={custos[r.remessa] ?? (r.custo != null ? String(r.custo) : "")}
                      salvando={salvandoCusto === r.remessa}
                      onChange={(v) => setCustos((s) => ({ ...s, [r.remessa]: v }))}
                      onSalvar={async () => {
                        const bruto = (custos[r.remessa] ?? "").trim().replace(",", ".");
                        const n = bruto === "" ? null : Number(bruto);
                        if (bruto !== "" && (!Number.isFinite(n) || (n as number) < 0)) { alert("Informe um valor válido."); return; }
                        setSalvandoCusto(r.remessa);
                        try {
                          await salvarCustoRemessaFull(r.remessa, n);
                          await buscar(true);
                        } catch (e) {
                          alert("Não consegui salvar o custo: " + (e instanceof Error ? e.message : String(e)));
                        } finally { setSalvandoCusto(""); }
                      }}
                    />
                  </div>
                  {feita ? (
                    <span style={{
                      color: "var(--green)", fontSize: ".75rem", fontWeight: 700,
                      background: "rgba(54,179,126,.12)", border: "1px solid rgba(54,179,126,.35)",
                      borderRadius: 999, padding: "3px 10px",
                    }}>✓ baixa dada</span>
                  ) : (
                    <span style={{ fontSize: ".8rem", color: "var(--muted)" }}>
                      dar baixa de <b style={{ color: "var(--text)" }}>{totalDaRemessa(r)} un</b>
                    </span>
                  )}
                </div>

                {/* Produtos */}
                {r.produtos.map((p) => {
                  const movExistente = movDoProduto(r, p.productId);
                  const chave = `${r.remessa}|${p.productId}`;
                  const valor = movExistente ? String(movExistente.quantidade) : (qtds[chave] ?? String(p.qtd));
                  const dif = Math.round(Number(valor) || 0) - p.qtd;
                  return (
                    <div key={p.inventory} style={{
                      display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 12px",
                      alignItems: "center", padding: "7px 0",
                      borderTop: "1px solid rgba(255,255,255,.04)",
                      opacity: movExistente ? 0.65 : 1,
                    }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: ".84rem", fontWeight: 500 }}>
                          {p.nome || p.inventory}
                        </div>
                        <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>
                          {movExistente
                            ? <span style={{ color: "var(--green)" }}>✓ já baixado: {movExistente.quantidade} un</span>
                            : p.productId
                              ? <>ML recebeu {p.qtd} un{dif !== 0 && (
                                  <span style={{ color: "var(--warning)", fontWeight: 600 }}>
                                    {" · "}{dif > 0 ? `+${dif}` : dif} a mais que o recebido
                                  </span>
                                )}</>
                              : <span style={{ color: "var(--red)" }}>sem cadastro no Estoque — não dá baixa</span>}
                        </div>
                      </div>
                      <input
                        type="number"
                        inputMode="numeric"
                        aria-label={`Unidades de ${p.nome || p.inventory}`}
                        style={{
                          width: 84, fontSize: 16, textAlign: "right", padding: "7px 9px",
                          background: p.productId ? "var(--surface)" : "transparent",
                          border: `1px solid ${dif !== 0 && !movExistente && p.productId ? "rgba(255,138,31,.5)" : "var(--border)"}`,
                          borderRadius: 8, color: "var(--text)", outline: "none",
                        }}
                        value={valor}
                        disabled={!!movExistente || !p.productId}
                        onChange={(e) => setQtds((s) => ({ ...s, [chave]: e.target.value }))}
                      />
                    </div>
                  );
                })}

                {!!semCadastro.length && (
                  <div style={{
                    fontSize: ".75rem", color: "var(--warning)", marginTop: 10, padding: "7px 10px",
                    background: "var(--warning-soft)", borderRadius: 8, lineHeight: 1.5,
                  }}>
                    {semCadastro.length === 1 ? "Um produto desta remessa não está" : `${semCadastro.length} produtos desta remessa não estão`}
                    {" "}no Estoque. A baixa vai cobrir só o resto.
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn btn-success btn-sm"
                    style={{ flex: "1 1 200px" }}
                    disabled={salvando === r.remessa}
                    onClick={() => darBaixa(r)}
                  >
                    {salvando === r.remessa ? "Dando baixa…" : `Dar baixa de ${totalDaRemessa(r)} unidades`}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    title="Some da lista sem mexer no estoque — para remessa que você já lançou à mão"
                    onClick={() => marcarResolvida(r.remessa)}
                  >
                    Já lancei
                  </button>
                </div>
              </div>
            );
          })}

          {resolvidas.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setMostrarResolvidas((v) => !v)}
              >
                {mostrarResolvidas ? "Ocultar" : "Ver"} {resolvidas.length} remessa
                {resolvidas.length === 1 ? "" : "s"} já resolvida{resolvidas.length === 1 ? "" : "s"}
              </button>

              {mostrarResolvidas && resolvidas.map((r) => (
                <div key={r.remessa} style={{
                  display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center",
                  padding: "8px 12px", marginTop: 8, borderRadius: 8,
                  background: "var(--surface2)", border: "1px solid var(--border)",
                  fontSize: ".78rem", color: "var(--muted)",
                }}>
                  <b style={{ fontFamily: "monospace", color: "var(--text)" }}>#{r.remessa}</b>
                  <span>{r.data.split("-").reverse().join("/")} · {r.recebido} un</span>
                  <span style={{ color: "var(--green)" }}>
                    {jaBaixada(r) ? "✓ baixa dada aqui" : "✓ lançada à mão"}
                  </span>
                  {!jaBaixada(r) && (
                    <button
                      type="button" className="btn btn-ghost btn-xs" style={{ marginLeft: "auto" }}
                      onClick={() => reabrirRemessaFull(r.remessa)}
                    >
                      reabrir
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {!!transferencias.length && (
            <div style={{ marginTop: 6, fontSize: ".76rem", color: "var(--muted)", lineHeight: 1.5 }}>
              <b style={{ color: "var(--text)" }}>+{transferencias.reduce((s, t) => s + t.recebido, 0)} unidades</b>{" "}
              chegaram em {transferencias.length} transferência{transferencias.length === 1 ? "" : "s"} entre centros
              do ML. São unidades de remessas anteriores que o ML redirecionou — já saíram da sua casa,
              então não geram baixa.
            </div>
          )}

          {/* TODAS as coletas, inclusive as já resolvidas. A lista acima some
              conforme a baixa é dada, e o custo sumia junto — sem como
              conferir nem corrigir um valor que entra na DRE. */}
          <CustosColetaFull
            remessas={remessas.map((r) => ({
              remessa: r.remessa, data: r.data, recebido: r.recebido,
              // `custo` ausente e `null` querem dizer a mesma coisa aqui: não
              // informado. Zero seria coleta grátis, e não é o caso.
              custo: r.custo ?? null,
              custoEstimado: r.custoEstimado === true,
            }))}
            onSalvo={() => buscar(true)}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Custo da coleta de UMA remessa, editável.
 *
 * Por que é digitado e não puxado: a doc de Fulfillment do Mercado Livre é
 * explícita — "através das APIs você pode apenas consultar o estoque de
 * fulfillment e as operações realizadas". O custo da coleta não tem endpoint
 * público; ele aparece só no detalhe do envio no Seller Center, em
 * "Tarifas › Custo da coleta Full", quase sempre com o selo ESTIMADO
 * (calculado por volume × distância até o centro). O app tenta a API primeiro
 * e, quando ela não devolve nada (o caso normal hoje), este campo é o que faz
 * o custo real chegar na DRE em vez de ficar como R$ 0,00.
 */
function CustoColeta({
  remessa, valor, salvando, onChange, onSalvar,
}: {
  remessa: Remessa;
  valor: string;
  salvando: boolean;
  onChange: (v: string) => void;
  onSalvar: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const temCusto = remessa.custo != null;

  if (!editando) {
    return (
      <button
        type="button"
        onClick={() => setEditando(true)}
        title={temCusto
          ? `Taxa desta coleta — entra no Resultado líquido da DRE.${remessa.custoEstimado ? " Valor informado por você (o ML mostra como ESTIMADO)." : " Valor devolvido pela API do ML."} Clique pra alterar.`
          : "O Mercado Livre não expõe esse custo pela API. Pegue em Envios › detalhe do envio › Tarifas › Custo da coleta Full e informe aqui pra ele entrar na DRE."}
        style={{
          fontSize: ".75rem", fontWeight: 700, borderRadius: 6, padding: "2px 8px", cursor: "pointer",
          color: temCusto ? "var(--red)" : "var(--warning)",
          background: temCusto ? "var(--red-bg)" : "var(--warning-soft)",
          border: `1px solid ${temCusto ? "var(--border)" : "rgba(255,138,31,.4)"}`,
        }}
      >
        {temCusto
          ? `coleta ${fmtBRL(remessa.custo as number)}${remessa.custoEstimado ? " (estimado)" : ""}`
          : "informar custo da coleta"}
      </button>
    );
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: ".72rem", color: "var(--muted)" }}>R$</span>
      <input
        type="number" min="0" step="0.01" inputMode="decimal" autoFocus
        aria-label={`Custo da coleta da remessa ${remessa.remessa}`}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { onSalvar(); setEditando(false); } if (e.key === "Escape") setEditando(false); }}
        style={{
          width: 92, fontSize: 16, padding: "4px 8px", textAlign: "right",
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 6, color: "var(--text)", outline: "none",
        }}
      />
      <button
        type="button" className="btn btn-success btn-xs" disabled={salvando}
        onClick={() => { onSalvar(); setEditando(false); }}
      >
        {salvando ? "…" : "Salvar"}
      </button>
      <button type="button" className="btn btn-ghost btn-xs" onClick={() => setEditando(false)}>Cancelar</button>
    </span>
  );
}
