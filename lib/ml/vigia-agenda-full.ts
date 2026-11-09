import "server-only";
import { criarEventoEPublicar, enviarEPersistirEntrega, especDoPush } from "@/lib/notification-dispatch";
import { buildPayload } from "@/lib/ml/notificar-venda";
import { datasPorExtenso } from "@/lib/domain/agenda-full";

/**
 * Os avisos da vigia da agenda do Full. Quem LÊ a agenda é a extensão do
 * Chrome (extensao-vigia-full/), com a sessão do vendedor; o servidor só
 * recebe a leitura (app/api/widget/vigias) e manda o push.
 *
 * Até 09/11/2026 havia também uma vigia aqui, perguntando à API pública do ML
 * (/inbounds/{id}…). Essa API não mostra a agenda de verdade, e a leitura
 * "tolerante" contava qualquer data numa lista de agendamento como vaga —
 * tocou o alarme com a página do ML dizendo "Não temos datas disponíveis".
 * Saiu: a única fonte de "abriu data" é a coleta no endereço que o dono marca.
 */
export const COLECAO_VIGIAS = "full_agenda_vigias";
/** Quantos envios a extensão vigia de uma vez (pedido do dono, 05/11/2026: "uns 20"). */
export const MAX_VIGIAS = 25;
/**
 * O "conferido às" da extensão — UM documento na mesma coleção, gravado a cada
 * rodada (em vez de regravar a hora em cada envio: com 20 envios, isso era o
 * grosso das gravações do dia). Não tem `ativa`, então nenhuma consulta de
 * vigias o pega; a tela o lê à parte.
 */
export const DOC_DA_EXTENSAO = "_extensao";

/** O push "Agenda do Full liberada". Sem datas (o iPhone só vê que abriu), o texto não as cita. */
export async function avisarAgendaLiberada(id: string, datas: string[], marca = ""): Promise<number> {
  const dedupeKey = `full_agenda:${id}:${datas[0] ?? marca}`;
  const titulo = `Agenda do Full liberada · envio #${id}`;
  const corpo = datas.length
    ? `Data livre: ${datasPorExtenso(datas)}. Abra o Mercado Livre e agende o envio já — vaga some rápido.`
    : "Abriu data pra agendar. Abra o Mercado Livre e agende o envio já — vaga some rápido.";
  const { enviados } = await criarEventoEPublicar({
    type: "full_agenda",
    severity: "success",
    entityType: "system",
    entityId: id,
    dedupeKey,
    title: titulo,
    body: corpo,
    financialState: "confirmed",
    deepLink: "/?tab=full",
  }, especDoPush(dedupeKey, "full_agenda", {
    ...buildPayload(dedupeKey, "full_agenda", titulo, corpo, { orderId: "", tag: `full-agenda-${id}` }),
    deepLink: "/?tab=full",
  }));
  return enviados;
}

/**
 * MODO DESPERTADOR. Abriu data: além do primeiro aviso, o celular "toca" de
 * novo a cada ~1 min (cada toque é uma notificação NOVA, com som, furando o
 * horário silencioso) até alguém tocar em "Parar o alarme" no app, a data
 * sumir ou acabarem os toques. Sono pesado não acorda com um aviso só.
 */
export const MAX_TOQUES = 20;
export const INTERVALO_DO_TOQUE_MS = 50_000;

export async function repetirAlarmeDaAgenda(id: string, toque: number, desde: number): Promise<number> {
  const pushId = `full_agenda:${id}:toque:${desde}:${toque}`;
  const titulo = `⏰ ACORDA! Abriu data no Full (${toque}/${MAX_TOQUES})`;
  const corpo = `Envio #${id}: agende antes que a vaga suma. Abra o app e toque em "Parar o alarme".`;
  return enviarEPersistirEntrega(pushId, "full_agenda", {
    // Tag nova a cada toque: o sistema trata como aviso novo e toca de novo.
    ...buildPayload(pushId, "full_agenda", titulo, corpo, { orderId: "", tag: `full-agenda-${id}-toque-${toque}` }),
    deepLink: "/?tab=full",
  }, false, { validadeMs: 2 * 60_000, atualizaEvento: false, origem: "vigia-alarme" });
}

/** De quanto em quanto tempo sai o "ainda sem data" (o servidor ignora repetições dentro da mesma janela). */
export const JANELA_DO_PULSO_MS = 5 * 60_000;

/**
 * "Ainda sem data": o sinal de vida da vigia, pedido pela extensão do Chrome.
 * Leve de propósito: só o push (sem evento na Central), a MESMA tag (um
 * substitui o outro, nunca empilha), validade curta e sem furar o horário
 * silencioso. O id por janela de 5 min faz a repetição dentro dela não sair.
 */
export async function avisarAindaSemData(ids: string[], dono: string, agora = Date.now()): Promise<number> {
  const janela = Math.floor(agora / JANELA_DO_PULSO_MS);
  const pushId = `full_agenda_status:${dono.replace(/[^A-Za-z0-9_-]/g, "_")}:${janela}`;
  const hora = new Date(agora).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  const titulo = "Vigia do Full: ainda sem data";
  const lista = ids.length <= 4 ? ids.map((i) => `#${i}`).join(", ") : `${ids.slice(0, 3).map((i) => `#${i}`).join(", ")} e mais ${ids.length - 3}`;
  const corpo = `${lista} · conferido às ${hora}. Quando abrir data, chega outro aviso.`;
  return enviarEPersistirEntrega(pushId, "full_agenda_status", {
    ...buildPayload(pushId, "full_agenda_status", titulo, corpo, { orderId: "", tag: "full-agenda-status" }),
    deepLink: "/?tab=full",
  }, false, { validadeMs: JANELA_DO_PULSO_MS, atualizaEvento: false, origem: "vigia-extensao" });
}

/** O mesmo aviso (tipo, prioridade e caminho), marcado como teste: prova que o celular recebe. */
export async function testarAvisoDaAgenda(agora = Date.now()): Promise<number> {
  const dedupeKey = `full_agenda:teste:${agora}`;
  const titulo = "Teste · Agenda do Full";
  const corpo = "Se isto chegou no celular, o aviso de data liberada também chega. Nada pra fazer agora.";
  const { enviados } = await criarEventoEPublicar({
    type: "full_agenda",
    severity: "info",
    entityType: "system",
    entityId: "teste",
    dedupeKey,
    title: titulo,
    body: corpo,
    financialState: "confirmed",
    deepLink: "/?tab=full",
  }, especDoPush(dedupeKey, "full_agenda", {
    ...buildPayload(dedupeKey, "full_agenda", titulo, corpo, { orderId: "", tag: "full-agenda-teste" }),
    deepLink: "/?tab=full",
  }));
  return enviados;
}

