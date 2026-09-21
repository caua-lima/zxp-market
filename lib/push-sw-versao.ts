/**
 * Versão do Service Worker de push. Precisa MUDAR sempre que o corpo do Service
 * Worker (app/firebase-messaging-sw.js/route.ts) mudar: o navegador só considera
 * um Service Worker "novo" se o corpo dele for diferente byte a byte, e é essa
 * comparação que dispara install/activate.
 *
 * Vive aqui — e não dentro da rota — porque o diagnóstico do aparelho compara a
 * versão que o SW ATIVO responde com a que este build publica. Duas cópias da
 * string (havia uma no SW e outra no botão de diagnóstico) divergiam em silêncio
 * no primeiro esquecimento, e o diagnóstico passava a acusar "desatualizado" sobre
 * um SW correto — ou, pior, a aprovar um velho.
 */
export const SW_VERSAO = "2026-09-20-clique-seguro";

/** Onde o SW registra o que recebeu (Cache API: página e SW enxergam o mesmo cache). */
export const CACHE_DO_LOG_DE_PUSH = "zxp-push-log";
export const CHAVE_DO_LOG_DE_PUSH = "/__push-log";
