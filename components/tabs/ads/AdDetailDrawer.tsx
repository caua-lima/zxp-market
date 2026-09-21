"use client";

import Drawer from "@/components/Drawer";
import { fmtBRL } from "@/lib/domain/calc";
import type { AdsAlteracao } from "@/lib/domain/types";
import { diasDesde, formatarResumoAlteracao } from "@/lib/domain/ads-changelog";
import { corAcos, corMargem, num, STATUS_META, type LinhaAds } from "./ads-types";
import { corDoRoas } from "@/lib/domain/ads-cores";
import { explicacoesDoAnuncio } from "./ads-explicacoes";

function linkAnuncio(itemId: string): string | null {
  return /^MLB\d+$/i.test(itemId) ? `https://produto.mercadolivre.com.br/${itemId.replace(/^MLB/, "MLB-")}` : null;
}

export default function AdDetailDrawer({
  linha, pub, changelog, onClose, onIrParaAlteracoes,
}: {
  linha: LinhaAds | null;
  pub: boolean;
  changelog: AdsAlteracao[];
  onClose: () => void;
  onIrParaAlteracoes: (campaignId: string) => void;
}) {
  if (!linha) return null;
  const l = linha;
  const m = STATUS_META[l.i.status];
  const historico = changelog
    .filter((e) => e.campaignId === l.i.campaignId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 5);
  const ultima = historico[0] ?? null;
  // Só texto de exibição ("há N dias") — recomputar a cada render reflete o
  // relógio de parede passando, não afeta memoização nem dependência de hook.
  // eslint-disable-next-line react-hooks/purity
  const agora = Date.now();
  const url = linkAnuncio(l.i.itemId);

  function copiarResumo() {
    const texto = [
      `${l.i.title || l.i.itemId} (${l.i.itemId})`,
      `Investimento: ${fmtBRL(l.i.cost)} · Receita: ${fmtBRL(l.v)} · Lucro após Ads: ${l.lucroAtual != null ? fmtBRL(l.lucroAtual) : "—"}`,
      `ROAS: ${l.i.cost > 0 ? `${num(l.r, 2)}x` : "—"}${l.breakEven != null ? ` · Break-even: ${num(l.breakEven, 2)}x` : ""}`,
      `Decisão: ${l.reco.label}`,
    ].join("\n");
    navigator.clipboard?.writeText(texto).catch(() => {});
  }

  return (
    // Era um <div> solto, sem papel de diálogo, sem foco preso e com o fundo navegável por Tab.
    // Agora é um Drawer (portal, foco, fundo inerte, Escape só no topo da pilha).
    <Drawer
      open onClose={onClose} titulo={`Detalhes do anúncio ${l.i.title || l.i.itemId}`}
      painelStyle={{ width: "min(480px, 100%)", overflowY: "auto", padding: 20, display: "block" }}
    >
        <button type="button" className="btn btn-ghost btn-xs" onClick={onClose} style={{ position: "absolute", top: 14, right: 14 }}>✕ Fechar</button>

        {/* A. Cabeçalho */}
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: "1.05rem", fontWeight: 800, marginBottom: 4, paddingRight: 60 }}>{l.i.title || l.i.itemId}</h3>
          <div style={{ fontSize: ".8rem", color: "var(--muted)", fontFamily: "monospace" }}>{l.i.itemId}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: ".75rem", fontWeight: 700, color: m.cor, background: m.bg, padding: "2px 8px", borderRadius: 5 }}>{m.label}</span>
            <span style={{ fontSize: ".75rem", color: "var(--muted)" }}>{l.i.campaignName || "sem campanha"}</span>
          </div>
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-xs" style={{ display: "inline-block", marginTop: 8 }}>
              Abrir anúncio no Mercado Livre ↗
            </a>
          )}
        </div>

        {/* B. Resultado financeiro */}
        <Secao titulo="Resultado financeiro">
          <Linha label="Receita" valor={fmtBRL(l.v)} />
          <Linha label="Investimento em Ads" valor={fmtBRL(l.i.cost)} cor="var(--red)" />
          <Linha label="Lucro antes de Ads" valor={fmtBRL(pub ? l.i.lucroDiretoAntesAds : l.i.lucroAntesAds)} />
          <Linha label="Lucro após Ads" valor={l.lucroAtual != null ? fmtBRL(l.lucroAtual) : "sem dado — não é prejuízo, é falta de dado"} cor={l.lucroAtual == null ? "var(--muted)" : l.lucroAtual >= 0 ? "var(--green)" : "var(--red)"} forte />
          <Linha label="Margem" valor={l.margemAtual != null ? `${num(l.margemAtual, 1)}%` : "—"} cor={l.margemAtual != null ? corMargem(l.margemAtual) : "var(--muted)"} />
          {/* Cor pelo equilibrio DESTE anuncio, nao por corte fixo: o ROAS que
              empata depende da margem do produto, e 3x podia estar queimando
              dinheiro num item de margem fina. */}
          {/* A coluna ROAS da tabela mostra o do PAINEL do Mercado Ads; o drawer só mostrava o do modo
              escolhido — dois números diferentes pro mesmo anúncio, sem dizer qual era qual. Agora os dois, nomeados. */}
          <Linha
            label="ROAS (painel do Mercado Ads)"
            valor={l.roasMlAds != null ? `${num(l.roasMlAds, 2)}x` : "—"}
            cor={corDoRoas(l.roasMlAds, l.breakEven, l.roasIdeal).cor}
          />
          <Linha
            label={`ROAS (modo ${pub ? "Publicidade direta" : "Geral"})`}
            valor={l.i.cost > 0 ? `${num(l.r, 2)}x` : "—"}
            cor={corDoRoas(l.i.cost > 0 ? l.r : null, l.breakEven, l.roasIdeal).cor}
          />
          <Linha label="ROAS objetivo (meta da campanha)" valor={l.i.roasTarget > 0 ? `${num(l.i.roasTarget, 2)}x` : "não configurado"} />
          <Linha label="Vendas atribuídas" valor={`${num(l.i.adUnitsAtribuidas)} (${num(l.i.directUnits)} direta(s) + ${num(l.i.indirectUnits)} assistida(s))`} />
          <Linha label="Receita atribuída pelo Ads" valor={fmtBRL(l.i.adSales)} />
          <Linha label="Via Ads (dependência da verba)" valor={l.i.totalSales > 0 ? `${num(l.pctAds, 0)}%` : "sem venda"} />
          <Linha label="Break-even ROAS" valor={l.breakEven != null ? `${num(l.breakEven, 2)}x` : "sem lucro antes de Ads pra calcular"} />
          <Linha
            label="ROAS ideal (margem alvo)"
            valor={l.roasIdeal != null
              ? `${num(l.roasIdeal, 2)}x${l.abaixoDoIdeal ? " — você está abaixo" : " — atingido"}`
              : "este produto não alcança a margem alvo nem sem Ads"}
          />
          <Linha label={pub ? "ACOS" : "TACOS"} valor={l.v > 0 ? `${num(l.a, 1)}%` : "—"} cor={corAcos(l.a, l.v > 0)} />
          {!l.i.diretoDisponivel && pub && (
            <div style={{ marginTop: 6, fontSize: ".75rem", color: "var(--warning)" }}>
              Estimado/incompleto: sem venda vinculada no período pra calcular a margem do lucro direto.
            </div>
          )}
        </Secao>

        {/* C. Funil */}
        <Secao titulo="Funil">
          <Linha label="Impressões" valor={num(l.i.prints)} />
          <Linha label="Cliques" valor={num(l.i.clicks)} />
          <Linha label="CTR" valor={l.i.prints > 0 ? `${num(l.ctr, 2)}%` : "—"} />
          <Linha label="CPC" valor={l.i.clicks > 0 ? fmtBRL(l.cpc) : "—"} />
          <Linha label="Vendas" valor={`${num(l.un)} un`} />
          <Linha label="Conversão clique → venda" valor={l.i.clicks > 0 ? `${num((l.un / l.i.clicks) * 100, 2)}%` : "—"} />
        </Secao>

        {/* Como ler cada número — o mesmo texto dos tooltips da tabela (uma fonte: ads-explicacoes),
            mas VISÍVEL: tooltip só existe com mouse, e no celular e no teclado a conta ficava escondida. */}
        <Secao titulo="Como ler cada número">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {explicacoesDoAnuncio(l, pub).map((x) => (
              <div key={x.chave}>
                <div style={{ fontSize: ".8125rem", fontWeight: 700 }}>{x.titulo}</div>
                <div style={{ fontSize: ".8125rem", color: "var(--muted)", lineHeight: 1.5, marginTop: 2 }}>{x.texto}</div>
              </div>
            ))}
          </div>
        </Secao>

        {/* D. Diagnóstico */}
        <Secao titulo="Diagnóstico">
          <div style={{ fontSize: ".82rem", lineHeight: 1.5 }}>{l.reco.label}</div>
          {l.reco.acao === "sem-dados" && (
            <div style={{ fontSize: ".8rem", color: "var(--muted)", marginTop: 4 }}>
              {!l.i.diretoDisponivel ? "Sem venda vinculada no período." : l.i.clicks < 20 && l.un === 0 ? "Volume de cliques/vendas baixo demais pra confiar numa recomendação." : "Dado insuficiente pra concluir."}
            </div>
          )}
        </Secao>

        {/* E. Histórico de mudanças */}
        <Secao titulo="Histórico de mudanças">
          <div style={{ fontSize: ".75rem", color: "var(--muted)", marginBottom: 8, fontStyle: "italic" }}>Alterações registradas pela equipe — não vem do Mercado Livre.</div>
          {ultima && (
            <div style={{ fontSize: ".8rem", color: "var(--muted)", marginBottom: 8 }}>
              Última alteração há {diasDesde(ultima.createdAt, agora)} dia(s).
            </div>
          )}
          {historico.length === 0 ? (
            <div style={{ fontSize: ".82rem", color: "var(--muted)" }}>Nenhuma alteração registrada pra esta campanha ainda.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {historico.map((e) => (
                <div key={e.id} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px" }}>
                  <div style={{ fontSize: ".82rem", fontWeight: 600 }}>{formatarResumoAlteracao(e)}</div>
                  <div style={{ fontSize: ".75rem", color: "var(--muted)", marginTop: 2 }}>
                    {new Date(e.createdAt).toLocaleDateString("pt-BR")} · {e.createdByName || e.createdBy}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Secao>

        {/* F. Ações */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
          <button type="button" className="btn btn-success btn-sm" onClick={() => onIrParaAlteracoes(l.i.campaignId)}>Registrar alteração</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={copiarResumo}>Copiar resumo</button>
        </div>
    </Drawer>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
      <div style={{ fontSize: ".75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted)", marginBottom: 8 }}>{titulo}</div>
      {children}
    </div>
  );
}

function Linha({ label, valor, cor, forte }: { label: string; valor: string; cor?: string; forte?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "3px 0" }}>
      <span style={{ fontSize: ".8rem", color: "var(--muted)" }}>{label}</span>
      <span style={{ fontSize: forte ? ".9rem" : ".82rem", fontWeight: forte ? 800 : 600, color: cor ?? "var(--text)", whiteSpace: "nowrap", textAlign: "right" }}>{valor}</span>
    </div>
  );
}
