import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { lerIdentidade } from "@/lib/api-auth";
import { getAdminDb } from "@/lib/firebase/admin";
import { lerModoDeDados } from "@/lib/firebase/caminhos";
import { avaliarCadastro, idDaEmpresa, TERMOS_VERSAO } from "@/lib/domain/cadastro";
import { trialNovo } from "@/lib/domain/assinatura";
import { log } from "@/lib/log";

/**
 * Cadastro self-service da empresa (S24). Quem chama: alguém logado, com
 * e-mail CONFIRMADO, sem empresa. A pessoa vira a DONA, a empresa nasce em
 * teste grátis (S25), e o aceite dos termos fica registrado (versão + quando).
 *
 * Atrás da chave `ZXP_CADASTRO_ABERTO=1` — fechado, a rota recusa e empresa
 * nova segue nascendo pelo script.
 *
 * Tudo numa transação: dois cliques (ou duas abas) não criam duas empresas —
 * o ponteiro `memberships/{email}` é criado com `create`, que falha se existir.
 */
export async function POST(req: Request) {
  const quem = await lerIdentidade(req);
  if (quem instanceof NextResponse) return quem;

  const corpo = (await req.json().catch(() => ({}))) as { nome?: unknown; termos?: unknown };
  const db = getAdminDb();
  const ponteiro = db.doc(`memberships/${quem.email}`);
  const atual = (await ponteiro.get()).data()?.tenantId as string | undefined;

  const decisao = avaliarCadastro({
    email: quem.email,
    emailVerificado: quem.emailVerificado,
    nome: corpo.nome,
    termos: corpo.termos,
    cadastroAberto: process.env.ZXP_CADASTRO_ABERTO === "1",
    modoEmpresa: lerModoDeDados() === "tenant",
    empresaAtual: atual ?? null,
  });
  if (!decisao.ok) {
    const status = decisao.motivo === "cadastro_fechado" || decisao.motivo === "so_modo_empresa" ? 403 : decisao.motivo === "ja_tem_empresa" ? 409 : 400;
    return NextResponse.json({ error: decisao.motivo, details: decisao.detalhe }, { status });
  }

  const agora = Date.now();
  const tenantId = idDaEmpresa(decisao.nome, randomBytes(4).toString("hex"));
  try {
    await db.runTransaction(async (tx) => {
      const empresa = db.doc(`tenants/${tenantId}`);
      if ((await tx.get(empresa)).exists) throw new Error("colisao_de_id");
      tx.create(ponteiro, { email: quem.email, tenantId });
      tx.create(empresa, {
        name: decisao.nome,
        criadoEm: agora,
        dono: quem.email,
        origem: "cadastro",
        // Posicionamento do lançamento: vendedores do Mercado Livre Brasil, em reais, horário de Brasília.
        siteId: "MLB",
        moeda: "BRL",
        fuso: "America/Sao_Paulo",
        assinatura: trialNovo(agora),
        termos: { versao: TERMOS_VERSAO, aceitoEm: agora, por: quem.email },
      });
      tx.create(db.doc(`tenants/${tenantId}/members/${quem.email}`), {
        email: quem.email, role: "owner", addedAt: agora, addedBy: "cadastro",
      });
    });
  } catch (err) {
    // `create` num ponteiro que já existe = a outra aba ganhou a corrida.
    if (String((err as { code?: unknown })?.code) === "6" || /already exists/i.test(String(err))) {
      return NextResponse.json({ error: "ja_tem_empresa" }, { status: 409 });
    }
    log.error("cadastro", { mensagem: "falhou ao criar empresa", erro: err });
    return NextResponse.json({ error: "falhou" }, { status: 500 });
  }

  log.info("cadastro.empresa_criada", { tenantId });
  return NextResponse.json({ ok: true, tenantId });
}
