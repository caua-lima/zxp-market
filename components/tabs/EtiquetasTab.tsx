"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authedFetch } from "@/lib/api/authed-fetch";
import TelaHeader from "@/components/TelaHeader";
import Modal from "@/components/Modal";
import { lerArquivos } from "@/lib/etiquetas/arquivos";
import { lerLote, pareceZpl, type LoteZpl } from "@/lib/etiquetas/lote-zpl";
import { linhasDaLista, montarSaida, zplDeSaida, type EnvioResolvido, type EtiquetaDeSaida } from "@/lib/etiquetas/montagem";
import { base64ParaBytes, renderizarEtiqueta } from "@/lib/etiquetas/motor-cliente";
import { descreverTexto, pdfDaListaDeSeparacao, pdfDasEtiquetas } from "@/lib/etiquetas/pdf";

/**
 * ETIQUETAS — o conversor ZPL da expedição.
 *
 * Tudo no navegador: o arquivo do ML (ZIP/TXT) não sobe pra lugar nenhum; só
 * os NÚMEROS DE ENVIO vão pro servidor, pra saber o que tem dentro de cada
 * pacote (/api/etiquetas/resolver). O motor (Zebrash/WASM) é servido pelo
 * próprio site e roda num Worker — sem Labelary, sem CDN.
 *
 * Saídas: prévia de cada etiqueta, PDF das etiquetas (4×6), ZPL pra Zebra
 * (com a sigla marcada onde há espaço livre; auxiliar quando não há) e a
 * lista de separação em PDF.
 */

type Lido = { lote: LoteZpl; arquivos: string[]; ignorados: { nome: string; motivo: string }[] };

