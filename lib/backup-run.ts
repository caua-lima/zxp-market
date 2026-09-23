import { getAdminDb } from "@/lib/firebase/admin";
import { colecoesParaBackup } from "@/lib/domain/backup-inventario";

/**
 * Backup semanal das coleções que NÃO dá pra reconstruir sozinho.
 *
 * POR QUE ESTAS E NÃO TODAS
 * `ml_orders` e `ml_returns` são re-sincronizáveis a qualquer momento a
 * partir da API do Mercado Livre (existe até uma rota de backfill pra isso) —
 * fazer cópia deles seria gastar escrita duplicando o que o próprio ML já
 * guarda. Nem aparecem em `firestore.rules` (são só Admin SDK, nunca
 * lidos/escritos pelo cliente), então nem entram no inventário. O que entra
 * aqui é todo o resto que NÃO é efêmero (`colecoesParaBackup`,
 * lib/domain/backup-inventario.ts) — o mesmo inventário que
 * `scripts/backup-firestore.mjs` (o export manual) e `restore-firestore.mjs`
 * já usam como fonte única. Perder isso não é "espera a próxima
 * sincronização", é perder o dado de verdade.
 *
 * ─── S15 DA AUDITORIA SAAS ───────────────────────────────────────────────
 *
 * Esta lista era uma constante mantida À MÃO — 7 coleções, hardcoded — e
 * ficou pra trás do inventário (que já tinha 15 marcadas pra backup) sem
 * ninguém notar: metas, controleAcessoMeta, ads_alteracoes, auditLog, dias,
 * rascunho, alertasDispensados e usuarios estavam SEM cópia semanal
 * nenhuma, apesar de classificadas como irrecuperáveis. Agora deriva do
 * inventário — a mesma coleção nova que o teste de `backup-inventario.test.ts`
 * já força ter uma decisão passa a entrar aqui automaticamente, sem
 * precisar lembrar de tocar neste arquivo também.
 *
 * ONDE FICA
 * `backups_semanais/{dia}/{colecao}/{docId}` — espelha a estrutura original
 * um-pra-um, então restaurar é copiar de volta, não decifrar um formato novo.
 * `dia` é a data em que rodou (não um número de semana ISO calculado): mais
 * simples de acertar, e como só roda aos domingos já dá uma entrada por
 * semana na prática.
 *
 * IDEMPOTÊNCIA
 * O doc `backups_semanais/{dia}` (o marcador, sem subcoleção) só existe
 * depois que o backup terminou. Rodar de novo no mesmo dia (retry do cron,
 * disparo manual pra testar) vê o marcador e não refaz o trabalho.
 */

const COLECOES_CRITICAS = colecoesParaBackup();

/** Dia de hoje no fuso de São Paulo, "yyyy-mm-dd". */
function diaBR(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

/** Domingo no fuso de São Paulo — é quando o cron diário decide rodar isto. */
export function ehDomingoBR(): boolean {
  const diaSemana = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(new Date());
  return diaSemana === "Sun";
}

export type ResultadoBackup = { feito: boolean; dia: string; colecoes: Record<string, number> };

export async function fazerBackupSemanal(): Promise<ResultadoBackup> {
  const dia = diaBR();
  const db = getAdminDb();
  const marcador = db.collection("backups_semanais").doc(dia);

  if ((await marcador.get()).exists) {
    return { feito: false, dia, colecoes: {} };
  }

  const colecoes: Record<string, number> = {};
  for (const nome of COLECOES_CRITICAS) {
    const snap = await db.collection(nome).get();
    const destino = marcador.collection(nome);

    // writeBatch aceita até 500 operações; folga de 50 pra caber o commit
    // final sem estourar em coleção grande (estoque_movimentos cresce com o tempo).
    let batch = db.batch();
    let pendentes = 0;
    for (const doc of snap.docs) {
      batch.set(destino.doc(doc.id), doc.data());
      pendentes++;
      if (pendentes >= 450) {
        await batch.commit();
        batch = db.batch();
        pendentes = 0;
      }
    }
    if (pendentes > 0) await batch.commit();
    colecoes[nome] = snap.size;
  }

  // Grava o marcador POR ÚLTIMO — se o backup cair no meio, ele não fica
  // marcado como feito, e a próxima execução (retry) completa o resto.
  await marcador.set({ criadoEm: Date.now(), colecoes });
  return { feito: true, dia, colecoes };
}
