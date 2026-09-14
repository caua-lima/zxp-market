/**
 * Quem pode se tornar o primeiro owner — e quando isso deixa de ser possível.
 *
 * ─── A JANELA QUE ISTO FECHA ────────────────────────────────────────────
 *
 * O primeiro owner era decidido no NAVEGADOR. `AccessGuard` carregava,
 * perguntava se `controleAcessoMeta/config` existia e, se não existisse,
 * gravava o próprio e-mail como `role: "owner"`. As regras do Firestore
 * permitiam isso a QUALQUER autenticado:
 *
 *   allow create: if signedIn()
 *     && !exists(.../controleAcessoMeta/config)
 *     && request.auth.token.email == email
 *     && request.resource.data.role == "owner"
 *
 * Enquanto esse documento não existisse, qualquer pessoa que conseguisse
 * entrar no Firebase — e entrar é abrir o app e logar com o Google — virava
 * dona do painel só por abrir a página. Não havia lista de quem podia; a
 * única trava era "chegar primeiro".
 *
 * Pior: eram DUAS gravações separadas (`bootstrapAccessOwner` fazia dois
 * `setDoc`). Duas pessoas carregando o app ao mesmo tempo liam "não existe"
 * as duas e as duas viravam owner; e se a segunda gravação falhasse, ficava
 * um owner sem config — ou seja, a janela seguia aberta.
 *
 * ─── COMO FICA ──────────────────────────────────────────────────────────
 *
 * A decisão sai do navegador e vai pro servidor, contra uma lista definida
 * em variável de ambiente (que ninguém de fora escreve), e as duas gravações
 * viram UMA transação do Firestore.
 *
 * Sem lista configurada, o bootstrap fica DESLIGADO. É de propósito: numa
 * instalação nova, "ninguém consegue" é um problema visível que se resolve
 * com uma variável de ambiente, enquanto "qualquer um consegue" é um
 * problema invisível que só se descobre depois.
 */

export type RecusaBootstrap =
  | "sem_lista"        // não há allowlist no servidor: bootstrap desligado
  | "fora_da_lista"    // autenticado, mas não é uma identidade autorizada
  | "ja_configurado"   // já existe owner: a janela fechou
  | "sem_email";       // token sem e-mail

export type VereditoBootstrap =
  | { ok: true; email: string }
  | { ok: false; motivo: RecusaBootstrap };

/**
 * Lê a allowlist da variável de ambiente.
 *
 * Aceita vírgula, ponto-e-vírgula ou espaço como separador — quem edita uma
 * variável no painel da Vercel não deve precisar acertar a pontuação.
 */
export function listaAutorizada(bruto: string | undefined): string[] {
  if (!bruto) return [];
  return bruto
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
}

/**
 * Decide se este e-mail pode ocupar o bootstrap agora.
 *
 * @param configExiste se `controleAcessoMeta/config` já existe. Precisa vir de
 *   uma leitura feita DENTRO da transação — ler antes e decidir depois é
 *   exatamente a corrida que este módulo existe pra impedir.
 */
export function avaliarBootstrap(args: {
  email: string;
  configExiste: boolean;
  autorizados: string[];
}): VereditoBootstrap {
  const email = (args.email || "").trim().toLowerCase();
  if (!email) return { ok: false, motivo: "sem_email" };

  // A ordem importa pra mensagem: quem chega depois merece saber que já tem
  // dono, não que a lista está errada.
  if (args.configExiste) return { ok: false, motivo: "ja_configurado" };
  if (args.autorizados.length === 0) return { ok: false, motivo: "sem_lista" };
  if (!args.autorizados.includes(email)) return { ok: false, motivo: "fora_da_lista" };

  return { ok: true, email };
}

/** Texto pra resposta da API — precisa dizer o que fazer, não só o que houve. */
export function explicarRecusaBootstrap(motivo: RecusaBootstrap): string {
  switch (motivo) {
    case "sem_lista":
      return "Bootstrap desligado: defina BOOTSTRAP_OWNER_EMAILS no servidor com o e-mail do dono.";
    case "fora_da_lista":
      return "Este e-mail não está na lista de donos autorizada no servidor.";
    case "ja_configurado":
      return "O painel já tem dono. Peça acesso a quem administra.";
    case "sem_email":
      return "O login não trouxe um e-mail.";
  }
}
