#!/usr/bin/env node
/**
 * Regera, dentro de `match /tenants/{tenantId}` em firestore.rules, as regras
 * do dado da empresa a partir das regras da raiz. Ver lib/domain/regras-tenant.ts.
 *
 *   npm run regras:gerar
 */
import fs from "node:fs";
import { aplicarSecaoDoTenant } from "../lib/domain/regras-tenant.ts";

const antes = fs.readFileSync("firestore.rules", "utf8");
const depois = aplicarSecaoDoTenant(antes);
if (depois === antes) {
  console.log("firestore.rules já está em dia.");
} else {
  fs.writeFileSync("firestore.rules", depois);
  console.log("firestore.rules: seção do tenant regerada.");
}
