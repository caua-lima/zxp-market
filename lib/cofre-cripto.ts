import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Cifra das senhas guardadas pro "Ver senha" (pedido do dono, 23/11/2026).
 *
 * ─── POR QUE GUARDAR A SENHA ────────────────────────────────────────────
 *
 * O Firebase Auth guarda só um hash irreversível: a senha em si não existe
 * em lugar nenhum depois de definida. O dono quer poder VER a senha de cada
 * acesso (os e-mails @zxpsolutions.com não têm caixa, então "Esqueci minha
 * senha" não chega e a senha é passada em mãos). Pra isso o app guarda uma
 * CÓPIA — cifrada, nunca em texto puro.
 *
 * ─── COMO ───────────────────────────────────────────────────────────────
 *
 * AES-256-GCM (cifra autenticada: alterar um byte faz a leitura falhar em vez
 * de devolver lixo), IV aleatório de 12 bytes por gravação. A chave é
 * DERIVADA (HKDF-SHA256) de um segredo que só o servidor tem — o banco sozinho
 * (ou um backup dele) não abre nada. Formato: "v1:iv:tag:cifra", em base64.
 *
 * Puro (recebe o segredo): testado em cofre-cripto.test.ts.
 */

export function derivarChave(segredo: string): Buffer {
  if (!segredo) throw new Error("cofre_sem_segredo");
  return Buffer.from(hkdfSync("sha256", segredo, "zxp-cofre-senhas", "v1", 32));
}

export function cifrar(texto: string, chave: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chave, iv);
  const corpo = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), corpo.toString("base64")].join(":");
}

/** O texto, ou null se a cifra é de outra chave, foi alterada ou está quebrada. */
export function decifrar(guardado: string, chave: Buffer): string | null {
  const [versao, iv, tag, corpo] = String(guardado ?? "").split(":");
  if (versao !== "v1" || !iv || !tag || !corpo) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", chave, Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(corpo, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
