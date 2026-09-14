/**
 * O que cada papel pode fazer — a matriz única de capacidades.
 *
 * ─── POR QUE ISTO PRECISOU EXISTIR ──────────────────────────────────────
 *
 * O portão das APIs (`lib/api-auth.ts`) tinha só dois papéis: `owner` e
 * `user`. Qualquer papel diferente de owner virava `user`, e com isso a
 * restrição de `member` — que existe justamente pra NÃO ver custo, margem,
 * preço e estoque — sumia no servidor.
 *
 * O efeito era concreto: as regras do Firestore barravam o member de ler a
 * coleção `custos` pelo SDK, mas `/api/ml/metrics` respondia a ele o
 * faturamento, o CMV, a margem e o detalhe de despesas — porque ali o papel
 * já tinha sido achatado. Esconder no frontend não resolve: a resposta da API
 * é pública pra quem tem o token.
 *
 * ─── POR QUE PURO, E SEPARADO DO PORTÃO ─────────────────────────────────
 *
 * A mesma decisão precisa valer em três lugares: o portão das APIs, as regras
 * do Firestore e a navegação da interface. Com três cópias, elas divergem — e
 * divergência aqui é vazamento, não inconveniência. Aqui fica a regra; os
 * outros dois a espelham, e o teste trava o espelho.
 */

import { papelDe, type AccessEntry, type Papel, type PermissionTab } from "./types";

export type Capacidade =
  /** O resultado consolidado: Dashboard e notificações. Todo autorizado tem. */
  | "ver_resumo"
  /** Estoque, pedidos, Full, Ads, metas, tarefas — o dia a dia da operação. */
  | "ver_operacao"
  /** Custo, margem, preço, DRE — o núcleo do negócio. */
  | "ver_financeiro"
  | "editar_custos"
  | "editar_metas"
  | "editar_estoque"
  | "editar_ads"
  /** Integração com o ML, usuários, rotinas, diagnósticos e backup. */
  | "administrar";

/** As capacidades de edição, e a aba que cada uma libera. */
const EDICAO: Record<string, PermissionTab> = {
  editar_custos: "custos",
  editar_metas: "metas",
  editar_estoque: "estoque",
  editar_ads: "ads",
};

/**
 * Este papel tem esta capacidade?
 *
 * @param permissoesEdicao abas que o dono liberou pra este partner. Ignorado
 *   pro owner (edita tudo) e pro member — uma conta rebaixada a member pode
 *   ter a lista sobrando de quando era partner, e o PAPEL manda sobre ela.
 *   Essa precedência é a mesma de `podeEditar` em firestore.rules.
 */
export function podeCapacidade(
  papel: Papel,
  permissoesEdicao: PermissionTab[] | undefined,
  cap: Capacidade,
): boolean {
  if (papel === "owner") return true;

  if (papel === "member") {
    // O ponto inteiro do papel: só o resultado, nada do núcleo do negócio.
    return cap === "ver_resumo";
  }

  // partner
  if (cap === "administrar") return false;
  if (cap === "ver_resumo" || cap === "ver_operacao" || cap === "ver_financeiro") return true;

  const aba = EDICAO[cap];
  return Boolean(aba && (permissoesEdicao ?? []).includes(aba));
}

/** A mesma decisão, partindo do documento de acesso como ele está gravado. */
export function podeCapacidadeDoRegistro(
  registro: Pick<AccessEntry, "role" | "permissoesEdicao"> | null | undefined,
  cap: Capacidade,
): boolean {
  if (!registro) return false;
  return podeCapacidade(papelDe(registro.role), registro.permissoesEdicao, cap);
}

/**
 * A capacidade mínima pra VER cada aba — o espelho de `podeVerAba`.
 *
 * Existe pra o portão da API poder exigir, numa linha, o mesmo que a
 * navegação já exige pra mostrar a aba.
 */
export function capacidadeDaAba(aba: string): Capacidade {
  if (aba === "acesso") return "administrar";
  if (aba === "dashboard") return "ver_resumo";
  if (aba === "dre" || aba === "custos" || aba === "preco") return "ver_financeiro";
  return "ver_operacao";
}
