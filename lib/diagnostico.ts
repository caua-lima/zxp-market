import "server-only";
import { NextResponse } from "next/server";
import { requireAccess, type AuthContext } from "@/lib/api-auth";
import { getAdminDb } from "@/lib/firebase/admin";
import { log, semDadosPessoais } from "@/lib/log";

/**
 * Rotas de diagnóstico (S27): escopo, auditoria e sem dado pessoal.
 *
 * Elas existem pra ver a resposta CRUA do Mercado Livre quando um número não
 * bate. Crua demais: devolviam nome, endereço e telefone de comprador, e uma
 * delas devolvia o começo do token do ML. Agora toda rota de diagnóstico:
 *
 *   1. só abre pra quem administra a empresa (e só enxerga a própria empresa —
 *      o token e os dados vêm da empresa da requisição);
 *   2. deixa registro de quem abriu, qual rota e quando, na coleção da própria
 *      empresa (`acessos_diagnostico`, só o servidor lê e grava);
 *   3. responde sem os campos pessoais (`semDadosPessoais`, mesma regra do log).
 */

/** Um ano: o registro de auditoria sai sozinho depois disso (política TTL do Firestore em `apagarEm`). */
export const RETENCAO_AUDITORIA_MS = 365 * 24 * 3600 * 1000;

export function rotaDeDiagnostico(
  rota: string,
  fn: (req: Request, gate: AuthContext) => Promise<{ corpo: unknown; status?: number }>,
) {
  return async function GET(req: Request) {
    const gate = await requireAccess(req, { adminOnly: true });
    if (gate instanceof NextResponse) return gate;

    const agora = Date.now();
    try {
      await getAdminDb().collection("acessos_diagnostico").add({
        rota,
        uid: gate.uid,
        email: gate.email,
        em: agora,
        apagarEm: new Date(agora + RETENCAO_AUDITORIA_MS),
      });
    } catch (err) {
      // Sem trilha, sem diagnóstico: o acesso é justamente o que precisa ficar registrado.
      log.error("diagnostico", { mensagem: "auditoria não gravada; acesso negado", rota, erro: err });
      return NextResponse.json({ error: "auditoria_indisponivel" }, { status: 503 });
    }
    log.info("diagnostico.acesso", { rota, uid: gate.uid });

    try {
      const { corpo, status } = await fn(req, gate);
      return NextResponse.json(semDadosPessoais(corpo), { status: status ?? 200 });
    } catch (err) {
      log.error("diagnostico", { mensagem: "falhou", rota, erro: err });
      return NextResponse.json({ error: `${rota}_falhou` }, { status: 500 });
    }
  };
}
