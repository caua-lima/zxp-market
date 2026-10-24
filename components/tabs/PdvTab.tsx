"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import TelaHeader from "@/components/TelaHeader";
import { useAccess } from "@/components/tabs/AccessGuard";
import { fmtBRL, parseBRNumber, todayStr } from "@/lib/domain/calc";
import type { Product } from "@/lib/domain/types";
import {
  contasDaVenda,
  custoDoDia,
  FORMAS_PAGAMENTO,
  montarVendaPresencial,
  problemaDoCarrinho,
  resumoPresencial,
  ROTULO_PAGAMENTO,
  ultimoPrecoPresencial,
  type FormaPagamento,
  type VendaPresencial,
} from "@/lib/domain/venda-presencial";
import { cancelarVendaPresencial, registrarVendaPresencial, watchVendasPresenciais } from "@/lib/firebase/data";
import { EVENTO_PDV_MUDOU } from "@/components/BarraAoVivo";
import s from "./PdvTab.module.css";

/**
 * PDV — as vendas do PRESENCIAL. Sem nota, sem imposto, sem taxa: o lucro é o
 * preço cobrado menos o custo médio do dia (ver lib/domain/venda-presencial.ts).
 * Fechar a venda baixa o estoque "em casa" no mesmo lote; cancelar devolve.
 */

type Linha = { chave: string; productId: string; quantidade: number; preco: string };
type Periodo = "hoje" | "mes" | "mesPassado";

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** O relógio fica fora do componente: só é lido no clique de fechar a venda. */
const instanteAtual = () => Date.now();
const novoId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const horaAgora = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const fmtPct = (v: number | null) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
const diaCurto = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
/** "1.234,5" pro campo de preço (sem R$, editável). */
const precoParaCampo = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function periodoDe(p: Periodo): { de: string; ate: string; rotulo: string } {
  const hoje = todayStr();
  const [a, m] = hoje.split("-").map(Number);
  if (p === "hoje") return { de: hoje, ate: hoje, rotulo: "Hoje" };
  if (p === "mes") return { de: `${hoje.slice(0, 7)}-01`, ate: hoje, rotulo: "Este mês" };
  const ano = m === 1 ? a - 1 : a;
  const mes = m === 1 ? 12 : m - 1;
  const ultimo = new Date(ano, mes, 0).getDate();
  const mm = String(mes).padStart(2, "0");
  return { de: `${ano}-${mm}-01`, ate: `${ano}-${mm}-${String(ultimo).padStart(2, "0")}`, rotulo: "Mês passado" };
}

