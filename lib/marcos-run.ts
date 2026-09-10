import "server-only";
import { getAdminDb } from "@/lib/firebase/admin";
import { getMlAccessToken } from "@/app/api/ml/token";
import { SELLER_ID } from "@/lib/ml/orders";
import { marcoDeReputacao, marcosDeFaturamento, marcosDoDia } from "@/lib/domain/marcos";
import { RECORDES_VAZIOS, avaliarRecordes, semear, type Recordes } from "@/lib/domain/recordes";
import { notificarMarco } from "@/lib/ml/notificar-venda";

const ML_API = "https://api.mercadolibre.com";

/**
 * Verifica e avisa os marcos comemorativos.
 *
 * Quatro famílias, todas com a mesma regra de dedupe por chave estável:
 *   · degraus de faturamento do MÊS (de 5 em 5 mil)
 *   · degraus de faturamento do DIA (de 1 em 1 mil)
 *   · RECORDES da empresa (melhor dia, melhor mês, primeira vez num degrau)
 *   · subida de nível no MercadoLíder
 *
 * ─── POR QUE ISTO NÃO CALCULA O FATURAMENTO ─────────────────────────────
 *
 * Recebe os números prontos de quem chama, em vez de somar por conta própria.
 * Recalcular aqui criaria uma SEGUNDA definição de faturamento no app — e
 * definição duplicada foi a origem de quase todo número errado nesta base. O
 * marco tem que comemorar o mesmo número que o Dashboard mostra.
 *
 * Best-effort por construção: nenhum erro aqui pode derrubar o sync ou o cron,
 * que é o que mantém o painel correto.
 */

const ESTADO = "marcos_estado";

async function lerUltimoNivel(): Promise<{ nivel: string | null; conhecido: boolean }> {
  try {
    const d = await getAdminDb().collection(ESTADO).doc("reputacao").get();
    if (!d.exists) return { nivel: null, conhecido: false };
    return { nivel: (d.data()?.powerSellerStatus as string | null) ?? null, conhecido: true };
  } catch {
    // Sem leitura, trata como desconhecido: melhor não comemorar do que dar
    // parabéns por um nível que talvez seja de meses atrás.
    return { nivel: null, conhecido: false };
  }
}

async function salvarNivel(nivel: string | null): Promise<void> {
  try {
    await getAdminDb().collection(ESTADO).doc("reputacao").set(
      { powerSellerStatus: nivel, em: Date.now() },
      { merge: true },
    );
  } catch { /* perder o ponteiro só adia a detecção pra próxima */ }
}

