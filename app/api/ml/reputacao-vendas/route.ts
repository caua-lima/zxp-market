import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getMlAccessToken, getMlTokenData } from "../token";
import { fetchOrdersLive } from "@/lib/ml/orders";
import { montarBlocoVendas, serieDiariaDeVendas } from "@/lib/domain/reputacao-vendas";
import { diasNaJanela, janelaDeDias } from "@/lib/domain/janela-dias";
import { lerPeriodo } from "@/lib/domain/periodo";
import { CacheDeFonte, estadoDaFonte, lerJanelasNomeadas } from "@/lib/domain/fonte-desempenho";

export const maxDuration = 60;

/**
 * O bloco "Acompanhamos suas vendas nos últimos N dias" do Seller Center.
 *
 * ─── POR QUE AO VIVO, E NÃO DO BANCO ────────────────────────────────────
 *
 * O sync cobre mês atual + anterior. Uma janela de 60 dias alcança o mês
 * retrasado, e medindo em 22/08 o banco tinha ZERO pedidos de junho — a conta
 * fechava 691 contra 750 do painel. Buscar ao vivo fecha em 763/728/R$ 33.561
 * contra 750/727/R$ 33.377, e a diferença é só o que vendeu entre o print e a
 * consulta.
 *
 * As definições de cada número (três delas contraintuitivas) estão em
 * lib/domain/reputacao-vendas.ts.
 */

/**
 * Cache curto por lambda quente: são várias páginas do ML por chamada, e o
 * painel de Desempenho recarrega a cada troca de aba.
 *
 * Era UMA entrada (`let cache`): os dois painéis pediam janelas diferentes e
 * expulsavam um ao outro, e cada abertura da aba virava duas buscas ao vivo. E
 * não sabia de qual conta era — a geração da conexão agora vai na chave (S10,
 * ver lib/domain/fonte-desempenho).
 */
const cache = new CacheDeFonte<Record<string, unknown>>(8, 5 * 60 * 1000);


/**
 * O dia no fuso de Sao Paulo a partir do ISO que o ML devolve (com offset).
 * Agrupar por UTC jogaria as vendas da noite pro dia seguinte.
 */