export default function PdvTab({ products }: { products: Product[] }) {
  const { canEditTab } = useAccess();
  const podeVender = canEditTab("estoque");

  // Lê do 1º dia do mês passado até hoje: cobre os três períodos e o "último preço cobrado".
  const janela = useMemo(() => ({ de: periodoDe("mesPassado").de, ate: todayStr() }), []);
  const [vendas, setVendas] = useState<VendaPresencial[] | null>(null);
  const [erroLeitura, setErroLeitura] = useState<string | null>(null);
  useEffect(() => watchVendasPresenciais(janela.de, janela.ate, (v) => { setVendas(v); setErroLeitura(null); }, () => setErroLeitura("Não consegui ler as vendas do PDV. Se a coleção é nova, as regras do Firestore precisam ser publicadas.")), [janela]);

  const [periodo, setPeriodo] = useState<Periodo>("hoje");
  const per = periodoDe(periodo);
  const resumo = useMemo(() => resumoPresencial(vendas ?? [], per.de, per.ate), [vendas, per.de, per.ate]);
  const doPeriodo = useMemo(
    () => (vendas ?? []).filter((v) => v.data >= per.de && v.data <= per.ate).sort((a, b) => `${b.data} ${b.hora} ${b.criadoEm}`.localeCompare(`${a.data} ${a.hora} ${a.criadoEm}`)),
    [vendas, per.de, per.ate],
  );

  return (
    <div className={s.tela}>
      <TelaHeader titulo="PDV" subtitulo="vendas presenciais — sem nota e sem imposto: lucro é preço menos custo" />

      <div className={s.periodos} role="group" aria-label="Período">
        {(["hoje", "mes", "mesPassado"] as Periodo[]).map((p) => (
          <button key={p} type="button" className={s.periodo} aria-pressed={periodo === p} onClick={() => setPeriodo(p)}>{periodoDe(p).rotulo}</button>
        ))}
      </div>

      <section className={s.kpis} aria-label={`Resumo — ${per.rotulo}`}>
        <Kpi rotulo="Faturamento" valor={fmtBRL(resumo.faturamento)} sub={resumo.desconto > 0 ? `${fmtBRL(resumo.desconto)} em descontos` : undefined} />
        <Kpi rotulo="Lucro" valor={fmtBRL(resumo.lucro)} sub={`margem ${fmtPct(resumo.margem)}`} tom={resumo.lucro < 0 ? "ruim" : resumo.lucro > 0 ? "bom" : undefined} />
        <Kpi rotulo="Vendas" valor={String(resumo.vendas)} sub={resumo.ticketMedio != null ? `ticket ${fmtBRL(resumo.ticketMedio)}` : undefined} />
        <Kpi rotulo="Unidades" valor={String(resumo.unidades)} sub={resumo.custo > 0 ? `custo ${fmtBRL(resumo.custo)}` : undefined} />
      </section>

      {erroLeitura && <div className={s.aviso} role="alert">{erroLeitura}</div>}

      <div className={s.grade}>
        {podeVender
          ? <NovaVenda products={products} vendas={vendas ?? []} />
          : <div className={`${s.cartao} ${s.semPermissao}`}>Pra registrar venda presencial é preciso poder editar o <b>Estoque</b> (a venda baixa o estoque). Peça ao dono do acesso.</div>}

        <section className={s.cartao} aria-labelledby="pdv-vendas">
          <div className={s.cartaoCabeca}>
            <h2 id="pdv-vendas" className={s.cartaoTitulo}>Vendas — {per.rotulo.toLowerCase()}</h2>
            {resumo.porPagamento.length > 0 && (
              <div className={s.pagamentos}>
                {resumo.porPagamento.map((p) => <span key={p.forma} className="chip chip-muted">{ROTULO_PAGAMENTO[p.forma]} {fmtBRL(p.total)}</span>)}
              </div>
            )}
          </div>
          {vendas === null && !erroLeitura && <p className={s.vazio}>Carregando…</p>}
          {vendas !== null && doPeriodo.length === 0 && <p className={s.vazio}>Nenhuma venda presencial {periodo === "hoje" ? "hoje" : "no período"}.</p>}
          <ul className={s.lista}>
            {doPeriodo.map((v) => <LinhaDaVenda key={v.id} v={v} mostrarDia={periodo !== "hoje"} podeCancelar={podeVender} />)}
          </ul>
          {resumo.porProduto.length > 0 && (
            <div className={s.porProduto}>
              <h3 className={s.subtitulo}>Por produto</h3>
              <table className={s.tabela}>
                <thead><tr><th>Produto</th><th className={s.num}>Un.</th><th className={s.num}>Faturamento</th><th className={s.num}>Lucro</th></tr></thead>
                <tbody>
                  {resumo.porProduto.slice(0, 10).map((p) => (
                    <tr key={p.productId}><td>{p.nome}</td><td className={s.num}>{p.unidades}</td><td className={s.num}>{fmtBRL(p.faturamento)}</td><td className={`${s.num} ${p.lucro < 0 ? s.ruim : ""}`}>{fmtBRL(p.lucro)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Kpi({ rotulo, valor, sub, tom }: { rotulo: string; valor: string; sub?: string; tom?: "bom" | "ruim" }) {
  return (
    <div className={s.kpi}>
      <div className={s.kpiRotulo}>{rotulo}</div>
      <div className={s.kpiValor} data-tom={tom}>{valor}</div>
      {sub && <div className={s.kpiSub}>{sub}</div>}
    </div>
  );
}

function NovaVenda({ products, vendas }: { products: Product[]; vendas: VendaPresencial[] }) {
  const [id, setId] = useState(novoId);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [busca, setBusca] = useState("");
  const [desconto, setDesconto] = useState("");
  const [pagamento, setPagamento] = useState<FormaPagamento>("pix");
  const [cliente, setCliente] = useState("");
  const [obs, setObs] = useState("");
  const [data, setData] = useState(todayStr);
  const [hora, setHora] = useState(horaAgora);
  const [mais, setMais] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const buscaRef = useRef<HTMLInputElement | null>(null);

  const ativos = useMemo(() => products.filter((p) => p.ativo !== false), [products]);
  const porId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const resultados = useMemo(() => {
    const q = semAcento(busca.trim());
    if (!q) return [];
    return ativos.filter((p) => semAcento(`${p.name} ${p.sku ?? ""}`).includes(q)).slice(0, 8);
  }, [busca, ativos]);

  const adicionar = (p: Product) => {
    setLinhas((ls) => {
      const ja = ls.find((l) => l.productId === p.id);
      if (ja) return ls.map((l) => (l === ja ? { ...l, quantidade: l.quantidade + 1 } : l));
      const ultimo = ultimoPrecoPresencial(p.id, vendas);
      return [...ls, { chave: novoId(), productId: p.id, quantidade: 1, preco: ultimo != null ? precoParaCampo(ultimo) : "" }];
    });
    setBusca("");
    setMsg(null);
    buscaRef.current?.focus();
  };
  const mudar = (chave: string, patch: Partial<Linha>) => setLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, ...patch } : l)));
  const tirar = (chave: string) => setLinhas((ls) => ls.filter((l) => l.chave !== chave));

  // A conta ao vivo, com o custo do dia escolhido.
  const linhasNum = linhas.map((l) => ({ productId: l.productId, quantidade: l.quantidade, precoUnit: parseBRNumber(l.preco) }));
  const itensConta = linhas.map((l, i) => {
    const p = porId.get(l.productId);
    return { quantidade: l.quantidade, precoUnit: linhasNum[i].precoUnit, custoUnit: p ? custoDoDia(p, data) : 0 };
  });
  const descontoNum = desconto.trim() ? parseBRNumber(desconto) : 0;
  const contas = contasDaVenda(itensConta, descontoNum);
  const problema = linhas.length ? problemaDoCarrinho(linhasNum, descontoNum) : null;
  const semPreco = linhas.some((l) => !l.preco.trim());

  // Vender mais do que o livro diz que está em casa não é proibido (o livro pode estar atrás), mas avisa.
  const alertasEstoque = linhas.flatMap((l) => {
    const p = porId.get(l.productId);
    if (!p) return [];
    const total = linhas.filter((x) => x.productId === l.productId).reduce((t, x) => t + x.quantidade, 0);
    const casa = Math.max(Number(p.qtdLocal ?? 0), 0);
    return total > casa && linhas.find((x) => x.productId === l.productId) === l ? [`${p.name}: vendendo ${total}, o estoque diz ${casa} em casa`] : [];
  });
  const nasAgencias = linhas.map((l) => porId.get(l.productId)).filter((p): p is Product => !!p && p.canal === "agencias" && Boolean(p.mlbs?.length || p.mlb));

  const fechar = async () => {
    if (salvando) return;
    const r = montarVendaPresencial({
      id, linhas: linhasNum, desconto: descontoNum, pagamento, cliente, obs, data, hora,
      produtos: products, email: "", agora: instanteAtual(),
    });
    if (!r.ok) { setMsg({ tipo: "erro", texto: r.erro }); return; }
    setSalvando(true);
    setMsg(null);
    try {
      // Quem vendeu é carimbado na gravação, com o e-mail da sessão.
      await registrarVendaPresencial(r);
      window.dispatchEvent(new Event(EVENTO_PDV_MUDOU));
      const agencias = nasAgencias.length ? ` Confira o estoque do anúncio nas agências no ML: ${[...new Set(nasAgencias.map((p) => p.name))].join(", ")}.` : "";
      setMsg({ tipo: "ok", texto: `Venda de ${fmtBRL(r.venda.total)} registrada — lucro ${fmtBRL(r.venda.lucro)}. Estoque baixado.${agencias}` });
      setLinhas([]); setDesconto(""); setCliente(""); setObs(""); setMais(false);
      setId(novoId());
      setData(todayStr()); setHora(horaAgora());
    } catch (e) {
      setMsg({ tipo: "erro", texto: `Não consegui registrar: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <section className={s.cartao} aria-labelledby="pdv-nova">
      <h2 id="pdv-nova" className={s.cartaoTitulo}>Nova venda</h2>

      <div className={s.busca}>
        <input
          ref={buscaRef} type="search" className={s.campo} placeholder="Buscar produto por nome ou SKU"
          value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar produto"
          onKeyDown={(e) => { if (e.key === "Enter" && resultados[0]) { e.preventDefault(); adicionar(resultados[0]); } }}
        />
        {resultados.length > 0 && (
          <ul className={s.resultados} role="listbox" aria-label="Produtos encontrados">
            {resultados.map((p) => (
              <li key={p.id}>
                <button type="button" className={s.resultado} onClick={() => adicionar(p)}>
                  <span className={s.resultadoNome}>{p.name}</span>
                  <span className={s.resultadoInfo}>{p.sku ? `${p.sku} · ` : ""}{Math.max(Number(p.qtdLocal ?? 0), 0)} em casa · custo {fmtBRL(custoDoDia(p, data))}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {busca.trim() && resultados.length === 0 && <p className={s.dica}>Nenhum produto ativo com “{busca.trim()}”.</p>}
      </div>

      {linhas.length === 0 ? (
        <p className={s.vazio}>Busque e toque num produto pra pôr no carrinho.</p>
      ) : (
        <ul className={s.carrinho} aria-label="Carrinho">
          {linhas.map((l, i) => {
            const p = porId.get(l.productId);
            const preco = linhasNum[i].precoUnit;
            const custo = itensConta[i].custoUnit;
            const lucroLinha = l.quantidade * (preco - custo);
            return (
              <li key={l.chave} className={s.item}>
                <div className={s.itemTopo}>
                  <span className={s.itemNome}>{p?.name ?? "Produto removido"}</span>
                  <button type="button" className={s.tirar} onClick={() => tirar(l.chave)} aria-label={`Tirar ${p?.name ?? "produto"} do carrinho`}>×</button>
                </div>
                <div className={s.itemControles}>
                  <div className={s.qtd} role="group" aria-label="Quantidade">
                    <button type="button" onClick={() => mudar(l.chave, { quantidade: Math.max(1, l.quantidade - 1) })} aria-label="Menos um">−</button>
                    <input
                      type="number" inputMode="numeric" min={1} value={l.quantidade} aria-label="Quantidade"
                      onChange={(e) => mudar(l.chave, { quantidade: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                    />
                    <button type="button" onClick={() => mudar(l.chave, { quantidade: l.quantidade + 1 })} aria-label="Mais um">+</button>
                  </div>
                  <label className={s.preco}>
                    <span>R$</span>
                    <input
                      type="text" inputMode="decimal" placeholder="preço un." value={l.preco} aria-label={`Preço por unidade de ${p?.name ?? "produto"}`}
                      onChange={(e) => mudar(l.chave, { preco: e.target.value })}
                    />
                  </label>
                </div>
                <div className={s.itemConta}>
                  {l.preco.trim()
                    ? <>
                        <span>{fmtBRL(l.quantidade * preco)}</span>
                        <span className={lucroLinha < 0 ? s.ruim : s.bom}>lucro {fmtBRL(lucroLinha)}</span>
                        <span className={s.custoUn}>custo {fmtBRL(custo)}/un</span>
                      </>
                    : <span className={s.dica}>Digite o preço cobrado por unidade.</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {linhas.length > 0 && (
        <>
          <div className={s.pagamento} role="radiogroup" aria-label="Forma de pagamento">
            {FORMAS_PAGAMENTO.map((f) => (
              <button key={f} type="button" role="radio" aria-checked={pagamento === f} className={s.forma} onClick={() => setPagamento(f)}>{ROTULO_PAGAMENTO[f]}</button>
            ))}
          </div>

          <div className={s.linhaCampos}>
            <label className={s.rotulado}>
              <span>Desconto (R$)</span>
              <input type="text" inputMode="decimal" className={s.campo} placeholder="0,00" value={desconto} onChange={(e) => setDesconto(e.target.value)} />
            </label>
            <label className={s.rotulado}>
              <span>Cliente (opcional)</span>
              <input type="text" className={s.campo} maxLength={120} value={cliente} onChange={(e) => setCliente(e.target.value)} />
            </label>
          </div>

          <button type="button" className={s.mais} aria-expanded={mais} onClick={() => setMais((m) => !m)}>
            {mais ? "Menos detalhes" : `Data, hora e observação (${data === todayStr() ? "hoje" : diaCurto(data)}, ${hora})`}
          </button>
          {mais && (
            <div className={s.linhaCampos}>
              <label className={s.rotulado}><span>Data</span><input type="date" className={s.campo} value={data} max={todayStr()} onChange={(e) => setData(e.target.value)} /></label>
              <label className={s.rotulado}><span>Hora</span><input type="time" className={s.campo} value={hora} onChange={(e) => setHora(e.target.value)} /></label>
              <label className={`${s.rotulado} ${s.largo}`}><span>Observação</span><input type="text" className={s.campo} maxLength={500} value={obs} onChange={(e) => setObs(e.target.value)} /></label>
            </div>
          )}

          {alertasEstoque.length > 0 && (
            <ul className={s.alertas}>{alertasEstoque.map((a) => <li key={a}>{a}</li>)}</ul>
          )}

          <div className={s.total}>
            <div className={s.totalLinha}><span>Subtotal</span><span>{fmtBRL(contas.bruto)}</span></div>
            {contas.desconto > 0 && <div className={s.totalLinha}><span>Desconto</span><span>− {fmtBRL(contas.desconto)}</span></div>}
            <div className={s.totalLinha}><span>Custo da mercadoria</span><span>− {fmtBRL(contas.custo)}</span></div>
            <div className={`${s.totalLinha} ${s.totalLucro}`}>
              <span>Lucro <small>(sem imposto)</small></span>
              <span className={contas.lucro < 0 ? s.ruim : s.bom}>{fmtBRL(contas.lucro)}{contas.margem != null ? ` · ${fmtPct(contas.margem)}` : ""}</span>
            </div>
          </div>

          <button
            type="button" className={`btn btn-primary ${s.fechar}`} onClick={fechar}
            disabled={salvando || !!problema || semPreco}
            title={semPreco ? "Falta o preço de algum produto" : problema ?? undefined}
          >
            {salvando ? "Registrando…" : `Fechar venda · ${fmtBRL(contas.total)}`}
          </button>
          {(problema || semPreco) && !salvando && <p className={s.dica}>{semPreco ? "Falta o preço de algum produto." : problema}</p>}
        </>
      )}

      {msg && <div className={msg.tipo === "ok" ? s.ok : s.erro} role="status">{msg.texto}</div>}
    </section>
  );
}

function LinhaDaVenda({ v, mostrarDia, podeCancelar }: { v: VendaPresencial; mostrarDia: boolean; podeCancelar: boolean }) {
  const [aberta, setAberta] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const cancelada = v.status === "cancelada";
  const resumoItens = v.itens.map((i) => `${i.quantidade}× ${i.nome}`).join(", ");

  const confirmar = async () => {
    setOcupado(true);
    setErro(null);
    try {
      await cancelarVendaPresencial(v, motivo);
      window.dispatchEvent(new Event(EVENTO_PDV_MUDOU));
      setCancelando(false);
    } catch (e) {
      setErro(`Não consegui cancelar: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <li className={s.venda} data-cancelada={cancelada ? "true" : undefined}>
      <button type="button" className={s.vendaResumo} aria-expanded={aberta} onClick={() => setAberta((a) => !a)}>
        <span className={s.vendaQuando}>{mostrarDia ? `${diaCurto(v.data)} ` : ""}{v.hora}</span>
        <span className={s.vendaItens}>{resumoItens}{v.cliente ? <em> · {v.cliente}</em> : null}</span>
        <span className={s.vendaValores}>
          <b>{fmtBRL(v.total)}</b>
          {cancelada ? <span className="chip chip-muted">cancelada</span> : <span className={v.lucro < 0 ? s.ruim : s.bom}>lucro {fmtBRL(v.lucro)}</span>}
        </span>
      </button>
      {aberta && (
        <div className={s.vendaDetalhe}>
          <table className={s.tabela}>
            <thead><tr><th>Item</th><th className={s.num}>Qtd</th><th className={s.num}>Preço</th><th className={s.num}>Custo</th></tr></thead>
            <tbody>
              {v.itens.map((i, k) => (
                <tr key={k}><td>{i.nome}</td><td className={s.num}>{i.quantidade}</td><td className={s.num}>{fmtBRL(i.precoUnit)}</td><td className={s.num}>{fmtBRL(i.custoUnit)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className={s.dica}>
            {ROTULO_PAGAMENTO[v.pagamento]}{v.desconto > 0 ? ` · desconto ${fmtBRL(v.desconto)}` : ""} · custo {fmtBRL(v.custo)} · registrada por {v.criadoPor || "—"}
            {v.obs ? ` · ${v.obs}` : ""}
          </p>
          {cancelada && (
            <p className={s.dica}>Cancelada{v.canceladaPor ? ` por ${v.canceladaPor}` : ""}{v.motivoCancelamento ? ` — ${v.motivoCancelamento}` : ""}. O estoque voltou.</p>
          )}
          {!cancelada && podeCancelar && !cancelando && (
            <button type="button" className="btn btn-danger btn-xs" onClick={() => setCancelando(true)}>Cancelar venda</button>
          )}
          {cancelando && (
            <div className={s.cancelar}>
              <input type="text" className={s.campo} placeholder="Motivo (opcional)" maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} aria-label="Motivo do cancelamento" />
              <div className={s.cancelarAcoes}>
                <button type="button" className="btn btn-danger btn-sm" disabled={ocupado} onClick={confirmar}>{ocupado ? "Cancelando…" : "Confirmar: cancelar e devolver o estoque"}</button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={ocupado} onClick={() => setCancelando(false)}>Voltar</button>
              </div>
            </div>
          )}
          {erro && <div className={s.erro} role="alert">{erro}</div>}
        </div>
      )}
    </li>
  );
}
