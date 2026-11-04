"use client";

import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/api/authed-fetch";
import { useAccess, type VisaoSimulada } from "@/components/tabs/AccessGuard";
import { papelDe, roleLabel, type AccessEntry } from "@/lib/domain/types";

/**
 * "VER COMO" — o Master enxerga o app como o Sócio, o Colaborador ou o
 * Partner enxergam, sem deslogar e logar de novo.
 *
 * É só a TELA: quais abas aparecem, de quem são as tarefas mostradas e o que
 * o papel pode tocar. Os dados continuam lidos com o login do Master, e o que
 * se fizer aqui vale de verdade (a faixa no topo avisa). Guardado na aba do
 * navegador (sessionStorage): fechar a aba volta pra visão do Master.
 */

type Pessoa = { email: string; displayName: string | null; role?: AccessEntry["role"] };

/** O seletor, no rodapé da barra lateral. Só aparece pro Master de verdade. */
export function SeletorVerComo() {
  const { donoDeVerdade, visao, verComo, email } = useAccess();
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);

  useEffect(() => {
    if (!donoDeVerdade) return;
    let vivo = true;
    authedFetch("/api/acesso/diretorio")
      .then((r) => (r.ok ? r.json() : { pessoas: [] }))
      .then((j) => { if (vivo) setPessoas(Array.isArray(j?.pessoas) ? j.pessoas : []); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [donoDeVerdade]);

  if (!donoDeVerdade) return null;
  const outras = pessoas.filter((p) => p.email !== email && p.role && papelDe(p.role) !== "owner");

  return (
    <label style={{ display: "block", marginBottom: 8, fontSize: ".72rem", color: "var(--muted)", fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase" }}>
      Ver como
      <select
        value={visao?.email ?? ""}
        onChange={(e) => {
          const p = outras.find((x) => x.email === e.target.value);
          if (!p || !p.role) { verComo(null); return; }
          const papel = papelDe(p.role);
          verComo({ email: p.email, displayName: p.displayName || p.email, papel });
          // O Colaborador vive no app de tarefas: a visão dele é lá.
          if (papel === "equipe") window.location.assign("/tarefas");
        }}
        style={{ display: "block", width: "100%", marginTop: 4, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px", color: "var(--text)", fontSize: ".8rem", textTransform: "none", letterSpacing: 0, fontWeight: 600 }}
      >
        <option value="">Eu (Master)</option>
        {outras.map((p) => (
          <option key={p.email} value={p.email}>{(p.displayName || p.email)} · {roleLabel(p.role!)}</option>
        ))}
      </select>
    </label>
  );
}

/** A faixa do topo enquanto o Master vê como outra pessoa. */
export function FaixaVerComo({ visao, onVoltar }: { visao: VisaoSimulada; onVoltar: () => void }) {
  return (
    <div
      role="status"
      style={{
        position: "sticky", top: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap",
        gap: 10, padding: "6px 12px", background: "var(--accent)", color: "#10100E", fontSize: ".82rem", fontWeight: 700,
      }}
    >
      <span>👁 Vendo como {visao.displayName} · {roleLabel(visao.papel)} — o que você fizer aqui vale de verdade</span>
      <button
        type="button" onClick={onVoltar}
        style={{ border: 0, borderRadius: 8, padding: "4px 10px", background: "#10100E", color: "#fff", fontWeight: 800, cursor: "pointer", font: "inherit" }}
      >
        Voltar pra minha visão
      </button>
    </div>
  );
}
