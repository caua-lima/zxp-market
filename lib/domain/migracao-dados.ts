/**
 * Migração do DADO DE NEGÓCIO pro tenant — Etapa 5 da transformação SaaS.
 *
 * A primeira fatia (scripts/migrar-tenant-legado.mjs) criou o tenant, os
 * membros e os ponteiros de membership. Esta copia o resto: estoque, custos,
 * metas, pedidos, tarefas, notificações — de `/{colecao}` pra
 * `/tenants/{tenantId}/{colecao}`, com as subcoleções junto.
 *
 * ─── O QUE ESTE MÓDULO GARANTE ──────────────────────────────────────────
 *
 *  - NADA É APAGADO NA ORIGEM. A raiz continua intacta: é o rollback. O app
 *    em produção lê da raiz até a chave de modo de dados ser virada.
 *  - IDEMPOTENTE: cada documento vai pro MESMO caminho com `set` do conteúdo
 *    atual. Rodar de novo atualiza a cópia com o que mudou na raiz — é assim
 *    que se faz a passada final logo antes de virar a chave.
 *  - TODA coleção que o código usa tem uma decisão aqui. O teste
 *    (migracao-dados.test.ts) varre o código-fonte e QUEBRA se aparecer uma
 *    coleção sem destino — a mesma lição do inventário de backup: decisão
 *    obrigatória em vez de lembrada.
 *  - Conferência depois de aplicar: os caminhos de documento da origem e do
 *    destino são comparados um a um, e qualquer diferença é listada.
 *
 * Autossuficiente de propósito (sem imports com `@/`): o script .mjs importa
 * este arquivo direto pelo Node. `db` é recebido por parâmetro, pra o mesmo
 * código rodar contra o emulador nos testes.
 */

import { createHash } from "node:crypto";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";

export type DestinoNaMigracao =
  /** Dado da empresa: vai pra tenants/{t}/{colecao}. */
  | "tenant"
  /** Da pessoa ou do sistema, não da empresa: fica na raiz. */
  | "global"
  /** A conexão do ML: ml_tokens/main vira tenants/{t}/connections/main. */
  | "conexao"
  /** Descartável ou secreto: não copia (o app recria no uso). */
  | "nao_migra";

export type DecisaoDeColecao = { destino: DestinoNaMigracao; motivo: string };

export const DESTINOS: Readonly<Record<string, DecisaoDeColecao>> = {
  // ── dado da empresa, digitado por gente ──
  estoque: { destino: "tenant", motivo: "cadastro de produtos e custo médio" },
  estoque_movimentos: { destino: "tenant", motivo: "o livro que reconstrói o custo médio" },
  custos: { destino: "tenant", motivo: "despesas da DRE" },
  full_remessas: { destino: "tenant", motivo: "custo de coleta do Full (a API do ML não expõe)" },
  metas: { destino: "tenant", motivo: "metas em vigor" },
  metasHistorico: { destino: "tenant", motivo: "metas de períodos passados" },
  tarefas: { destino: "tenant", motivo: "tarefas da operação" },
  ads_alteracoes: { destino: "tenant", motivo: "registro de mudanças de campanha" },
  auditLog: { destino: "tenant", motivo: "trilha de auditoria da empresa" },
  dias: { destino: "tenant", motivo: "fechamento e anotação por dia" },
  rascunho: { destino: "tenant", motivo: "texto em edição" },
  alertasDispensados: { destino: "tenant", motivo: "alertas já tratados" },
  snapshots_diarios: { destino: "tenant", motivo: "fotografia diária dos anúncios" },
  backups_semanais: { destino: "tenant", motivo: "registro dos backups da empresa" },
  // ── dado da empresa que vem do ML (copiar é mais barato que ressincronizar) ──
  ml_orders: { destino: "tenant", motivo: "pedidos sincronizados" },
  ml_returns: { destino: "tenant", motivo: "cancelamentos e devoluções" },
  ml_webhook_inbox: { destino: "tenant", motivo: "notificações do ML pendentes de processar" },
  webhook_log: { destino: "tenant", motivo: "trilha das notificações do ML" },
  webhook_topicos: { destino: "tenant", motivo: "contagem diária de tópicos do ML" },
  cron_estado: { destino: "tenant", motivo: "carimbo do cron e do worker" },
  acessos_diagnostico: { destino: "tenant", motivo: "auditoria de quem abriu rota de diagnóstico (S27)" },
  // ── notificações da empresa ──
  notification_events: { destino: "tenant", motivo: "central de avisos" },
  notification_events_publico: { destino: "tenant", motivo: "espelho da central sem financeiro" },
  notification_feed: { destino: "tenant", motivo: "avisos pessoais (feed por pessoa, com subcoleção itens)" },
  notification_outbox: { destino: "tenant", motivo: "pushes agendados" },
  notification_entregas: { destino: "tenant", motivo: "estado de entrega por aparelho" },
  notification_janelas: { destino: "tenant", motivo: "janelas de rajada de vendas" },
  // ── da pessoa ou do sistema ──
  usuarios: { destino: "global", motivo: "preferências da PESSOA, não da empresa" },
  pushTokens: { destino: "global", motivo: "aparelhos da pessoa" },
  controleAcesso: { destino: "global", motivo: "legado; os membros já foram migrados pela primeira fatia" },
  controleAcessoMeta: { destino: "global", motivo: "trava do bootstrap legado" },
  tenants: { destino: "global", motivo: "é o próprio destino" },
  memberships: { destino: "global", motivo: "ponteiro pessoa → tenant" },
  billing_eventos: { destino: "global", motivo: "eventos do Stripe já recebidos (idempotência do webhook de cobrança, S25)" },
  vendedores: { destino: "global", motivo: "índice vendedor do ML → empresa (roteia o webhook, impede a mesma conta em duas empresas)" },
  // ── conexão ──
  ml_tokens: { destino: "conexao", motivo: "tokens do ML viram a conexão do tenant" },
  // ── não copia ──
  ml_oauth_transacoes: { destino: "nao_migra", motivo: "transação OAuth em andamento: secreta e de vida curta" },
  notification_limites: { destino: "nao_migra", motivo: "contador de limite de envio: recomeça sozinho" },
  // ── nomes que só aparecem em scripts de semente/legado ──
  settings: { destino: "nao_migra", motivo: "legado de semente; o app não lê" },
  products: { destino: "nao_migra", motivo: "legado de semente; o app usa `estoque`" },
  operational_costs: { destino: "nao_migra", motivo: "legado de semente; o app usa `custos`" },
  ml_ads_spend: { destino: "nao_migra", motivo: "cache de gasto de Ads: o ML é a fonte" },
  ml_ads_campaigns: { destino: "nao_migra", motivo: "cache de campanhas: o ML é a fonte" },
};

