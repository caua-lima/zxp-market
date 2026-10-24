import { createHash, randomBytes } from "node:crypto";

/**
 * O código secreto do widget do iPhone (app Scriptable).
 *
 * O widget não tem sessão: ele chama `/api/widget/ao-vivo?t=<código>`. Por isso
 * o código é longo (256 bits), só o HASH fica guardado (quem ler o banco não
 * consegue montar a URL), cada pessoa tem um por empresa (gerar outro revoga o
 * anterior) e a rota só devolve faturamento e contagem — nunca custo nem lucro.
 */
export const FORMATO_TOKEN = /^zw_[A-Za-z0-9_-]{43}$/;

export function novoToken(): string {
  return `zw_${randomBytes(32).toString("base64url")}`;
}

export function hashDoToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
