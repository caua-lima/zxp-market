"use client";

import { useEffect, useState } from "react";
import CustosColetaFull from "@/components/tabs/full/CustosColetaFull";
import { useAccess } from "@/components/tabs/AccessGuard";
import { carregarColetaFull } from "@/lib/coleta-full-cliente";
import { fmtBRL, todayStr } from "@/lib/domain/calc";
import type { ColetaFull } from "@/lib/domain/coleta-full";

/**
 * Os custos de coleta pro Full do período do Dashboard, editáveis aqui mesmo.
 *
 * O Dashboard NÃO desconta essa taxa do lucro (ela entra só no Resultado
 * líquido da DRE, abaixo das despesas da empresa — ver DreTab). Este painel
 * existe pra o dono informar o custo de cada remessa sem sair da tela aberta
 * todo dia: sem o valor, o resultado da DRE fica otimista, e é aqui que a falta
 * é vista primeiro.
 *
 * Só o dono: é quem as regras deixam gravar em `full_remessas`.
 */
export default function ColetaFullDoPeriodo({ from, to }: { from?: string; to?: string }) {
  const { isOwner } = useAccess();
  // O período vai junto da resposta: resposta de outro período não é a deste.
  const [resp, setResp] = useState<{ chave: string; c: ColetaFull | null } | null>(null);
  const [versao, setVersao] = useState(0);
  const chave = from && to ? `${from}|${to}` : "";

  useEffect(() => {
    if (!isOwner || !from || !to) return;
    let vivo = true;
    carregarColetaFull({ from, to }, { hoje: todayStr(), forcar: versao > 0 })
      .then((c) => { if (vivo) setResp({ chave: `${from}|${to}`, c }); })
      .catch(() => { if (vivo) setResp({ chave: `${from}|${to}`, c: null }); });
    return () => { vivo = false; };
  }, [isOwner, from, to, versao]);

  const c = resp && resp.chave === chave ? resp.c : null;
  if (!isOwner || !c) return null;
  if (c.todas.length === 0 && c.semData.length === 0) return null;

  return (
    <CustosColetaFull
      remessas={c.todas}
      semData={c.semData}
      onSalvo={() => setVersao((v) => v + 1)}
      iniciarAberto={false}
      titulo={`Custos de coleta do Full no período · ${fmtBRL(c.total)}`}
    />
  );
}
