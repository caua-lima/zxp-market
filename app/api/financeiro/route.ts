import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getAdminDb } from "@/lib/firebase/admin";
import { paraCentavos } from "@/lib/financeiro/dinheiro";
import {
  gerarDaRecorrencia, registrarBaixa, transferir,
  type Conta, type Movimento, type Natureza, type Obrigacao, type Recorrencia, type TipoConta,
} from "@/lib/financeiro/modelo";

/**
 * Financeiro PRIVADO — só o owner (`ver_financeiro_privado`).
 *
 * Tudo passa por aqui, no servidor, e não pelo SDK do navegador: o app guarda
 * em disco (IndexedDB) o que o SDK lê, e extrato não pode ficar gravado no
 * computador de ninguém. Resposta `private, no-store`. As regras do Firestore
 * (`fin_*` só pro owner) são a segunda barreira.
 *
 * "Registrar pagamento" é ANOTAÇÃO interna: não move dinheiro de verdade.
 */

const SEM_CACHE = { "Cache-Control": "private, no-store" };
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const COMPETENCIA = /^\d{4}-\d{2}$/;
const NATUREZAS: Natureza[] = ["receita", "despesa", "compra_estoque", "retirada", "ajuste"];
const NATUREZAS_OBRIG: Obrigacao["natureza"][] = ["despesa", "compra_estoque", "retirada"];
const TIPOS: TipoConta[] = ["mercado_pago", "banco", "caixa"];

const texto = (v: unknown, max = 120) => String(v ?? "").trim().slice(0, max);
const novoId = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const erro = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status, headers: SEM_CACHE });

