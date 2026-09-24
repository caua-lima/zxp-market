#!/usr/bin/env node
/**
 * Por que a margem do DIA é tão menor que a margem dos PEDIDOS?
 *
 * Só leitura. Pede à rota de produção /api/ml/metrics (a MESMA que o
 * Dashboard usa) o breakdown de um dia e monta a ponte entre as duas
 * margens, anúncio por anúncio. Não toca no Firestore nem no ML diretamente
 * — só lê o que a própria produção já calcula.
 *
 * ─── POR QUE NÃO LÊ O FIRESTORE DIRETO ───────────────────────────────────
 *
 * As credenciais do .env.local podem apontar pra outro projeto Firebase que
 * não o de produção (já aconteceu: `controleml-saas` em vez de
 * `vazxpress-a2350`). Uma leitura local "vazia" pareceria dado faltando, e
 * não era. A rota de produção roda com as credenciais da Vercel — é a única
 * fonte que garantidamente é a mesma da tela.
 *
 * Uso: node scripts/diagnostico-margem-dia.mjs [yyyy-mm-dd] [--url https://...]
 * Precisa só de CRON_SECRET (lido do .env.local, nunca impresso).
 */
import fs from "node:fs";

for (const linha of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = linha.match(/^([A-Z_]+)=(.*)$/);
  if (!m || process.env[m[1]]) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  process.env[m[1]] = v;
}

const args = process.argv.slice(2);
const opt = (n, p) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : p; };
const hojeBR = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const dia = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? hojeBR;
const base = opt("url", "https://briefing-master.vercel.app");

const fmt = (v) => `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v) => `${Number(v).toFixed(1).replace(".", ",")}%`;
const div = (a, b) => (b > 0 ? (a / b) * 100 : 0);

const res = await fetch(`${base}/api/ml/metrics?from=${dia}&to=${dia}&dia=${dia}`, {
  headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
});
if (!res.ok) {
  console.error(`/api/ml/metrics respondeu ${res.status} — confira CRON_SECRET no .env.local e a URL (${base}).`);
  process.exit(1);
}
const m = await res.json();
const h = m.hoje;
const antesAds = h.lucroLiquido + h.totalAds;

console.log(`\n══ ${dia} — produção (${base}) ══════════════════════`);
console.log(`\nA CONTA DO DIA (card "Vendas do dia"):`);
console.log(`  ${h.pedidos} pedidos válidos, receita-base ${fmt(h.totalRetorno)}`);
console.log(`  − CMV ${fmt(h.totalCMV)}  − frete ${fmt(h.totalEnvio)}  − taxas ${fmt(h.totalTaxasML)}  − imposto ${fmt(h.totalImposto)}`);
console.log(`  = lucro ANTES do Ads ..... ${fmt(antesAds)}  →  ${pct(div(antesAds, h.totalRetorno))}   ← é a conta de cada linha da aba Pedidos`);
console.log(`  − Ads do dia ............. ${fmt(h.totalAds)}  (${pct(div(h.totalAds, h.totalRetorno))} da receita)`);
console.log(`  = lucro DEPOIS do Ads .... ${fmt(h.lucroLiquido)}  →  ${pct(div(h.lucroLiquido, h.totalRetorno))}   ← é a margem do dia no Dashboard`);

const vendidos = (m.anuncios ?? []).filter((a) => a.retorno > 0);
const semVenda = (m.anuncios ?? []).filter((a) => a.semVenda);
const linhas = vendidos.map((a) => {
  const lucroAntes = a.lucro + a.ads;
  return { ...a, lucroAntes, margemAntes: div(lucroAntes, a.retorno), margemDepois: div(a.lucro, a.retorno) };
});
const pedidosTot = linhas.reduce((s, a) => s + a.vendas, 0);
const pedAcimaAntes = linhas.filter((a) => a.margemAntes >= 10).reduce((s, a) => s + a.vendas, 0);
const pedAcimaDepois = linhas.filter((a) => a.margemDepois >= 10).reduce((s, a) => s + a.vendas, 0);

console.log(`\nPOR ANÚNCIO (pedidos do dia; margem antes e depois do Ads do próprio anúncio):`);
for (const a of [...linhas].sort((x, y) => y.retorno - x.retorno)) {
  console.log(
    `  ${String(a.vendas).padStart(2)} ped  ${fmt(a.retorno).padStart(12)}  antes ${pct(a.margemAntes).padStart(6)}` +
    `  Ads ${fmt(a.ads).padStart(10)}  depois ${pct(a.margemDepois).padStart(6)}  ${String(a.title).slice(0, 42)}`,
  );
}
if (semVenda.length) {
  const gastoSemVenda = semVenda.reduce((s, a) => s + a.ads, 0);
  console.log(`  + ${semVenda.length} anúncio(s) com Ads e ZERO venda hoje: ${fmt(gastoSemVenda)} de gasto que nenhum pedido "carrega"`);
}

console.log(`\nRESUMO:`);
console.log(`  pedidos em anúncios com margem ≥ 10% ANTES do Ads: ${pedAcimaAntes} de ${pedidosTot} (${pct(div(pedAcimaAntes, pedidosTot))})`);
console.log(`  pedidos em anúncios com margem ≥ 10% DEPOIS do Ads: ${pedAcimaDepois} de ${pedidosTot} (${pct(div(pedAcimaDepois, pedidosTot))})`);
console.log(`  diferença entre "antes" e "depois" do dia inteiro = o Ads: ${pct(div(antesAds, h.totalRetorno))} → ${pct(div(h.lucroLiquido, h.totalRetorno))}`);
if (m.pedidosSemVinculo) console.log(`  ${m.pedidosSemVinculo} pedido(s) sem produto vinculado — na aba Pedidos aparecem com custo 0 (margem inflada) e ficam FORA da conta do dia.`);
