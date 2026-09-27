import { log } from "@/lib/log";

/**
 * Recebe os relatórios da CSP em modo relatório (S27, lib/config/cabecalhos.ts).
 *
 * Público por natureza (o navegador manda sem login). Por isso: corpo com teto,
 * nada gravado no banco, e só o essencial vai pro log — a diretiva e a ORIGEM
 * do que seria bloqueado, e o caminho da página sem query string (a query pode
 * carregar dado de quem estava na tela).
 */
const TETO_BYTES = 16_000;

function soOrigem(u: unknown): string | null {
  if (typeof u !== "string" || !u) return null;
  try { return new URL(u).origin; } catch { return u.slice(0, 40); }
}

function soCaminho(u: unknown): string | null {
  if (typeof u !== "string" || !u) return null;
  try { return new URL(u).pathname; } catch { return null; }
}

export async function POST(req: Request) {
  const texto = (await req.text().catch(() => "")).slice(0, TETO_BYTES);
  let dados: unknown = null;
  try { dados = JSON.parse(texto); } catch { return new Response(null, { status: 204 }); }

  // Formato antigo: { "csp-report": {...} }. Reporting API: [{ type, body }].
  const relatorios = Array.isArray(dados)
    ? dados.map((r) => (r as { body?: Record<string, unknown> })?.body ?? {})
    : [((dados as Record<string, unknown>)?.["csp-report"] ?? {}) as Record<string, unknown>];

  for (const r of relatorios.slice(0, 10)) {
    log.warn("csp.violacao", {
      diretiva: r["effective-directive"] ?? r["violated-directive"] ?? r.effectiveDirective ?? null,
      bloqueado: soOrigem(r["blocked-uri"] ?? r.blockedURL),
      pagina: soCaminho(r["document-uri"] ?? r.documentURL),
    });
  }
  return new Response(null, { status: 204 });
}
