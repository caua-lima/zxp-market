/**
 * Criar uma empresa nova — o cadastro do segundo cliente.
 *
 * Uma empresa nasce com UM dono, que é o único que convida o resto do time
 * pela tela de Acesso (rota /api/acesso/membros). Sem cadastro aberto na
 * internet de propósito: quem cria empresa é você, pelo script, até a
 * cobrança existir (Etapa 6).
 *
 * Autossuficiente (sem `@/`): o script .mjs importa direto pelo Node.
 */

export type PedidoDeEmpresa = { tenantId: string; nome: string; dono: string };

export type EstadoAtual = {
  /** tenants/{id} já existe. */
  empresaExiste: boolean;
  /** memberships/{dono}.tenantId, se houver. */
  empresaDoDono: string | null;
};

export type PlanoDeEmpresa =
  | { ok: false; problemas: string[] }
  | {
      ok: true;
      escritas: { caminho: string; dados: Record<string, unknown> }[];
    };

export function planoDeNovaEmpresa(p: PedidoDeEmpresa, atual: EstadoAtual, agora = Date.now()): PlanoDeEmpresa {
  const tenantId = p.tenantId.trim();
  const nome = p.nome.trim();
  const dono = p.dono.trim().toLowerCase();
  const problemas: string[] = [];
  if (!/^[a-z0-9-]{2,60}$/.test(tenantId)) problemas.push("id da empresa: só letras minúsculas, números e hífen (2 a 60), ex.: loja-do-joao");
  if (!nome) problemas.push("informe o nome da empresa");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(dono)) problemas.push("e-mail do dono inválido");
  if (atual.empresaExiste) problemas.push(`a empresa ${tenantId} já existe — nada foi alterado`);
  if (atual.empresaDoDono && atual.empresaDoDono !== tenantId) {
    problemas.push(`${dono} já pertence à empresa ${atual.empresaDoDono} — uma pessoa, uma empresa`);
  }
  if (problemas.length) return { ok: false, problemas };
  return {
    ok: true,
    escritas: [
      { caminho: `tenants/${tenantId}`, dados: { name: nome, criadoEm: agora, dono } },
      { caminho: `tenants/${tenantId}/members/${dono}`, dados: { email: dono, role: "owner", addedAt: agora, addedBy: "script:criar-empresa" } },
      { caminho: `memberships/${dono}`, dados: { email: dono, tenantId } },
    ],
  };
}
