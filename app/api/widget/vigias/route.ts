import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { comTenant } from "@/lib/firebase/contexto-tenant";
import { inboundValido } from "@/lib/domain/agenda-full";
import { acessoDoWidget } from "@/lib/widget-acesso";
import { avisarAgendaLiberada, avisarAindaSemData, testarAvisoDaAgenda, COLECAO_VIGIAS, DOC_DA_EXTENSAO, MAX_VIGIAS, INTERVALO_DO_TOQUE_MS, MAX_TOQUES, repetirAlarmeDaAgenda } from "@/lib/ml/vigia-agenda-full";

/**
 * A rota da extensão do Chrome da vigia (pasta extensao-vigia-full). SEM
 * sessão: autoriza o código secreto. O ML só mostra a agenda pra quem está
 * logado no navegador, então quem olha a página é o Chrome do PC; aqui ele
 * busca a lista de envios e conta o que viu. (O campo no banco se chama
 * `iphone` por causa da primeira tentativa, com o Scriptable, que o ML bloqueou.)
 *
 *  - GET: os envios vigiados (só os números) e os de alarme parado no app.
 *  - POST { silenciar: true, inboundId }: "Parar alarme" na extensão.
 *  - POST { pulso: true, ids }: o "ainda sem data" (lib/ml/vigia-agenda-full.ts › avisarAindaSemData).
 *  - POST { inboundId, estado, trecho, novo }: o que a extensão viu. Com
 *    `novo` e "sem_datas", um envio ainda não vigiado passa a ser (a pessoa
 *    abriu a página de agendamento dele no Chrome; até 5). "datas" na
 *    primeira vez dispara o push pros outros aparelhos (crítico).
 */
const nao = () => NextResponse.json({ error: "nao_autorizado" }, { status: 401, headers: { "Cache-Control": "no-store" } });
const ESTADOS = new Set(["datas", "sem_datas", "login", "indefinido"]);

/**
 * SÓ A COLETA A DOMICÍLIO É DATA. Em 03/11/2026 as versões antigas da extensão
 * tocaram com a coleta "Indisponível no momento": a 1.7 tratava "forma de envio
 * liberada" como data ("formas liberadas: …") e a 1.8 contava veículo
 * particular/transportadora/fornecedor ("com horário: ftl, …"). Desde a 1.9 a
 * extensão só manda "datas" com horário na coleta, e o trecho diz isso
 * ("com horário: coleta no endereço escolhido · …"). Qualquer outro "datas" não vale: o servidor não
 * toca o celular e manda a extensão parar de bipar (lista de silenciados) até
 * ela ser recarregada.
 */
// Desde a 2.0, só vale horário no ENDEREÇO DE COLETA que o dono escolheu na
// extensão: em 03/11 a 1.9 tocou por um endereço antigo em São Paulo enquanto
// os de Mogi Guaçu seguiam sem data.
const dataNaColeta = (trecho: unknown) => /^com hor[aá]rio: coleta no endere[cç]o escolhido\b/i.test(String(trecho ?? ""));
const avisoDaVersaoAntiga = (trecho: unknown) => /^(formas liberadas|com hor[aá]rio:)/i.test(String(trecho ?? "")) && !dataNaColeta(trecho);

async function naEmpresa<T>(tenantId: string | null, fn: () => Promise<T>): Promise<T> {
  return tenantId ? comTenant(tenantId, fn) : fn();
}

type DocDaVigia = { id: string; get: (campo: string) => unknown };

/**
 * A lista que a extensão confere: os envios vigiados e os de alarme parado
 * ("Parar o alarme" no app, ou abriu a página pra agendar) — o PC para de
 * bipar também.
 */
function listaDaVigia(docs: DocDaVigia[]) {
  const itens = docs.map((d) => ({
    id: String(d.get("inboundId") ?? d.id),
    silenciado: Boolean((d.get("alarme") as { silenciadoEm?: number } | undefined)?.silenciadoEm)
      || avisoDaVersaoAntiga((d.get("iphone") as { trecho?: string } | undefined)?.trecho),
  }));
  return { ids: itens.map((x) => x.id), silenciados: itens.filter((x) => x.silenciado).map((x) => x.id) };
}

export async function GET(req: Request) {
  const dono = await acessoDoWidget(new URL(req.url).searchParams.get("t"));
  if (!dono) return nao();
  const lista = await naEmpresa(dono.tenantId, async () => {
    const snap = await getAdminDb().collection(COLECAO_VIGIAS).where("ativa", "==", true).limit(MAX_VIGIAS).get();
    return listaDaVigia(snap.docs);
  });
  return NextResponse.json(lista, { headers: { "Cache-Control": "no-store" } });
}

