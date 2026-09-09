"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { fmtBRL } from "@/lib/domain/calc";
import { MARCA_DOURADO, MARCA_ONYX } from "@/lib/marca";
import {
  lerODoMes,
  montarCascata,
  residuoDaCascata,
  type DadosDre,
} from "@/lib/domain/dre-apresentacao";

/**
 * O fechamento do mês em formato de apresentação, pra mandar pro sócio.
 *
 * ─── POR QUE IMPRESSÃO DO NAVEGADOR, E NÃO UMA BIBLIOTECA DE PDF ────────
 *
 * As duas opções eram html2canvas/jsPDF (rasteriza a tela) ou a impressão
 * nativa. A impressão ganha em tudo que importa aqui:
 *
 *   · sai VETORIAL — dá pra dar zoom no número sem borrar, e o texto é
 *     selecionável e pesquisável no PDF.
 *   · usa as fontes de verdade, não um bitmap delas.
 *   · não adiciona dependência nenhuma, e não quebra quando a lib atualiza.
 *
 * O custo é que o usuário passa pelo diálogo de impressão e escolhe "Salvar
 * como PDF". É um clique a mais numa ação que se faz uma vez por mês.
 *
 * ─── POR QUE FUNDO ESCURO ───────────────────────────────────────────────
 *
 * Isto é feito pra ser lido na tela — mandado por mensagem, aberto no
 * celular. O onyx com dourado é a identidade da casa e é o que faz o
 * documento parecer da empresa, não uma planilha exportada. Em papel gasta
 * tinta; se um dia for pra imprimir de verdade, é aqui que se inverte.
 */

/** Uma folha A4 deitada. As medidas em mm são o que o `@page` espera. */
function Pagina({ children, n, total, periodo }: {
  children: React.ReactNode;
  n: number;
  total: number;
  periodo: string;
}) {
  return (
    <section className="apres-pagina">
      <div className="apres-conteudo">{children}</div>
      <footer className="apres-rodape">
        <span>VAZXPRESS · {periodo}</span>
        <span>{n} / {total}</span>
      </footer>
    </section>
  );
}

function Marca({ tamanho = 34 }: { tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 200 200" aria-hidden="true" style={{ display: "block", flexShrink: 0 }}>
      <rect width="200" height="200" rx="44" fill={MARCA_ONYX} />
      <polyline
        points="30,47 170,47 30,153 170,153"
        fill="none" stroke={MARCA_DOURADO} strokeWidth="34"
        strokeLinejoin="miter" strokeLinecap="butt"
      />
    </svg>
  );
}

/** A seta de variação contra o período anterior. Fora do componente de
 *  propósito: definida dentro do render, o React a trataria como um tipo
 *  novo a cada renderização e remontaria a subárvore. */
function Variacao({ v }: { v: number | null }) {
  if (v == null) return <span className="apres-var neutra">sem base anterior</span>;
  return (
    <span className={`apres-var ${v >= 0 ? "sobe" : "desce"}`}>
      {v >= 0 ? "▲" : "▼"} {pct1(Math.abs(v))} vs período anterior
    </span>
  );
}

