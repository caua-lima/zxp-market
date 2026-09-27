/**
 * As regras do dado da EMPRESA dentro de `tenants/{tenantId}` — geradas a
 * partir das regras da raiz, nunca escritas à mão (Etapa 3).
 *
 * ─── POR QUE GERAR ──────────────────────────────────────────────────────
 *
 * Depois da migração (Etapa 5) o dado de negócio mora em
 * `tenants/{t}/estoque`, `tenants/{t}/custos`… e precisa das MESMAS regras
 * que tem na raiz — só que a autorização vem de ser membro da empresa
 * (`tenants/{t}/members/{email}`), não de `controleAcesso`. Copiar à mão 18
 * blocos seria criar duas verdades: a próxima correção feita na raiz não
 * chegaria na empresa, em silêncio. Aqui a raiz é a fonte, esta função traduz,
 * e um teste regenera e compara — regra da raiz alterada sem regenerar QUEBRA
 * o teste (`npm run regras:gerar` conserta).
 *
 * Autossuficiente (sem `@/`): o script .mjs importa direto pelo Node.
 */

/** Os blocos da raiz que são dado da empresa (lib/domain/migracao-dados.ts: destino "tenant"). */
export const BLOCOS_DO_TENANT = [
  "/rascunho/{docId}",
  "/dias/{docId}",
  "/metas/{docId}",
  "/metasHistorico/{docId}",
  "/custos/{docId}",
  "/estoque/{docId}",
  "/estoque_movimentos/{docId}",
  "/ads_alteracoes/{docId}",
  "/full_remessas/{docId}",
  "/tarefas/{docId}",
  "/alertasDispensados/{docId}",
  "/notification_events/{eventId}",
  "/notification_events_publico/{eventId}",
  "/notification_outbox/{pushId}",
  "/notification_entregas/{entregaId}",
  "/notification_feed/{email}/itens/{eventId}",
  "/notification_janelas/{janelaId}",
  "/auditLog/{docId}",
] as const;

/** Funções da raiz que citam caminho ou permissão: ganham cópia com sufixo T. */
export const FUNCOES_COPIADAS = [
  "idAuditoriaMovimento",
  "auditouMovimento",
  "auditEventValido",
  "auditoriaDeMovimentoCoerente",
] as const;

const AJUDANTES = ["requesterDoc", "isOwner", "isAuthorized", "isMember", "veOperacao", "podeEditar"];

export const INICIO = "// <gerado:dados-do-tenant> — NÃO EDITE: `npm run regras:gerar` refaz a partir da raiz";
export const FIM = "// </gerado:dados-do-tenant>";

/** Acha `cabecalho {` e devolve o trecho até a chave que fecha, contando chaves. */
function extrairBloco(regras: string, cabecalho: string): string {
  const i = regras.indexOf(cabecalho);
  if (i < 0) throw new Error(`não achei nas regras: ${cabecalho}`);
  const inicioLinha = regras.lastIndexOf("\n", i) + 1;
  let nivel = 0;
  // A partir do FIM do cabeçalho: `match /x/{docId} {` tem chaves no caminho.
  for (let k = regras.indexOf("{", i + cabecalho.length - 1); k < regras.length; k++) {
    if (regras[k] === "{") nivel++;
    else if (regras[k] === "}") {
      nivel--;
      if (nivel === 0) return regras.slice(inicioLinha, k + 1);
    }
  }
  throw new Error(`bloco sem fechamento: ${cabecalho}`);
}

function semComentarios(trecho: string): string {
  return trecho
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\s+\/\/.*$/, "").replace(/^\s*\/\/.*$/, ""))
    .filter((l) => l.trim() !== "")
    .join("\n");
}

function traduzir(trecho: string): string {
  let t = semComentarios(trecho);
  for (const a of AJUDANTES) t = t.replace(new RegExp(`\\b${a}\\(`, "g"), `${a}T(`);
  for (const f of FUNCOES_COPIADAS) t = t.replace(new RegExp(`\\b${f}\\(`, "g"), `${f}T(`);
  // Todo caminho absoluto dentro do dado da empresa passa a apontar pra empresa.
  t = t.replace(/\/databases\/\$\(database\)\/documents\//g, "/databases/$(database)/documents/tenants/$(tenantId)/");
  // Um nível a mais de recuo: a seção mora dentro de `match /tenants/{tenantId}`.
  return t.split("\n").map((l) => `  ${l}`).join("\n");
}

const AJUDANTES_T = `
      function acessoT() {
        return /databases/$(database)/documents/tenants/$(tenantId)/members/$(request.auth.token.email);
      }
      function requesterDocT() {
        return get(acessoT());
      }
      function isAuthorizedT() {
        return signedIn() && exists(acessoT());
      }
      function isOwnerT() {
        return isAuthorizedT() && requesterDocT().data.role == "owner";
      }
      function isMemberT() {
        return isAuthorizedT() && requesterDocT().data.get('role', '') == 'member';
      }
      function veOperacaoT() {
        return isAuthorizedT() && !isMemberT();
      }
      function podeEditarT(tab) {
        return isOwnerT() || (veOperacaoT() && tab in requesterDocT().data.get('permissoesEdicao', []));
      }`;

/** A seção gerada, entre os marcadores. */
export function gerarSecaoDoTenant(regras: string): string {
  const funcoes = FUNCOES_COPIADAS.map((f) => traduzir(extrairBloco(regras, `function ${f}(`)));
  const blocos = BLOCOS_DO_TENANT.map((b) => traduzir(extrairBloco(regras, `match ${b} {`)));
  return [
    `      ${INICIO}`,
    "      // Autorização por membro da empresa (tenants/{tenantId}/members/{email}), não pela lista legada de acesso.",
    AJUDANTES_T.slice(1),
    ...funcoes,
    ...blocos,
    `      ${FIM}`,
  ].join("\n");
}

/** As regras com a seção gerada no lugar (inserida na primeira vez, substituída nas outras). */
export function aplicarSecaoDoTenant(regras: string): string {
  const nl = regras.includes("\r\n") ? "\r\n" : "\n";
  const base = regras.replace(/\r\n/g, "\n");
  const secao = gerarSecaoDoTenant(base);
  const i = base.indexOf(`      ${INICIO}`);
  let saida: string;
  if (i >= 0) {
    const f = base.indexOf(`      ${FIM}`, i);
    if (f < 0) throw new Error("marcador de fim da seção gerada sumiu");
    saida = base.slice(0, i) + secao + base.slice(f + `      ${FIM}`.length);
  } else {
    const ancora = "match /tenants/{tenantId} {";
    const a = base.indexOf(ancora);
    if (a < 0) throw new Error("não achei match /tenants/{tenantId}");
    const fimDaLinha = base.indexOf("\n", a);
    saida = base.slice(0, fimDaLinha + 1) + secao + "\n\n" + base.slice(fimDaLinha + 1);
  }
  return saida.replace(/\n/g, nl);
}
