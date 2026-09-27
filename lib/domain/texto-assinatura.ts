import type { EstadoDaAssinatura } from "./assinatura";

/** Como cada estado aparece pra quem usa (S25). */
export const ROTULO_DO_ESTADO: Record<EstadoDaAssinatura, string> = {
  interna: "Sem cobrança pelo app",
  trial: "Teste grátis",
  trial_encerrado: "Teste grátis encerrado",
  incompleta: "Aguardando o primeiro pagamento",
  ativa: "Ativa",
  carencia: "Pagamento pendente",
  inadimplente: "Pagamento em atraso",
  cancelada: "Cancelada",
};

const DIA = 86_400_000;

export type EstadoParaAviso = {
  modo?: string;
  direitos?: { estado: EstadoDaAssinatura; bloqueada: boolean };
  trialAte?: number | null;
};

/**
 * O aviso do topo da tela, ou null. Bloqueada: explica que nada foi apagado e
 * como voltar. Trial nos últimos 3 dias: avisa antes de travar.
 */
export function avisoDaAssinatura(e: EstadoParaAviso | null, agora: number): { tom: "perigo" | "atencao"; texto: string } | null {
  if (!e || e.modo !== "tenant" || !e.direitos) return null;
  const { estado, bloqueada } = e.direitos;
  if (bloqueada) {
    const porque = estado === "trial_encerrado" ? "O teste grátis terminou" : estado === "cancelada" ? "A assinatura foi cancelada" : "O pagamento está em atraso";
    return { tom: "perigo", texto: `${porque}: a empresa está em modo somente leitura. Nada foi apagado — o dono reativa em Acesso → Plano.` };
  }
  if (estado === "carencia") return { tom: "atencao", texto: "A última cobrança falhou. O acesso continua normal por alguns dias — o dono atualiza o cartão em Acesso → Plano." };
  if (estado === "trial" && e.trialAte != null) {
    const dias = Math.ceil((e.trialAte - agora) / DIA);
    if (dias <= 3) return { tom: "atencao", texto: `O teste grátis termina em ${dias <= 1 ? "1 dia" : `${dias} dias`}. Para continuar gravando, o dono assina em Acesso → Plano.` };
  }
  return null;
}
