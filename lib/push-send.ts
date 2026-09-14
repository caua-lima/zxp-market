import "server-only";
import { getAdminDb, getAdminMessaging } from "@/lib/firebase/admin";
import type { NotificationEventType, SalePushPayload } from "@/lib/domain/notifications";
import { isPushAllowedForRecipient } from "@/lib/domain/notification-preferences";
import { agoraBR, getNotificationPreferencesByEmail } from "@/lib/notification-preferences";
import {
  redigirPush,
  separarPorAcesso,
  type AcessoDoDestinatario,
  type NivelConteudo,
} from "@/lib/domain/notificacao-publico";
import { papelDe, type PermissionTab } from "@/lib/domain/types";

/**
 * Lê quem ainda tem acesso, uma vez por envio.
 *
 * O envio nao consultava isto: lia `pushTokens` inteira e mandava pra todo
 * mundo. Tirar alguem de `controleAcesso` nao parava nada — o aparelho
 * continuava recebendo o faturamento da empresa ate o token do FCM morrer.
 * Preferencia de notificacao nunca foi autorizacao.
 */
async function lerAcessos(): Promise<Map<string, AcessoDoDestinatario>> {
  const snap = await getAdminDb().collection("controleAcesso").get();
  const mapa = new Map<string, AcessoDoDestinatario>();
  for (const d of snap.docs) {
    const dados = d.data() ?? {};
    const email = String(dados.email ?? d.id).toLowerCase();
    if (!email) continue;
    mapa.set(email, {
      papel: papelDe(dados.role),
      permissoesEdicao: Array.isArray(dados.permissoesEdicao)
        ? (dados.permissoesEdicao as PermissionTab[])
        : [],
    });
  }
  return mapa;
}

/**
 * Envia respeitando acesso e nivel de conteudo.
 *
 * Um multicast por nivel, porque o conteudo agora DIFERE por destinatario: o
 * member recebe a mesma venda sem valor, lucro nem margem.
 *
 * Quem perdeu o acesso e apenas pulado, nao apagado — restaurar o acesso nao
 * deve obrigar a pessoa a reativar a notificacao no aparelho.
 */
async function enviarComAcesso(
  registros: Registro[],
  payload: SalePushPayload,
): Promise<{ enviados: number; semAcesso: number }> {
  const { porNivel, semAcesso } = separarPorAcesso(registros, await lerAcessos());
  let enviados = 0;
  for (const [nivel, grupo] of porNivel) {
    enviados += await enviarPara(grupo, redigirPush(payload, nivel as NivelConteudo));
  }
  return { enviados, semAcesso: semAcesso.length };
}

type Registro = {
  docId: string; token: string; updatedAt: number;
  deviceId: string; email: string; userAgent: string;
};

/** Fica com o mais recente entre dois registros do mesmo aparelho. */
function maisNovo(a: Registro, b: Registro): [Registro, string] {
  return b.updatedAt > a.updatedAt ? [b, a.docId] : [a, b.docId];
}

/**
 * Um aparelho podia ter VÁRIOS registros vivos: antes o documento era
 * identificado pelo próprio token do FCM, e o token rotaciona — cada rotação
 * criava um documento novo sem apagar o antigo. Como o token velho segue
 * válido por um tempo, o mesmo celular recebia a notificação duplicada.
 * Agrupa por dispositivo e fica só com o registro mais recente; os antigos
 * (`duplicados`) são devolvidos pra quem chamar apagar.
 *
 * A 1ª correção tentou casar o registro LEGADO (sem deviceId) com o novo
 * comparando e-mail+navegador — e continuou falhando no iOS: o
 * `navigator.userAgent` do Safari em aba normal é DIFERENTE do mesmo Safari
 * rodando como app instalado na Tela de Início (partições de
 * armazenamento/contexto distintas). Alguém que ativou antes de instalar o
 * app e reabriu depois como instalado batia num userAgent diferente, o
 * legado nunca era reconhecido como duplicata, e os dois continuavam vivos.
 *
 * Correção: não depende mais de bater navegador nenhum. Qualquer registro
 * LEGADO de um e-mail que já tem PELO MENOS UM registro no formato novo é
 * considerado superado e apagado, sem exceção — não existe cenário em que
 * isso apague algo legítimo, porque é um app web: o deploy troca o código
 * de todo mundo de uma vez, não tem "alguém ainda no código antigo depois
 * do deploy". Se sobrarem só legados (ninguém reativou desde o deploy
 * ainda), eles continuam recebendo normal até serem substituídos.
 */
