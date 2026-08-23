/**
 * Modelo multi-tenant — quem é o cliente, quem trabalha nele, e quem pagou.
 *
 * ─── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────
 *
 * O branch `saas` escopou os dados em `users/{uid}` e travou a regra em
 * `request.auth.uid == uid`. Isso amarra o cliente ao LOGIN: dois usuários
 * (Owner e Colaborador) logam com uids diferentes, gravam em espaços
 * diferentes, e cada um vê o dashboard vazio do outro. O produto de hoje já
 * tem colaboração — Owner e Colaborador com permissão por aba (ver
 * PermissionTab/AccessEntry em types.ts) — então aquele modelo não comporta o
 * que já existe.
 *
 * Aqui o dono dos dados é o TENANT, não o uid. Vários uids apontam pro mesmo
 * tenant, cada um com o seu papel. É o que permite "eu peço pro meu sócio e
 * vice-versa" continuar funcionando quando isto virar SaaS.
 *
 * ─── A COLISÃO QUE ISTO DESFAZ ──────────────────────────────────────────
 *
 * `controleAcesso` quer dizer coisas DIFERENTES nos dois branches:
 *
 *   main:  lista de acesso DA OPERAÇÃO. role "owner" = dono desta loja.
 *          Carrega permissoesEdicao por aba.
 *   saas:  registro de LICENÇA do SaaS. role "owner" = admin master do
 *          negócio inteiro (isMaster() nas rules). Carrega status/expiresAt.
 *
 * Mesma coleção, mesmo campo `role`, significados incompatíveis. Um merge que
 * compila transformaria todo cliente do SaaS em admin master — sem erro de
 * tipo, sem teste vermelho. Por isso as duas responsabilidades ficam
 * separadas daqui pra frente:
 *
 *   licencas/{email}              → o comercial: pagou? está no prazo?
 *   tenant_membros/{uid}          → o operacional: de qual loja é, com que papel
 *   tenants/{tenantId}/...        → os dados em si
 *
 * ─── POR QUE `tenant_membros` É INDEXADO POR uid ────────────────────────
 *
 * Um documento por uid, e não uma subcoleção em tenants/{id}/membros. A
 * resolução "quem é este usuário?" acontece em TODA requisição e em TODA
 * regra do Firestore — com um doc por uid custa 1 leitura direta por id, sem
 * query nem índice composto. Numa subcoleção seria uma collection-group query
 * a cada checagem, e este app já esgotou cota de leitura duas vezes (ver
 * lib/firebase/cache.ts). Listar o time é a operação rara: essa sim faz query
 * por tenantId, e só o Owner faz.
 *
 * Puro de propósito: nada de Firestore aqui, só as regras. O I/O fica em
 * lib/tenant.ts (servidor).
 */

import type { PermissionTab } from "./types";

export type PapelTenant = "owner" | "colaborador";

/**
 * Vínculo de um usuário com um tenant. É o doc `tenant_membros/{uid}`.
 * `uid` não é campo: é o id do documento.
 */
export type MembroTenant = {
  tenantId: string;
  email: string;
  papel: PapelTenant;
  /** Abas que o COLABORADOR pode editar. Ignorado pro owner (edita tudo). Mesma semântica de AccessEntry.permissoesEdicao. */
  permissoesEdicao?: PermissionTab[];
  displayName?: string;
  adicionadoEm?: number;
  adicionadoPor?: string;
};

export type Tenant = {
  id: string;
  /** Nome da operação, mostrado na interface (ex.: "VAZXPRESS"). */
  nome: string;
  /** uid de quem criou — não é "o dono atual", é registro histórico. */
  criadoPor: string;
  criadoEm: number;
};

export type StatusLicenca = "ativo" | "suspenso";

/**
 * Licença do SaaS, por e-mail. Separada do tenant de propósito: quem paga
 * pode não ser quem opera, e um tenant pode ter vários membros sob a mesma
 * licença. É o doc `licencas/{email}`.
 */
export type Licenca = {
  email: string;
  status: StatusLicenca;
  /** ms epoch. Ausente/null = sem prazo (o caso do dono do SaaS). */
  expiresAt?: number | null;
  plano?: string;
  nota?: string;
};

/** Papéis legados de AccessEntry ("admin"/"user") normalizados — ver roleLabel em types.ts. */
export function normalizarPapel(role: string | undefined): PapelTenant {
  return role === "owner" ? "owner" : "colaborador";
}

/**
 * Licença vale agora?
 *
 * Sem licença NÃO é o mesmo que licença vencida, mas o efeito é o mesmo aqui:
 * ambos negam. Quem precisa distinguir (pra mostrar "fale com o vendedor" vs
 * "sua assinatura venceu") olha o objeto, não este booleano.
 */
export function licencaValida(licenca: Licenca | null | undefined, agora: number): boolean {
  if (!licenca) return false;
  if (licenca.status === "suspenso") return false;
  // null/undefined = sem prazo. 0 é prazo de verdade (epoch), não "sem prazo".
  if (licenca.expiresAt == null) return true;
  return licenca.expiresAt > agora;
}

export type SituacaoConta = "ok" | "sem_licenca" | "suspenso" | "vencido";

/**
 * Por que a conta está bloqueada — pra mostrar mensagem certa, não só negar.
 *
 * `licencaValida()` já decide SE deixa passar; isto decide O QUÊ dizer pra
 * quem não passou. Sem isto, um cliente com licença vencida via a MESMA tela
 * genérica de "acesso negado" que alguém que nunca teve conta — e "fale com o
 * suporte" não ajuda quem só precisa renovar.
 */
export function situacaoDaConta(licenca: Licenca | null | undefined, agora: number): SituacaoConta {
  if (!licenca) return "sem_licenca";
  if (licenca.status === "suspenso") return "suspenso";
  if (licenca.expiresAt != null && licenca.expiresAt <= agora) return "vencido";
  return "ok";
}

/** Owner edita tudo, sempre. Colaborador só a aba que o owner liberou. */
export function podeEditarAba(membro: MembroTenant | null | undefined, aba: PermissionTab): boolean {
  if (!membro) return false;
  if (membro.papel === "owner") return true;
  return (membro.permissoesEdicao ?? []).includes(aba);
}

export function ehOwner(membro: MembroTenant | null | undefined): boolean {
  return membro?.papel === "owner";
}

/**
 * O usuário alcança este tenant? É a pergunta que separa cliente de cliente —
 * a mesma checagem que a regra do Firestore faz, aqui em TypeScript pra
 * poder testar a decisão sem subir emulador.
 *
 * Exige licença válida ALÉM do vínculo: colaborador de tenant cuja licença
 * venceu perde acesso junto com o owner. A licença é da operação, não da
 * pessoa — se fosse por pessoa, o owner poderia deixar a assinatura vencer e
 * continuar operando através de um colaborador.
 */
export function podeAcessarTenant(
  membro: MembroTenant | null | undefined,
  tenantId: string,
  licenca: Licenca | null | undefined,
  agora: number,
): boolean {
  if (!membro || !tenantId) return false;
  if (membro.tenantId !== tenantId) return false;
  return licencaValida(licenca, agora);
}
