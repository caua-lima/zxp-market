# ADR 0001 — Modelo de empresa: um banco, dado por empresa sob `tenants/{id}`, atrás de uma chave

- **Estado**: aceito (27/09/2026). Achados S01, S03, S23.

## Contexto

O app era de UMA loja: coleções na raiz do Firestore (`estoque`, `custos`,
`ml_orders`…), acesso em `controleAcesso`, conta do ML em `ml_tokens/main` e
vendedor fixo no código. Vender pra outro cliente exigia isolar dado, time e
conexão — sem parar a operação que já roda nem fazer migração de uma vez só.

## Decisão

1. **Um projeto Firebase, uma árvore por empresa**: `tenants/{id}/…` guarda o
   dado da empresa; `tenants/{id}/members/{email}` o time (owner/partner/member);
   `tenants/{id}/connections/main` a conta do ML. `memberships/{email}` aponta
   a pessoa pra UMA empresa; `vendedores/{sellerId}` aponta a conta do ML pra
   UMA empresa (roteia o webhook e impede a mesma conta em duas).
2. **O código de negócio não recebe a empresa por parâmetro.** A tabela
   `DESTINOS` (`lib/domain/migracao-dados.ts`) diz, por coleção, se ela é da
   empresa, da pessoa, do sistema ou da conexão; `traduzirCaminho`
   (`lib/firebase/caminhos.ts`) reescreve o caminho — no servidor dentro de
   `getAdminDb()`, no navegador em `sCol`/`sDoc`. Um teste varre o código e
   quebra se aparecer coleção sem decisão.
3. **A empresa é da requisição**: `requireAccess` resolve o membro e entra na
   empresa dele (AsyncLocalStorage, `lib/firebase/contexto-tenant.ts`); rotinas
   agendadas rodam uma vez por empresa (`porEmpresa`).
4. **A virada é uma chave** (`NEXT_PUBLIC_ZXP_MODO_DADOS=raiz|tenant`), com a
   raiz intacta como rollback. Migração copia, confere (presença e conteúdo) e
   nunca apaga.

## Alternativas descartadas

- **Um projeto Firebase por cliente**: isolamento forte, mas deploy de regras,
  chaves, cron e cobrança multiplicados por cliente — inviável pra operar sozinho.
- **Campo `tenantId` em cada documento**: toda consulta e toda regra teriam de
  filtrar; um filtro esquecido vaza dado de outra empresa. A árvore por empresa
  faz o isolamento pelo caminho.

## Consequências

- Uma pessoa pertence a uma empresa; uma conta do ML a uma empresa.
- Rotinas percorrem as empresas em sequência dentro de 60 s por função — com
  dezenas de empresas, vira fila por empresa.
- Cache, preferências e cópia offline no navegador são por pessoa+empresa (S23).