function deduplicarPorDispositivo(docs: FirebaseFirestore.QueryDocumentSnapshot[]): { envio: Registro[]; duplicados: string[] } {
  const duplicados: string[] = [];
  const comDevice: Registro[] = [];
  const legados: Registro[] = [];

  for (const d of docs) {
    const data = d.data() ?? {};
    const token = String(data.token ?? d.id); // legado: doc antigo tinha o token como id
    if (!token) continue;
    const r: Registro = {
      docId: d.id, token,
      updatedAt: Number(data.updatedAt ?? data.createdAt ?? 0),
      deviceId: String(data.deviceId ?? ""),
      email: String(data.email ?? ""),
      userAgent: String(data.userAgent ?? ""),
    };
    (r.deviceId ? comDevice : legados).push(r);
  }

  // 1) Registros novos: um por deviceId, o mais recente vence.
  const porDevice = new Map<string, Registro>();
  for (const r of comDevice) {
    const atual = porDevice.get(r.deviceId);
    if (!atual) { porDevice.set(r.deviceId, r); continue; }
    const [fica, sai] = maisNovo(atual, r);
    porDevice.set(r.deviceId, fica);
    duplicados.push(sai);
  }

  // 2) Legados: se o e-mail já tem QUALQUER registro novo, todo legado dele
  // é sobra — apaga sem tentar casar navegador. Só entram no envio os
  // legados de e-mail que ainda não migrou nenhum dispositivo.
  const emailsMigrados = new Set(Array.from(porDevice.values()).map((r) => r.email));
  const porEmailLegado = new Map<string, Registro>();
  for (const r of legados) {
    if (emailsMigrados.has(r.email)) { duplicados.push(r.docId); continue; }
    // Sem deviceId pra diferenciar aparelhos do mesmo e-mail no formato
    // antigo — mantém só o mais recente, igual ao comportamento anterior.
    const atual = porEmailLegado.get(r.email);
    if (!atual) { porEmailLegado.set(r.email, r); continue; }
    const [fica, sai] = maisNovo(atual, r);
    porEmailLegado.set(r.email, fica);
    duplicados.push(sai);
  }

  const registros = [...porDevice.values(), ...porEmailLegado.values()];
  // Mesmo token em dispositivos distintos não deveria acontecer, mas se
  // acontecer o FCM entregaria duas vezes — corta aqui também.
  const vistos = new Set<string>();
  const envio = registros.filter((r) => (vistos.has(r.token) ? false : (vistos.add(r.token), true)));
  return { envio, duplicados };
}

/**
 * Serializa o payload normalizado pro formato `data` do FCM — TODOS os
 * valores viram string porque mensagens data-only exigem isso (a API rejeita
 * número/undefined dentro de `data`). Campos ausentes viram string vazia em
 * vez de sumirem, pra quem lê do outro lado (SW, foreground, toast) não
 * precisar tratar "chave ausente" como um caso a mais.
 */
function serializarPayload(payload: SalePushPayload): Record<string, string> {
  return {
    eventId: payload.eventId,
    type: payload.type,
    title: payload.title,
    body: payload.body,
    icon: payload.icon ?? "/manifest-icon-192",
    badge: payload.badge ?? "/manifest-icon-192",
    tag: payload.tag,
    orderId: payload.orderId ?? "",
    deepLink: payload.deepLink,
    productName: payload.productName ?? "",
    grossAmount: payload.grossAmount ?? "",
    estimatedProfit: payload.estimatedProfit ?? "",
    estimatedMargin: payload.estimatedMargin ?? "",
    financialState: payload.financialState ?? "",
    itensJson: payload.itensJson ?? "",
    timestamp: payload.timestamp,
  };
}

/**
 * Manda o payload normalizado pros dispositivos em `registros`, com dedupe de
 * `tag`/`collapseKey` (o aparelho SUBSTITUI uma notificação já existente com
 * a mesma tag em vez de empilhar outra — rede de segurança extra, mesmo que
 * algo mande dois pushes do mesmo evento o usuário vê um aviso só). Limpa
 * token morto (app desinstalado, permissão revogada) sozinho.
 * Retorna quantos dispositivos realmente receberam.
 */
