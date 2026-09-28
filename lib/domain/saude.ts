/**
 * Saúde da operação de UMA empresa (Etapa 4 — observabilidade por empresa).
 *
 * Com várias empresas, "o cron rodou?" vira "o cron rodou PRA CADA UMA?". Os
 * sinais já existiam espalhados (carimbo do cron e do worker, inbox do webhook,
 * entregas de push); aqui eles viram um veredito por item, igual pra a tela do
 * dono e pro script que varre todas as empresas (scripts/saude-das-empresas.mjs).
 *
 * Autossuficiente (sem `@/`): o script importa direto pelo Node.
 */

export type SinaisDeSaude = {
  agora: number;
  cronEm: number | null;
  workerEm: number | null;
  mlConectado: boolean;
  inboxPendentes: number;
  inboxFalhas: number;
  entregasPendentes: number;
  /** Respostas ruins do ML nos últimos 7 dias. */
  ml429: number;
  ml5xx: number;
  mlTimeouts: number;
  bloqueada: boolean;
};

export type Nivel = "ok" | "atencao" | "falha";
export type ItemDeSaude = { id: string; titulo: string; nivel: Nivel; texto: string };

const HORA = 3_600_000;

function haQuanto(ms: number): string {
  const h = Math.round(ms / HORA);
  return h < 1 ? "há menos de 1 h" : h < 48 ? `há ${h} h` : `há ${Math.round(h / 24)} dias`;
}

export function avaliarSaude(s: SinaisDeSaude): ItemDeSaude[] {
  const itens: ItemDeSaude[] = [];

  // Cron diário: roda uma vez por dia; mais de 26 h sem rodar é atraso, mais de 50 h é falha.
  const idadeCron = s.cronEm == null ? null : s.agora - s.cronEm;
  itens.push({
    id: "cron",
    titulo: "Rotina diária",
    nivel: idadeCron == null ? "atencao" : idadeCron > 50 * HORA ? "falha" : idadeCron > 26 * HORA ? "atencao" : "ok",
    texto: idadeCron == null ? "Ainda não rodou para esta empresa." : `Última execução ${haQuanto(idadeCron)}.`,
  });

  // Worker a cada 5 min (GitHub Actions): 30 min sem rodar já é sinal; 3 h, falha.
  const idadeWorker = s.workerEm == null ? null : s.agora - s.workerEm;
  itens.push({
    id: "worker",
    titulo: "Rotina de 5 minutos",
    nivel: idadeWorker == null ? "atencao" : idadeWorker > 3 * HORA ? "falha" : idadeWorker > 0.5 * HORA ? "atencao" : "ok",
    texto: idadeWorker == null ? "Ainda não rodou — o segredo CRON_SECRET está no GitHub?" : `Última execução ${haQuanto(idadeWorker)}.`,
  });

  itens.push({
    id: "ml",
    titulo: "Conta do Mercado Livre",
    nivel: s.mlConectado ? "ok" : "falha",
    texto: s.mlConectado ? "Conectada." : "Desconectada: vendas novas não entram.",
  });

  itens.push({
    id: "inbox",
    titulo: "Notificações de venda",
    nivel: s.inboxFalhas > 0 ? "falha" : s.inboxPendentes > 20 ? "atencao" : "ok",
    texto: s.inboxFalhas > 0
      ? `${s.inboxFalhas} notificação(ões) desistida(s) depois de várias tentativas.`
      : s.inboxPendentes > 0 ? `${s.inboxPendentes} na fila.` : "Fila vazia.",
  });

  itens.push({
    id: "push",
    titulo: "Avisos no celular",
    nivel: s.entregasPendentes > 50 ? "atencao" : "ok",
    texto: s.entregasPendentes > 0 ? `${s.entregasPendentes} entrega(s) aguardando nova tentativa.` : "Nada pendente.",
  });

  const ruins = s.ml429 + s.ml5xx + s.mlTimeouts;
  itens.push({
    id: "ml_api",
    titulo: "API do Mercado Livre (7 dias)",
    nivel: s.ml429 > 200 || s.ml5xx > 200 ? "falha" : ruins > 50 ? "atencao" : "ok",
    texto: ruins === 0 ? "Sem limite de uso nem erro do ML." : `${s.ml429} limite de uso (429), ${s.ml5xx} erro do ML (5xx), ${s.mlTimeouts} sem resposta.`,
  });

  if (s.bloqueada) {
    itens.push({ id: "assinatura", titulo: "Assinatura", nivel: "falha", texto: "Empresa em modo somente leitura: as rotinas estão paradas." });
  }
  return itens;
}

export function nivelGeral(itens: ItemDeSaude[]): Nivel {
  return itens.some((i) => i.nivel === "falha") ? "falha" : itens.some((i) => i.nivel === "atencao") ? "atencao" : "ok";
}

/** Os últimos N dias (AAAA-MM-DD, fuso de Brasília), pra ler os contadores diários. */
export function diasAte(agora: number, n: number): string[] {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
  return Array.from({ length: n }, (_, i) => fmt.format(new Date(agora - i * 86_400_000)));
}
