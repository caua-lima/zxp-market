"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { explicarFonte } from "@/lib/domain/estado-fonte";
import { patchArquivar, patchReativar, vigenteHoje } from "@/lib/domain/vigencia-custo";
import Modal from "@/components/Modal";
import CustoForm from "@/components/custos/CustoForm";
import { diasNoMes, fmtBRL, mesAtual, parseBRNumber, fmtPct } from "@/lib/domain/calc";
import { COST_CATEGORIA_LABEL, type Cost } from "@/lib/domain/types";
import { ESCOPO_META, FREQUENCIA_META, type Escopo } from "@/lib/domain/custo-form";
import { deleteCost, logAudit, upsertCost } from "@/lib/firebase/data";
import type { UserData } from "@/components/useUserData";
import { useAccess } from "@/components/tabs/AccessGuard";
import { authedFetch } from "@/lib/api/authed-fetch";
import TelaHeader from "@/components/TelaHeader";
import { resumirEstadoDaTela } from "@/lib/domain/estado-da-tela";
import {
  filtrarCustos, ordenarCustos, filtrosAtivos, impactoDaLista, acumuladoEProjetado,
  rotuloDaVigencia, FILTRO_VAZIO, type FiltroCustos, type OrdemCustos,
} from "@/lib/domain/custos-lista";

/**
 * Custos — a lista do que a operação e a empresa gastam.
 *
 * ─── O QUE MUDOU, E POR QUÊ ─────────────────────────────────────────────
 *
 * Cada custo era um bloco de SETE campos abertos, todos editáveis, gravando a
 * cada tecla. Com três custos a aba virava um formulário sem fim, e não havia
 * como bater o olho e responder "quanto eu gasto por mês e com o quê".
 *
 * Agora a lista é pra LER: uma linha por custo, com quanto ele pesa no mês. A
 * edição acontece num formulário separado, com botão de salvar — ver
 * components/custos/CustoForm.tsx.
 *
 * A lista também se divide em dois grupos, custo da operação e despesa da
 * empresa. Essa diferença decide se o custo mexe no lucro do Dashboard, e
 * antes ela vivia num select dentro de cada bloco, explicada num quadro no
 * topo da página. Agrupada, ela aparece sozinha.
 */

type Aviso = { tipo: "ok" | "erro"; texto: string };
type Edicao = { custo: Cost | null; escopo: Escopo };

/**
 * Quanto um custo pesa no mês corrente — e o quanto disso JÁ SAIU.
 *
 * `impactoNoMes`, e não uma conta própria: a versão anterior tinha a sua (com
 * `parseFloat` e comparação de mês diferente pro avulso), e a soma das linhas
 * podia não bater com o total exibido logo acima delas.
 */
function pesoNoMes(c: Cost, hojeISO: string) {
  return acumuladoEProjetado(c, mesAtual(), hojeISO);
}

function sufixoDaFrequencia(c: Cost): string {
  if (c.freq === "diario") return "por dia";
  if (c.freq === "mensal") return "por mês";
  const [y, m, d] = String(c.data ?? "").split("-");
  return d ? `em ${d}/${m}/${y}` : "uma vez";
}

