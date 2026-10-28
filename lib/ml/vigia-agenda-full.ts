import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { fetchML } from "@/lib/ml/fetch-ml";
import { getMlAccessToken } from "@/app/api/ml/token";
import { criarEventoEPublicar, especDoPush } from "@/lib/notification-dispatch";
import { buildPayload } from "@/lib/ml/notificar-venda";
import { datasPorExtenso, lerAgenda, type LeituraDaAgenda, type RespostaDoInbound } from "@/lib/domain/agenda-full";

/**
 * A vigia da agenda do Full, do lado do servidor. Roda a cada passagem do worker
 * (GitHub Actions, ~5 min — ver app/api/worker/route.ts): pra cada envio
 * vigiado, pergunta ao ML, grava o que ele respondeu e, se apareceu data livre,
 * manda o push "Agenda do Full liberada" — uma vez por data nova.
 *
 * O formato da resposta do ML não é documentado (ver lib/domain/agenda-full.ts):
 * guarda-se o status de cada endereço e um trecho da primeira resposta boa, pra
 * a tela mostrar o que o ML disse e pra a leitura poder ser afinada depois.
 */
export const COLECAO_VIGIAS = "full_agenda_vigias";
const ML_API = "https://api.mercadolibre.com";
/** O worker pode passar mais de uma vez em poucos minutos: não pergunta ao ML mais que isso. */
export const INTERVALO_MINIMO_MS = 4 * 60_000;
/** O ML já recusou este envio (403): insistir a cada 5 min só gasta chamada. Tenta de hora em hora, caso libere. */
export const INTERVALO_SEM_ACESSO_MS = 60 * 60_000;

export function caminhosDoInbound(id: string): string[] {
  return [`/inbounds/${id}`, `/inbounds/${id}/appointments`, `/inbounds/${id}/availability`, `/inbounds/${id}/schedules`, `/inbounds/${id}/slots`];
}

type Buscar = (url: string, init: RequestInit) => Promise<Response>;

/** Pergunta ao ML sobre UM envio. */
export async function consultarAgenda(id: string, token: string, buscar: Buscar = (u, i) => fetchML(u, i, { timeoutMs: 8000, maxTentativas: 1 })): Promise<LeituraDaAgenda & { amostra: string }> {
  const respostas: RespostaDoInbound[] = [];
  for (const caminho of caminhosDoInbound(id)) {
    try {
      const r = await buscar(`${ML_API}${caminho}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store" });
      const texto = await r.text().catch(() => "");
      let corpo: unknown = null;
      try { corpo = texto ? JSON.parse(texto) : null; } catch { corpo = null; }
      respostas.push({ caminho, status: r.status, corpo });
    } catch {
      respostas.push({ caminho, status: -1, corpo: null });
    }
  }
  const leitura = lerAgenda(respostas);
  const boa = respostas.find((r) => r.status >= 200 && r.status < 300 && r.corpo != null);
  return { ...leitura, amostra: boa ? `${boa.caminho} ${JSON.stringify(boa.corpo)}`.slice(0, 1500) : "" };
}

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

export type ResumoDaVigia = { vigias: number; consultadas: number; avisos: number; semToken: boolean };

/** Uma passagem: consulta os envios vigiados (empresa do contexto) e avisa o que liberou. */
export async function vigiarAgendasFull(opcoes: { agora?: number; buscar?: Buscar; token?: string | null } = {}): Promise<ResumoDaVigia> {
  const agora = opcoes.agora ?? Date.now();
  const db = getAdminDb();
  const snap = await db.collection(COLECAO_VIGIAS).where("ativa", "==", true).limit(20).get();
  const resumo: ResumoDaVigia = { vigias: snap.size, consultadas: 0, avisos: 0, semToken: false };
  if (snap.empty) return resumo;

  const token = opcoes.token !== undefined ? opcoes.token : await getMlAccessToken().catch(() => null);
  if (!token) { resumo.semToken = true; return resumo; }

  for (const d of snap.docs) {
    const v = d.data();
    const intervalo = v.estado === "sem_acesso" ? INTERVALO_SEM_ACESSO_MS : INTERVALO_MINIMO_MS;
    if (agora - Number(v.ultimaConsulta ?? 0) < intervalo) continue;
    const id = String(v.inboundId ?? d.id);
    const leitura = await consultarAgenda(id, token, opcoes.buscar);
    resumo.consultadas++;

    const patch: Record<string, unknown> = {
      ultimaConsulta: agora,
      estado: leitura.estado,
      datas: leitura.datas,
      detalhe: leitura.detalhe,
      consultas: FieldValue.increment(1),
      ...(leitura.amostra ? { amostra: leitura.amostra } : {}),
    };
    if (leitura.estado === "datas_liberadas") {
      const chave = leitura.datas.join(",");
      if (v.avisadoDatas !== chave) {
        const enviados = await avisarAgendaLiberada(id, leitura.datas).catch(() => 0);
        resumo.avisos++;
        patch.avisadoEm = agora;
        patch.avisadoDatas = chave;
        patch.avisoEnviados = enviados;
      }
    }
    await d.ref.update(patch);
  }
  return resumo;
}
