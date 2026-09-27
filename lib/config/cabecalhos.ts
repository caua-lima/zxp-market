/**
 * Cabeçalhos de segurança servidos em toda resposta (S27).
 *
 * Os "duros" (nosniff, frame, referrer, permissões, HSTS) valem já: nenhum
 * deles muda o que o app faz. O COOP é `same-origin-allow-popups` e não
 * `same-origin` porque o login do Google abre em popup (signInWithPopup) e
 * precisa falar de volta com esta janela.
 *
 * A CSP entra em modo RELATÓRIO (Content-Security-Policy-Report-Only): o
 * navegador não bloqueia nada, só avisa em /api/csp-report o que TERIA
 * bloqueado. Firebase, login do Google, push e PWA carregam coisa de vários
 * domínios; ligar bloqueando sem ver os relatórios de produção antes seria
 * arriscar tirar o login do ar. O passo de virar pra bloqueio está em
 * docs/saas/SEGURANCA.md.
 */

export type Cabecalho = { key: string; value: string };

export function politicaDeConteudo(opcoes: { dev: boolean }): string {
  const google = "https://apis.google.com https://www.gstatic.com https://www.google.com";
  const diretivas: Record<string, string> = {
    "default-src": "'self'",
    // 'unsafe-inline': o Next injeta scripts inline de hidratação. Tirar isso
    // exige nonce por requisição (middleware) — passo seguinte, não este.
    "script-src": `'self' 'unsafe-inline'${opcoes.dev ? " 'unsafe-eval'" : ""} ${google}`,
    "style-src": "'self' 'unsafe-inline'",
    // Fotos de perfil do Google e miniaturas do ML vêm de vários hosts https.
    "img-src": "'self' data: blob: https:",
    "font-src": "'self' data:",
    "connect-src": [
      "'self'",
      "https://*.googleapis.com",
      "https://*.firebaseio.com",
      "wss://*.firebaseio.com",
      "https://*.firebaseapp.com",
      "https://www.google.com",
      ...(opcoes.dev ? ["http://127.0.0.1:*", "http://localhost:*", "ws://localhost:*", "ws://127.0.0.1:*"] : []),
    ].join(" "),
    "frame-src": "'self' https://*.firebaseapp.com https://accounts.google.com https://apis.google.com",
    "worker-src": "'self'",
    "manifest-src": "'self'",
    "object-src": "'none'",
    "base-uri": "'self'",
    "form-action": "'self'",
    "frame-ancestors": "'none'",
    "report-uri": "/api/csp-report",
  };
  return Object.entries(diretivas).map(([k, v]) => `${k} ${v}`).join("; ");
}

export function cabecalhosDeSeguranca(opcoes: { dev: boolean }): Cabecalho[] {
  const lista: Cabecalho[] = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    { key: "Content-Security-Policy-Report-Only", value: politicaDeConteudo(opcoes) },
  ];
  // HSTS só fora do dev: em localhost http ele faria o navegador insistir em https.
  if (!opcoes.dev) lista.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" });
  return lista;
}
