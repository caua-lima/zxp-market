# ADR 0002 — Regras do dado da empresa GERADAS a partir das regras da raiz

- **Estado**: aceito (27/09/2026). Etapa 3; estendido por S25 (trava de escrita) e Etapa 6 (acesso com prazo).

## Contexto

O dado da empresa em `tenants/{id}/…` precisa das MESMAS validações que já
existiam na raiz (18 blocos: números e datas, movimento de estoque auditado,
notificações…), só que autorizando por membro da empresa. Copiar à mão criaria
duas verdades que divergem na primeira correção.

## Decisão

`lib/domain/regras-tenant.ts` extrai cada bloco da raiz, troca os ajudantes de
autorização pelas versões da empresa (`isOwnerT`, `podeEditarT`…), reaponta os
caminhos absolutos pra dentro da empresa e escreve a seção entre marcadores em
`firestore.rules` (`npm run regras:gerar`). Um teste regenera e compara: regra
da raiz alterada sem regenerar quebra o teste.

O gerador também aplica duas travas a TODA escrita/leitura gerada:
- `escritaLiberadaT()` — empresa bloqueada pela assinatura só lê (S25);
- `naoExpiradoT()` — membro com acesso vencido não lê nem grava (Etapa 6).

## Consequências

- Mudou uma regra de dado? Edite a raiz e rode `npm run regras:gerar`.
- Cada escrita do dado da empresa lê o documento da empresa nas regras (em cache
  dentro da requisição). Os lotes auditados continuam dentro do limite de
  acessos por requisição (provado no emulador).
- Regras não sobem com a Vercel: publicar é passo manual (OPERACAO, parte B).
