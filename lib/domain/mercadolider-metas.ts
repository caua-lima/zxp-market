/**
 * As metas oficiais de MercadoLíder — o que o Mercado Livre pede pra cada
 * medalha.
 *
 * ─── POR QUE ISTO EXISTE AGORA, E NÃO ANTES ─────────────────────────────
 *
 * Este painel nasceu pedindo o alvo DIGITADO, e o motivo estava escrito na
 * época: a API (`seller_reputation`) devolve o nível atual e as métricas de
 * qualidade, mas não os limiares. Chutar seria pior que não ter — compra e
 * verba de anúncio planejadas em cima de um número que ninguém conferiu.
 *
 * Tentou-se deduzir do próprio painel do ML, que exibe "R$ 76.490 faturado em
 * vendas concluídas" na tela do Gold. Medido contra a conta, aquilo era o
 * acumulado de ~120 dias (R$ 77.218) — PROGRESSO, não meta. A leitura estava
 * certa: a meta do Gold é R$ 118.400.
 *
 * A tabela abaixo é a da página oficial "Tudo sobre ser MercadoLíder"
 * (mercadolivre.com.br/ajuda/como-se-tornar-mercadolider_1359), lida em
 * 05/09/2026. Com ela o alvo deixa de ser digitado.
 *
 * ─── SÃO DUAS CONDIÇÕES, NÃO UMA ────────────────────────────────────────
 *
 * O ML exige vendas concretizadas E faturamento. Acompanhar só o dinheiro
 * esconde metade do problema: dá pra estar com o faturamento fechado e a
 * medalha travada por contagem de vendas, e isso muda a decisão (baixar preço
 * pra girar volume × subir margem). Por isso as duas viajam juntas aqui.
 */

export type NivelMedalha = "silver" | "gold" | "platinum";

export type MetaMedalha = {
  nivel: NivelMedalha;
  label: string;
  /** Vendas concretizadas exigidas na janela. */
  vendas: number;
  /**
   * Faturamento exigido na janela, em reais.
   *
   * O ML exclui as vendas vindas de anúncios GRÁTIS desta soma (nota de
   * rodapé da própria tabela). O app não separa por tipo de anúncio, então
   * este número sai otimista pra quem usa anúncio grátis — não é o caso
   * desta conta, que é toda clássico/premium.
   */
  faturamento: number;
};

/** Tabela oficial. Ordem crescente — `proximaMeta` depende disso. */
export const METAS_MERCADOLIDER: MetaMedalha[] = [
  { nivel: "silver", label: "MercadoLíder", vendas: 230, faturamento: 37_000 },
  { nivel: "gold", label: "MercadoLíder Gold", vendas: 575, faturamento: 118_400 },
  { nivel: "platinum", label: "MercadoLíder Platinum", vendas: 1_725, faturamento: 296_000 },
];

/**
 * Requisitos que valem pra QUALQUER medalha — não escalam por nível.
 *
 * Ficam aqui, e não soltos na tela, porque são a resposta pra "bati as vendas
 * e o faturamento, por que não subi?". Quase sempre é uma destas linhas.
 */
export const REQUISITOS_COMUNS = [
  { id: "cadastro", label: "Tempo de cadastro no Mercado Livre", exigencia: "Mais de 4 meses" },
  { id: "documentos", label: "Documentação pessoal", exigencia: "Documento de identidade e dados de contato" },
  { id: "fiscal", label: "Documento fiscal", exigencia: "Comprovação fiscal" },
  { id: "termometro", label: "Cor no termômetro", exigencia: "Verde escuro" },
  { id: "reclamacoes", label: "Reclamações", exigencia: "Menos de 1% do total das vendas" },
  { id: "mediacoes", label: "Reclamações mediadas pelo Mercado Livre", exigencia: "Menos de 0,5% do total das vendas" },
  { id: "canceladas", label: "Vendas canceladas", exigencia: "Menos de 0,5% do total das vendas" },
  { id: "envios", label: "Envios incorretos", exigencia: "Menos de 6% do total das vendas" },
] as const;

function ordemDoNivel(status: string | null | undefined): number {
  const s = String(status ?? "").trim().toLowerCase();
  if (s === "platinum") return 3;
  if (s === "gold") return 2;
  if (s === "silver") return 1;
  return 0;
}

/**
 * A meta que o vendedor persegue agora. `null` só no Platinum, que é o topo —
 * e ali a pergunta deixa de ser "quanto falta" e vira "como manter".
 */
export function proximaMeta(nivelAtual: string | null | undefined): MetaMedalha | null {
  const ordem = ordemDoNivel(nivelAtual);
  return ordem >= 3 ? null : METAS_MERCADOLIDER[ordem];
}

export type JanelaMedalha = { de: string; ate: string; dias: number };

