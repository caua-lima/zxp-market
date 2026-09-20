import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { isCronRequest, requireAccess } from "@/lib/api-auth";
import { fetchMlUserProfileFresh } from "@/lib/ml/account";
import { enviarEPersistirEntrega } from "@/lib/notification-dispatch";
import { createNotificationEventIdempotent } from "@/lib/notification-events";
import {
  apenasPioras, compararAnuncios, compararReputacao,
  type AnuncioSnapshot, type ReputacaoSnapshot, type SnapshotDia,
} from "@/lib/domain/snapshot-diff";
import type { SalePushPayload } from "@/lib/domain/notifications";

export const maxDuration = 60;

/**
 * Retrato diário dos anúncios e da reputação, e os avisos do que MUDOU.
 *
 * POR QUE EXISTE
 * O app inteiro só sabia responder "como está agora". Coisa que muda sozinha
 * — o ML mexendo no preço, promoção entrando pela Central de Promoções,
 * anúncio sendo pausado, reputação piorando — só era percebida se alguém
 * abrisse a tela certa no dia certo. Preço caindo sem aviso é margem indo
 * embora em silêncio, que é o pior tipo de perda: não aparece em lugar nenhum
 * até o mês fechar pior.
 *
 * Guardar um retrato por dia é o que permite comparar. Uma escrita por dia,
 * então não pesa na cota (o app já esgotou cota de LEITURA antes; escrita
 * anda em ~17%).
 *
 * Só avisa PIORA e mudança relevante: alerta que dispara todo dia ensina a
 * pessoa a ignorar a notificação inteira.
 */

const COL = "snapshots_diarios";