/**
 * O que uma leitura da extensão muda no documento do envio — e se avisou.
 * Avisar é o primeiro push crítico (data abriu) e, depois, o modo despertador
 * (toca de novo a cada ~1 min até alguém parar).
 */
async function aplicarLeitura(id: string, doc: DocDaVigia, estado: string, trecho: string, agora: number) {
  const patch: Record<string, unknown> = { iphone: { estado, em: agora, trecho } };
  let avisou = false;
  if (estado === "datas") {
    patch.estado = "datas_liberadas";
    const alarme = (doc.get("alarme") ?? {}) as { toques?: number; ultimoToqueEm?: number; silenciadoEm?: number; desde?: number };
    if (doc.get("avisadoDatas") !== "iphone") {
      await avisarAgendaLiberada(id, [], `iphone-${new Date(agora).toISOString().slice(0, 10)}`).catch(() => 0);
      patch.avisadoEm = agora;
      patch.avisadoDatas = "iphone";
      patch.alarme = { toques: 1, ultimoToqueEm: agora, silenciadoEm: 0, desde: agora };
      avisou = true;
    } else if (!alarme.silenciadoEm && (alarme.toques ?? 1) < MAX_TOQUES && agora - (alarme.ultimoToqueEm ?? 0) >= INTERVALO_DO_TOQUE_MS) {
      // Modo despertador: toca de novo até alguém parar no app.
      const toque = (alarme.toques ?? 1) + 1;
      await repetirAlarmeDaAgenda(id, toque, alarme.desde ?? agora).catch(() => 0);
      patch.alarme = { ...alarme, toques: toque, ultimoToqueEm: agora };
      avisou = true;
    }
  } else if (doc.get("avisadoDatas") === "iphone") {
    // Fechou de novo: a próxima abertura volta a avisar (e a tocar).
    patch.avisadoDatas = "";
    patch.alarme = { toques: 0, ultimoToqueEm: 0, silenciadoEm: 0, desde: 0 };
    if (estado === "sem_datas") patch.estado = "sem_datas";
  }
  return { patch, avisou };
}

/** "Data" de versão antiga da extensão (forma liberada, sem conferir horário na coleta do endereço escolhido) não é data. */
const estadoQueVale = (recebido: string, trecho: unknown) => (recebido === "datas" && !dataNaColeta(trecho) ? "indefinido" : recebido);