/**
 * A janela que o ML usa pra medalha: "os 3 meses mais os dias do mês vigente".
 *
 * ─── POR QUE NÃO DÁ PRA REAPROVEITAR OS 60 DIAS ─────────────────────────
 *
 * O painel de qualidade mede 60 dias (ou 365 — ver `ajuda.ts`), que é a
 * janela da REPUTAÇÃO. A da MEDALHA é outra, e maior. Medir o progresso de
 * uma na janela da outra subestima o acumulado em cerca de 40%: em 05/09/2026
 * são 97 dias contra 60. Foi exatamente essa diferença que fez R$ 76.490
 * parecer meta quando era progresso.
 *
 * Medindo em 05/09: volta 3 meses (junho), pega do dia 1º, e vai até hoje —
 * 01/06 a 05/09. Junho, julho e agosto completos, mais os 5 dias de setembro.
 */
export function janelaDaMedalha(hojeISO: string): JanelaMedalha {
  const m = String(hojeISO).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const hoje = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    : new Date();
  // Dia 1 do mês três meses atrás. `new Date` normaliza a virada de ano
  // sozinho: mês -1 em janeiro vira dezembro do ano anterior.
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - 3, 1);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  // +1 porque a janela inclui os dois extremos: 01/06 a 05/09 são 97 dias
  // vividos, não 96 de diferença.
  const dias = Math.round((hoje.getTime() - inicio.getTime()) / 86400000) + 1;
  return { de: iso(inicio), ate: iso(hoje), dias };
}

export type EixoMedalha = {
  atual: number;
  alvo: number;
  falta: number;
  /** Percentual do alvo já alcançado. Pode passar de 100. */
  pct: number;
  ok: boolean;
};

export type ProgressoMercadoLider = {
  meta: MetaMedalha;
  janela: JanelaMedalha;
  vendas: EixoMedalha;
  faturamento: EixoMedalha;
  /**
   * O eixo que está travando a medalha — o mais atrasado dos dois. É onde a
   * ação muda: faturamento atrás pede preço/mix, vendas atrás pede giro.
   * `null` quando os dois já fecharam.
   */
  gargalo: "vendas" | "faturamento" | null;
  /** Os dois eixos fechados. Não garante a medalha: faltam os comuns. */
  ambosOk: boolean;
  /** Ritmo diário medido na janela, pra projeção. */
  vendasPorDia: number;
  faturamentoPorDia: number;
  /** Dias no ritmo atual até fechar o eixo mais atrasado. `null` sem ritmo. */
  diasNoRitmo: number | null;
  /** Data estimada, yyyy-mm-dd. `null` sem ritmo. */
  chegaEm: string | null;
};

function eixo(atual: number, alvo: number): EixoMedalha {
  const a = Math.max(Number(atual) || 0, 0);
  const meta = Math.max(Number(alvo) || 0, 0);
  return {
    atual: a,
    alvo: meta,
    falta: Math.max(0, meta - a),
    pct: meta > 0 ? (a / meta) * 100 : 0,
    ok: meta > 0 && a >= meta,
  };
}

/**
 * @param hojeISO entra como parâmetro pra função continuar pura — a data
 *   projetada depende de hoje, e sem isso o teste dependeria do relógio.
 */
export function progressoMercadoLider(
  vendasConcluidas: number,
  faturado: number,
  nivelAtual: string | null | undefined,
  hojeISO: string,
): ProgressoMercadoLider | null {
  const meta = proximaMeta(nivelAtual);
  if (!meta) return null;

  const janela = janelaDaMedalha(hojeISO);
  const v = eixo(vendasConcluidas, meta.vendas);
  const f = eixo(faturado, meta.faturamento);

  const ambosOk = v.ok && f.ok;
  /**
   * O gargalo é o eixo menos avançado — o que ainda não fechou e está mais
   * longe EM PROPORÇÃO. Comparar reais contra unidades direto não diria nada.
   */
  const gargalo: "vendas" | "faturamento" | null = ambosOk
    ? null
    : v.ok ? "faturamento"
      : f.ok ? "vendas"
        : v.pct <= f.pct ? "vendas" : "faturamento";

  const dias = Math.max(janela.dias, 1);
  const vendasPorDia = v.atual / dias;
  const faturamentoPorDia = f.atual / dias;

  /**
   * A projeção segue o GARGALO: prometer a medalha pela data do eixo que já
   * está adiantado é o jeito mais fácil de errar pra menos.
   */
  let diasNoRitmo: number | null = ambosOk ? 0 : null;
  if (!ambosOk) {
    const porDia = gargalo === "vendas" ? vendasPorDia : faturamentoPorDia;
    const falta = gargalo === "vendas" ? v.falta : f.falta;
    if (porDia > 0) diasNoRitmo = Math.ceil(falta / porDia);
  }

  let chegaEm: string | null = null;
  if (diasNoRitmo != null) {
    const m = String(hojeISO).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + diasNoRitmo);
      chegaEm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
  }

  return {
    meta, janela, vendas: v, faturamento: f, gargalo, ambosOk,
    vendasPorDia, faturamentoPorDia, diasNoRitmo, chegaEm,
  };
}
