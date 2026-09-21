/**
 * O selo de estado — texto SEMPRE, cor como reforço.
 *
 * Cor sozinha exclui quem não distingue verde de âmbar (o par exato de "ok" e "atenção"),
 * e some numa impressão em preto e branco. O selo leva o texto do estado e, opcionalmente,
 * um ícone; a cor só acompanha. `tom` mapeia pros tokens de estado do app.
 */
export type TomDoSelo = "ok" | "atencao" | "erro" | "neutro" | "info";

const COR: Record<TomDoSelo, string> = {
  ok: "var(--success)",
  atencao: "var(--warning)",
  erro: "var(--red-text)",
  neutro: "var(--muted)",
  info: "var(--info-2)",
};

export default function StatusBadge({ tom = "neutro", icone, children, titulo }: {
  tom?: TomDoSelo;
  /** Um caractere ou glifo curto (●, ▲, ✓). Decorativo: o texto já diz o estado. */
  icone?: string;
  children: React.ReactNode;
  /** Explicação por extenso (tooltip). Não é o único lugar onde o estado aparece. */
  titulo?: string;
}) {
  const cor = COR[tom];
  return (
    <span
      className="chip" title={titulo}
      style={{ color: cor, borderColor: cor, fontWeight: 700, background: "transparent" }}
    >
      {icone && <span aria-hidden="true">{icone}</span>}
      {children}
    </span>
  );
}
