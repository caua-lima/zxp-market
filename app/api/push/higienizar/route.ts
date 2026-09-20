import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdminDb, getAdminMessaging } from "@/lib/firebase/admin";
import { classificarErroFcm } from "@/lib/domain/push-envio";
import { diagnosticarRegistros, type RegistroDeDestino } from "@/lib/domain/push-destinos";

export const maxDuration = 60;

/**
 * Limpeza CONSERVADORA dos registros de push antigos — com simulação antes.
 *
 * O envio apagava registros no caminho de cada aviso, inferindo "mesmo
 * aparelho" pelo e-mail (ver lib/domain/push-destinos). Isso saiu. A limpeza
 * agora é esta operação explícita, e só apaga o que se PROVA sobra:
 *
 *  - documentos que repetem o MESMO token de outro (duplicata provada);
 *  - registros do formato antigo cujo token o FCM diz estar morto (checado
 *    com um envio de validação, que não entrega nada a ninguém).
 *
 * Um registro antigo VIVO nunca é apagado, mesmo que a pessoa tenha outro no
 * formato novo: o e-mail não prova que é o mesmo aparelho.
 *
 *   (sem parâmetro)   simulação: conta e mostra, não escreve nem chama o FCM
 *   ?aplicar=1        executa a limpeza
 *
 * O envio de validação do FCM é o comportamento documentado do `dryRun`, mas
 * NÃO pôde ser exercitado contra o FCM real ao escrever isto: se ele não
 * reportar o token morto, nada é apagado por esse critério (o lado seguro).
 */
async function tratar(req: Request) {
  const gate = await requireAccess(req, { allowCron: true, capacidade: "administrar" });
  if (gate instanceof NextResponse) return gate;

  const aplicar = new URL(req.url).searchParams.get("aplicar") === "1";
  const db = getAdminDb();
  const snap = await db.collection("pushTokens").get();
  const registros: RegistroDeDestino[] = snap.docs.map((d) => {
    const x = d.data() ?? {};
    return {
      docId: d.id,
      token: String(x.token ?? d.id),
      updatedAt: Number(x.updatedAt ?? x.createdAt ?? 0),
      deviceId: String(x.deviceId ?? ""),
      email: String(x.email ?? ""),
      userAgent: String(x.userAgent ?? ""),
    };
  });

  const diagnostico = diagnosticarRegistros(registros);
  const relatorio = {
    ok: true,
    simulacao: !aplicar,
    total: diagnostico.total,
    comInstalacao: diagnostico.comInstalacao,
    legados: diagnostico.legados,
    legadosDeEmailComRegistroNovo: diagnostico.legadosDeEmailComRegistroNovo,
    semEmail: diagnostico.semEmail,
    // Nunca devolve e-mails nem tokens: só contagens do que sairia.
    duplicadosPorToken: diagnostico.duplicadosPorToken.length,
    mortosDetectados: 0,
    apagados: 0,
  };
  if (!aplicar) return NextResponse.json(relatorio);

  const paraApagar = new Set<string>(diagnostico.duplicadosPorToken);

  const legadosVivos = registros.filter((r) => !r.deviceId && !paraApagar.has(r.docId));
  for (const r of legadosVivos) {
    try {
      await getAdminMessaging().send({ token: r.token, data: { validacao: "1" } }, true);
    } catch (err) {
      if (classificarErroFcm((err as { code?: string })?.code) === "token_invalido") {
        paraApagar.add(r.docId);
        relatorio.mortosDetectados++;
      }
    }
  }

  const ids = [...paraApagar];
  for (let i = 0; i < ids.length; i += 400) {
    const lote = db.batch();
    ids.slice(i, i + 400).forEach((id) => lote.delete(db.collection("pushTokens").doc(id)));
    await lote.commit();
  }
  relatorio.apagados = ids.length;
  return NextResponse.json(relatorio);
}

export const POST = tratar;
export const GET = tratar;