function hojeBR(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

export async function GET(req: Request) {
  const gate = await requireAccess(req, { capacidade: "ver_financeiro_privado" });
  if (gate instanceof NextResponse) return gate;
  const url = new URL(req.url);
  const hoje = hojeBR();
  const de = DATA.test(url.searchParams.get("de") ?? "") ? url.searchParams.get("de")! : `${hoje.slice(0, 7)}-01`;
  const ate = DATA.test(url.searchParams.get("ate") ?? "") ? url.searchParams.get("ate")! : hoje;
  const db = getAdminDb();

  const [contas, movimentos, obrigacoes, recorrencias] = await Promise.all([
    db.collection("fin_contas").get(),
    // Todos os movimentos (o saldo precisa deles desde a abertura); a tela filtra o período.
    db.collection("fin_movimentos").get(),
    db.collection("fin_obrigacoes").get(),
    db.collection("fin_recorrencias").get(),
  ]);
  return NextResponse.json({
    de, ate, hoje,
    contas: contas.docs.map((d) => d.data() as Conta),
    movimentos: movimentos.docs.map((d) => d.data() as Movimento),
    // Abertas de qualquer data (conta antiga não some por estar fora do filtro) + as do período.
    obrigacoes: obrigacoes.docs.map((d) => d.data() as Obrigacao),
    recorrencias: recorrencias.docs.map((d) => d.data() as Recorrencia),
  }, { headers: SEM_CACHE });
}

export async function POST(req: Request) {
  const gate = await requireAccess(req, { capacidade: "ver_financeiro_privado" });
  if (gate instanceof NextResponse) return gate;
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return erro("corpo inválido");
  const db = getAdminDb();
  const auditar = (detalhe: string) => db.collection("auditLog").doc(novoId("audit")).set({
    acao: "editar", entidade: "financeiro", entidadeLabel: "Financeiro", detalhe: detalhe.slice(0, 300), por: gate.email, em: Date.now(),
  }).catch(() => {});

  switch (c.acao) {
    case "salvar_conta": {
      const id = texto(c.id, 60) || novoId("conta");
      const tipo = TIPOS.includes(c.tipo as TipoConta) ? (c.tipo as TipoConta) : null;
      const nome = texto(c.nome, 80);
      if (!nome || !tipo) return erro("informe nome e tipo da conta");
      const conta: Conta = { id, nome, tipo, ativa: c.ativa !== false };
      const ab = c.abertura as Record<string, unknown> | undefined;
      if (ab) {
        const cent = paraCentavos(ab.valor);
        const data = texto(ab.data, 10);
        const comprovacao = texto(ab.comprovacao, 200);
        if (cent == null || !DATA.test(data) || !comprovacao) return erro("saldo de abertura precisa de valor, data e de onde veio (extrato, print)");
        conta.abertura = { centavos: cent, data, comprovacao };
      }
      await db.collection("fin_contas").doc(id).set(conta);
      await auditar(`conta ${nome}${conta.abertura ? ` com abertura em ${conta.abertura.data}` : ""}`);
      return NextResponse.json({ ok: true, conta }, { headers: SEM_CACHE });
    }

    case "lancar": {
      const cent = paraCentavos(c.valor);
      const natureza = NATUREZAS.includes(c.natureza as Natureza) ? (c.natureza as Natureza) : null;
      const data = texto(c.data, 10);
      const contaId = texto(c.contaId, 60);
      if (cent == null || cent === 0 || !natureza || !DATA.test(data) || !contaId) return erro("informe conta, valor, natureza e data");
      if (!(await db.collection("fin_contas").doc(contaId).get()).exists) return erro("conta não encontrada");
      // Sinal pela natureza: receita entra; despesa, compra de estoque e retirada saem; ajuste vale como digitado.
      const valor = natureza === "receita" ? Math.abs(cent) : natureza === "ajuste" ? cent : -Math.abs(cent);
      const m: Movimento = {
        id: novoId("mov"), contaId, centavos: valor, natureza, data,
        descricao: texto(c.descricao, 160), categoria: texto(c.categoria, 60) || "Outros", origem: "manual",
      };
      await db.collection("fin_movimentos").doc(m.id).set(m);
      await auditar(`lançamento ${natureza} em ${data}`);
      return NextResponse.json({ ok: true, movimento: m }, { headers: SEM_CACHE });
    }

    case "transferir": {
      const cent = paraCentavos(c.valor);
      const data = texto(c.data, 10);
      const pernas = cent != null && DATA.test(data)
        ? transferir({ id: novoId("trf"), de: texto(c.de, 60), para: texto(c.para, 60), centavos: Math.abs(cent), data, descricao: texto(c.descricao, 160) || undefined })
        : null;
      if (!pernas) return erro("transferência precisa de duas contas diferentes, valor e data");
      const lote = db.batch();
      for (const m of pernas) lote.set(db.collection("fin_movimentos").doc(m.id), m);
      await lote.commit();
      await auditar(`transferência em ${data}`);
      return NextResponse.json({ ok: true, movimentos: pernas }, { headers: SEM_CACHE });
    }

    case "nova_obrigacao": {
      const cent = paraCentavos(c.valor);
      const vencimento = texto(c.vencimento, 10);
      const competencia = texto(c.competencia, 7) || vencimento.slice(0, 7);
      const natureza = NATUREZAS_OBRIG.includes(c.natureza as Obrigacao["natureza"]) ? (c.natureza as Obrigacao["natureza"]) : "despesa";
      const parcelas = Math.min(Math.max(Math.trunc(Number(c.parcelas ?? 1)) || 1, 1), 48);
      if (cent == null || cent <= 0 || !DATA.test(vencimento) || !COMPETENCIA.test(competencia)) return erro("informe valor, vencimento e competência");
      const base = novoId("obr");
      const total = cent;
      const partes = Array.from({ length: parcelas }, (_, i) => Math.trunc(total / parcelas) + (i < total % parcelas ? 1 : 0));
      const lote = db.batch();
      const criadas: Obrigacao[] = partes.map((valor, i) => {
        const [a, mth, d] = vencimento.split("-").map(Number);
        const dt = new Date(Date.UTC(a, mth - 1 + i, 1));
        const ultimo = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
        const venc = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(d, ultimo)).padStart(2, "0")}`;
        const o: Obrigacao = {
          id: parcelas > 1 ? `${base}_${i + 1}` : base,
          descricao: texto(c.descricao, 160), categoria: texto(c.categoria, 60) || "Outros", favorecido: texto(c.favorecido, 80),
          competencia: parcelas > 1 ? venc.slice(0, 7) : competencia, vencimento: venc, centavos: valor, natureza, baixas: [],
          ...(parcelas > 1 ? { parcela: { numero: i + 1, de: parcelas } } : {}),
        };
        lote.set(db.collection("fin_obrigacoes").doc(o.id), o);
        return o;
      });
      await lote.commit();
      await auditar(`conta a pagar (${parcelas}x) venc. ${vencimento}`);
      return NextResponse.json({ ok: true, obrigacoes: criadas }, { headers: SEM_CACHE });
    }

    case "baixar": {
      const id = texto(c.obrigacaoId, 80);
      const cent = paraCentavos(c.valor);
      const data = texto(c.data, 10);
      const contaId = texto(c.contaId, 60);
      if (!id || cent == null || !DATA.test(data) || !contaId) return erro("informe a conta, o valor e a data do pagamento");
      const movimentoId = texto(c.movimentoId, 80) || novoId("pag");
      const ref = db.collection("fin_obrigacoes").doc(id);
      // Transação: duas baixas ao mesmo tempo não passam juntas do devido.
      const r = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { ok: false as const, motivo: "conta a pagar não encontrada" };
        const res = registrarBaixa(snap.data() as Obrigacao, { contaId, centavos: Math.abs(cent), data, movimentoId });
        if (!res.ok) return res;
        tx.set(ref, res.obrigacao);
        tx.set(db.collection("fin_movimentos").doc(res.movimento.id), res.movimento);
        return res;
      });
      if (!r.ok) return erro(r.motivo, 409);
      await auditar(`pagamento registrado em ${data}`);
      return NextResponse.json({ ok: true, obrigacao: r.obrigacao, movimento: r.movimento }, { headers: SEM_CACHE });
    }

    case "cancelar_obrigacao": {
      const id = texto(c.obrigacaoId, 80);
      const ref = db.collection("fin_obrigacoes").doc(id);
      const snap = await ref.get();
      if (!snap.exists) return erro("conta a pagar não encontrada", 404);
      if ((snap.data() as Obrigacao).baixas.length) return erro("tem pagamento registrado — não dá pra cancelar", 409);
      await ref.update({ cancelada: true });
      await auditar(`conta a pagar cancelada`);
      return NextResponse.json({ ok: true }, { headers: SEM_CACHE });
    }

    case "nova_recorrencia": {
      const cent = paraCentavos(c.valor);
      const desde = texto(c.desde, 7);
      const dia = Math.trunc(Number(c.diaVencimento));
      if (cent == null || cent <= 0 || !COMPETENCIA.test(desde) || !(dia >= 1 && dia <= 31)) return erro("informe valor, mês de início e dia do vencimento");
      const r: Recorrencia = {
        id: novoId("rec"), descricao: texto(c.descricao, 160), categoria: texto(c.categoria, 60) || "Outros",
        favorecido: texto(c.favorecido, 80), centavos: cent,
        natureza: NATUREZAS_OBRIG.includes(c.natureza as Obrigacao["natureza"]) ? (c.natureza as Obrigacao["natureza"]) : "despesa",
        diaVencimento: dia, desde, ...(COMPETENCIA.test(texto(c.ate, 7)) ? { ate: texto(c.ate, 7) } : {}),
      };
      await db.collection("fin_recorrencias").doc(r.id).set(r);
      await auditar(`recorrência desde ${desde}`);
      return NextResponse.json({ ok: true, recorrencia: r }, { headers: SEM_CACHE });
    }

    case "gerar_recorrencias": {
      // Até o mês que vem: a conta do próximo mês já aparece pra se programar.
      const hoje = hojeBR();
      const [a, m] = hoje.slice(0, 7).split("-").map(Number);
      const proximo = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
      const [recs, obrs] = await Promise.all([db.collection("fin_recorrencias").get(), db.collection("fin_obrigacoes").get()]);
      const existentes = new Set(obrs.docs.map((d) => d.id));
      const novas = recs.docs.flatMap((d) => gerarDaRecorrencia(d.data() as Recorrencia, proximo, existentes));
      const lote = db.batch();
      // `create`, não `set`: duas chamadas ao mesmo tempo não duplicam (a segunda falha na chave).
      for (const o of novas) lote.create(db.collection("fin_obrigacoes").doc(o.id), o);
      if (novas.length) await lote.commit().catch(() => {});
      return NextResponse.json({ ok: true, geradas: novas.length }, { headers: SEM_CACHE });
    }

    case "excluir_movimento": {
      const id = texto(c.movimentoId, 80);
      const snap = await db.collection("fin_movimentos").doc(id).get();
      if (!snap.exists) return erro("lançamento não encontrado", 404);
      const m = snap.data() as Movimento;
      if (m.obrigacaoId || m.transferenciaId || m.origem !== "manual") {
        return erro("pagamento de conta, transferência ou importado não se exclui por aqui", 409);
      }
      await snap.ref.delete();
      await auditar(`lançamento excluído (${m.data})`);
      return NextResponse.json({ ok: true }, { headers: SEM_CACHE });
    }
  }
  return erro("ação desconhecida");
}