function carimbo(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function baixar(dados: BlobPart, nome: string, tipo: string) {
  const url = URL.createObjectURL(new Blob([dados], { type: tipo }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Abre o PDF num iframe escondido e chama a impressão; se o navegador barrar, abre em aba nova. */
function imprimirPdf(bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  frame.src = url;
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      window.open(url, "_blank", "noopener");
    }
    setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 120_000);
  };
  document.body.appendChild(frame);
}

export default function EtiquetasTab() {
  const [lido, setLido] = useState<Lido | null>(null);
  const [lendo, setLendo] = useState(false);
  const [falhaLeitura, setFalhaLeitura] = useState<string | null>(null);
  const [resolvidos, setResolvidos] = useState<Map<string, EnvioResolvido>>(new Map());
  const [consultando, setConsultando] = useState(false);
  const [falhaConsulta, setFalhaConsulta] = useState<string | null>(null);
  const [semSigla, setSemSigla] = useState<string[]>([]);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [marcar, setMarcar] = useState(true);
  const [previas, setPrevias] = useState<Record<string, string>>({});
  const [errosRender, setErrosRender] = useState<Record<string, string>>({});
  const [ampliada, setAmpliada] = useState<EtiquetaDeSaida | null>(null);
  const [ocupado, setOcupado] = useState<null | "pdf" | "imprimir" | "lista">(null);
  const [colar, setColar] = useState(false);
  const [textoColado, setTextoColado] = useState("");
  const [arrastando, setArrastando] = useState(false);
  /**
   * Etiquetas que a pessoa tirou da impressão (pedido do dono, 27/11/2026:
   * a auxiliar gasta etiqueta). Pela `chave` da saída — some do PDF, do
   * "Imprimir" e do ZPL baixado, e volta com um clique. Arquivo novo zera.
   */
  const [excluidas, setExcluidas] = useState<Set<string>>(new Set());
  const alternarExclusao = (chave: string) => setExcluidas((atual) => {
    const n = new Set(atual);
    if (n.has(chave)) n.delete(chave); else n.add(chave);
    return n;
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const cache = useRef(new Map<string, string>());
  const emAndamento = useRef(new Set<string>());
  const geracao = useRef(0);

  const consultar = useCallback(async (lote: LoteZpl) => {
    const envios = [...new Set(lote.etiquetas.map((e) => e.envio).filter((x): x is string => !!x))];
    if (!envios.length) return;
    const minha = geracao.current;
    setConsultando(true);
    setFalhaConsulta(null);
    try {
      const r = await authedFetch("/api/etiquetas/resolver", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ envios }),
      });
      const j = (await r.json().catch(() => null)) as { envios?: EnvioResolvido[]; produtosSemSigla?: string[]; nomesDasSiglas?: Record<string, string>; error?: string } | null;
      if (minha !== geracao.current) return;
      if (!r.ok || !j?.envios) throw new Error(j?.error ? `erro ${r.status}: ${j.error}` : `erro ${r.status}`);
      setResolvidos(new Map(j.envios.map((e) => [e.envio, e])));
      setSemSigla(j.produtosSemSigla ?? []);
      setNomes(j.nomesDasSiglas ?? {});
    } catch (e) {
      if (minha === geracao.current) setFalhaConsulta(e instanceof Error ? e.message : String(e));
    } finally {
      if (minha === geracao.current) setConsultando(false);
    }
  }, []);

  const carregarTexto = useCallback((textos: { nome: string; texto: string }[], ignorados: { nome: string; motivo: string }[]) => {
    geracao.current += 1;
    cache.current.clear();
    emAndamento.current.clear();
    setPrevias({});
    setErrosRender({});
    setResolvidos(new Map());
    setSemSigla([]);
    setFalhaConsulta(null);
    if (!textos.length) {
      setLido(null);
      setFalhaLeitura(ignorados.length ? ignorados.map((i) => `${i.nome}: ${i.motivo}`).join(" · ") : "Nenhuma etiqueta ZPL encontrada.");
      return;
    }
    const lote = lerLote(textos.map((t) => t.texto).join("\n"));
    if (!lote.etiquetas.length) {
      setLido(null);
      setFalhaLeitura("O arquivo não tem nenhuma etiqueta (^XA … ^XZ).");
      return;
    }
    setFalhaLeitura(null);
    setLido({ lote, arquivos: textos.map((t) => t.nome), ignorados });
    setExcluidas(new Set());
    void consultar(lote);
  }, [consultar]);

  const abrirArquivos = useCallback(async (lista: FileList | File[] | null) => {
    const arquivos = Array.from(lista ?? []);
    if (!arquivos.length) return;
    setLendo(true);
    try {
      const r = await lerArquivos(arquivos);
      carregarTexto(r.textos, r.ignorados);
    } catch (e) {
      setFalhaLeitura(`Não consegui ler o arquivo: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLendo(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [carregarTexto]);

  const saida = useMemo(
    () => (lido ? montarSaida(lido.lote.etiquetas, resolvidos, { marcar, duplicados: lido.lote.duplicados }) : []),
    [lido, resolvidos, marcar],
  );
  /** O que vai pra impressora: a saída menos as excluídas. */
  const impressas = useMemo(() => saida.filter((s) => !excluidas.has(s.chave)), [saida, excluidas]);
  const auxiliares = saida.filter((s) => s.tipo === "auxiliar");
  const auxiliaresExcluidas = auxiliares.filter((s) => excluidas.has(s.chave)).length;
  const linhas = useMemo(() => (lido ? linhasDaLista(lido.lote.etiquetas, resolvidos, lido.lote.duplicados) : []), [lido, resolvidos]);
  const totais = useMemo(() => {
    const t = new Map<string, number>();
    for (const l of linhas) {
      for (const parte of String(l.texto ?? "").split("+").map((s) => s.trim()).filter(Boolean)) {
        const m = parte.match(/^(\d*)([A-Z0-9]+)$/);
        if (m) t.set(m[2], (t.get(m[2]) ?? 0) + (m[1] ? Number(m[1]) : 1));
      }
    }
    return [...t].sort(([a], [b]) => a.localeCompare(b));
  }, [linhas]);
  const prontas = linhas.filter((l) => l.texto).length;
  const pendentes = linhas.length - prontas;

  // Prévia: desenha uma por vez, na ordem, o que ainda não está no cache.
  useEffect(() => {
    const minha = geracao.current;
    let vivo = true;
    (async () => {
      for (const s of saida) {
        if (!vivo || minha !== geracao.current) return;
        if (cache.current.has(s.chave) || emAndamento.current.has(s.chave)) continue;
        emAndamento.current.add(s.chave);
        try {
          const png = await renderizarEtiqueta(s.zpl);
          if (minha !== geracao.current) return;
          cache.current.set(s.chave, png);
          setPrevias((p) => ({ ...p, [s.chave]: png }));
        } catch (e) {
          if (minha !== geracao.current) return;
          setErrosRender((p) => ({ ...p, [s.chave]: e instanceof Error ? e.message : String(e) }));
        } finally {
          emAndamento.current.delete(s.chave);
        }
      }
    })();
    return () => { vivo = false; };
  }, [saida]);

  const pngsDaSaida = useCallback(async (): Promise<Uint8Array[]> => {
    const out: Uint8Array[] = [];
    for (const s of impressas) {
      let png = cache.current.get(s.chave);
      if (!png) {
        png = await renderizarEtiqueta(s.zpl);
        cache.current.set(s.chave, png);
      }
      out.push(base64ParaBytes(png));
    }
    return out;
  }, [impressas]);

  const gerarPdf = useCallback(async (modo: "pdf" | "imprimir") => {
    setOcupado(modo);
    try {
      const bytes = await pdfDasEtiquetas(await pngsDaSaida());
      if (modo === "pdf") baixar(bytes as BlobPart, `etiquetas-${carimbo()}.pdf`, "application/pdf");
      else imprimirPdf(bytes);
    } catch (e) {
      alert(`Não consegui gerar o PDF: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setOcupado(null);
    }
  }, [pngsDaSaida]);

  const gerarLista = useCallback(async () => {
    if (!lido) return;
    setOcupado("lista");
    try {
      const bytes = await pdfDaListaDeSeparacao({ linhas, geradoEm: new Date(), arquivo: lido.arquivos.join(", "), nomes });
      baixar(bytes as BlobPart, `lista-separacao-${carimbo()}.pdf`, "application/pdf");
    } catch (e) {
      alert(`Não consegui gerar a lista: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setOcupado(null);
    }
  }, [lido, linhas, nomes]);

  const baixarZpl = useCallback(() => {
    if (!lido) return;
    baixar(zplDeSaida(impressas, lido.lote.prefixo), `etiquetas-${marcar ? "marcadas-" : ""}${carimbo()}.txt`, "text/plain;charset=utf-8");
  }, [lido, impressas, marcar]);

  const desenhadas = saida.filter((s) => previas[s.chave]).length;
  const comErro = saida.filter((s) => errosRender[s.chave]).length;
  const tudoPronto = saida.length > 0 && desenhadas === saida.length;

  return (
    <div className="dash">
      <TelaHeader
        titulo="Etiquetas"
        subtitulo={lido
          ? `${lido.lote.etiquetas.length} etiqueta(s) · ${lido.arquivos.join(", ")}`
          : "Conversor ZPL do Mercado Livre: prévia, PDF, sigla de separação e lista — tudo aqui, sem site externo"}
        acao={lido
          ? { rotulo: ocupado === "imprimir" ? "Preparando…" : "Imprimir etiquetas", onClick: () => void gerarPdf("imprimir"), desabilitada: !!ocupado || !impressas.length }
          : { rotulo: "Abrir arquivo do ML", onClick: () => inputRef.current?.click() }}
        secundarias={lido ? [
          { rotulo: "Abrir outro arquivo", onClick: () => inputRef.current?.click() },
          { rotulo: "Colar ZPL", onClick: () => setColar(true) },
          { rotulo: "Consultar envios de novo", onClick: () => void consultar(lido.lote), desabilitada: consultando },
        ] : [{ rotulo: "Colar ZPL", onClick: () => setColar(true) }]}
      />

      <input
        ref={inputRef} type="file" multiple hidden accept=".zip,.txt,.zpl,application/zip,text/plain"
        onChange={(e) => void abrirArquivos(e.target.files)}
      />

      {falhaLeitura && <div className="note note-warn" style={{ marginBottom: 12 }}>{falhaLeitura}</div>}

      {!lido && (
        <div
          role="button" tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
          onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => { e.preventDefault(); setArrastando(false); void abrirArquivos(e.dataTransfer.files); }}
          className="panel"
          style={{
            cursor: "pointer", textAlign: "center", padding: "48px 20px", borderStyle: "dashed",
            borderColor: arrastando ? "var(--accent)" : undefined, background: arrastando ? "var(--surface2)" : undefined,
          }}
        >
          <div style={{ fontSize: "1.05rem", fontWeight: 800, marginBottom: 6 }}>{lendo ? "Lendo…" : "Solte aqui o ZIP das etiquetas do ML"}</div>
          <div style={{ color: "var(--muted)", fontSize: ".86rem" }}>
            ou clique pra escolher · aceita .zip, .txt e .zpl (baixe as etiquetas em <b>ZPL</b> no Mercado Livre)
          </div>
        </div>
      )}

      {lido && (
        <>
          {(falhaConsulta || consultando || semSigla.length > 0 || lido.lote.duplicados.length > 0 || lido.ignorados.length > 0) && (
            <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
              {consultando && <div className="note note-purple">Consultando o que vai em cada envio…</div>}
              {falhaConsulta && (
                <div className="note note-warn">
                  Não consegui consultar os envios ({falhaConsulta}). As etiquetas imprimem normalmente, só sem a sigla.{" "}
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => void consultar(lido.lote)}>Tentar de novo</button>
                </div>
              )}
              {lido.lote.duplicados.length > 0 && <div className="note note-warn">Envio repetido no arquivo: {lido.lote.duplicados.join(", ")} — confira antes de despachar.</div>}
              {semSigla.length > 0 && <div className="note note-purple">Produtos ativos sem sigla no Estoque: {semSigla.slice(0, 8).join(", ")}{semSigla.length > 8 ? ` e mais ${semSigla.length - 8}` : ""}.</div>}
              {lido.ignorados.length > 0 && <div className="note note-purple">Fora do lote: {lido.ignorados.map((i) => `${i.nome} (${i.motivo})`).join(" · ")}</div>}
            </div>
          )}

          <section className="panel" style={{ marginBottom: 14 }}>
            <div className="panel-head">
              <span className="panel-title">Separar</span>
              <span className="panel-sub">{prontas} pronta(s){pendentes ? ` · ${pendentes} pendente(s)` : ""}</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              {totais.length === 0 && <span style={{ color: "var(--muted)", fontSize: ".86rem" }}>{consultando ? "…" : "Nenhum envio com sigla ainda."}</span>}
              {totais.map(([sigla, q]) => (
                <span key={sigla} className="pill" style={{ fontSize: ".95rem" }}><b>{sigla}</b>{nomes[sigla] ? ` ${nomes[sigla]}` : ""} · {q} un</span>
              ))}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14, alignItems: "center" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: ".86rem", marginRight: 6 }}>
                <input type="checkbox" checked={marcar} onChange={(e) => setMarcar(e.target.checked)} />
                Marcar a sigla na etiqueta
              </label>
              <button type="button" className="btn btn-ghost btn-sm" disabled={!!ocupado} onClick={() => void gerarPdf("pdf")}>
                {ocupado === "pdf" ? "Gerando…" : "Baixar PDF das etiquetas"}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={baixarZpl}>Baixar ZPL (Zebra)</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={!!ocupado || consultando} onClick={() => void gerarLista()}>
                {ocupado === "lista" ? "Gerando…" : "Lista de separação (PDF)"}
              </button>
              <span style={{ fontSize: ".78rem", color: comErro ? "var(--red-text)" : "var(--muted)", marginLeft: "auto" }}>
                {tudoPronto ? `${impressas.length} etiqueta(s) pra imprimir` : `Desenhando ${desenhadas}/${saida.length}…`}
                {excluidas.size ? ` · ${excluidas.size} excluída(s)` : ""}
                {comErro ? ` · ${comErro} com erro` : ""}
              </span>
            </div>
            {auxiliares.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10, alignItems: "center", fontSize: ".82rem" }}>
                <span style={{ color: "var(--muted)" }}>
                  {auxiliares.length} etiqueta(s) auxiliar(es) de separação{auxiliaresExcluidas ? ` · ${auxiliaresExcluidas} fora da impressão` : ""}.
                </span>
                {auxiliaresExcluidas < auxiliares.length
                  ? <button type="button" className="btn btn-ghost btn-xs" onClick={() => setExcluidas((a) => new Set([...a, ...auxiliares.map((x) => x.chave)]))}>Excluir todas as auxiliares</button>
                  : <button type="button" className="btn btn-ghost btn-xs" onClick={() => setExcluidas((a) => new Set([...a].filter((c) => !auxiliares.some((x) => x.chave === c))))}>Voltar as auxiliares</button>}
              </div>
            )}
          </section>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12 }}>
            {saida.map((s) => {
              const png = previas[s.chave];
              const erro = errosRender[s.chave];
              const fora = excluidas.has(s.chave);
              return (
                <div
                  key={s.chave}
                  className="panel"
                  style={{ padding: 8, textAlign: "left", display: "flex", flexDirection: "column", gap: 6, opacity: fora ? 0.45 : 1 }}
                >
                  <div role={png ? "button" : undefined} tabIndex={png ? 0 : undefined} onClick={() => png && setAmpliada(s)}
                    onKeyDown={(e) => { if (png && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setAmpliada(s); } }}
                    style={{ cursor: png ? "zoom-in" : "default", aspectRatio: "2 / 3", width: "100%", background: "#fff", borderRadius: 6, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--border)" }}>
                    {png
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={`data:image/png;base64,${png}`} alt={`Etiqueta ${s.origem + 1}`} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                      : <span style={{ fontSize: ".75rem", color: erro ? "#b00" : "#888", padding: 8, textAlign: "center" }}>{erro ? `Não desenhou: ${erro}` : "desenhando…"}</span>}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: ".78rem", fontWeight: 800 }}>#{s.origem + 1}{s.tipo === "auxiliar" ? " · auxiliar" : ""}</span>
                    {s.texto
                      ? <span className={s.tipo === "auxiliar" ? "chip chip-accent" : "chip chip-green"}>{s.texto}</span>
                      : <span className="chip chip-yellow">pendente</span>}
                  </div>
                  {s.texto && <div style={{ fontSize: ".74rem" }}>{descreverTexto(s.texto, nomes)}</div>}
                  <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>{s.envio ? `Envio ${s.envio}` : "sem envio"}</div>
                  {s.aviso && <div style={{ fontSize: ".72rem", color: "var(--warning)" }}>{s.aviso}</div>}
                  {fora && s.tipo === "auxiliar" && s.texto && (
                    <div style={{ fontSize: ".72rem", color: "var(--warning)" }}>Fora da impressão: escreva {s.texto} à mão no pacote.</div>
                  )}
                  <button type="button" className={fora ? "btn btn-primary btn-xs" : "btn btn-ghost btn-xs"} onClick={() => alternarExclusao(s.chave)}
                    title={fora ? "Volta pra impressão" : "Tira esta etiqueta do PDF, do Imprimir e do ZPL"}>
                    {fora ? "Excluída · voltar" : "Excluir da impressão"}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {ampliada && previas[ampliada.chave] && (
        <Modal open onClose={() => setAmpliada(null)}>
          <div className="modal-title">Etiqueta #{ampliada.origem + 1}{ampliada.texto ? ` · ${ampliada.texto}` : ""}</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`data:image/png;base64,${previas[ampliada.chave]}`} alt="" style={{ width: "100%", maxHeight: "75vh", objectFit: "contain", background: "#fff", borderRadius: 6 }} />
          <div className="modal-btns"><button type="button" className="btn btn-ghost" onClick={() => setAmpliada(null)}>Fechar</button></div>
        </Modal>
      )}

      {colar && (
        <Modal open onClose={() => setColar(false)}>
          <div className="modal-title">Colar ZPL</div>
          <textarea
            value={textoColado} onChange={(e) => setTextoColado(e.target.value)} rows={10} placeholder="^XA … ^XZ"
            style={{ width: "100%", fontFamily: "monospace", fontSize: ".78rem" }}
          />
          <div className="modal-btns">
            <button type="button" className="btn btn-ghost" onClick={() => setColar(false)}>Cancelar</button>
            <button
              type="button" className="btn btn-primary" disabled={!pareceZpl(textoColado)}
              onClick={() => { carregarTexto([{ nome: "texto colado", texto: textoColado }], []); setColar(false); setTextoColado(""); }}
            >Converter</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