/** O nível de MercadoLíder agora, direto do ML. `null` quando não dá pra saber. */
export async function lerNivelMercadoLider(): Promise<string | null> {
  try {
    const token = await getMlAccessToken();
    if (!token) return null;
    const r = await fetch(`${ML_API}/users/${SELLER_ID}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { seller_reputation?: { power_seller_status?: string | null } };
    return j.seller_reputation?.power_seller_status ?? null;
  } catch {
    return null;
  }
}

async function lerRecordes(): Promise<{ recordes: Recordes; existia: boolean }> {
  try {
    const d = await getAdminDb().collection(ESTADO).doc("recordes").get();
    if (!d.exists) return { recordes: RECORDES_VAZIOS, existia: false };
    const x = d.data() ?? {};
    return {
      recordes: {
        melhorDia: x.melhorDia ?? null,
        melhorMes: x.melhorMes ?? null,
        maisPedidosNumDia: x.maisPedidosNumDia ?? null,
        primeiraVezMensal: x.primeiraVezMensal ?? {},
      },
      existia: true,
    };
  } catch {
    // Sem leitura, finge que existe e está vazio? Não: isso faria todo dia
    // virar "melhor dia da história". `existia: false` manda semear.
    return { recordes: RECORDES_VAZIOS, existia: false };
  }
}

async function salvarRecordes(r: Recordes): Promise<void> {
  try {
    await getAdminDb().collection(ESTADO).doc("recordes").set(
      { ...r, em: Date.now() },
      { merge: true },
    );
  } catch { /* idem: só adia */ }
}

export type ResultadoMarcos = {
  faturamento: string[];
  dia: string[];
  recordes: string[];
  reputacao: string | null;
  nivelAtual: string | null;
  /** Primeira execução: registrou o passado sem comemorar. */
  semeou: boolean;
};

export type FatosParaMarcos = {
  /** Faturamento do mês corrente. `null` = não deu pra apurar agora. */
  faturamentoMes: number | null;
  mes: string;
  /** Faturamento do dia de hoje. `null` = não apurado. */
  faturamentoHoje?: number | null;
  hoje?: string;
  /**
   * Faturamento por dia do mês. Só os dias FECHADOS entram nos recordes —
   * o filtro é feito aqui, ver abaixo.
   */
  serieDiaria?: { data: string; faturamento: number }[];
};

/**
 * @param fatos os números já apurados por quem chama. A REPUTAÇÃO é verificada
 *   mesmo quando o faturamento falha, de propósito: as duas conquistas são
 *   independentes, e amarrá-las foi exatamente o bug que segurou o aviso de
 *   MercadoLíder — a busca do faturamento falhava, quem chamava desistia, e a
 *   reputação nunca chegava a ser olhada.
 */
export async function verificarMarcos(fatos: FatosParaMarcos): Promise<ResultadoMarcos> {
  const { faturamentoMes, mes, faturamentoHoje = null, hoje = "", serieDiaria = [] } = fatos;
  const avisadosFaturamento: string[] = [];
  const avisadosDia: string[] = [];
  const avisadosRecordes: string[] = [];
  let avisadoReputacao: string | null = null;
  let semeou = false;

  /**
   * O nível vem PRIMEIRO: ele fecha a mensagem de todo marco ("MercadoLíder —
   * seus anúncios já aparecem na frente"). Buscar depois faria a comemoração
   * sair sem o selo justamente na hora em que ela é lida.
   */
  const nivelAtual = await lerNivelMercadoLider();

  const avisar = async (marcos: { chave: string; titulo: string; corpo: string }[], destino: string[]) => {
    for (const m of marcos) {
      try {
        if (await notificarMarco(m)) destino.push(m.chave);
      } catch (err) {
        console.error("[marcos] falhou ao avisar", m.chave, err);
      }
    }
  };

  // ── Degraus do mês e do dia ──
  await avisar(marcosDeFaturamento(faturamentoMes ?? 0, mes, nivelAtual), avisadosFaturamento);
  if (hoje) await avisar(marcosDoDia(faturamentoHoje ?? 0, hoje, nivelAtual), avisadosDia);

  // ── Recordes da empresa ──
  try {
    /**
     * Só dias FECHADOS. Um dia pela metade sempre perderia pro recorde e, se
     * ganhasse, seria batido de novo à tarde pelo mesmo dia — o "maior dia da
     * história" mudaria três vezes num dia só.
     */
    const dias = serieDiaria
      .filter((d) => d?.data && (!hoje || d.data < hoje))
      .map((d) => ({ dia: d.data, valor: Number(d.faturamento) || 0 }));

    const fato = { dias, mes, faturamentoMes: faturamentoMes ?? 0 };
    const { recordes, existia } = await lerRecordes();

    if (!existia) {
      /**
       * Primeira execução: registra o passado e NÃO comemora nada. Sem isto,
       * o primeiro dia medido viraria "melhor dia da história" e o mês
       * corrente viraria "primeira vez" em todos os degraus abaixo dele.
       */
      await salvarRecordes(semear(fato));
      semeou = true;
    } else if (faturamentoMes != null || dias.length > 0) {
      const { novos, marcos } = avaliarRecordes(recordes, fato, nivelAtual);
      await avisar(marcos, avisadosRecordes);
      await salvarRecordes(novos);
    }
  } catch (err) {
    console.error("[marcos] recordes falharam", err);
  }

  // ── Subida de nível ──
  try {
    const { nivel: anterior, conhecido } = await lerUltimoNivel();
    const marco = marcoDeReputacao(nivelAtual, anterior, conhecido);
    if (marco && await notificarMarco(marco)) avisadoReputacao = marco.chave;
    /**
     * Grava SEMPRE, mesmo sem marco. É esta gravação que transforma a
     * primeira execução (que não comemora, por não saber de onde veio) na
     * base de comparação da próxima.
     */
    await salvarNivel(nivelAtual);
  } catch (err) {
    console.error("[marcos] reputação indisponível", err);
  }

  return {
    faturamento: avisadosFaturamento,
    dia: avisadosDia,
    recordes: avisadosRecordes,
    reputacao: avisadoReputacao,
    nivelAtual,
    semeou,
  };
}
