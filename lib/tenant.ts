import "server-only";
import { getAdminDb } from "@/lib/firebase/admin";
import { refreshAccessToken } from "@/lib/ml/client";
import {
  licencaValida, normalizarPapel,
  type Licenca, type MembroTenant,
} from "@/lib/domain/tenant";

/**
 * Resolução de tenant no servidor — o lado de I/O de lib/domain/tenant.ts
 * (que é puro e tem os testes).
 *
 * Adaptado do lib/ml/tenant.ts do branch `saas`, com UMA mudança de fundo:
 * lá tudo era indexado por `uid`, aqui é por `tenantId`.
 *
 * ─── POR QUE A CONEXÃO DO ML É POR TENANT, NÃO POR uid ──────────────────
 *
 * No branch saas a conexão morava em `ml_conexoes/{uid}`. Isso quer dizer que
 * o colaborador, tendo outro uid, cairia numa conexão VAZIA — e teria que
 * conectar a própria conta do Mercado Livre para ver os pedidos da loja onde
 * trabalha. Não faz sentido: a conta ML é da OPERAÇÃO, não da pessoa. O sócio
 * não tem (nem deveria ter) credencial própria da loja.
 *
 * Indexando por tenantId, o Owner conecta uma vez e todo mundo do tenant
 * enxerga os mesmos pedidos — que é como o produto já funciona hoje.
 *
 * ─── SEGURANÇA ──────────────────────────────────────────────────────────
 *
 * `ml_conexoes` e `ml_oauth_states` NÃO têm match em firestore.rules.saas, de
 * propósito: sem regra, o Firestore nega tudo que vem do cliente e só o Admin
 * SDK enxerga. É onde mora o refresh_token — se o cliente pudesse ler, um
 * vazamento daria acesso à conta ML do vendedor. Há teste de emulador
 * cobrindo isso (nem o próprio owner lê).
 */

const ML_API = "https://api.mercadolibre.com";

const MEMBROS = "tenant_membros";   // tenant_membros/{uid}
const LICENCAS = "licencas";        // licencas/{email}
const CONEXOES = "ml_conexoes";     // ml_conexoes/{tenantId}  ← por TENANT
const TENANTS = "tenants";          // tenants/{tenantId}

export type ContextoTenant = {
  uid: string;
  email: string;
  tenantId: string;
  membro: MembroTenant;
};

const conexaoRef = (tenantId: string) => getAdminDb().collection(CONEXOES).doc(tenantId);

/** Coleção de dados DESTE tenant. Tem que casar com o caminho que o cliente usa. */
export function tenantCol(tenantId: string, nome: string) {
  return getAdminDb().collection("tenants").doc(tenantId).collection(nome);
}

export async function getMembro(uid: string): Promise<MembroTenant | null> {
  const snap = await getAdminDb().collection(MEMBROS).doc(uid).get();
  if (!snap.exists) return null;
  const d = snap.data() ?? {};
  return {
    tenantId: String(d.tenantId ?? ""),
    email: String(d.email ?? ""),
    papel: normalizarPapel(d.papel),
    permissoesEdicao: Array.isArray(d.permissoesEdicao) ? d.permissoesEdicao : undefined,
    displayName: d.displayName,
    adicionadoEm: d.adicionadoEm,
    adicionadoPor: d.adicionadoPor,
  };
}

export async function getLicenca(email: string): Promise<Licenca | null> {
  const snap = await getAdminDb().collection(LICENCAS).doc(email.toLowerCase()).get();
  if (!snap.exists) return null;
  const d = snap.data() ?? {};
  // expiresAt pode vir como Timestamp do Firestore ou número — normaliza pra ms.
  const raw = d.expiresAt;
  const expiresAt =
    raw == null ? null
      : typeof raw === "number" ? raw
        : typeof raw?.toMillis === "function" ? raw.toMillis()
          : null;
  return {
    email: String(d.email ?? email),
    status: d.status === "suspenso" ? "suspenso" : "ativo",
    expiresAt,
    plano: d.plano,
    nota: d.nota,
  };
}

