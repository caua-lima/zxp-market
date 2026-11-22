import "server-only";
import { getAdminDb } from "@/lib/firebase/admin";
import { fetchML } from "@/lib/ml/fetch-ml";
import { getValidMlAccessToken } from "@/lib/ml/getToken";
import { chaveDoGrupo } from "@/lib/domain/grupo-produto";
import {
  custoAGravar, diaDaColeta, enviosParaDetalhar, lerDetalheDoEnvio, lerEnvioDaLista, mesclarEnvio,
  planejarReservas, planejarTravamento, situacaoDoEnvio,
  type EnvioFullML, type ReservaExistente,
} from "@/lib/domain/envios-full-ml";

/**
 * O lado do servidor da sincronização dos envios pro Full.
 *
 * A extensão do Chrome lê o painel do ML (com o login do vendedor) e manda os
 * objetos crus; aqui eles viram documentos em `full_envios_ml`, e daí:
 *
 *  1. custo da coleta em `full_remessas` (o mesmo lugar do custo digitado,
 *     que a DRE já lê) — estimado até o ML cobrar, depois o cobrado;
 *  2. reservas em `full_envios_agendados` (o "−220 pro Full · qua 25/11"),
 *     uma por produto, seguindo o que o ML diz;
 *  3. passou o prazo de editar → o anúncio de agência desce a quantidade
 *     reservada, e a reserva fica marcada "já fora do anúncio".
 *
 * A BAIXA do livro (saída pro Full + complemento quando o ML recebe mais
 * depois) fica na tela, com um clique: ela reusa a transferência das
 * Agências pro Full que só existe no cliente (envio-full-agencias.ts).
 */

export const COLECAO_ENVIOS_ML = "full_envios_ml";
export const DOC_DA_SYNC = "_sync";
const COLECAO_RESERVAS = "full_envios_agendados";
const COLECAO_REMESSAS = "full_remessas";
const ML_API = "https://api.mercadolibre.com";

const hojeBR = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
const normMlb = (s: unknown) => {
  const up = String(s ?? "").trim().toUpperCase();
  return up ? (up.startsWith("MLB") ? up : `MLB${up}`) : "";
};

type Produto = { id: string; name?: string; mlbs: string[]; grupo?: string; canal?: string; ativo?: boolean };

/** Produtos do Estoque com os MLBs normalizados. */
async function carregarProdutos(): Promise<Produto[]> {
  const snap = await getAdminDb().collection("estoque").get();
  return snap.docs.map((d) => {
    const x = d.data();
    const lista: unknown[] = Array.isArray(x.mlbs) && x.mlbs.length ? x.mlbs : x.mlb ? [x.mlb] : [];
    return { id: String(x.id ?? d.id), name: x.name, mlbs: lista.map(normMlb).filter(Boolean), grupo: x.grupo, canal: x.canal, ativo: x.ativo };
  });
}

/**
 * MLB do anúncio do Full → produto do Estoque. O envio traz o MLB do anúncio
 * do Full; um mesmo MLB em dois cadastros ativos é ambíguo e fica de fora
 * (vira "sem cadastro" na tela, em vez de reservar no produto errado).
 */
function mapaPorMlb(produtos: readonly Produto[]): Map<string, string> {
  const contagem = new Map<string, string[]>();
  for (const p of produtos) {
    if (p.ativo === false) continue;
    for (const m of p.mlbs) contagem.set(m, [...(contagem.get(m) ?? []), p.id]);
  }
  const mapa = new Map<string, string>();
  for (const [m, ids] of contagem) if (ids.length === 1) mapa.set(m, ids[0]);
  return mapa;
}

/** O cadastro "… Agências" do mesmo sabor — a mesma regra de irmaoDeAgencias (envio-full-agencias.ts). */
function irmaoDeAgencias(produto: Produto, produtos: readonly Produto[]): Produto | null {
  if (produto.canal === "agencias") return null;
  const chave = chaveDoGrupo(produto as { id: string; grupo?: string });
  if (chave.startsWith("produto:")) return null;
  const irmaos = produtos.filter((p) => p.id !== produto.id && p.ativo !== false && p.canal === "agencias" && chaveDoGrupo(p as { id: string; grupo?: string }) === chave);
  return irmaos.length === 1 ? irmaos[0] : null;
}

/**
 * Desce `quantidade` do anúncio de agência do sabor no ML. Só com UM anúncio
 * de agência (não chuta de qual tirar); relê e confere; deixa trilha no
 * auditLog. Devolve o texto do que aconteceu.
 */