export async function POST(req: Request) {
  const dono = await acessoDoWidget(new URL(req.url).searchParams.get("t"));
  if (!dono) return nao();
  const corpo = (await req.json().catch(() => null)) as { inboundId?: unknown; estado?: unknown; trecho?: unknown; novo?: unknown; pulso?: unknown; ids?: unknown; silenciar?: unknown; teste?: unknown; lote?: unknown } | null;

  /**
   * A RODADA INTEIRA DE UMA VEZ (extensão 2.2+): { lote: [{ inboundId, estado, trecho }] }.
   * Uma requisição por rodada em vez de uma por envio; só grava o envio cuja
   * situação MUDOU (ou que precisa avisar), mais o "conferido às" geral. A
   * resposta já traz a lista da próxima rodada. Com 20 envios de 2 em 2 min,
   * é o que mantém o banco dentro da cota.
   */
  if (Array.isArray(corpo?.lote)) {
    const itens = (corpo.lote as { inboundId?: unknown; estado?: unknown; trecho?: unknown }[]).slice(0, MAX_VIGIAS)
      .map((x) => ({ id: inboundValido(x?.inboundId), recebido: String(x?.estado ?? ""), trecho: String(x?.trecho ?? "").slice(0, 300) }))
      .filter((x): x is { id: string; recebido: string; trecho: string } => !!x.id && ESTADOS.has(x.recebido));
    const r = await naEmpresa(dono.tenantId, async () => {
      const db = getAdminDb();
      const agora = Date.now();
      const snap = await db.collection(COLECAO_VIGIAS).where("ativa", "==", true).limit(MAX_VIGIAS).get();
      const porId = new Map(snap.docs.map((d) => [String(d.get("inboundId") ?? d.id), d]));
      let avisos = 0;
      const escritas: Promise<unknown>[] = [];
      for (const it of itens) {
        const doc = porId.get(it.id);
        if (!doc) continue;
        const estado = estadoQueVale(it.recebido, it.trecho);
        const { patch, avisou } = await aplicarLeitura(it.id, doc, estado, it.trecho, agora);
        if (avisou) avisos++;
        const antes = (doc.get("iphone") ?? {}) as { estado?: string; trecho?: string };
        const mudou = antes.estado !== estado || (antes.trecho ?? "") !== it.trecho || Object.keys(patch).length > 1;
        if (mudou) escritas.push(doc.ref.update(patch));
      }
      escritas.push(db.collection(COLECAO_VIGIAS).doc(DOC_DA_EXTENSAO).set({ conferidoEm: agora, envios: itens.length }, { merge: true }));
      await Promise.all(escritas);
      return { avisos, ...listaDaVigia(snap.docs) };
    });
    return NextResponse.json({ ok: true, ...r }, { headers: { "Cache-Control": "no-store" } });
  }

  // "Testar tudo" na extensão: o MESMO aviso crítico de data aberta, marcado como teste (um por minuto, no máximo).
  if (corpo?.teste === true) {
    const minuto = Math.floor(Date.now() / 60_000) * 60_000;
    const enviados = await naEmpresa(dono.tenantId, () => testarAvisoDaAgenda(minuto).catch(() => -1));
    return NextResponse.json({ ok: enviados >= 0, enviados: Math.max(0, enviados) }, { status: enviados >= 0 ? 200 : 502 });
  }

  // "Parar alarme" na extensão: o celular para de tocar também.
  if (corpo?.silenciar === true) {
    const alvo = inboundValido(corpo.inboundId);
    if (!alvo) return NextResponse.json({ error: "invalido" }, { status: 400 });
    const ok = await naEmpresa(dono.tenantId, () =>
      getAdminDb().collection(COLECAO_VIGIAS).doc(alvo).update({ "alarme.silenciadoEm": Date.now() }).then(() => true, () => false));
    return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
  }

  // "Ainda sem data": o sinal de vida que a extensão pede (~5 min). Só os envios que estão mesmo vigiados.
  if (corpo?.pulso === true) {
    const pedidos = Array.isArray(corpo.ids) ? corpo.ids.map(inboundValido).filter((x): x is string => !!x) : [];
    const enviados = await naEmpresa(dono.tenantId, async () => {
      const snap = await getAdminDb().collection(COLECAO_VIGIAS).where("ativa", "==", true).limit(MAX_VIGIAS).get();
      const ativos = new Set(snap.docs.map((d) => String(d.get("inboundId") ?? d.id)));
      const ids = pedidos.filter((i) => ativos.has(i)).slice(0, MAX_VIGIAS);
      return ids.length ? avisarAindaSemData(ids, dono.tenantId ?? dono.email).catch(() => 0) : 0;
    });
    return NextResponse.json({ ok: true, enviados }, { headers: { "Cache-Control": "no-store" } });
  }
  const id = inboundValido(corpo?.inboundId);
  const recebido = String(corpo?.estado ?? "");
  if (!id || !ESTADOS.has(recebido)) return NextResponse.json({ error: "invalido" }, { status: 400 });
  const estado = estadoQueVale(recebido, corpo?.trecho);

  const r = await naEmpresa(dono.tenantId, async () => {
    const db = getAdminDb();
    const ref = db.collection(COLECAO_VIGIAS).doc(id);
    const snap = await ref.get();
    const agora = Date.now();
    if (!snap.exists || snap.get("ativa") !== true) {
      // A extensão achou um envio sem data aberto no Chrome: passa a vigiar sozinho.
      if (corpo?.novo !== true || estado !== "sem_datas") return { ok: false as const };
      const ativas = await db.collection(COLECAO_VIGIAS).where("ativa", "==", true).limit(MAX_VIGIAS).get();
      if (ativas.docs.length >= MAX_VIGIAS) return { ok: false as const, cheio: true };
      await ref.set({
        inboundId: id, ativa: true, criadoEm: agora, criadoPor: dono.email, origem: "extensao",
        ultimaConsulta: 0, estado: "sem_datas", datas: [], detalhe: "", avisadoDatas: "",
        iphone: { estado, em: agora, trecho: "" },
      });
      return { ok: true as const, avisou: false, novo: true };
    }
    const { patch, avisou } = await aplicarLeitura(id, { id: snap.id ?? id, get: (c) => snap.get(c) }, estado, String(corpo?.trecho ?? "").slice(0, 300), agora);
    await ref.update(patch);
    return { ok: true as const, avisou };
  });
  if (!r.ok) return NextResponse.json({ error: "cheio" in r ? "limite_de_vigias" : "nao_vigiado" }, { status: "cheio" in r ? 409 : 404 });
  return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
}
