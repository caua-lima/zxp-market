"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { authedFetch } from "@/lib/api/authed-fetch";
import { mlbsDe, normMlb } from "@/components/tabs/estoque/estoque-compartilhado";
import type {
  PlanoSku, ResumoSku,
} from "@/components/tabs/estoque/estoque-compartilhado";
import { upsertProduct } from "@/lib/firebase/data";
import type { Product } from "@/lib/domain/types";

/**
 * Vincula anúncio a produto casando o SKU.
 *
 * Os três tipos vieram junto: são só deste modal, e deixá-los no arquivo de
 * origem os tornaria órfãos — alguém teria que abrir dois arquivos pra
 * entender um formulário.
 */
// ── Imposto em massa ──────────────────────────────────────────────────────
/**
 * O imposto fica no cadastro do produto e o lucro o aplica na hora de ler.
 * Ou seja, mudar aqui muda também o lucro dos meses já fechados — por isso o
 * aviso é explícito antes de gravar.
 */
// ── Vincular anúncio ao produto pelo SKU ──────────────────────────────────
/**
 * Puxa do ML o SKU de cada anúncio e sugere vincular ao produto de mesmo SKU.
 * Só sugere; a gravação acontece aqui no cliente, com a confirmação do dono,
 * porque é ele quem tem permissão de escrever no Estoque.
 */