async function baixarAnuncioDeAgencias(
  irmao: Produto, quantidade: number, motivo: string,
): Promise<{ ok: boolean; texto: string }> {
  const token = await getValidMlAccessToken().catch(() => null);
  if (!token) return { ok: false, texto: "sem token do ML" };
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const lidos: { mlb: string; available: number }[] = [];
  for (const mlb of irmao.mlbs) {
    const r = await fetchML(`${ML_API}/items/${mlb}?attributes=id,available_quantity,shipping,variations,status`, { headers, cache: "no-store" }, { maxTentativas: 2 }).catch(() => null);
    if (!r || !r.ok) continue;
    const j = (await r.json()) as { available_quantity?: number; shipping?: { logistic_type?: string }; variations?: unknown[] };
    if (j.shipping?.logistic_type === "fulfillment") continue;
    if (Array.isArray(j.variations) && j.variations.length) return { ok: false, texto: `${irmao.name}: anúncio com variações — tire ${quantidade} un à mão` };
    lidos.push({ mlb, available: Number(j.available_quantity ?? 0) });
  }
  if (lidos.length !== 1) return { ok: false, texto: `${irmao.name}: ${lidos.length} anúncios de agência — tire ${quantidade} un à mão` };
  const [{ mlb, available }] = lidos;
  const novo = Math.max(available - quantidade, 0);
  const put = await fetchML(`${ML_API}/items/${mlb}`, {
    method: "PUT", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ available_quantity: novo }), cache: "no-store",
  }, { maxTentativas: 1 }).catch(() => null);
  if (!put || !put.ok) return { ok: false, texto: `${irmao.name}: o ML recusou baixar ${available} → ${novo}` };
  await getAdminDb().collection("auditLog").doc(`audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`).set({
    acao: "editar", entidade: "anuncio", entidadeId: mlb, entidadeLabel: String(irmao.name ?? "").slice(0, 80),
    detalhe: `estoque no ML: ${available} → ${novo} (${motivo})`, por: "ml-sync", em: Date.now(),
  }).catch(() => {});
  return { ok: true, texto: `${irmao.name}: ${available} → ${novo}` };
}

export type ResultadoDaSync = {
  envios: number;
  detalhar: string[];
  reservas: { criadas: number; atualizadas: number; encerradas: number };
  semCadastro: { inboundId: string; itemId: string; sku: string }[];
  custos: number;
  anuncios: string[];
  avisos: string[];
};