/**
 * Resolve o tenant de um usuário autenticado, já validando a licença.
 *
 * Devolve `null` em vez de lançar quando não resolve — quem chama decide se
 * é 401, 403 ou "ainda não fez onboarding". NUNCA cai num tenant padrão: era
 * exatamente esse fallback silencioso (`|| "2420261535"`) que fazia o sistema
 * servir dado da VAZXPRESS quando a resolução falhava.
 */
export async function resolverTenant(uid: string, email: string): Promise<ContextoTenant | null> {
  const membro = await getMembro(uid);
  if (!membro?.tenantId) return null;

  const licenca = await getLicenca(membro.email || email);
  if (!licencaValida(licenca, Date.now())) return null;

  return { uid, email, tenantId: membro.tenantId, membro };
}

/**
 * Resolve o tenant de uma chamada de API, cobrindo os dois jeitos que ela
 * chega: sessão de usuário real (gate.uid/gate.email vêm de requireAccess) ou
 * cron/job (gate.uid === "cron", sem usuário nenhum por trás — ver
 * lib/api-auth.ts).
 *
 * ─── A DECISÃO PARA O CASO cron, E POR QUE ELA SE AUTO-EXPIRA ───────────
 *
 * Hoje existe exatamente UM tenant. Então, para chamadas de cron, esta
 * função usa esse único tenant. É deliberadamente PROVISÓRIO: no instante em
 * que existir um segundo tenant ATIVO, ela passa a RECUSAR — nunca escolhe
 * qual dos dois é "o certo", porque não há como saber.
 *
 * Isso transforma a limitação em trava, não em bug esquecido: o cron
 * simplesmente PARA de funcionar quando o segundo cliente é onboardado, com
 * um log dizendo exatamente por quê. Ninguém vai deixar cron parado sem
 * notar. É o gatilho que força a Fase 4 (cron iterando por tenant, com
 * rate-limit e alerta por tenant) a existir antes do segundo cliente, em vez
 * de depois — e antes é sempre mais barato.
 */
export async function resolverTenantDaRequisicao(
  gate: { uid: string; email: string },
): Promise<{ tenantId: string } | null> {
  if (gate.uid !== "cron") {
    const ctx = await resolverTenant(gate.uid, gate.email);
    return ctx ? { tenantId: ctx.tenantId } : null;
  }

  const snap = await getAdminDb().collection("tenants").get();
  if (snap.size !== 1) {
    console.error(
      `[tenant] cron chamado com ${snap.size} tenant(s) — recusando. ` +
      `A resolução de tenant único do cron só vale para exatamente 1 tenant ` +
      `(ver resolverTenantDaRequisicao em lib/tenant.ts). Implemente a Fase 4 ` +
      `(cron por tenant) antes de onboardar o próximo cliente.`,
    );
    return null;
  }
  return { tenantId: snap.docs[0].id };
}

// ── Conexão com o Mercado Livre, por tenant ────────────────────────

export type MlConexao = {
  access_token?: string | null;
  refresh_token?: string | null;
  expires_in?: number | null;
  updated_at?: string | null;
  seller_id?: string | null;
  nickname?: string | null;
  conectado_em?: string | null;
  /** uid de quem conectou — rastro, não autorização. */
  conectado_por?: string | null;
};

export async function getMlConexao(tenantId: string): Promise<MlConexao | null> {
  const snap = await conexaoRef(tenantId).get();
  return snap.exists ? (snap.data() as MlConexao) : null;
}

function expirado(c: MlConexao): boolean {
  if (!c.expires_in || !c.updated_at) return false;
  const updatedAt = Date.parse(c.updated_at);
  if (Number.isNaN(updatedAt)) return false;
  return Date.now() >= updatedAt + c.expires_in * 1000 - 60_000; // 1 min de folga
}

async function renovar(tenantId: string, c: MlConexao): Promise<string | null> {
  if (!c.refresh_token) return null;
  const novo = await refreshAccessToken(c.refresh_token);
  await conexaoRef(tenantId).set(
    {
      access_token: novo.access_token ?? null,
      refresh_token: novo.refresh_token ?? c.refresh_token,
      expires_in: novo.expires_in ?? c.expires_in,
      updated_at: new Date().toISOString(),
    },
    { merge: true },
  );
  return novo.access_token ?? null;
}