export default function VincularSkuModal({ uid, produtos, onClose }: { uid: string; produtos: Product[]; onClose: () => void }) {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [plano, setPlano] = useState<PlanoSku[]>([]);
  const [resumo, setResumo] = useState<ResumoSku | null>(null);
  const [aplicando, setAplicando] = useState(false);
  const [feito, setFeito] = useState(0);
  const [concluido, setConcluido] = useState(false);
  // Cada anúncio sugerido é escolhido individualmente: match aproximado pode
  // aproximar SKUs de produtos diferentes, e vincular errado bagunça o lucro.
  const [marcados, setMarcados] = useState<Set<string>>(new Set());

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await authedFetch("/api/ml/vincular-sku", { cache: "no-store" });
        const txt = await r.text();
        if (!vivo) return;
        if (!r.ok) { setErro(`HTTP ${r.status} — ${txt.slice(0, 300)}`); }
        else {
          const j = JSON.parse(txt) as { plano?: PlanoSku[]; resumo?: ResumoSku };
          const lista = j.plano ?? [];
          setPlano(lista);
          setResumo(j.resumo ?? null);
          // Exato já vem marcado; aproximado exige o seu aval.
          const iniciais = new Set<string>();
          for (const item of lista) {
            for (const n of item.novos) if (n.exato) iniciais.add(`${item.productId}|${n.mlb}`);
          }
          setMarcados(iniciais);
        }
      } catch (e) {
        if (vivo) setErro(`Falhou: ${String(e).slice(0, 200)}`);
      } finally {
        if (vivo) setCarregando(false);
      }
    })();

    /**
     * A limpeza que não existia.
     *
     * `let vivo = true` estava aqui em cima e NUNCA virava false — não
     * havia return nenhum neste efeito. Os quatro `if (vivo)` abaixo eram
     * decoração: se a pessoa trocasse de aba no meio da busca, todos os
     * setState disparavam mesmo assim, num componente já desmontado.
     *
     * Quem achou foi o `prefer-const` do lint, reclamando que `vivo` nunca
     * é reatribuído. Era a única pista de que a guarda estava morta.
     */
    return () => { vivo = false; };
  }, []);

  const alterna = (chave: string) => setMarcados((s) => {
    const novo = new Set(s);
    if (novo.has(chave)) novo.delete(chave); else novo.add(chave);
    return novo;
  });

  const totalMarcado = marcados.size;

  async function aplicar() {
    setAplicando(true);
    try {
      let n = 0;
      for (const item of plano) {
        const escolhidos = item.novos.filter((x) => marcados.has(`${item.productId}|${x.mlb}`));
        if (!escolhidos.length) continue;
        const prod = produtos.find((p) => p.id === item.productId);
        if (!prod) continue;
        // Une os anúncios atuais com os escolhidos, sem duplicar.
        const atuais = mlbsDe(prod).map(normMlb).filter(Boolean);
        const merged = Array.from(new Set([...atuais, ...escolhidos.map((x) => x.mlb)]));
        await upsertProduct(uid, { ...prod, mlbs: merged, mlb: merged[0] ?? "" });
        n += escolhidos.length;
        setFeito(n);
      }
      setConcluido(true);
    } catch (e) {
      alert("Erro ao vincular: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setAplicando(false);
    }
  }

  return (
    <Modal open onClose={onClose}>
      <div className="modal-title">Vincular anúncios por SKU</div>
      <div className="modal-sub">liga cada produto ao anúncio do ML que tem o mesmo SKU</div>

      {carregando ? (
        <div style={{ padding: "24px 0", textAlign: "center", color: "var(--muted)" }}>
          Lendo os anúncios do Mercado Livre…
        </div>
      ) : erro ? (
        <div style={{
          margin: "12px 0", padding: 10, borderRadius: 8,
          background: "rgba(214,90,74,.12)", border: "1px solid rgba(214,90,74,.4)",
          fontFamily: "ui-monospace, monospace", fontSize: ".75rem", whiteSpace: "pre-wrap",
        }}>{erro}</div>
      ) : concluido ? (
        <div style={{
          margin: "12px 0", padding: "12px 14px", borderRadius: 8,
          background: "rgba(54,179,126,.1)", border: "1px solid rgba(54,179,126,.4)",
          color: "var(--green)", fontSize: ".86rem",
        }}>
          <b>{feito} produto{feito === 1 ? "" : "s"} vinculado{feito === 1 ? "" : "s"}.</b> Os dados do ML
          já passam a bater com esses anúncios.
        </div>
      ) : (
        <>
          {resumo && (
            <div style={{
              display: "flex", flexWrap: "wrap", gap: 8, margin: "12px 0",
              fontSize: ".8rem", color: "var(--muted)",
            }}>
              <span style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 9px" }}>
                {resumo.anunciosLidos} anúncios lidos
              </span>
              <span style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 9px" }}>
                <b style={{ color: "var(--green)" }}>{resumo.aVincular}</b> vínculo(s) a criar
              </span>
              {resumo.semSku > 0 && (
                <span style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 9px" }}>
                  {resumo.semSku} produto(s) sem SKU
                </span>
              )}
              {resumo.semMatch > 0 && (
                <span style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 9px" }}>
                  {resumo.semMatch} sem anúncio de mesmo SKU
                </span>
              )}
              {resumo.aproximados > 0 && (
                <span style={{ background: "var(--warning-soft)", border: "1px solid rgba(255,138,31,.4)", borderRadius: 6, padding: "4px 9px", color: "var(--warning)" }}>
                  {resumo.aproximados} aproximado(s) — confira antes
                </span>
              )}
            </div>
          )}

          {plano.length === 0 ? (
            <div style={{ padding: "16px 0", fontSize: ".86rem", color: "var(--muted)", lineHeight: 1.6 }}>
              Nada a vincular — todo produto com SKU já está ligado ao anúncio correspondente.
              {!!resumo?.semSku && <> Os {resumo.semSku} produto(s) sem SKU precisam do código preenchido na ficha para casar.</>}
            </div>
          ) : (
            <div style={{ maxHeight: 340, overflow: "auto", margin: "4px 0 12px" }}>
              {plano.map((item) => (
                <div key={item.productId} style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                    <span style={{ fontWeight: 600, fontSize: ".86rem" }}>{item.name || "—"}</span>
                    <span style={{ fontSize: ".75rem", color: "var(--muted)", fontFamily: "monospace" }}>SKU {item.sku}</span>
                  </div>

                  {item.atuais.length > 0 && (
                    <div style={{ fontSize: ".75rem", color: "var(--muted)", marginTop: 3 }}>
                      já vinculado: {item.atuais.map((a) => a.mlb).join(", ")}
                    </div>
                  )}

                  {item.novos.map((n) => {
                    const chave = `${item.productId}|${n.mlb}`;
                    const on = marcados.has(chave);
                    return (
                      <label key={n.mlb} style={{
                        display: "flex", gap: 8, alignItems: "flex-start", marginTop: 6,
                        padding: "6px 8px", borderRadius: 6, cursor: "pointer",
                        background: on ? "rgba(54,179,126,.08)" : "var(--surface2)",
                        border: `1px solid ${on ? "rgba(54,179,126,.35)" : "var(--border)"}`,
                      }}>
                        <input
                          type="checkbox" checked={on} onChange={() => alterna(chave)}
                          style={{ marginTop: 3, flexShrink: 0 }}
                        />
                        <span style={{ minWidth: 0 }}>
                          <span style={{ fontFamily: "monospace", fontSize: ".8rem", color: "var(--text)" }}>{n.mlb}</span>
                          {!n.exato && (
                            <span style={{ marginLeft: 6, fontSize: ".75rem", fontWeight: 700, color: "var(--warning)", background: "var(--warning-soft)", padding: "1px 5px", borderRadius: 4 }}>
                              APROXIMADO
                            </span>
                          )}
                          {n.titulo && (
                            <span style={{ display: "block", fontSize: ".75rem", color: "var(--muted)" }}>{n.titulo.slice(0, 52)}</span>
                          )}
                          <span style={{ display: "block", fontSize: ".75rem", color: "var(--muted)", fontFamily: "monospace" }}>
                            SKU no ML: {n.skuAnuncio || "—"}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="modal-btns">
        {!concluido && plano.length > 0 && !erro && (
          <button type="button" className="btn btn-success" onClick={aplicar} disabled={aplicando || carregando || totalMarcado === 0}>
            {aplicando ? `Vinculando… ${feito}` : `Vincular ${totalMarcado} anúncio(s)`}
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={aplicando}>
          {concluido ? "Fechar" : "Cancelar"}
        </button>
      </div>
    </Modal>
  );
}
