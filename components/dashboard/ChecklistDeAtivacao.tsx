"use client";

import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/api/authed-fetch";
import { useAccess } from "@/components/tabs/AccessGuard";
import { iniciarVinculoML } from "@/lib/ml/iniciar-vinculo";
import { passosDeAtivacao, resumoDaAtivacao } from "@/lib/domain/ativacao";
import { gravarChaveApp, lerChaveApp } from "@/lib/storage";
import { modoEmpresaNaTela } from "@/lib/marca";
import type { UserData } from "@/components/useUserData";

/**
 * Checklist de ativação da empresa nova (S24), no topo do Dashboard do DONO.
 * Some sozinho quando tudo está feito, ou quando o dono esconde. Só no modo
 * empresa: a operação que já existia não passa por ativação.
 *
 * Os sinais vêm do que já existe: conta do ML e pedidos (/api/ml/status),
 * produtos/custos/meta (os dados já carregados da tela), time (/api/billing/estado).
 */

const CHAVE_OCULTO = "ativacao:oculto";

type Remoto = { mlConectado: boolean; pedidos: number; primeira: boolean; pessoas: number };

export default function ChecklistDeAtivacao({ data, onNavigate }: { data: UserData; onNavigate?: (aba: string) => void }) {
  const { papel } = useAccess();
  const ativo = modoEmpresaNaTela() && papel === "owner";
  const [oculto, setOculto] = useState(() => lerChaveApp(CHAVE_OCULTO) === "1");
  const [remoto, setRemoto] = useState<Remoto | null>(null);
  const [conectando, setConectando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!ativo || oculto) return;
    let vivo = true;
    const buscar = () =>
      Promise.all([
        authedFetch("/api/ml/status", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        authedFetch("/api/billing/estado", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]).then(([s, b]) => {
        if (!vivo) return;
        setRemoto({
          mlConectado: Boolean(s?.connected),
          pedidos: Number(s?.pedidosImportados ?? 0),
          primeira: Boolean(s?.primeiraSincronizacaoEm),
          pessoas: Number(b?.uso?.membros ?? 1),
        });
      });
    void buscar();
    // Enquanto importa, o passo "vendas" atualiza sozinho.
    const id = window.setInterval(() => { void buscar(); }, 20_000);
    return () => { vivo = false; window.clearInterval(id); };
  }, [ativo, oculto]);

  if (!ativo || oculto || !remoto) return null;

  const produtosComCusto = data.products.filter((p) => Number(String(p.custo ?? "").replace(",", ".")) > 0).length;
  const passos = passosDeAtivacao({
    mlConectado: remoto.mlConectado,
    pedidosImportados: remoto.pedidos,
    primeiraSincronizacao: remoto.primeira,
    produtos: data.products.length,
    produtosComCusto,
    custosCadastrados: data.costs.length,
    temMeta: Boolean(data.goals?.meta1),
    pessoasNoTime: remoto.pessoas,
  });
  const resumo = resumoDaAtivacao(passos);
  if (resumo.completo) return null;

  async function agir(aba: string, id: string) {
    if (id === "conectar_ml") {
      setConectando(true);
      setErro(null);
      const falha = await iniciarVinculoML().finally(() => setConectando(false));
      if (falha) setErro(falha);
      return;
    }
    onNavigate?.(aba);
  }

  function esconder() {
    gravarChaveApp(CHAVE_OCULTO, "1");
    setOculto(true);
  }

  return (
    <section className="card" aria-labelledby="ativacao-titulo" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <h2 id="ativacao-titulo" style={{ margin: 0, fontSize: "1rem" }}>Primeiros passos · {resumo.feitos} de {resumo.total}</h2>
        <button type="button" className="login-link" onClick={esconder} style={{ fontSize: ".78rem" }}>Esconder</button>
      </div>
      <p style={{ margin: "4px 0 12px", fontSize: ".82rem", color: resumo.confiavel ? "var(--green)" : "var(--muted)" }}>
        {resumo.confiavel
          ? "O lucro do painel já é confiável. Os próximos passos completam a gestão."
          : "Até os três primeiros passos, o lucro do painel ainda não é confiável."}
      </p>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
        {passos.map((p) => (
          <li key={p.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", opacity: p.feito ? 0.7 : 1 }}>
            <span aria-hidden="true" style={{ width: 20, flexShrink: 0, color: p.feito ? "var(--green)" : "var(--muted)" }}>{p.feito ? "✓" : "○"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: ".86rem", fontWeight: 600, textDecoration: p.feito ? "line-through" : undefined }}>
                <span className="sr-only">{p.feito ? "Feito: " : "Pendente: "}</span>{p.titulo}
              </div>
              <div style={{ fontSize: ".78rem", color: "var(--muted)" }}>{p.detalhe}</div>
            </div>
            {!p.feito && (
              <button type="button" className="btn btn-ghost btn-xs" disabled={conectando && p.id === "conectar_ml"} onClick={() => agir(p.aba, p.id)} style={{ flexShrink: 0 }}>
                {conectando && p.id === "conectar_ml" ? "Abrindo…" : p.acao}
              </button>
            )}
          </li>
        ))}
      </ol>
      {erro && <p role="alert" style={{ margin: "10px 0 0", fontSize: ".8rem", color: "var(--red-text)" }}>{erro}</p>}
    </section>
  );
}