function brDayISO(offset = 0): string {
  const d = new Date(Date.now() - 3 * 3600 * 1000 + offset * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function handler(req: Request) {
  try {
    const origem = new URL(req.url).origin;
    const auth = req.headers.get("authorization");
    const headers: Record<string, string> = auth ? { Authorization: auth } : {};
    const hoje = brDayISO();
    const db = getAdminDb();

    // ── Retrato de hoje ────────────────────────────────────────
    const [rEstoque, perfil] = await Promise.all([
      fetch(`${origem}/api/ml/estoque-ml`, { headers, cache: "no-store" }),
      fetchMlUserProfileFresh(),
    ]);

    const anuncios: AnuncioSnapshot[] = [];
    if (rEstoque.ok) {
      const j = (await rEstoque.json()) as {
        estoque?: Record<string, { available: number; status: string; price: number; regularPrice: number; hasPromo: boolean }>;
      };
      for (const [mlb, v] of Object.entries(j.estoque ?? {})) {
        anuncios.push({
          mlb,
          // `price` aqui já é o preço de venda real (a rota resolve sale_price).
          preco: Number(v.price ?? 0),
          emPromocao: Boolean(v.hasPromo),
          status: String(v.status ?? ""),
          disponivel: Number(v.available ?? 0),
        });
      }
    }

    const r = (perfil?.seller_reputation ?? null) as {
      level_id?: string; power_seller_status?: string | null;
      metrics?: { claims?: { rate?: number }; delayed_handling_time?: { rate?: number }; cancellations?: { rate?: number } };
    } | null;
    const reputacao: ReputacaoSnapshot | null = r
      ? {
          nivel: String(r.level_id ?? ""),
          selo: r.power_seller_status ?? null,
          reclamacoes: num(r.metrics?.claims?.rate),
          atrasoEnvio: num(r.metrics?.delayed_handling_time?.rate),
          cancelamentos: num(r.metrics?.cancellations?.rate),
        }
      : null;

    const snapshotHoje: SnapshotDia = { dia: hoje, anuncios, reputacao };

    // ── Compara com o retrato anterior ─────────────────────────
    // Busca o mais recente ANTES de hoje: se o cron falhou ontem, comparar
    // com anteontem ainda é melhor do que não comparar com nada.
    const anteriorSnap = await db.collection(COL)
      .where("dia", "<", hoje).orderBy("dia", "desc").limit(1).get();
    const anterior = anteriorSnap.empty ? null : (anteriorSnap.docs[0].data() as SnapshotDia);

    // Grava sempre, mesmo sem anterior — é o retrato que serve de base amanhã.
    await db.collection(COL).doc(hoje).set({ ...snapshotHoje, gravadoEm: Date.now() });

    if (!anterior) {
      return NextResponse.json({ ok: true, dia: hoje, primeiroRetrato: true, anuncios: anuncios.length });
    }

    const mudancasAnuncio = compararAnuncios(anterior.anuncios ?? [], anuncios);
    const piorasReputacao = apenasPioras(compararReputacao(anterior.reputacao ?? null, reputacao));

    // ── Monta o aviso ──────────────────────────────────────────
    const linhas: string[] = [];
    const quedas = mudancasAnuncio.filter((m) => m.tipo === "preco" && (m.variacaoPct ?? 0) < 0);
    const promos = mudancasAnuncio.filter((m) => m.tipo === "promocao_entrou");
    const pausados = mudancasAnuncio.filter((m) => m.tipo === "status" && m.depois !== "active");
    const zerados = mudancasAnuncio.filter((m) => m.tipo === "zerou");

    if (quedas.length) {
      const pior = quedas.reduce((a, b) => ((a.variacaoPct ?? 0) < (b.variacaoPct ?? 0) ? a : b));
      linhas.push(`${quedas.length} anúncio(s) com preço menor (maior queda: ${pior.titulo} ${pior.variacaoPct?.toFixed(1)}%)`);
    }
    if (promos.length) linhas.push(`${promos.length} anúncio(s) entraram em promoção`);
    if (pausados.length) linhas.push(`${pausados.length} anúncio(s) saíram do ar`);
    if (zerados.length) linhas.push(`${zerados.length} anúncio(s) zeraram o estoque`);
    for (const p of piorasReputacao) linhas.push(`reputação: ${p.campo} de ${p.antes} para ${p.depois}`);

    if (linhas.length === 0) {
      return NextResponse.json({ ok: true, dia: hoje, semMudancas: true, anuncios: anuncios.length });
    }

    const titulo = piorasReputacao.length > 0 ? "Reputação piorou" : "Mudanças nos seus anúncios";
    const dedupeKey = `snapshot_alerta:${hoje}`;
    const { eventId } = await createNotificationEventIdempotent({
      // "sync_warning" é o tipo mais próximo do que isto é: aviso operacional
      // do sistema, não venda. Reaproveita o toggle que o usuário já conhece.
      type: "sync_warning", severity: piorasReputacao.length > 0 ? "warning" : "info",
      entityType: "system", entityId: hoje, dedupeKey,
      title: titulo, body: linhas.join(" · "),
      financialState: "estimated", deepLink: "/?tab=estoque",
    });

    // Publica também quando o evento do dia já existia — ver resumo-diario.
    const payload: SalePushPayload = {
      eventId, type: "sync_warning", title: titulo, body: linhas.join(" · "),
      tag: `snapshot-${hoje}`, deepLink: "/?tab=estoque", timestamp: new Date().toISOString(),
    };
    const enviados = await enviarEPersistirEntrega(eventId, "sync_warning", payload, false, { origem: "snapshot" });

    return NextResponse.json({
      ok: true, dia: hoje, enviados,
      mudancas: mudancasAnuncio.length, pioras: piorasReputacao.length,
      detalhe: mudancasAnuncio.slice(0, 20),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "snapshot_failed", details: msg }, { status: 500 });
  }
}

/** GET = Vercel Cron. */
export async function GET(req: Request) {
  if (!isCronRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return handler(req);
}

/** POST = disparo manual, pra testar sem esperar o horário. */
export async function POST(req: Request) {
  const gate = await requireAccess(req, { allowCron: true, capacidade: "administrar" });
  if (gate instanceof NextResponse) return gate;
  return handler(req);
}