/** Recebe a leitura da extensão (lista e/ou detalhes) e aplica tudo. */
export async function sincronizarEnvios(entrada: { lista?: unknown[]; detalhes?: unknown[]; versao?: string }): Promise<ResultadoDaSync> {
  const db = getAdminDb();
  const agora = Date.now();
  const col = db.collection(COLECAO_ENVIOS_ML);
  const avisos: string[] = [];

  // ── 1. Guarda o que veio, mesclando com o que já estava ──
  const atuais = new Map<string, EnvioFullML>();
  const snap = await col.get();
  for (const d of snap.docs) if (d.id !== DOC_DA_SYNC) atuais.set(d.id, d.data() as EnvioFullML);

  const daLista = (entrada.lista ?? []).slice(0, 300).map(lerEnvioDaLista).filter((e): e is EnvioFullML => !!e);
  const doDetalhe = (entrada.detalhes ?? []).slice(0, 40).map(lerDetalheDoEnvio).filter((e): e is EnvioFullML => !!e);
  const tocados = new Set<string>();
  for (const l of daLista) {
    const antes = atuais.get(l.id);
    // A lista não traz produtos: guarda os do detalhe já lido.
    const novo = antes?.detalheLido ? mesclarEnvio(l, antes)! : { ...l, custo: l.custo ?? antes?.custo ?? null };
    atuais.set(l.id, novo);
    tocados.add(l.id);
  }
  for (const d of doDetalhe) {
    const antes = atuais.get(d.id) ?? null;
    atuais.set(d.id, mesclarEnvio(antes, d)!);
    tocados.add(d.id);
  }
  const lote = db.batch();
  for (const id of tocados) lote.set(col.doc(id), { ...atuais.get(id), lidoEm: agora }, { merge: false });
  lote.set(col.doc(DOC_DA_SYNC), {
    em: agora, versao: String(entrada.versao ?? ""),
    ...(daLista.length ? { listaEm: agora, listaQtd: daLista.length } : {}),
    ...(doDetalhe.length ? { detalheEm: agora } : {}),
  }, { merge: true });
  await lote.commit();

  const envios = [...atuais.values()];

  // ── 2. Custo da coleta ──
  let custos = 0;
  for (const id of tocados) {
    const e = atuais.get(id)!;
    const ref = db.collection(COLECAO_REMESSAS).doc(id);
    const atual = (await ref.get()).data() as { custoManual?: number | null; custoInformadoPor?: string | null } | undefined;
    const g = custoAGravar(e, atual ?? null);
    if (!g) continue;
    const dia = diaDaColeta(e);
    await ref.set({
      remessa: id, custoManual: g.valor, custoInformadoPor: g.origem, custoInformadoEm: agora,
      ...(dia ? { data: dia } : {}),
      ...(e.recebido > 0 ? { recebido: e.recebido } : {}),
    }, { merge: true });
    custos++;
  }

  // ── 3. Reservas ──
  const produtos = await carregarProdutos();
  const porMlb = mapaPorMlb(produtos);
  const resSnap = await db.collection(COLECAO_RESERVAS).get();
  const reservas: ReservaExistente[] = resSnap.docs.map((d) => ({ ...(d.data() as ReservaExistente), id: d.id }));
  const { acoes, semCadastro } = planejarReservas(envios, porMlb, reservas, agora);
  const contagem = { criadas: 0, atualizadas: 0, encerradas: 0 };
  for (const a of acoes) {
    if (a.tipo === "criar") {
      const ref = db.collection(COLECAO_RESERVAS).doc(`ml-${a.inboundId}-${a.productId}`);
      const doc = {
        id: ref.id, productId: a.productId, quantidade: a.quantidade, data: a.data,
        criadoEm: hojeBR(), status: "agendado", inboundId: a.inboundId,
        obs: `Coleta Full #${a.inboundId} (lida do Mercado Livre)`,
        createdBy: "ml-sync", createdAt: agora,
      };
      await ref.set(doc);
      reservas.push(doc as ReservaExistente);
      contagem.criadas++;
    } else if (a.tipo === "atualizar") {
      await db.collection(COLECAO_RESERVAS).doc(a.id).update({ quantidade: a.quantidade, data: a.data, inboundId: a.inboundId, updatedBy: "ml-sync", updatedAt: agora });
      const r = reservas.find((x) => x.id === a.id);
      if (r) Object.assign(r, { quantidade: a.quantidade, data: a.data, inboundId: a.inboundId });
      contagem.atualizadas++;
    } else {
      await db.collection(COLECAO_RESERVAS).doc(a.id).update({ status: a.status, updatedBy: "ml-sync", updatedAt: agora });
      contagem.encerradas++;
    }
  }

  // ── 4. Passou o prazo de editar: o anúncio de agência desce ──
  const anuncios: string[] = [];
  for (const t of planejarTravamento(envios, reservas, agora)) {
    const produto = produtos.find((p) => p.id === t.productId);
    const irmao = produto ? irmaoDeAgencias(produto, produtos) : null;
    if (!irmao) { avisos.push(`#${t.inboundId}: ${produto?.name ?? t.productId} sem cadastro de Agências — tire ${t.quantidade} un do anúncio à mão`); continue; }
    const r = await baixarAnuncioDeAgencias(irmao, t.quantidade, `coleta Full #${t.inboundId} travou: ${t.quantidade} un vão pro Full`);
    if (r.ok) {
      await db.collection(COLECAO_RESERVAS).doc(t.reservaId).update({ anuncioJaBaixado: true, anuncioBaixadoEm: agora, anuncioBaixadoPor: "ml-sync" });
      anuncios.push(r.texto);
    } else {
      avisos.push(`#${t.inboundId}: ${r.texto}`);
    }
  }

  const resultado: ResultadoDaSync = {
    envios: tocados.size, detalhar: enviosParaDetalhar(envios, agora),
    reservas: contagem, semCadastro, custos, anuncios, avisos,
  };
  await col.doc(DOC_DA_SYNC).set({ ultimoResultado: { ...resultado, em: agora } }, { merge: true });
  return resultado;
}

/** Os ids que a extensão deve abrir no detalhe (sem ela mandar nada antes). */
export async function idsParaDetalhar(): Promise<string[]> {
  const snap = await getAdminDb().collection(COLECAO_ENVIOS_ML).get();
  const envios = snap.docs.filter((d) => d.id !== DOC_DA_SYNC).map((d) => d.data() as EnvioFullML);
  return enviosParaDetalhar(envios, Date.now());
}

export { situacaoDoEnvio };