/** Subcoleção só existe dentro de uma coleção de cima — não é decisão à parte. */
export const SUBCOLECOES_CONHECIDAS = ["itens", "members", "connections", "preferences"] as const;

export function colecoesPara(destino: DestinoNaMigracao): string[] {
  return Object.entries(DESTINOS).filter(([, d]) => d.destino === destino).map(([c]) => c).sort();
}

export function caminhoNoTenant(tenantId: string, caminhoNaRaiz: string): string {
  if (!/^[a-z0-9-]{2,60}$/.test(tenantId)) throw new Error(`tenantId inválido: ${tenantId}`);
  return `tenants/${tenantId}/${caminhoNaRaiz}`;
}

// ── motor ───────────────────────────────────────────────────────────────

export type ResultadoDaColecao = {
  colecao: string;
  /** Documentos lidos na origem, contando subcoleções. */
  lidos: number;
  /** Documentos gravados no destino (0 no ensaio). */
  gravados: number;
};

type Escrita = { ref: DocumentReference; dados: Record<string, unknown> };

async function gravarEmLotes(db: Firestore, escritas: Escrita[]): Promise<void> {
  for (let i = 0; i < escritas.length; i += 400) {
    const lote = db.batch();
    for (const e of escritas.slice(i, i + 400)) lote.set(e.ref, e.dados);
    await lote.commit();
  }
}

/**
 * Copia uma coleção (e as subcoleções de cada documento) de `origem` pra
 * `destino`, paginando pelo id. Documento "fantasma" — sem campos, só com
 * subcoleções, como `notification_feed/{email}` — não aparece em `get()` da
 * coleção; por isso a busca é por `listDocuments()`, que os devolve.
 */
async function copiarColecao(
  db: Firestore,
  origem: string,
  destino: string,
  aplicar: boolean,
  conta: { lidos: number; gravados: number },
): Promise<void> {
  const refs = await db.collection(origem).listDocuments();
  for (let i = 0; i < refs.length; i += 300) {
    const fatia = refs.slice(i, i + 300);
    const snaps = await db.getAll(...fatia);
    const escritas: Escrita[] = [];
    for (const s of snaps) {
      if (s.exists) {
        conta.lidos++;
        escritas.push({ ref: db.doc(`${destino}/${s.id}`), dados: s.data() ?? {} });
      }
    }
    if (aplicar) {
      await gravarEmLotes(db, escritas);
      conta.gravados += escritas.length;
    }
    for (const ref of fatia) {
      for (const sub of await ref.listCollections()) {
        await copiarColecao(db, `${origem}/${ref.id}/${sub.id}`, `${destino}/${ref.id}/${sub.id}`, aplicar, conta);
      }
    }
  }
}

