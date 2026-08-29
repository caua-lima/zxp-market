import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { lerUltimaExecucaoDoCron } from "@/lib/cron-heartbeat";
import { requireAccess } from "@/lib/api-auth";

export const maxDuration = 30;

/**
 * Diagnóstico da cadeia de notificação de venda.
 *
 * ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────
 *
 * "Não chega notificação" tem pelo menos cinco causas possíveis, e elas pedem
 * correções OPOSTAS:
 *
 *   1. O Mercado Livre nunca chama a nossa URL (webhook não cadastrado no
 *      painel de Developers, tópico `orders_v2` não assinado, URL de um
 *      deploy antigo). → nada no código resolve; é configuração no ML.
 *   2. O ML chama e nós quebramos (token, Firestore, erro no cálculo).
 *   3. O evento é criado mas nenhum aparelho está registrado.
 *   4. Está registrado, mas a preferência do usuário ou o horário silencioso
 *      bloqueiam.
 *   5. O push sai e o aparelho não exibe (permissão revogada, token morto).
 *
 * Sem medir, qualquer conserto é chute. Esta rota responde as cinco de uma
 * vez, com o que o sistema REGISTROU — não com suposição.
 *
 * Só metadado: nunca token, nunca corpo de requisição.
 */
export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  const db = getAdminDb();
  const agora = Date.now();
  const h24 = agora - 24 * 3600 * 1000;

  // ── 1/2. O ML está batendo aqui? ──
  let chamadas: Record<string, unknown>[] = [];
  let webhookIndisponivel = false;
  try {
    const snap = await db.collection("webhook_log").orderBy("ts", "desc").limit(30).get();
    chamadas = snap.docs.map((d) => d.data());
  } catch {
    // Índice ausente ou coleção nova: não é erro do diagnóstico.
    webhookIndisponivel = true;
  }
  const ultimas24h = chamadas.filter((c) => Number(c.ts ?? 0) >= h24);
  const comErro = ultimas24h.filter((c) => c.ok === false);

  /**
   * Tópicos que o webhook descarta (shipments, items, payments…) não entram
   * mais em `webhook_log` um-a-um — viraram contador diário, porque eram 73%
   * do volume. Mas a contagem precisa aparecer AQUI, senão o diagnóstico
   * responderia "o ML não está chamando" justamente no caso que ele existe
   * pra distinguir: ML configurado, só que no tópico errado.
   */
  let topicosIgnorados: Record<string, unknown> = {};
  try {
    const dias = [0, 1].map((d) => new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(agora - d * 86400000)));
    const docs = await db.getAll(...dias.map((dia) => db.collection("webhook_topicos").doc(dia)));
    for (const doc of docs) {
      if (doc.exists) topicosIgnorados[doc.id] = doc.data()?.topicos ?? {};
    }
  } catch {
    topicosIgnorados = {};
  }

  /**
   * ── O cron diário está rodando? ──
   *
   * Cinco automações dependem dele (backup, marcos, alerta de estoque,
   * lembrete de prazo e aviso de devolução). Quando ele não roda, nenhuma
   * roda — e o sintoma é ausência, que não aparece em lugar nenhum. Sem esta
   * checagem, "não chega notificação de tarefa" e "não chegou o marco" eram
   * investigados um a um, quando a causa era a mesma e ficava a montante.
   */
  const ultimaExecucao = await lerUltimaExecucaoDoCron();
  const cronHa = ultimaExecucao ? agora - ultimaExecucao.em : null;
  const cron = {
    jaRodou: ultimaExecucao != null,
    ultimaEm: ultimaExecucao ? new Date(ultimaExecucao.em).toISOString() : null,
    horasAtras: cronHa != null ? Math.round(cronHa / 3600000) : null,
    // Roda 9h todo dia: passando de 36h, ou nunca tendo rodado, algo está errado.
    saudavel: cronHa != null && cronHa < 36 * 3600 * 1000,
    diagnostico: ultimaExecucao == null
      ? "O cron NUNCA registrou execução. Causa mais provável: a variável CRON_SECRET não está configurada na Vercel — sem ela a Vercel não manda o header de autorização e o endpoint recusa a chamada com 401. Nesse estado, backup semanal, marcos, alerta de estoque, lembrete de tarefa e aviso de devolução não rodam."
      : cronHa != null && cronHa >= 36 * 3600 * 1000
        ? "O cron rodou, mas não nas últimas 36h — deveria rodar todo dia às 9h."
        : null,
    ultimoResumo: ultimaExecucao?.resumo ?? null,
  };

  // ── 3. Existe aparelho registrado? ──
  const tokensSnap = await db.collection("pushTokens").get();
  const porEmail = new Map<string, number>();
  for (const d of tokensSnap.docs) {
    const email = String(d.data()?.email ?? "(sem e-mail)");
    porEmail.set(email, (porEmail.get(email) ?? 0) + 1);
  }

  // ── 4/5. Os eventos recentes conseguiram entregar? ──
  let eventos: Record<string, unknown>[] = [];
  try {
    const snap = await db.collection("notification_events").orderBy("createdAt", "desc").limit(20).get();
    eventos = snap.docs.map((d) => {
      const v = d.data();
      const entrega = (v.delivery ?? {}) as Record<string, unknown>;
      return {
        id: d.id,
        type: v.type,
        title: v.title,
        // O que interessa aqui é a ENTREGA, não o conteúdo.
        tentou: Boolean(entrega.pushAttemptedAt),
        entregou: Boolean(entrega.pushDeliveredAt),
        erro: entrega.pushError ?? null,
      };
    });
  } catch { /* idem */ }

  const vendasRecentes = eventos.filter((e) => String(e.type ?? "").startsWith("sale_"));
  const semEntrega = vendasRecentes.filter((e) => e.tentou && !e.entregou);

  /**
   * Veredito em texto: a leitura correta de cada combinação, pra quem abre
   * isto não precisar interpretar os números sozinho.
   */
  const diagnostico: string[] = [];
  if (webhookIndisponivel || chamadas.length === 0) {
    diagnostico.push(
      "O Mercado Livre NUNCA chamou este servidor (nenhum registro de webhook). "
      + "Isso é configuração no ML, não código: em Developers › sua aplicação › Notificações, "
      + "confirme a URL de callback apontando pra /api/ml/webhook DESTE domínio e o tópico "
      + "'orders_v2' marcado. Enquanto isso, o sync a cada 15 min é quem manda os avisos.",
    );
  } else if (ultimas24h.length === 0) {
    diagnostico.push("O ML já chamou este servidor antes, mas nada nas últimas 24h. Se houve venda nesse período, a notificação do ML pode ter sido desativada.");
  }
  if (comErro.length > 0) {
    diagnostico.push(`${comErro.length} chamada(s) do ML falharam nas últimas 24h — ver 'erro' em ultimasChamadas.`);
  }
  if (tokensSnap.size === 0) {
    diagnostico.push("NENHUM aparelho registrado para push. Abra o app no celular e ative as notificações — sem isso não há para onde enviar.");
  }
  if (semEntrega.length > 0) {
    diagnostico.push(
      `${semEntrega.length} evento(s) de venda tentaram enviar e não entregaram. `
      + "Veja o campo 'erro' — 'bloquearam por preferência' é configuração de notificação; "
      + "'nenhum dispositivo registrado' é token faltando.",
    );
  }
  if (diagnostico.length === 0) {
    /**
     * "Entregue" aqui é só até onde o SERVIDOR enxerga: o FCM aceitou a
     * mensagem. Aceitar não é exibir — permissão revogada no sistema ou um
     * Service Worker velho no comando fazem o aparelho descartar em silêncio,
     * e daqui isso é indistinguível de sucesso. Dizer "cadeia saudável" sem
     * essa ressalva mandava procurar o problema no lugar errado.
     */
    diagnostico.push(
      "Do lado do servidor está tudo certo: o Mercado Livre está chamando, há aparelho registrado "
      + "e o Firebase ACEITOU as mensagens recentes. Atenção: aceitar não é o mesmo que exibir — "
      + "se mesmo assim nada aparece na barra, a causa está no aparelho (permissão do sistema ou "
      + "Service Worker antigo ainda no comando), e é o que as linhas acima verificam.",
    );
  }

  return NextResponse.json({
    diagnostico,
    webhook: {
      chamadasRegistradas: chamadas.length,
      ultimas24h: ultimas24h.length,
      comErro: comErro.length,
      ultimaChamadaEm: chamadas[0]?.at ?? null,
      ultimasChamadas: chamadas.slice(0, 10),
      // Só tópicos de pedido entram no log acima; estes são os demais.
      topicosIgnorados,
    },
    cron,
    dispositivos: {
      total: tokensSnap.size,
      porEmail: Object.fromEntries(porEmail),
    },
    eventos: {
      recentes: eventos.length,
      vendas: vendasRecentes.length,
      semEntrega: semEntrega.length,
      ultimos: eventos.slice(0, 10),
    },
  });
}