export default function CustosTab({ uid, data }: { uid: string; data: UserData }) {
  const { canEditTab } = useAccess();
  const canEdit = canEditTab("custos");
  const [edicao, setEdicao] = useState<Edicao | null>(null);

  /**
   * Busca, filtros e ordenação — que não existiam.
   *
   * Com doze custos a lista ainda cabe na tela; com quarenta, achar o
   * aluguel do galpão virava rolar procurando. E "mostrarArquivados" era um
   * botão solto no fim da página, que é onde ninguém procura um filtro.
   *
   * A regra de cada um mora em `custos-lista`, com teste: a busca ignora
   * acento (quem digita 'agua' tem que achar 'Água'), duas palavras é E e
   * não OU, e a ordem padrão é por IMPACTO — a pergunta desta tela é o que
   * está custando mais, e ordem alfabética obriga a ler a lista inteira.
   */
  const [filtro, setFiltro] = useState<FiltroCustos>(FILTRO_VAZIO);
  const [ordem, setOrdem] = useState<OrdemCustos>("impacto");
  const [painelFiltros, setPainelFiltros] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const timerAviso = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * A confirmação de que deu certo — que a aba antiga nunca dava. Some sozinha
   * depois de uns segundos quando é sucesso; erro fica até a próxima ação,
   * porque erro que some antes de ser lido é o mesmo que erro engolido.
   */
  function avisar(a: Aviso) {
    if (timerAviso.current) clearTimeout(timerAviso.current);
    setAviso(a);
    if (a.tipo === "ok") timerAviso.current = setTimeout(() => setAviso(null), 4000);
  }
  useEffect(() => () => { if (timerAviso.current) clearTimeout(timerAviso.current); }, []);

  /**
   * Vigente HOJE é o que entra nas listas ativas.
   *
   * O comentário antigo aqui dizia que arquivado "para de contar em tudo —
   * mesmo filtro que a rota de métricas aplica". Era verdade, e era o bug:
   * arquivar o contador removia a despesa de todos os meses PASSADOS também,
   * e a DRE de meses fechados mudava sozinha.
   *
   * Agora arquivar fecha a vigência na data de hoje. A lista continua sendo
   * sobre o presente; o histórico deixa de ser reescrito.
   */
  const hojeISO = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const ativos = data.costs.filter((c) => vigenteHoje(c, hojeISO));
  const arquivados = data.costs.filter((c) => !vigenteHoje(c, hojeISO));

  /**
   * A lista visível: filtrada e ordenada ANTES de separar por escopo.
   *
   * Filtrar depois da separação daria dois filtros pra manter em sincronia,
   * e o contador do botão teria que somar os dois — é assim que dois
   * números do mesmo filtro passam a discordar.
   */
  const visiveis = useMemo(() => {
    const base = filtro.incluirArquivados ? data.costs : ativos;
    return ordenarCustos(filtrarCustos(base, filtro), ordem, mesAtual(), hojeISO);
    // `ativos` deriva de data.costs e hojeISO — já nas dependências.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.costs, filtro, ordem, hojeISO]);

  const daOperacao = visiveis.filter((c) => (c.escopo ?? "dash") === "dash");
  const daEmpresa = visiveis.filter((c) => c.escopo === "dre");

  /**
   * ─── ACUMULADO NÃO É PROJEÇÃO ───────────────────────────────────────
   *
   * Havia um número só, "pesa no mês", e ele era o mês INTEIRO. No dia 8,
   * um pró-labore de R$ 4.000 aparecia como se já tivesse saído.
   *
   * Acumulado é o que se compara com o extrato; projeção é o que se usa pra
   * decidir preço. Mostrar só a projeção faz o mês em curso parecer pior do
   * que está; só o acumulado faz parecer melhor.
   */
  const impactoOperacao = useMemo(() => impactoDaLista(daOperacao, mesAtual(), hojeISO), [daOperacao, hojeISO]);
  const impactoEmpresa = useMemo(() => impactoDaLista(daEmpresa, mesAtual(), hojeISO), [daEmpresa, hojeISO]);
  const totalOperacao = impactoOperacao.projetado;
  const totalEmpresa = impactoEmpresa.projetado;
  const mesEmCurso = !impactoOperacao.mesFechado;

  // Contexto: quanto os custos da operação comem do faturamento e do lucro do
  // mês. Mesma rota que o Dashboard usa.
  const [ref, setRef] = useState<{ faturamentoLiquido: number; lucroSemCustos: number } | null>(null);

  /**
   * SYNC-03: mexer em custo invalida esta referência.
   *
   * Ela era buscada UMA vez, na montagem. Cadastrar, arquivar ou apagar uma
   * despesa mudava os totais da esquerda e deixava o "% do faturamento" da
   * direita com o número de antes — dois valores contraditórios na mesma tela.
   *
   * E o `fresh` importa: a rota de métricas guarda a resposta por alguns
   * minutos, então sem ele o recarregamento traria exatamente o mesmo corpo
   * que já estava na tela.
   */
  const carregarRef = useCallback(async (fresh = false) => {
    try {
      const r = await authedFetch(
        `/api/ml/metrics?month=${mesAtual()}${fresh ? "&fresh=1" : ""}`,
        { cache: "no-store" },
      );
      if (!r.ok) return;
      const j = await r.json();
      if (j && !j.error) setRef({ faturamentoLiquido: j.faturamentoLiquido ?? 0, lucroSemCustos: j.lucroSemCustos ?? 0 });
    } catch { /* a referência é contexto, não pode derrubar a aba */ }
  }, []);

  useEffect(() => {
    // Dentro de um callback async de proposito: chamar direto no corpo do
    // efeito e setState sincrono em efeito, que o lint pega
    // (react-hooks/set-state-in-effect).
    void (async () => { await carregarRef(false); })();
  }, [carregarRef]);
  const pctFaturamento = ref && ref.faturamentoLiquido > 0 ? (totalOperacao / ref.faturamentoLiquido) * 100 : null;
  const pctLucro = ref && ref.lucroSemCustos > 0 ? (totalOperacao / ref.lucroSemCustos) * 100 : null;

  /**
   * O estado dos dados, pro selo do cabeçalho.
   *
   * `custos` é a fonte essencial: sem ela a tela não diz nada. A referência
   * de faturamento (`ref`) é secundária — sem ela os percentuais somem e o
   * resto continua servindo —, e por isso ela vira RESSALVA e não erro.
   */
  const estadoDaTela = useMemo(() => resumirEstadoDaTela({
    fontes: { custos: data.fontes.custos },
    essenciais: ["custos"],
    pendencias: ref ? [] : [{
      chave: "sem-referencia",
      titulo: "Faturamento do mês não carregou",
      detalhe: "Os percentuais sobre faturamento e lucro não podem ser calculados.",
      efeito: "indefinido" as const,
    }],
  }), [data.fontes.custos, ref]);

  async function arquivar(c: Cost, ativo: boolean) {
    try {
      /**
       * Arquivar FECHA a vigência em hoje; reativar reabre a partir de hoje.
       *
       * Era `{ ...c, ativo }` e mais nada — sem data, o cálculo não tinha como
       * saber até quando a despesa valeu, e a única leitura possível era
       * "nunca valeu".
       */
      await upsertCost(uid, {
        ...c,
        ...(ativo ? patchReativar(hojeISO) : patchArquivar(hojeISO)),
      } as Cost);
      logAudit({
        acao: ativo ? "reativar" : "arquivar", entidade: "custo", entidadeId: c.id, entidadeLabel: c.nome || "(sem nome)",
      }).catch(() => {});
      avisar({
        tipo: "ok",
        texto: ativo
          ? `"${c.nome}" volta a contar a partir de hoje.`
          : `"${c.nome}" arquivado — para de contar a partir de amanhã. Os meses anteriores seguem como estavam.`,
      });
      carregarRef(true);
    } catch (err) {
      avisar({ tipo: "erro", texto: `Não consegui ${ativo ? "reativar" : "arquivar"}: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  async function excluir(c: Cost) {
    if (!confirm(`Excluir "${c.nome || "este custo"}" de vez? Não dá pra desfazer — arquivar mantém o histórico.`)) return;
    try {
      await deleteCost(uid, c.id);
      logAudit({ acao: "excluir", entidade: "custo", entidadeId: c.id, entidadeLabel: c.nome || "(sem nome)" }).catch(() => {});
      avisar({ tipo: "ok", texto: `"${c.nome}" excluído.` });
    } catch (err) {
      avisar({ tipo: "erro", texto: `Não consegui excluir: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  const abrirNovo = (escopo: Escopo) => setEdicao({ custo: null, escopo });
  const abrirEdicao = (c: Cost) => setEdicao({ custo: c, escopo: c.escopo ?? "dash" });

  return (
    <div className="dash">
      {/*
        O cabeçalho padrão: título, MÊS DE COMPETÊNCIA e estado dos dados, com
        uma ação principal. O que havia era um subtítulo solto e um botão —
        e nada dizia se a lista na tela podia ser lida como a lista de verdade.
      */}
      <TelaHeader
        titulo="Custos"
        periodo={{ de: `${mesAtual()}-01`, ate: `${mesAtual()}-${diasNoMes(mesAtual())}` }}
        subtitulo={`${ativos.length} ativo(s)`}
        estado={estadoDaTela}
        acao={canEdit ? {
          rotulo: "＋ Novo custo",
          onClick: () => abrirNovo("dash"),
          titulo: "Cadastra um custo da operação ou uma despesa da empresa",
        } : null}
        secundarias={[
          {
            rotulo: filtro.incluirArquivados
              ? "Esconder arquivados"
              : `Mostrar arquivados (${arquivados.length})`,
            onClick: () => setFiltro((f) => ({ ...f, incluirArquivados: !f.incluirArquivados })),
          },
          ...(canEdit ? [{
            rotulo: "＋ Despesa da empresa (só na DRE)",
            onClick: () => abrirNovo("dre"),
            titulo: "Pró-labore, contador, retirada — não mexe no lucro do Dashboard",
          }] : []),
        ]}
      />

      {/* Quatro números, cada um respondendo uma pergunta. Eram seis, e
          "custo fixo por dia" e "mensais fixos" ao lado de "impacto no mês"
          obrigavam a somar de cabeça pra achar o total. */}
      <div className="kpi-grid">
        <div className="kpi k-neg">
          {/*
            O rótulo diz QUAL dos dois números é. "Pesa no mês" com o valor
            do mês inteiro, no dia 8, era uma afirmação falsa com cara de fato.
          */}
          <div className="k-lbl">{mesEmCurso ? "Operação — projeção do mês" : "Operação no mês"}</div>
          <div className="k-val" style={{ color: "var(--red)" }}>{fmtBRL(totalOperacao)}</div>
          <div className="k-sub">
            {mesEmCurso
              ? <>já saiu <b>{fmtBRL(impactoOperacao.acumulado)}</b> · {daOperacao.length} custo(s)</>
              : <>{daOperacao.length} custo(s) da operação</>}
          </div>
        </div>
        <div className="kpi k-acc">
          <div className="k-lbl">{mesEmCurso ? "Só na DRE — projeção" : "Só na DRE"}</div>
          <div className="k-val" style={{ color: daEmpresa.length ? "var(--text)" : "var(--muted)" }}>{fmtBRL(totalEmpresa)}</div>
          <div className="k-sub">
            {mesEmCurso && daEmpresa.length
              ? <>já saiu <b>{fmtBRL(impactoEmpresa.acumulado)}</b> · {daEmpresa.length} despesa(s)</>
              : <>{daEmpresa.length} despesa(s) da empresa</>}
          </div>
        </div>
        <div className="kpi k-warn">
          <div className="k-lbl">% do faturamento</div>
          <div className="k-val" style={{ color: "var(--yellow)" }}>{pctFaturamento != null ? `${fmtPct(pctFaturamento, 1)}` : "—"}</div>
          <div className="k-sub">custos da operação ÷ faturamento do mês</div>
        </div>
        <div className="kpi k-neg">
          <div className="k-lbl">% do lucro</div>
          <div className="k-val" style={{ color: "var(--red)" }}>{pctLucro != null ? `${fmtPct(pctLucro, 1)}` : "—"}</div>
          <div className="k-sub">quanto do lucro, antes deles, eles consomem</div>
        </div>
      </div>

      {aviso && (
        <div className={`note ${aviso.tipo === "ok" ? "note-accent" : "note-danger"}`} role={aviso.tipo === "erro" ? "alert" : "status"}>
          {aviso.tipo === "ok" ? "✓ " : ""}{aviso.texto}
        </div>
      )}

      {!canEdit && (
        <div className="note">Você pode ver os custos, mas não tem permissão pra editar.</div>
      )}

      {/*
        ─── BUSCA, FILTROS E ORDENAÇÃO ─────────────────────────────────────

        A busca fica sempre visível; os filtros abrem sob demanda. Com doze
        custos a lista cabe na tela, mas o que se procura aqui é sempre um
        custo específico — e rolar procurando é a operação que a busca
        substitui.

        O contador no botão existe pra que filtro esquecido não vire
        "sumiu um custo": com um filtro ativo e a lista curta, a explicação
        tem que estar visível sem abrir nada.
      */}
      {ativos.length > 0 && (
        <div className="panel" style={{ padding: "10px 12px" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="search"
              placeholder="Buscar por nome, categoria, centro de custo…"
              value={filtro.busca}
              onChange={(e) => setFiltro((f) => ({ ...f, busca: e.target.value }))}
              aria-label="Buscar custo"
              style={{ flex: "1 1 240px", minWidth: 0 }}
            />

            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setPainelFiltros((v) => !v)}
              aria-expanded={painelFiltros}
            >
              Filtros{filtrosAtivos(filtro) > 0 ? ` (${filtrosAtivos(filtro)})` : ""}
            </button>

            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: ".8rem", color: "var(--muted)" }}>
              Ordenar
              <select
                value={ordem}
                onChange={(e) => setOrdem(e.target.value as OrdemCustos)}
                aria-label="Ordenar a lista de custos"
              >
                <option value="impacto">Maior impacto</option>
                <option value="valor">Maior valor</option>
                <option value="nome">Nome</option>
                <option value="vigencia">Mudou por último</option>
              </select>
            </label>

            {filtrosAtivos(filtro) > 0 && (
              <button
                type="button" className="btn btn-ghost btn-xs"
                onClick={() => setFiltro(FILTRO_VAZIO)}
              >
                Limpar
              </button>
            )}
          </div>

          {painelFiltros && (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
              <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                <legend style={{ fontSize: ".75rem", color: "var(--muted)", fontWeight: 700, padding: 0 }}>Recorrência</legend>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                  {Object.entries(FREQUENCIA_META).map(([k, m]) => (
                    <button
                      key={k}
                      type="button"
                      className={`chip chip-btn${filtro.frequencias.includes(k) ? " is-on" : ""}`}
                      aria-pressed={filtro.frequencias.includes(k)}
                      onClick={() => setFiltro((f) => ({
                        ...f,
                        frequencias: f.frequencias.includes(k)
                          ? f.frequencias.filter((x) => x !== k)
                          : [...f.frequencias, k],
                      }))}
                    >
                      {m.rotulo}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                <legend style={{ fontSize: ".75rem", color: "var(--muted)", fontWeight: 700, padding: 0 }}>Categoria</legend>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                  {Object.entries(COST_CATEGORIA_LABEL).map(([k, rotulo]) => (
                    <button
                      key={k}
                      type="button"
                      className={`chip chip-btn${filtro.categorias.includes(k) ? " is-on" : ""}`}
                      aria-pressed={filtro.categorias.includes(k)}
                      onClick={() => setFiltro((f) => ({
                        ...f,
                        categorias: f.categorias.includes(k)
                          ? f.categorias.filter((x) => x !== k)
                          : [...f.categorias, k],
                      }))}
                    >
                      {rotulo}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
          )}

          {/*
            Filtro ativo que não acha nada precisa dizer que é o FILTRO. Sem
            isto a tela mostra "nenhum cadastrado" e a pessoa procura um
            custo que está bem ali, escondido por um filtro que ela esqueceu.
          */}
          {filtrosAtivos(filtro) > 0 && visiveis.length === 0 && (
            <div style={{ marginTop: 10, fontSize: ".82rem", color: "var(--muted)" }}>
              Nenhum custo passa pelos filtros atuais. Existem <b>{ativos.length}</b> custos ativos.
            </div>
          )}
        </div>
      )}

      {ativos.length === 0 ? (
        <div className="panel">
          <div className="empty-state">
            <span className="empty-ico">💸</span>
            {/*
              "Não carregou" não pode aparecer como "nenhum custo cadastrado".

              A rede de segurança do useUserData destrava a tela depois de seis
              segundos com a lista no valor inicial — vazia. Pro papel member,
              que por regra do Firestore não lê a coleção de custos, essa
              assinatura é negada SEMPRE, e a tela afirmava que não havia custo
              nenhum.
            */}
            {explicarFonte(data.fontes.custos, "custos") ?? "Nenhum custo cadastrado ainda."}
            {canEdit && (
              <div style={{ marginTop: 10 }}>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => abrirNovo("dash")}>
                  ＋ Cadastrar o primeiro custo
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <GrupoCustos
            escopo="dash" custos={daOperacao} total={totalOperacao} canEdit={canEdit} hojeISO={hojeISO}
            onNovo={abrirNovo} onEditar={abrirEdicao} onArquivar={arquivar} onExcluir={excluir}
          />
          <GrupoCustos
            escopo="dre" custos={daEmpresa} total={totalEmpresa} canEdit={canEdit} hojeISO={hojeISO}
            onNovo={abrirNovo} onEditar={abrirEdicao} onArquivar={arquivar} onExcluir={excluir}
          />
        </>
      )}

      {/*
        O painel de arquivados no rodapé deixou de existir. Eles agora entram
        na lista principal pelo filtro do cabeçalho, já com o visual de
        arquivado que LinhaCusto aplica — e um botão de filtro no FIM da
        página era o lugar onde ninguém procura um filtro.
      */}

      {edicao && (
        <Modal open onClose={() => setEdicao(null)}>
          <CustoForm
            inicial={edicao.custo}
            escopoPadrao={edicao.escopo}
            onCancelar={() => setEdicao(null)}
            onSalvo={(c) => {
              setEdicao(null);
              avisar({ tipo: "ok", texto: edicao.custo ? `"${c.nome}" atualizado.` : `"${c.nome}" cadastrado.` });
              carregarRef(true);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function GrupoCustos({ escopo, custos, total, canEdit, hojeISO, onNovo, onEditar, onArquivar, onExcluir }: {
  escopo: Escopo;
  custos: Cost[];
  total: number;
  canEdit: boolean;
  hojeISO: string;
  onNovo: (escopo: Escopo) => void;
  onEditar: (c: Cost) => void;
  onArquivar: (c: Cost, ativo: boolean) => void;
  onExcluir: (c: Cost) => void;
}) {
  const meta = ESCOPO_META[escopo];
  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 4 }}>
        <span className="panel-title">{escopo === "dash" ? "Custos da operação" : "Despesas da empresa"}</span>
        <span className="panel-sub">{fmtBRL(total)} no mês</span>
      </div>
      <div style={{ fontSize: ".82rem", color: "var(--muted)", marginBottom: 12 }}>{meta.explica}</div>

      {custos.length === 0 ? (
        <div style={{ fontSize: ".84rem", color: "var(--muted)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          Nenhum cadastrado.
          {canEdit && (
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => onNovo(escopo)}>
              ＋ Adicionar {escopo === "dash" ? "custo da operação" : "despesa da empresa"}
            </button>
          )}
        </div>
      ) : (
        <div className="list-stack">
          {custos.map((c) => (
            <LinhaCusto
              key={c.id} custo={c} canEdit={canEdit} hojeISO={hojeISO}
              onEditar={onEditar} onArquivar={onArquivar} onExcluir={onExcluir}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LinhaCusto({ custo: c, canEdit, hojeISO, onEditar, onArquivar, onExcluir }: {
  custo: Cost;
  canEdit: boolean;
  hojeISO: string;
  onEditar: (c: Cost) => void;
  onArquivar: (c: Cost, ativo: boolean) => void;
  onExcluir: (c: Cost) => void;
}) {
  const arquivado = c.ativo === false;
  const impacto = pesoNoMes(c, hojeISO);
  const peso = arquivado ? 0 : impacto.projetado;
  return (
    <div className="list-row" style={{ padding: "12px 14px", opacity: arquivado ? 0.6 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 220px" }}>
          <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{c.nome || "(sem nome)"}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 4, fontSize: ".75rem", color: "var(--muted)" }}>
            <span className="chip">{FREQUENCIA_META[c.freq]?.rotulo ?? c.freq}</span>
            {c.categoria && <span className="chip">{COST_CATEGORIA_LABEL[c.categoria]}</span>}
            {/*
              A VIGÊNCIA, que não aparecia na linha.

              Um custo arquivado em março e outro que só começa em outubro
              apareciam idênticos. Sem ela, a única forma de saber por que um
              custo não estava somando era abrir o formulário dele.
            */}
            <span className="chip" title="Período em que este custo vale">{rotuloDaVigencia(c, hojeISO)}</span>
            {c.centroCusto && <span>{c.centroCusto}</span>}
            {c.observacao && <span>· {c.observacao}</span>}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontWeight: 800, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
            {fmtBRL(parseBRNumber(c.valor))}{" "}
            <span style={{ fontWeight: 400, fontSize: ".75rem", color: "var(--muted)" }}>{sufixoDaFrequencia(c)}</span>
          </div>
          <div style={{ fontSize: ".75rem", color: arquivado ? "var(--muted)" : "var(--red)", whiteSpace: "nowrap" }}>
            {arquivado
              ? "arquivado — não conta"
              : impacto.mesFechado
                ? `pesou ${fmtBRL(peso)} no mês`
                /* No mês em curso o rótulo diz que o número é projeção — e
                   mostra ao lado quanto já saiu de fato. */
                : `projeção ${fmtBRL(peso)} · já saiu ${fmtBRL(impacto.acumulado)}`}
          </div>
        </div>
      </div>

      {canEdit && (
        <div className="row-actions" style={{ marginTop: 10, justifyContent: "flex-end", alignItems: "center" }}>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => onEditar(c)}>Editar</button>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => onArquivar(c, arquivado)}>
            {arquivado ? "Reativar" : "Arquivar"}
          </button>

          {/*
            ─── EXCLUIR SAI DA FILEIRA ────────────────────────────────────

            Era um botão vermelho do mesmo tamanho, encostado em Arquivar, em
            cada linha da lista. As duas ações parecem a mesma coisa e não
            são: arquivar preserva o histórico — a DRE de julho continua
            certa — e excluir apaga o custo de todos os meses passados.

            Lado a lado e com o mesmo peso, um clique errado é irreversível.
            Agora ela fica atrás do ⋯, onde quem quer excluir chega em dois
            gestos e quem queria arquivar não chega por acidente.
          */}
          <details className="acao-perigosa">
            <summary aria-label={`Mais ações para ${c.nome || "este custo"}`}>⋯</summary>
            <div className="acao-perigosa-menu">
              <button
                type="button" className="btn btn-danger btn-xs"
                onClick={() => onExcluir(c)}
                title="Apaga o custo de TODOS os meses, inclusive os já fechados"
              >
                Excluir definitivamente
              </button>
              <div style={{ fontSize: ".72rem", color: "var(--muted)", marginTop: 6, maxWidth: 210, lineHeight: 1.5 }}>
                Some de todos os meses, inclusive os já fechados. Arquivar preserva o histórico.
              </div>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
