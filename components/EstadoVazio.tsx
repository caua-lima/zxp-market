/**
 * O estado vazio de uma lista: um ícone, o que aconteceu e a SAÍDA.
 *
 * "Vazio" tem causas diferentes (não há cadastro · há e nada precisa de ação · o filtro
 * escondeu tudo · a fonte não chegou) e cada uma pede uma saída diferente. Este componente
 * é só a apresentação; quem decide qual causa é o domínio da tela
 * (`lib/domain/estoque-vazio`, `custos-lista › vistaDaLista`). Sempre `role="status"`: a
 * mudança de "lista" pra "vazio" é anunciada.
 */
export default function EstadoVazio({ icone, children, acao }: {
  icone: string;
  children: React.ReactNode;
  /** A saída: um botão, no máximo dois. */
  acao?: React.ReactNode;
}) {
  return (
    <div className="empty-state" role="status">
      <span className="empty-ico" aria-hidden="true">{icone}</span>
      {children}
      {acao && <div style={{ marginTop: 10, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>{acao}</div>}
    </div>
  );
}
