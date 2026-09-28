import type { ReactNode } from "react";
import Link from "next/link";
import { TERMOS_VERSAO } from "@/lib/domain/cadastro";

/**
 * Moldura das páginas públicas de termos e privacidade (S24). O aviso de
 * versão preliminar sai quando o texto passar pela revisão jurídica — e aí a
 * versão (TERMOS_VERSAO) sobe, pra o aceite registrar o texto certo.
 */
export default function DocumentoLegal({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 16px 64px", lineHeight: 1.7, color: "var(--text)" }}>
      <p style={{ fontSize: ".8rem", color: "var(--muted)" }}>
        <Link href="/">ZXP Market</Link> · versão {TERMOS_VERSAO}
      </p>
      <h1 className="font-display" style={{ fontSize: "1.6rem", margin: "8px 0 12px" }}>{titulo}</h1>
      <p role="note" style={{ padding: "10px 14px", border: "1px solid var(--border)", borderRadius: 8, fontSize: ".85rem", color: "var(--muted)" }}>
        Versão preliminar, em revisão jurídica. Dúvidas: fale com o responsável pela sua conta.
      </p>
      <div className="documento-legal" style={{ fontSize: ".92rem" }}>{children}</div>
    </main>
  );
}