export async function migrarDados(
  db: Firestore,
  opcoes: { tenantId: string; aplicar: boolean; colecoes?: string[]; log?: (linha: string) => void },
): Promise<ResultadoDaColecao[]> {
  const log = opcoes.log ?? (() => {});
  const tenant = await db.doc(`tenants/${opcoes.tenantId}`).get();
  if (!tenant.exists) {
    // A ordem importa: sem tenant e membros, não há autorização pra proteger o dado copiado.
    throw new Error(`tenants/${opcoes.tenantId} não existe — rode primeiro scripts/migrar-tenant-legado.mjs.`);
  }
  const alvo = opcoes.colecoes ?? colecoesPara("tenant");
  for (const c of alvo) {
    if (DESTINOS[c]?.destino !== "tenant") throw new Error(`${c} não é coleção de tenant (destino: ${DESTINOS[c]?.destino ?? "sem decisão"})`);
  }

  const resultados: ResultadoDaColecao[] = [];
  for (const colecao of alvo) {
    const conta = { lidos: 0, gravados: 0 };
    await copiarColecao(db, colecao, caminhoNoTenant(opcoes.tenantId, colecao), opcoes.aplicar, conta);
    resultados.push({ colecao, ...conta });
    log(`${colecao}: ${conta.lidos} lido(s)${opcoes.aplicar ? `, ${conta.gravados} gravado(s)` : ""}`);
  }

  // A conexão do ML: um documento, com o nome novo.
  if (!opcoes.colecoes) {
    const token = await db.doc("ml_tokens/main").get();
    const conta = { colecao: "ml_tokens → connections/main", lidos: token.exists ? 1 : 0, gravados: 0 };
    if (token.exists && opcoes.aplicar) {
      await db.doc(caminhoNoTenant(opcoes.tenantId, "connections/main")).set(token.data() ?? {});
      conta.gravados = 1;
      // O índice que roteia as notificações do ML pra esta empresa.
      const vendedor = String(token.data()?.user_id ?? "").trim();
      if (vendedor) await db.doc(`vendedores/${vendedor}`).set({ tenantId: opcoes.tenantId, connectionId: "main" });
    }
    resultados.push(conta);
    log(`${conta.colecao}: ${conta.lidos} lido(s)${opcoes.aplicar ? `, ${conta.gravados} gravado(s)` : ""}`);
  }
  return resultados;
}

/**
 * Forma canônica de um valor do Firestore: chaves em ordem, Timestamp pelo
 * instante exato (segundos + nanos), referência pelo caminho, bytes em base64.
 * Duas cópias fiéis dão o mesmo texto; qualquer campo diferente muda o texto.
 */
export function formaCanonica(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return Number.isNaN(v) ? '"NaN"' : Object.is(v, -0) ? "-0" : JSON.stringify(v);
  if (typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(formaCanonica).join(",")}]`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown> & { seconds?: number; nanoseconds?: number; toMillis?: unknown; path?: string; firestore?: unknown; latitude?: number; longitude?: number };
    if (typeof o.toMillis === "function" && typeof o.seconds === "number") return `"T:${o.seconds}.${o.nanoseconds ?? 0}"`;
    if (typeof o.path === "string" && o.firestore) return `"R:${o.path}"`;
    if (typeof o.latitude === "number" && typeof o.longitude === "number" && Object.keys(o).length <= 2) return `"G:${o.latitude},${o.longitude}"`;
    if (v instanceof Uint8Array) return `"B:${Buffer.from(v).toString("base64")}"`;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${formaCanonica(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(String(v));
}

export function impressaoDigital(dados: Record<string, unknown>): string {
  return createHash("sha256").update(formaCanonica(dados)).digest("hex");
}

/** Todos os documentos sob uma coleção (com subcoleções), caminho relativo → impressão digital do conteúdo. */
async function documentosSob(db: Firestore, base: string, prefixo = ""): Promise<Map<string, string>> {
  const saida = new Map<string, string>();
  for (const ref of await db.collection(base).listDocuments()) {
    const s = await ref.get();
    if (s.exists) saida.set(`${prefixo}${ref.id}`, impressaoDigital(s.data() ?? {}));
    for (const sub of await ref.listCollections()) {
      for (const [c, h] of await documentosSob(db, `${base}/${ref.id}/${sub.id}`, `${prefixo}${ref.id}/${sub.id}/`)) saida.set(c, h);
    }
  }
  return saida;
}

export type Divergencia = {
  colecao: string;
  soNaOrigem: string[];
  soNoDestino: string[];
  /** Existe dos dois lados, mas o CONTEÚDO não bate (Etapa 5 — conferência por conteúdo). */
  diferentes: string[];
};

/**
 * Confere origem × destino documento a documento — presença E conteúdo.
 * Lista vazia = cópia completa e fiel.
 * `soNoDestino` não é erro de cópia (pode ser dado que o app já gravou no
 * modo tenant), mas aparece pra ninguém se surpreender.
 */
export async function conferirMigracao(
  db: Firestore,
  tenantId: string,
  colecoes: string[] = colecoesPara("tenant"),
): Promise<Divergencia[]> {
  const divergencias: Divergencia[] = [];
  for (const colecao of colecoes) {
    const [origem, destino] = await Promise.all([
      documentosSob(db, colecao),
      documentosSob(db, caminhoNoTenant(tenantId, colecao)),
    ]);
    const soNaOrigem = [...origem.keys()].filter((c) => !destino.has(c));
    const soNoDestino = [...destino.keys()].filter((c) => !origem.has(c));
    const diferentes = [...origem.keys()].filter((c) => destino.has(c) && destino.get(c) !== origem.get(c));
    if (soNaOrigem.length || soNoDestino.length || diferentes.length) divergencias.push({ colecao, soNaOrigem, soNoDestino, diferentes });
  }
  return divergencias;
}