function diaBRDeISO(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t - 3 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export async function GET(req: Request) {
  const gate = await requireAccess(req, { capacidade: "ver_operacao" });
  if (gate instanceof NextResponse) return gate;

  try {
    const url = new URL(req.url);
    // 60 é o que o Mercado Livre usa pra reputação; o parâmetro existe pra o
    // filtro de período da tela reaproveitar a mesma conta.
    const dias = Math.max(1, Math.min(180, Number(url.searchParams.get("dias") ?? 60) || 60));

    /**
     * REP-02: a janela era `de = diaBR(-dias)` com `ate = diaBR()`, e a busca
     * e INCLUSIVA nas duas pontas — com dias=60 isso cobria 61 datas: os 60
     * dias anteriores MAIS hoje.
     *
     * Pior, /api/ml/desempenho recebe o MESMO parametro da MESMA tela e ja
     * fazia -(dias-1). Os dois paineis liam um filtro so e contavam bases
     * diferentes: a reputacao saia com um dia a mais de vendas no denominador
     * do que o desempenho ao lado. Um dia a mais vira ~1,6% de erro na taxa de
     * reclamacao, sempre pra baixo — a direcao que engana.
     *
     * A definicao agora e uma so, em lib/domain/janela-dias.
     */
    const padrao = janelaDeDias(dias);
    /**
     * SEG-07: valida antes de buscar.
     *
     * Esta rota é a mais cara do app — até dezesseis páginas de pedidos ao
     * vivo no Mercado Livre por chamada. Aceitar `from`/`to` sem conferir
     * deixava qualquer pessoa autorizada pedir trinta anos pela URL e derrubar
     * a função, ou mandar um intervalo invertido e receber vazio, que aqui se
     * lê como "não vendeu nada".
     */
    const periodo = lerPeriodo(
      { from: url.searchParams.get("from"), to: url.searchParams.get("to") },
      padrao.ate,
    );
    if (!periodo.ok) {
      return NextResponse.json({ error: periodo.erro, details: periodo.detalhe, bloco: null }, { status: 400 });
    }
    const de = url.searchParams.get("from") ? periodo.de : padrao.de;
    const ate = url.searchParams.get("to") ? periodo.ate : padrao.ate;

    /**
     * Quantas datas a janela cobre DE FATO. Quando a tela manda from/to
     * direto, o parametro `dias` deixa de descrever o intervalo — e quem le a
     * resposta precisa do numero real, nao do pedido.
     */
    const diasCobertos = diasNaJanela(de, ate);

    /**
     * Várias contagens da MESMA busca (REP-01, generalizado no S10).
     *
     * A aba precisa da janela da medalha (3 meses + mês vigente) e da janela da
     * REPUTAÇÃO, cujo tamanho é o que o ML informa (60 ou 365 dias). Elas se
     * sobrepõem, e cada busca são várias páginas de pedidos ao vivo — então a tela
     * pede o intervalo que cobre as duas e esta rota conta cada janela:
     * `janela=nome:de:ate`, repetível.
     *
     * `subFrom`/`subTo` (a forma antiga, uma sub-janela só) continua valendo
     * como a janela `sub`, pra um navegador com a tela antiga não ficar sem o
     * bloco até recarregar.
     */
    const pedidasJanelas = url.searchParams.getAll("janela");
    const subDe = url.searchParams.get("subFrom");
    const subAte = url.searchParams.get("subTo");
    if (subDe && subAte) pedidasJanelas.push(`sub:${subDe}:${subAte}`);
    const lidas = lerJanelasNomeadas(pedidasJanelas, { de, ate });
    if (!lidas.ok) return NextResponse.json({ error: "janela_invalida", details: lidas.erro, bloco: null }, { status: 400 });

    const geracao = Number((await getMlTokenData())?.geracao ?? 0);
    const chave = CacheDeFonte.chave(geracao, de, ate, lidas.janelas.map((j) => `${j.nome}:${j.de}:${j.ate}`).join(","));
    // `fresh=1`: o "Atualizar" da aba precisa renovar de verdade, não reler o cache.
    if (url.searchParams.get("fresh") !== "1") {
      const guardado = cache.ler(chave, Date.now());
      if (guardado) return NextResponse.json({ ...guardado.valor, cached: true });
    }

    const token = await getMlAccessToken();
    if (!token) {
      return NextResponse.json({
        error: "sem_token", bloco: null,
        fonte: estadoDaFonte({ ok: false, buscadoEm: Date.now(), geracao, erro: "sem_token" }),
      }, { status: 200 });
    }

    const pedidos = await fetchOrdersLive(
      token,
      `${de}T00:00:00.000-03:00`,
      `${ate}T23:59:59.999-03:00`,
    );
    if (!pedidos) {
      // null, nunca zeros: "não consegui perguntar" e "não vendeu nada" levam
      // a leituras opostas da reputação.
      return NextResponse.json({
        error: "pedidos_indisponiveis", bloco: null, de, ate,
        fonte: estadoDaFonte({ ok: false, buscadoEm: Date.now(), geracao, erro: "pedidos_indisponiveis" }),
      }, { status: 200 });
    }

    /**
     * Mapeia UMA vez e reaproveita: o bloco agregado e a serie diaria saem dos
     * mesmos pedidos, e percorrer a lista duas vezes com dois formatos e como
     * as duas contas divergem.
     */
    const paraDominio = pedidos.map((o) => ({
      orderId: String(o.order_id ?? ""),
      status: o.status,
      shippingId: (o.shipping_id as string | null | undefined) ?? null,
      packId: (o.pack_id as string | null | undefined) ?? null,
      total: Number(o.total_amount ?? 0),
      // Dia no fuso de Sao Paulo — date_created vem com offset do ML.
      dia: diaBRDeISO(String(o.date_created ?? "")),
    }));

    const bloco = montarBlocoVendas(paraDominio);

    // Cada janela sai dos mesmos pedidos, só filtrando por dia.
    const janelas = Object.fromEntries(lidas.janelas.map((j) => [
      j.nome,
      { bloco: montarBlocoVendas(paraDominio.filter((p) => p.dia >= j.de && p.dia <= j.ate)), de: j.de, ate: j.ate },
    ]));

    /**
     * A serie por dia, pra a projecao da medalha poder simular a JANELA MOVEL.
     *
     * A janela e "3 meses + os dias do mes vigente": quando o mes vira, o mes
     * mais antigo sai dela inteiro. Sem saber o que cada dia produziu nao da
     * pra saber o que vai sair — e a projecao linear, que so somava ritmo,
     * prometia uma data que a conta nao alcanca.
     */
    const serie = serieDiariaDeVendas(paraDominio);

    const agora = Date.now();
    const body = {
      bloco, serie, de, ate, dias, diasCobertos, janelas,
      sub: janelas.sub ?? null,
      // Quando, de qual conexão e o que cobre — pra a tela dizer "atualizado às
      // HH:MM" e nunca ler falta de resposta como falta de venda.
      fonte: estadoDaFonte({
        ok: true, vazio: pedidos.length === 0, buscadoEm: agora, geracao,
        cobertura: { de, ate, completa: true },
      }),
    };
    cache.gravar(chave, body, agora);
    return NextResponse.json(body);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "reputacao_vendas_failed", details: msg, bloco: null }, { status: 500 });
  }
}