async function enviarPara(registros: Registro[], payload: SalePushPayload): Promise<number> {
  if (registros.length === 0) return 0;
  const db = getAdminDb();
  const messaging = getAdminMessaging();
  const resp = await messaging.sendEachForMulticast({
    tokens: registros.map((r) => r.token),
    // SÓ "data", sem "notification" no topo — de propósito. Com um campo
    // "notification" presente, o próprio SDK do Firebase pode exibir a
    // notificação sozinho ALÉM do showNotification() manual que o Service
    // Worker já faz (ver app/firebase-messaging-sw.js/route.ts) — duas
    // exibições pra um push só. Só "data" garante que a exibição acontece
    // uma vez, sempre pelo nosso código.
    data: serializarPayload(payload),
    webpush: { fcmOptions: { link: payload.deepLink } },
  });

  const mortos: string[] = [];
  resp.responses.forEach((r, i) => {
    const code = r.error?.code;
    if (!r.success && (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token")) {
      mortos.push(registros[i].docId);
    }
  });
  if (mortos.length > 0) {
    const batch = db.batch();
    mortos.forEach((id) => batch.delete(db.collection("pushTokens").doc(id)));
    await batch.commit();
  }
  return resp.successCount;
}

/**
 * Manda o mesmo evento pra TODOS os dispositivos registrados (owner e
 * colaborador, cada celular/navegador que ativou) — uma venda é informação
 * do time inteiro, não só de quem tá logado no momento.
 *
 * `payload.tag` já vem pronto de quem chama (ex.: `sale-{orderId}` — ver
 * lib/domain/notifications.ts) — é o que faz o aparelho substituir em vez de
 * empilhar duas notificações do mesmo pedido.
 */
export async function sendPushToAll(payload: SalePushPayload): Promise<{ enviados: number }> {
  const db = getAdminDb();
  const snap = await db.collection("pushTokens").get();
  const { envio, duplicados } = deduplicarPorDispositivo(snap.docs);

  if (duplicados.length > 0) {
    const batch = db.batch();
    duplicados.forEach((id) => batch.delete(db.collection("pushTokens").doc(id)));
    await batch.commit();
  }

  const { enviados } = await enviarComAcesso(envio, payload);
  return { enviados };
}

/**
 * Igual a `sendPushToAll`, mas filtrando por destinatário ANTES de enviar:
 * cada e-mail com preferências que desativam esse `type` (ou está dentro do
 * próprio horário silencioso configurado, e o tipo não é crítico) fica de
 * fora do envio. O evento em si já foi persistido de qualquer forma — isto
 * só decide quem recebe o PUSH.
 *
 * Owner e colaborador podem ter preferências diferentes porque a checagem é
 * por e-mail: cada um lê a própria preferência (usuarios/{uid}/preferences/
 * notifications), nunca a do outro.
 */
export async function sendSalePushToAll(
  payload: SalePushPayload,
  type: NotificationEventType,
  isSummary = false,
): Promise<{ enviados: number; elegiveis: number; bloqueadosPorPreferencia: number }> {
  const db = getAdminDb();
  const snap = await db.collection("pushTokens").get();
  const { envio, duplicados } = deduplicarPorDispositivo(snap.docs);

  if (duplicados.length > 0) {
    const batch = db.batch();
    duplicados.forEach((id) => batch.delete(db.collection("pushTokens").doc(id)));
    await batch.commit();
  }

  const emails = Array.from(new Set(envio.map((r) => r.email).filter(Boolean)));
  const agora = agoraBR();
  const permitidoPorEmail = new Map<string, boolean>();
  await Promise.all(
    emails.map(async (email) => {
      const prefs = await getNotificationPreferencesByEmail(email);
      permitidoPorEmail.set(email, isPushAllowedForRecipient(type, prefs, agora, isSummary));
    }),
  );

  const elegiveis = envio.filter((r) => permitidoPorEmail.get(r.email) !== false);
  const bloqueadosPorPreferencia = envio.length - elegiveis.length;

  const { enviados } = await enviarComAcesso(elegiveis, payload);
  return { enviados, elegiveis: elegiveis.length, bloqueadosPorPreferencia };
}

/**
 * Manda uma notificação só pros dispositivos de UM e-mail — usado pelo botão
 * "Enviar teste": prova que o pipeline inteiro funciona (token salvo no
 * Firestore → FCM aceita → aparelho de fato mostra o aviso) sem incomodar o
 * resto do time. Retorna quantos dispositivos desse usuário receberam, pra
 * UI poder dizer "nenhum dispositivo seu está registrado" quando for 0.
 */
export async function sendPushToUser(email: string, payload: SalePushPayload): Promise<{ enviados: number }> {
  const db = getAdminDb();
  const snap = await db.collection("pushTokens").where("email", "==", email).get();
  const { envio, duplicados } = deduplicarPorDispositivo(snap.docs);

  if (duplicados.length > 0) {
    const batch = db.batch();
    duplicados.forEach((id) => batch.delete(db.collection("pushTokens").doc(id)));
    await batch.commit();
  }

  const { enviados } = await enviarComAcesso(envio, payload);
  return { enviados };
}

/**
 * Igual a `sendPushToUser`, mas primeiro verifica a preferência DAQUELE
 * destinatário pra este tipo de evento (toggle + horário silencioso) — usado
 * pra avisos direcionados a UMA pessoa (ex.: tarefa atribuída), diferente do
 * envio de venda que já é preference-aware por natureza
 * (`sendSalePushToAll`, que varre o time inteiro).
 */
export async function sendPushToUserIfAllowed(
  email: string,
  payload: SalePushPayload,
  type: NotificationEventType,
): Promise<{ enviados: number; bloqueadoPorPreferencia: boolean }> {
  const prefs = await getNotificationPreferencesByEmail(email);
  const permitido = isPushAllowedForRecipient(type, prefs, agoraBR());
  if (!permitido) return { enviados: 0, bloqueadoPorPreferencia: true };
  const { enviados } = await sendPushToUser(email, payload);
  return { enviados, bloqueadoPorPreferencia: false };
}
