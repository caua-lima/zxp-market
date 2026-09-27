"use client";
import { escopoDoCache } from "@/lib/firebase/cache";

/**
 * Chaves de localStorage do app, com migração do prefixo antigo.
 *
 * O app nasceu como "briefing" e as chaves ficaram com esse prefixo. Ao
 * renomear pra ZXP Market, trocar o prefixo direto APAGARIA dado real do
 * usuário — filtros salvos na aba Pedidos e a lista de reposição planejada
 * no Estoque ficam só aqui, não no Firestore. Um rename cosmético não pode
 * custar isso.
 *
 * Então a leitura tenta a chave nova e, se não achar, puxa da antiga e
 * regrava no formato novo. A partir da segunda leitura a antiga não é mais
 * consultada; ela é removida na migração pra não ficar lixo pra sempre.
 *
 * NÃO cobre `push_enabled` nem `push_device_id` de propósito: renomear
 * aquelas duas faria o aparelho perder o vínculo com o token de notificação
 * já registrado, e a pessoa pararia de receber push até reativar na mão.
 * Consistência de nome não vale esse preço.
 */

const PREFIXO = "zxpmarket:";
const PREFIXO_ANTIGO = "briefing:";

/**
 * A chave de uma preferência DESTA pessoa NESTA empresa (S23).
 *
 * Era `zxpmarket:{sufixo}`, global no navegador: numa máquina compartilhada, os
 * filtros salvos e os produtos planejados (ids de produto da empresa) de uma
 * conta apareciam pra próxima. Com escopo, cada pessoa+empresa tem os seus; sem
 * escopo ainda (antes do login), cai na chave antiga.
 */
export function chaveComEscopo(escopo: string, sufixo: string): string {
  return escopo ? `${PREFIXO}${escopo}:${sufixo}` : `${PREFIXO}${sufixo}`;
}

export function chaveApp(sufixo: string): string {
  return chaveComEscopo(escopoDoCache(), sufixo);
}

/**
 * Lê a chave, migrando do prefixo antigo na primeira vez. Devolve null quando
 * não existe em nenhum dos dois.
 */
export function lerChaveApp(sufixo: string): string | null {
  if (typeof window === "undefined") return null;
  const nova = chaveApp(sufixo);
  try {
    const atual = localStorage.getItem(nova);
    if (atual !== null) return atual;

    // Chaves de antes do escopo (S23): herdadas UMA vez, e só no modo raiz — a
    // operação de uma empresa só, dona desse dado. No modo empresa, herdar a
    // chave global poderia entregar a preferência de uma empresa pra outra.
    const semEscopo = `${PREFIXO}${sufixo}`;
    const herdavel = nova !== semEscopo && process.env.NEXT_PUBLIC_ZXP_MODO_DADOS !== "tenant";
    const antiga = herdavel && localStorage.getItem(semEscopo) !== null ? semEscopo : `${PREFIXO_ANTIGO}${sufixo}`;
    const legado = localStorage.getItem(antiga);
    if (legado === null) return null;

    localStorage.setItem(nova, legado);
    localStorage.removeItem(antiga);
    return legado;
  } catch {
    // Modo privado / storage bloqueado: seguir sem dado salvo é aceitável,
    // quebrar a tela por causa disso não.
    return null;
  }
}

export function gravarChaveApp(sufixo: string, valor: string): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(chaveApp(sufixo), valor); } catch { /* storage indisponível */ }
}

export function removerChaveApp(sufixo: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(chaveApp(sufixo));
    localStorage.removeItem(`${PREFIXO_ANTIGO}${sufixo}`);
  } catch { /* storage indisponível */ }
}
