import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import {
  avaliarBootstrap,
  explicarRecusaBootstrap,
  listaAutorizada,
} from "@/lib/domain/bootstrap-acesso";

/**
 * Cria o PRIMEIRO owner — a única gravação em `controleAcesso` que não exige
 * um owner já existente.
 *
 * Antes isto acontecia no navegador: `AccessGuard` via que
 * `controleAcessoMeta/config` não existia e gravava o próprio e-mail como
 * owner, com as regras do Firestore liberando pra qualquer autenticado. Abrir
 * o app logado bastava pra virar dono do painel.
 *
 * Aqui a decisão é do servidor, contra uma lista que só existe em variável de
 * ambiente, e as duas gravações acontecem numa transação só.
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const idToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!idToken) {
    return NextResponse.json({ error: "unauthorized", details: "Missing token" }, { status: 401 });
  }

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(idToken);
  } catch {
    return NextResponse.json({ error: "unauthorized", details: "Invalid token" }, { status: 401 });
  }

  const email = (decoded.email || "").toLowerCase();
  const autorizados = listaAutorizada(process.env.BOOTSTRAP_OWNER_EMAILS);
  const db = getAdminDb();
  const refConfig = db.collection("controleAcessoMeta").doc("config");

  try {
    await db.runTransaction(async (tx) => {
      /**
       * A leitura acontece DENTRO da transação. Ler antes e decidir depois é
       * exatamente a corrida que isto existe pra impedir: duas abas abrindo
       * juntas liam "não existe" as duas e as duas viravam owner.
       */
      const config = await tx.get(refConfig);
      const veredito = avaliarBootstrap({
        email,
        configExiste: config.exists,
        autorizados,
      });
      if (!veredito.ok) throw new Error(veredito.motivo);

      // As duas gravações saem juntas ou não saem. Antes eram dois `setDoc`
      // soltos: falhar no segundo deixava um owner sem config, com a janela
      // ainda aberta pro próximo.
      //
      // `displayName` só entra quando existe: o Admin SDK recusa `undefined`
      // em `set()` (sem `ignoreUndefinedProperties`), e login por e-mail/senha
      // sem nome cadastrado não traz `decoded.name` — o bootstrap inteiro
      // quebrava com 500 pra esse caso.
      tx.set(db.collection("controleAcesso").doc(veredito.email), {
        email: veredito.email,
        role: "owner",
        ...(decoded.name ? { displayName: decoded.name } : {}),
        addedAt: Date.now(),
      });
      tx.set(refConfig, {
        ownerEmail: veredito.email,
        createdAt: Date.now(),
      });
    });
  } catch (err) {
    const motivo = err instanceof Error ? err.message : "desconhecido";
    const conhecido = ["sem_lista", "fora_da_lista", "ja_configurado", "sem_email"].includes(motivo);
    if (!conhecido) {
      return NextResponse.json(
        { error: "bootstrap_falhou", details: motivo },
        { status: 500 },
      );
    }
    return NextResponse.json(
      {
        error: motivo,
        // `ja_configurado` é 409 (estado do recurso), o resto é 403 (quem pede).
        details: explicarRecusaBootstrap(motivo as "sem_lista"),
      },
      { status: motivo === "ja_configurado" ? 409 : 403 },
    );
  }

  return NextResponse.json({ ok: true, ownerEmail: email });
}