/** As linhas do demonstrativo, na ordem em que a DRE as apresenta. */
function montarLinhasDre(dados: DadosDre): { rotulo: string; valor: number; ded?: boolean; forte?: boolean }[] {
  return [
    { rotulo: "Receita bruta de vendas", valor: dados.receitaBruta },
    { rotulo: "Cancelamentos e devoluções", valor: dados.canceladas, ded: true },
    { rotulo: "Receita líquida", valor: dados.receitaLiquida, forte: true },
    { rotulo: "Taxas do Mercado Livre", valor: dados.taxasML, ded: true },
    { rotulo: "Frete", valor: dados.frete, ded: true },
    { rotulo: "Receita operacional líquida", valor: dados.receitaOperacional, forte: true },
    { rotulo: "Custo da mercadoria vendida", valor: dados.cmv, ded: true },
    { rotulo: "Lucro bruto", valor: dados.lucroBruto, forte: true },
    { rotulo: "Impostos sobre vendas", valor: dados.imposto, ded: true },
    { rotulo: "Marketing (ADS)", valor: dados.ads, ded: true },
    { rotulo: "Despesas operacionais", valor: dados.despesasOperacionais, ded: true },
    { rotulo: "Resultado operacional", valor: dados.resultadoOperacional, forte: true },
    ...dados.despesasEmpresa.map((c) => ({ rotulo: c.nome, valor: c.valor, ded: true })),
    ...(dados.coletaFull > 0 ? [{ rotulo: "Coleta pro Full", valor: dados.coletaFull, ded: true }] : []),
    { rotulo: "Resultado líquido", valor: dados.resultadoLiquido, forte: true },
  ];
}