/** Token válido do tenant (renova sozinho). null = não conectado. */
export async function getMlAccessToken(tenantId: string): Promise<string | null> {
  const c = await getMlConexao(tenantId);
  if (!c) return null;
  if (c.access_token && !expirado(c)) return c.access_token;
  if (!c.refresh_token) return c.access_token || null;
  return renovar(tenantId, c);
}

export async function getValidMlAccessToken(tenantId: string): Promise<string> {
  const token = await getMlAccessToken(tenantId);
  if (!token) throw new Error("ml_nao_conectado: este tenant ainda não conectou a conta do Mercado Livre.");
  return token;
}

type ContaML = { id?: number | string; nickname?: string };

async function buscarConta(token: string): Promise<ContaML | null> {
  const r = await fetch(`${ML_API}/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!r.ok) return null;
  return (await r.json()) as ContaML;
}

/**
 * seller_id da conta ML DESTE tenant. Substitui a env `ML_SELLER_ID` e, mais
 * importante, o fallback `|| "2420261535"` que existia em 6 arquivos: aqui,
 * não conseguir resolver LANÇA, em vez de servir a conta do dono em silêncio.
 */
export async function getSellerId(tenantId: string): Promise<string> {
  const c = await getMlConexao(tenantId);
  if (c?.seller_id) return String(c.seller_id);

  const token = await getValidMlAccessToken(tenantId);
  const me = await buscarConta(token);
  if (!me?.id) throw new Error("ml_sem_seller_id: não consegui identificar a conta do Mercado Livre deste tenant.");
  await conexaoRef(tenantId).set({ seller_id: String(me.id), nickname: me.nickname ?? null }, { merge: true });
  return String(me.id);
}

/** Tudo que uma rota precisa do ML, numa chamada só. */
export async function getTenantML(tenantId: string): Promise<{ token: string; sellerId: string }> {
  const token = await getValidMlAccessToken(tenantId);
  const sellerId = await getSellerId(tenantId);
  return { token, sellerId };
}

/**
 * Qual tenant é dono desta conta do Mercado Livre?
 *
 * É o que o webhook precisa: o ML manda `user_id` (o seller), não o nosso
 * tenantId. Sem isto, o webhook grava o pedido de um cliente no espaço de
 * outro — hoje o handler nem olha de quem é o pedido.
 *
 * Consulta por `seller_id`, que é gravado no momento da conexão. Devolve null
 * quando nenhum tenant reivindica aquele seller: quem chama deve RECUSAR o
 * evento, nunca escolher um tenant padrão.
 */
export async function tenantPorSellerId(sellerId: string): Promise<string | null> {
  const id = String(sellerId ?? "").trim();
  if (!id) return null;
  const snap = await getAdminDb().collection(CONEXOES).where("seller_id", "==", id).limit(2).get();
  if (snap.empty) return null;
  if (snap.size > 1) {
    // Dois tenants com a mesma conta ML é estado inválido: não dá pra escolher
    // um sem chutar de quem é a venda. Recusa e deixa o erro visível.
    console.error("[tenant] seller_id reivindicado por mais de um tenant", { sellerId: id });
    return null;
  }
  return snap.docs[0].id;
}

// ── OAuth: quem está autorizando, e para qual tenant ──────────────

const OAUTH_STATES = "ml_oauth_states"; // ml_oauth_states/{state}

/** 10 min: tempo de sobra pra alguém logar no ML, curto pra um state vazado não valer muito. */
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export type OAuthState = { tenantId: string; uid: string; verifier: string; criadoEm: number };

/**
 * Guarda a intenção de conectar ANTES de mandar o usuário pro Mercado Livre.
 *
 * O `state` é a única coisa que sobrevive ao redirect. Guardar tenant e uid do
 * lado do SERVIDOR, indexados por ele, é o que impede que o callback confie em
 * algo que o navegador poderia ter adulterado: se o tenantId viajasse no
 * próprio state (ou num cookie), bastaria trocá-lo pra gravar o token da SUA
 * conta do Mercado Livre dentro do tenant de outro cliente.
 */
export async function criarOAuthState(tenantId: string, uid: string, verifier: string): Promise<string> {
  const state = crypto.randomUUID();
  await getAdminDb().collection(OAUTH_STATES).doc(state).set({
    tenantId, uid, verifier, criadoEm: Date.now(),
  });
  return state;
}

/**
 * Lê e QUEIMA o state — de uso único, sempre. Devolve null se não existe, já
 * foi usado ou expirou; quem chama deve recusar a conexão nesses casos, nunca
 * seguir com um tenant adivinhado.
 *
 * Apaga antes de validar o prazo de propósito: mesmo state expirado sai do
 * banco na primeira tentativa, em vez de ficar lá esperando uma segunda.
 */
export async function consumirOAuthState(state: string): Promise<OAuthState | null> {
  const id = String(state ?? "").trim();
  if (!id) return null;

  const ref = getAdminDb().collection(OAUTH_STATES).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;

  await ref.delete().catch(() => {});

  const d = snap.data() as OAuthState;
  if (!d?.tenantId || !d?.uid) return null;
  if (Date.now() - (d.criadoEm ?? 0) > OAUTH_STATE_TTL_MS) return null;
  return d;
}

export async function salvarConexao(
  tenantId: string,
  uid: string,
  tokens: { access_token?: string; refresh_token?: string; expires_in?: number },
): Promise<{ sellerId: string | null; nickname: string | null }> {
  const me = tokens.access_token ? await buscarConta(tokens.access_token) : null;
  await conexaoRef(tenantId).set(
    {
      access_token: tokens.access_token ?? null,
      refresh_token: tokens.refresh_token ?? null,
      expires_in: tokens.expires_in ?? null,
      updated_at: new Date().toISOString(),
      conectado_em: new Date().toISOString(),
      conectado_por: uid,
      ...(me?.id ? { seller_id: String(me.id) } : {}),
      ...(me?.nickname ? { nickname: me.nickname } : {}),
    },
    { merge: true },
  );
  return { sellerId: me?.id ? String(me.id) : null, nickname: me?.nickname ?? null };
}

/** Apaga tokens e identidade da conexão do tenant — usado por "Desconectar"/"Trocar conta". */
export async function desconectarML(tenantId: string): Promise<void> {
  await conexaoRef(tenantId).set(
    {
      access_token: null, refresh_token: null, expires_in: null,
      seller_id: null, nickname: null,
      updated_at: new Date().toISOString(),
    },
    { merge: true },
  );
}

// ── Cron multi-tenant ──────────────────────────────────────────────

/**
 * Todos os tenants com a licença do dono anexada, pro cron decidir quem
 * sincroniza (ver lib/domain/cron-tenants.ts).
 *
 * A licença é indexada por E-MAIL e o tenant por id, então o vínculo vem de
 * `tenant_membros`: o owner daquele tenant é quem carrega a licença. Um
 * tenant sem owner (estado inconsistente) volta com licença null e é pulado
 * com motivo, em vez de sumir da lista sem explicação.
 */
export async function listarTenantsComLicenca(): Promise<
  { tenantId: string; email: string; licenca: { status?: string | null; expiresAt?: number | null } | null }[]
> {
  const db = getAdminDb();
  const [tenantsSnap, membrosSnap] = await Promise.all([
    db.collection(TENANTS).get(),
    db.collection(MEMBROS).where("papel", "==", "owner").get(),
  ]);

  const ownerPorTenant = new Map<string, string>();
  for (const d of membrosSnap.docs) {
    const m = d.data();
    const tid = String(m?.tenantId ?? "");
    const email = String(m?.email ?? "").toLowerCase();
    if (tid && email && !ownerPorTenant.has(tid)) ownerPorTenant.set(tid, email);
  }

  const emails = Array.from(new Set(ownerPorTenant.values()));
  const licencas = new Map<string, { status?: string | null; expiresAt?: number | null }>();
  await Promise.all(
    emails.map(async (email) => {
      const l = await getLicenca(email);
      if (l) licencas.set(email, { status: l.status, expiresAt: l.expiresAt });
    }),
  );

  return tenantsSnap.docs.map((d) => {
    const email = ownerPorTenant.get(d.id) ?? "";
    return { tenantId: d.id, email, licenca: email ? licencas.get(email) ?? null : null };
  });
}

/**
 * Onde o rodízio do cron para. Guardado num doc único e global: é estado da
 * EXECUÇÃO, não de nenhum tenant — colocá-lo dentro de um deles faria um
 * cliente carregar o ponteiro dos outros.
 */
const CRON_ESTADO = "cron_estado";

export async function lerUltimoTenantSincronizado(): Promise<string | null> {
  try {
    const d = await getAdminDb().collection(CRON_ESTADO).doc("sync").get();
    const v = d.data()?.ultimoTenant;
    return typeof v === "string" && v ? v : null;
  } catch {
    return null; // sem ponteiro, começa do topo — nunca trava o cron
  }
}

export async function salvarUltimoTenantSincronizado(tenantId: string): Promise<void> {
  try {
    await getAdminDb().collection(CRON_ESTADO).doc("sync").set(
      { ultimoTenant: tenantId, em: Date.now() },
      { merge: true },
    );
  } catch { /* perder o ponteiro só reinicia o rodízio */ }
}

// ── Admin master do SaaS ───────────────────────────────────────────

const SAAS_ADMINS = "saas_admins";   // saas_admins/{email}

/**
 * O e-mail é admin master do SaaS?
 *
 * Master NÃO é "owner" de um tenant: owner é dono de UMA loja, master é dono
 * do negócio — vê todas as licenças e cria contas. A separação é deliberada
 * (ver lib/domain/tenant.ts): no modelo antigo `role == "owner"` queria dizer
 * as duas coisas, e um merge que compilasse transformaria todo cliente em
 * admin do SaaS.
 *
 * A coleção tem `allow write: if false` nas regras — só o Admin SDK escreve,
 * e só pelo script. Esta função apenas LÊ.
 */
export async function ehMaster(email: string): Promise<boolean> {
  const e = String(email ?? "").trim().toLowerCase();
  if (!e) return false;
  try {
    return (await getAdminDb().collection(SAAS_ADMINS).doc(e).get()).exists;
  } catch {
    // Falha de leitura NUNCA vira permissão: no escuro, o acesso é negado.
    return false;
  }
}

export type ClienteResumo = {
  tenantId: string;
  nome: string;
  ownerEmail: string;
  criadoEm: number | null;
  licenca: { status: string; expiresAt: number | null } | null;
  /** true = a conta do ML já foi conectada por eles. */
  mlConectado: boolean;
};

/**
 * Todos os clientes, com licença e estado da conexão — a visão do master.
 *
 * `mlConectado` importa mais do que parece: é o único passo do onboarding que
 * o master NÃO pode fazer pelo cliente (o token do ML dá acesso à conta
 * inteira dele). Sem esta coluna, "criei a conta e o cliente diz que não
 * funciona" vira investigação; com ela, é uma olhada.
 */
export async function listarClientes(): Promise<ClienteResumo[]> {
  const db = getAdminDb();
  const [tenants, membros, conexoes] = await Promise.all([
    db.collection(TENANTS).get(),
    db.collection(MEMBROS).where("papel", "==", "owner").get(),
    db.collection(CONEXOES).get(),
  ]);

  const ownerPorTenant = new Map<string, string>();
  for (const d of membros.docs) {
    const m = d.data();
    const tid = String(m?.tenantId ?? "");
    const email = String(m?.email ?? "").toLowerCase();
    if (tid && email && !ownerPorTenant.has(tid)) ownerPorTenant.set(tid, email);
  }
  const conectados = new Set(conexoes.docs.filter((d) => d.data()?.refresh_token).map((d) => d.id));

  const emails = Array.from(new Set(ownerPorTenant.values()));
  const licencas = new Map<string, { status: string; expiresAt: number | null }>();
  await Promise.all(emails.map(async (email) => {
    const l = await getLicenca(email);
    if (l) licencas.set(email, { status: String(l.status ?? "ativo"), expiresAt: l.expiresAt ?? null });
  }));

  return tenants.docs
    .map((d) => {
      const email = ownerPorTenant.get(d.id) ?? "";
      return {
        tenantId: d.id,
        nome: String(d.data()?.nome ?? d.id),
        ownerEmail: email,
        criadoEm: Number(d.data()?.criadoEm ?? 0) || null,
        licenca: email ? licencas.get(email) ?? null : null,
        mlConectado: conectados.has(d.id),
      };
    })
    .sort((a, b) => (b.criadoEm ?? 0) - (a.criadoEm ?? 0));
}
