"use client";

import type { RequisitoMercadoLider } from "@/lib/domain/mercadolider-requisitos";

function diasDesde(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

function IconeStatus({ status }: { status: RequisitoMercadoLider["status"] }) {
  if (status === "ok") return <span style={{ color: "var(--green)", fontWeight: 700 }}>✓</span>;
  if (status === "atencao") return <span style={{ color: "var(--red)", fontWeight: 700 }}>✗</span>;
  return <span style={{ color: "var(--muted)", fontWeight: 700 }}>?</span>;
}

export default function RequisitosMercadoLiderPanel({
  requisitos, registrationDate, vendasConcluidas, jaEhLider,
}: {
  requisitos: RequisitoMercadoLider[];
  registrationDate: string | null;
  vendasConcluidas: number | null | undefined;
  jaEhLider: boolean;
}) {
  const dias = diasDesde(registrationDate);
  const pendentes = requisitos.filter((r) => r.status === "atencao").length;
  const semDado = requisitos.filter((r) => r.status === "indisponivel").length;

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 6 }}>
        <span className="panel-title">O que falta pra ser MercadoLíder</span>
        {requisitos.length > 0 && (
          <span className="panel-sub">{pendentes === 0 ? "critérios de qualidade em dia" : `${pendentes} de ${requisitos.length} fora do critério`}</span>
        )}
      </div>

      {jaEhLider && (
        <div style={{ marginBottom: 10, fontSize: ".82rem", color: "var(--green)", fontWeight: 600 }}>
          Você já tem o selo — os itens abaixo são o que mantém o selo ativo.
        </div>
      )}

      {requisitos.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: ".85rem" }}>Sem dados de reputação pra avaliar agora.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
          {requisitos.map((r) => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", background: "var(--surface2)", borderRadius: 6, fontSize: ".82rem" }}>
              <IconeStatus status={r.status} />
              <div style={{ flex: 1 }}>
                <div>{r.label}</div>
                <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>{r.detalhe}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 12, fontSize: ".8rem" }}>
        <div>
          <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>Tempo de cadastro</div>
          <div style={{ fontWeight: 700 }}>{dias != null ? `${dias} dia(s)` : "—"}</div>
          <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>referência não-oficial: ~90 a 120 dias</div>
        </div>
        <div>
          <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>Vendas concluídas (total)</div>
          <div style={{ fontWeight: 700 }}>{vendasConcluidas ?? "—"}</div>
          <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>referência não-oficial nível básico: ~230 nos últimos 3 meses</div>
        </div>
      </div>

      {semDado > 0 && (
        <div style={{ fontSize: ".75rem", color: "var(--muted)", marginBottom: 8 }}>
          {semDado} critério(s) acima ({semDado === 1 ? "está" : "estão"} marcado(s) com &quot;?&quot;) a API não devolve ou ainda não tem dado suficiente calculado.
        </div>
      )}

      <div style={{ fontSize: ".75rem", color: "var(--muted)", lineHeight: 1.5 }}>
        Os 5 critérios acima (reputação, reclamações, mediações, cancelamentos, envios com atraso) vêm de
        seller_reputation da própria API do ML. Tempo de cadastro, vendas concluídas e faturamento mínimo por
        nível <b>não têm fonte oficial acessível automaticamente</b> — o Mercado Livre bloqueia acesso
        automatizado às páginas de ajuda, e os números aqui são referências de terceiros que divergem entre si.
        Trate como aproximação, não como o cálculo exato que o próprio Mercado Livre usa.
      </div>
    </div>
  );
}