const pct1 = (n: number) => `${n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/**
 * A cascata, na horizontal.
 *
 * ─── POR QUE DEITADA ────────────────────────────────────────────────────
 *
 * A cascata clássica é de colunas verticais, e ali os rótulos ("Custo da
 * mercadoria vendida", "Despesas operacionais") só cabem girados 45°, o que
 * obriga a inclinar a cabeça pra ler oito deles. Deitada, cada linha se lê
 * como uma frase: o nome à esquerda, quanto levou no meio, o quanto pesou à
 * direita. É a mesma informação em ordem de leitura natural.
 */
function Cascata({ dados }: { dados: DadosDre }) {
  const blocos = montarCascata(dados);
  const receita = blocos[0]?.valor ?? 0;
  const residuo = residuoDaCascata(blocos);
  // Escala pela receita: é o 100% contra o qual tudo é comparado.
  const escala = (v: number) => (receita > 0 ? Math.max(0, Math.min(100, (v / receita) * 100)) : 0);

  return (
    <div className="apres-cascata">
      {blocos.map((b) => {
        const abertura = b.tipo === "abertura";
        const fechamento = b.tipo === "fechamento";
        const negativo = fechamento && b.valor < 0;
        // Barra flutuante: começa onde a linha PAROU e vai até onde ela
        // COMEÇOU — é o pedaço que aquele custo levou embora.
        const esquerda = abertura ? 0 : fechamento ? 0 : escala(b.depois);
        const largura = abertura || fechamento ? escala(Math.abs(b.valor)) : escala(b.valor);
        return (
          <div key={b.id} className={`apres-casc-linha${abertura || fechamento ? " destaque" : ""}`}>
            <span className="apres-casc-rot">{b.rotulo}</span>
            <span className="apres-casc-trilho">
              <span
                className={
                  "apres-casc-barra "
                  + (abertura ? "abre" : fechamento ? (negativo ? "fecha-neg" : "fecha") : "sai")
                }
                style={{ left: `${esquerda}%`, width: `${Math.max(largura, 0.4)}%` }}
              />
            </span>
            <span className={`apres-casc-val${negativo ? " neg" : ""}`}>
              {b.tipo === "saida" ? "−" : ""}{fmtBRL(Math.abs(b.valor))}
            </span>
            <span className="apres-casc-pct">{pct1(b.pctDaReceita)}</span>
          </div>
        );
      })}

      {/* Se as barras não somam o resultado, a figura está errada — e dizer
          isso vale mais que um desenho bonito. Ver residuoDaCascata. */}
      {Math.abs(residuo) >= 0.01 && (
        <div className="apres-aviso">
          As linhas acima não fecham no resultado por {fmtBRL(Math.abs(residuo))}. Há custo
          faltando ou contado duas vezes — confira a DRE completa antes de usar este número.
        </div>
      )}
    </div>
  );
}

export default function ApresentacaoDre({ dados, anterior, periodo, geradoEm, onFechar }: {
  dados: DadosDre;
  anterior: DadosDre | null;
  /** "setembro de 2026" — já formatado pela aba. */
  periodo: string;
  geradoEm: string;
  onFechar: () => void;
}) {
  // Esc fecha, como qualquer sobreposição da casa.
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onFechar(); }
    document.addEventListener("keydown", onKey);
    /**
     * Trava a rolagem do fundo enquanto a apresentação está aberta: sem isso,
     * rolar dentro dela arrasta a aba de DRE junto e a pré-visualização foge.
     */
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = antes;
    };
  }, [onFechar]);



  /**
   * Montada num PORTAL direto no body.
   *
   * A regra de impressão precisa esconder tudo menos esta sobreposição, e
   * dentro da árvore do React ela é neta de vários contêineres — não há
   * seletor simples que esconda os irmãos sem escondê-la junto. Como filha
   * direta do body,  resolve.
   *
   *  existe porque no servidor não há document: sem ele o React
   * tentaria criar o portal na renderização do servidor e quebraria.
   */
  // No servidor não há `document` pra receber o portal. Na prática nunca
  // acontece — a apresentação só abre por clique —, mas o portal quebraria
  // ruidosamente se acontecesse.
  if (typeof document === "undefined") return null;

  return createPortal((
    <div className="apres-overlay">
      {/* A barra some na impressão — ver @media print em globals.css. */}
      <div className="apres-barra">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Marca tamanho={26} />
          <div>
            <div style={{ fontWeight: 700, fontSize: ".9rem" }}>Fechamento de {periodo}</div>
            <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>
              4 páginas · A4 deitado · no diálogo, escolha <b>Salvar como PDF</b>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onFechar}>Fechar</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}>
            Gerar PDF
          </button>
        </div>
      </div>

      <Folhas dados={dados} anterior={anterior} periodo={periodo} geradoEm={geradoEm} />
    </div>
  ), document.body);
}

/**
 * As quatro folhas — o documento em si, sem a barra de ferramentas nem o
 * portal. Separado de proposito: a barra e comportamento de TELA (fecha,
 * imprime) e some na impressao; as folhas sao o que vira PDF. Exportado pra
 * poder ser renderizado isolado quando se quer conferir o layout.
 */
export function Folhas({ dados, anterior, periodo, geradoEm }: {
  dados: DadosDre;
  anterior: DadosDre | null;
  periodo: string;
  geradoEm: string;
}) {
  const destaques = lerODoMes(dados, anterior);
  const margemLiquida = dados.receitaLiquida ? (dados.resultadoLiquido / dados.receitaLiquida) * 100 : 0;
  const margemBruta = dados.receitaLiquida ? (dados.lucroBruto / dados.receitaLiquida) * 100 : 0;
  const ticket = dados.pedidos > 0 ? dados.receitaLiquida / dados.pedidos : 0;
  const TOTAL = 4;
  const delta = (atual: number, ref: number | null | undefined) =>
    (ref == null || ref === 0 ? null : ((atual - ref) / Math.abs(ref)) * 100);
  const pctReceita = (v: number) => (dados.receitaLiquida ? (v / dados.receitaLiquida) * 100 : 0);
  const linhasDre = montarLinhasDre(dados);

  return (
    <div className="apres-folhas">
        {/* ─── 1. CAPA ───────────────────────────────────────────────── */}
        <Pagina n={1} total={TOTAL} periodo={periodo}>
          <div className="apres-capa">
            <div className="apres-capa-topo">
              <Marca tamanho={44} />
              <div>
                <div className="apres-capa-marca">VAZXPRESS</div>
                <div className="apres-capa-sub">Mercado Livre · relatório gerencial</div>
              </div>
            </div>

            <div>
              <div className="apres-capa-titulo">Fechamento de<br /><span>{periodo}</span></div>
            </div>

            <div className="apres-capa-numeros">
              <div>
                <div className="apres-num-lbl">Receita líquida</div>
                <div className="apres-num-val">{fmtBRL(dados.receitaLiquida)}</div>
                <Variacao v={delta(dados.receitaLiquida, anterior?.receitaLiquida)} />
              </div>
              <div>
                <div className="apres-num-lbl">Resultado líquido</div>
                <div className={`apres-num-val ${dados.resultadoLiquido >= 0 ? "bom" : "ruim"}`}>
                  {fmtBRL(dados.resultadoLiquido)}
                </div>
                <Variacao v={delta(dados.resultadoLiquido, anterior?.resultadoLiquido)} />
              </div>
              <div>
                <div className="apres-num-lbl">Margem líquida</div>
                <div className={`apres-num-val ${margemLiquida >= 0 ? "bom" : "ruim"}`}>{pct1(margemLiquida)}</div>
                <span className="apres-var neutra">de cada R$ 100 vendidos</span>
              </div>
            </div>

            <div className="apres-capa-pe">
              Gerado em {geradoEm} pelo ZXP Market · dados do Mercado Livre e do controle interno
            </div>
          </div>
        </Pagina>

        {/* ─── 2. CASCATA ────────────────────────────────────────────── */}
        <Pagina n={2} total={TOTAL} periodo={periodo}>
          <h2 className="apres-h2">Para onde foi cada real</h2>
          <p className="apres-lead">
            Começa na receita líquida e desce até o que sobrou. Cada barra é o pedaço que
            aquele custo levou embora — quanto mais longa, mais ela pesa no resultado.
          </p>
          <Cascata dados={dados} />
        </Pagina>

        {/* ─── 3. LEITURA DO MÊS ─────────────────────────────────────── */}
        <Pagina n={3} total={TOTAL} periodo={periodo}>
          <h2 className="apres-h2">Leitura do período</h2>
          <p className="apres-lead">
            O que os números acima dizem, em ordem de importância.
          </p>

          <div className="apres-kpis">
            <div><span>Pedidos</span><b>{dados.pedidos.toLocaleString("pt-BR")}</b></div>
            <div><span>Ticket médio</span><b>{fmtBRL(ticket)}</b></div>
            <div><span>Margem bruta</span><b>{pct1(margemBruta)}</b></div>
            <div><span>Margem líquida</span><b className={margemLiquida >= 0 ? "bom" : "ruim"}>{pct1(margemLiquida)}</b></div>
          </div>

          <div className="apres-destaques">
            {destaques.map((d) => (
              <div key={d.id} className={`apres-dest ${d.tom}`}>
                <div className="apres-dest-tit">{d.titulo}</div>
                <div className="apres-dest-txt">{d.texto}</div>
              </div>
            ))}
          </div>
        </Pagina>

        {/* ─── 4. DRE COMPLETA ───────────────────────────────────────── */}
        <Pagina n={4} total={TOTAL} periodo={periodo}>
          <h2 className="apres-h2">Demonstrativo completo</h2>
          <p className="apres-lead">
            Todas as linhas, com o peso de cada uma sobre a receita líquida.
          </p>
          <table className="apres-tabela">
            <thead>
              <tr>
                <th>Linha</th>
                <th style={{ textAlign: "right" }}>Valor</th>
                <th style={{ textAlign: "right" }}>% da receita</th>
              </tr>
            </thead>
            <tbody>
              {linhasDre.map((l, i) => (
                <tr key={`${l.rotulo}-${i}`} className={l.forte ? "forte" : l.ded ? "ded" : ""}>
                  <td>{l.rotulo}</td>
                  <td style={{ textAlign: "right" }}>
                    {l.ded ? "−" : ""}{fmtBRL(Math.abs(l.valor))}
                  </td>
                  <td style={{ textAlign: "right" }}>{pct1(pctReceita(l.valor))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="apres-nota">
            Receita líquida é a base de 100% de todas as porcentagens. Cancelamentos e
            devoluções aparecem como dedução da receita bruta, não como custo — são venda
            que não se concretizou.
          </div>
        </Pagina>
    </div>
  );
}
