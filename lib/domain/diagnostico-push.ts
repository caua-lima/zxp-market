import type { StatusEntrega } from "@/lib/domain/entrega-destino";

/**
 * Traduz o que o OUTBOX registrou de um envio de teste em algo que a pessoa
 * entende e sabe o que fazer.
 *
 * ─── O QUE ESTAVA ERRADO ────────────────────────────────────────────────
 *
 * O teste devolvia "quantos aparelhos receberam" e, quando era zero, uma única
 * frase: "nenhum dispositivo seu está registrado". Zero aceitos tem várias causas
 * com correções OPOSTAS — aparelho sem registro, acesso removido, token que o
 * Firebase recusou, Firebase instável, preferência — e a frase mandava
 * reinstalar o app em todos os casos, o que apaga dados do aparelho e não
 * corrige um erro do servidor.
 *
 * O envio de teste agora vai só pro aparelho que o pediu, e o resultado é o de
 * ESSE aparelho.
 */

export type DestinoDoTeste = {
  /** Este é o aparelho que pediu o teste? */
  este: boolean;
  status: StatusEntrega;
  motivo?: string;
  /** Código de erro do provedor (nunca token nem e-mail). */
  erro?: string;
};

export type ResultadoDoTeste = {
  resultado: "aceito" | "pendente" | "suprimido" | "falha" | "sem_registro";
  /** O que aconteceu e o que fazer. */
  explicacao: string;
};

const PASSOS_APOS_ACEITE =
  "Se mesmo assim nada aparecer na barra, a causa está no aparelho: permissão do sistema, "
  + "Service Worker antigo ou economia de bateria — o botão 🩺 verifica cada um. Reinstalar o app não deve ser o primeiro passo.";

/**
 * O veredito do teste. Se `alvoEspecifico` (o aparelho que pediu foi identificado),
 * só o destino dele conta; senão, vale o melhor resultado entre os aparelhos da pessoa.
 */
export function explicarTeste(destinos: DestinoDoTeste[], alvoEspecifico: boolean): ResultadoDoTeste {
  const consideradas = alvoEspecifico ? destinos.filter((d) => d.este) : destinos;

  if (consideradas.length === 0) {
    return {
      resultado: "sem_registro",
      explicacao: alvoEspecifico
        ? "Este aparelho não tem registro de notificação no servidor. Toque em 📱 para ativar e repita o teste."
        : "Nenhum aparelho seu está registrado. Toque em 📱 no aparelho que quer usar e repita o teste.",
    };
  }

  if (consideradas.some((d) => d.status === "accepted")) {
    return {
      resultado: "aceito",
      explicacao: `O servidor entregou a mensagem ao Firebase. ${PASSOS_APOS_ACEITE}`,
    };
  }

  const pendente = consideradas.find((d) => d.status === "pending" || d.status === "leased" || d.status === "retry_scheduled");
  if (pendente) {
    return {
      resultado: "pendente",
      explicacao: "O Firebase não aceitou na primeira tentativa (instabilidade passageira). O servidor tenta de novo sozinho nos próximos minutos — não precisa repetir o teste agora.",
    };
  }

  const falha = consideradas.find((d) => d.status === "permanent_failure");
  if (falha) {
    if (falha.motivo === "token_invalido") {
      return {
        resultado: "falha",
        explicacao: "O Firebase recusou o token deste aparelho (expirou ou foi revogado). Desative e ative de novo em 📱 para gerar um novo — reinstalar o app não é necessário.",
      };
    }
    if (falha.motivo === "tentativas_esgotadas") {
      return { resultado: "falha", explicacao: `O Firebase falhou em todas as tentativas (${falha.erro ?? "erro desconhecido"}). É do lado do servidor ou do provedor; tente de novo mais tarde.` };
    }
    return { resultado: "falha", explicacao: `O Firebase recusou a mensagem (${falha.erro ?? "erro desconhecido"}). Isso é do servidor, não do aparelho.` };
  }

  const suprimido = consideradas.find((d) => d.status === "suppressed");
  if (suprimido) {
    const porMotivo: Record<string, string> = {
      sem_acesso: "Seu acesso a este app não foi encontrado — peça ao dono para conferir sua conta em Acesso.",
      destino_removido: "O registro deste aparelho foi removido entre o pedido e o envio. Ative de novo em 📱.",
    };
    return {
      resultado: "suprimido",
      explicacao: porMotivo[suprimido.motivo ?? ""] ?? "O envio foi bloqueado por uma regra do servidor.",
    };
  }

  return { resultado: "falha", explicacao: "O envio expirou antes de sair. Repita o teste." };
}

// ── O diagnóstico completo, por camada ──────────────────────────────────

/**
 * "Não chega notificação" atravessa camadas independentes, e cada uma pede uma
 * correção diferente:
 *
 *   1. este APARELHO (suporte, permissão, Service Worker);
 *   2. o VÍNCULO deste aparelho com a sua conta (e o registro no servidor);
 *   3. a sua CONTA (acesso, preferências);
 *   4. os seus OUTROS aparelhos (não contam pra este);
 *   5. o SERVIDOR e o Firebase (o que ele aceitou, recusou ou está tentando);
 *   6. o que o aparelho OBSERVOU (o Service Worker recebeu? exibiu?).
 *
 * O diagnóstico anterior misturava tudo numa lista de frases e, quando não achava
 * nada, mandava reinstalar o app — que apaga o armazenamento do aparelho e não
 * corrige um erro do servidor. Aqui cada camada diz o que sabe e o que NÃO sabe.
 */

export type DiagnosticoLocal = {
  suportado: boolean;
  permissao: "granted" | "denied" | "default" | "indisponivel";
  /** O app está instalado (tela inicial / janela própria)? */
  standalone: boolean;
  ios: boolean;
  swRegistrado: boolean;
  /** Versão que o Service Worker ATIVO respondeu; `null` = não respondeu (antigo ou ausente). */
  swVersao: string | null;
  swEsperada: string;
  vinculo: "ativo" | "outra_pessoa" | "sem_vinculo";
  /** O token de agora é o guardado no vínculo? `null` = não deu pra verificar. */
  tokenConfere: boolean | null;
  /** O servidor tem o registro deste aparelho? `null` = não deu pra verificar. */
  registroNoServidor: boolean | null;
  /** O último push que o Service Worker deste aparelho registrou. */
  ultimoRecebimento: { eventId: string; tipo: string; recebidoEm: number; exibidoEm: number | null; erro: string | null } | null;
};

export type DiagnosticoServidor = {
  acesso: "ok" | "sem_acesso";
  preferencias: "ok" | "ausente" | "invalida" | "indisponivel";
  /** Quantos aparelhos SEUS estão registrados, e se ESTE é um deles. */
  aparelhos: { total: number; esteRegistrado: boolean | null };
  /** Os últimos envios pra você (sem token, sem e-mail). */
  ultimosEnvios: { status: StatusEntrega; motivo?: string; erro?: string; clicado: boolean }[];
};

export type NivelDaSecao = "ok" | "atencao" | "problema" | "desconhecido";

export type SecaoDoDiagnostico = {
  id: "aparelho" | "vinculo" | "conta" | "outros" | "servidor" | "observado";
  titulo: string;
  nivel: NivelDaSecao;
  linhas: string[];
};

const pior = (a: NivelDaSecao, b: NivelDaSecao): NivelDaSecao => {
  const ordem: NivelDaSecao[] = ["ok", "desconhecido", "atencao", "problema"];
  return ordem.indexOf(a) >= ordem.indexOf(b) ? a : b;
};

/** Monta as seções. `servidor` é `null` quando o servidor não respondeu — e isso é dito, não escondido. */
export function montarDiagnostico(l: DiagnosticoLocal, s: DiagnosticoServidor | null): SecaoDoDiagnostico[] {
  const secoes: SecaoDoDiagnostico[] = [];

  // ── 1. Este aparelho ──
  {
    const linhas: string[] = [];
    let nivel: NivelDaSecao = "ok";
    const marca = (n: NivelDaSecao, texto: string) => { nivel = pior(nivel, n); linhas.push(texto); };

    if (!l.suportado) {
      marca("problema", l.ios
        ? "Este navegador não suporta notificações push. No iPhone/iPad é preciso o iOS 16.4 ou superior."
        : "Este navegador não suporta notificações push.");
    } else {
      if (l.ios && !l.standalone) {
        marca("atencao", "No iPhone/iPad as notificações só funcionam com o app ADICIONADO à Tela de Início (Compartilhar → Adicionar à Tela de Início) e ativadas tocando no botão 📱 dentro do app instalado.");
      }
      if (l.permissao === "denied") {
        marca("problema", "A permissão está BLOQUEADA neste aparelho. O servidor manda e o sistema descarta em silêncio. Libere as notificações do app nas configurações do sistema e ative de novo em 📱.");
      } else if (l.permissao === "default") {
        marca("atencao", "As notificações ainda não foram autorizadas neste aparelho. Toque em 📱 para ativar.");
      } else if (l.permissao === "indisponivel") {
        marca("desconhecido", "Não consegui ler a permissão deste navegador.");
      }
      if (!l.swRegistrado) {
        marca("problema", "Nenhum Service Worker registrado — sem ele não existe notificação na barra. Toque em 📱 para ativar.");
      } else if (l.swVersao == null) {
        marca("atencao", "O Service Worker ativo é ANTIGO (não respondeu à checagem de versão). Desativar e ativar de novo em 📱 troca por um novo na hora — não é preciso reinstalar o app.");
      } else if (l.swVersao !== l.swEsperada) {
        marca("atencao", `Service Worker desatualizado (${l.swVersao}; esperado ${l.swEsperada}). Desativar e ativar em 📱 aplica a versão nova.`);
      }
    }
    if (linhas.length === 0) linhas.push("Suporte, permissão e Service Worker em ordem.");
    secoes.push({ id: "aparelho", titulo: "Este aparelho", nivel, linhas });
  }

  // ── 2. O vínculo ──
  {
    const linhas: string[] = [];
    let nivel: NivelDaSecao = "ok";
    const marca = (n: NivelDaSecao, texto: string) => { nivel = pior(nivel, n); linhas.push(texto); };

    if (l.vinculo === "sem_vinculo") {
      marca("atencao", "Este aparelho não está vinculado à sua conta. Toque em 📱 para ativar.");
    } else if (l.vinculo === "outra_pessoa") {
      marca("problema", "Este aparelho está vinculado a OUTRA conta. Entre com ela, ou ative aqui em 📱 para vincular à sua.");
    } else {
      if (l.registroNoServidor === false || s?.aparelhos.esteRegistrado === false) {
        marca("problema", "O servidor NÃO tem o registro deste aparelho (foi removido, ou o token expirou). Desative e ative de novo em 📱 — reinstalar o app não é necessário.");
      } else if (l.registroNoServidor == null && s == null) {
        marca("desconhecido", "Não consegui confirmar o registro no servidor agora.");
      }
      if (l.tokenConfere === false) {
        marca("atencao", "O token do aparelho mudou desde o último registro. O app reconcilia sozinho ao abrir; se persistir, ative de novo em 📱.");
      }
    }
    if (linhas.length === 0) linhas.push("Este aparelho está vinculado à sua conta e registrado no servidor.");
    secoes.push({ id: "vinculo", titulo: "Vínculo com a sua conta", nivel, linhas });
  }

  // ── 3. A conta ──
  {
    if (s == null) {
      secoes.push({ id: "conta", titulo: "Sua conta", nivel: "desconhecido", linhas: ["O servidor não respondeu — não deu pra conferir acesso e preferências."] });
    } else {
      const linhas: string[] = [];
      let nivel: NivelDaSecao = "ok";
      const marca = (n: NivelDaSecao, texto: string) => { nivel = pior(nivel, n); linhas.push(texto); };
      if (s.acesso === "sem_acesso") marca("problema", "Seu acesso não foi encontrado: o servidor NÃO envia avisos a quem não tem acesso. Peça ao dono para conferir sua conta.");
      if (s.preferencias === "invalida") marca("atencao", "Suas preferências têm campos inválidos que voltaram ao padrão. Abra ⚙ Configurações e salve para corrigir.");
      if (s.preferencias === "indisponivel") marca("atencao", "Não consegui ler suas preferências agora; enquanto isso o push vai sem valores financeiros.");
      if (linhas.length === 0) linhas.push(s.preferencias === "ausente" ? "Acesso em ordem. Você ainda não salvou preferências — vale o padrão." : "Acesso e preferências em ordem.");
      secoes.push({ id: "conta", titulo: "Sua conta", nivel, linhas });
    }
  }

  // ── 4. Outros aparelhos ──
  if (s != null) {
    const outros = Math.max(0, s.aparelhos.total - (s.aparelhos.esteRegistrado ? 1 : 0));
    secoes.push({
      id: "outros", titulo: "Seus outros aparelhos", nivel: "ok",
      linhas: [outros === 0 ? "Você não tem outros aparelhos registrados." : `Você tem ${outros} outro(s) aparelho(s) registrado(s). Eles recebem os avisos por conta própria e não dizem nada sobre ESTE.`],
    });
  }

  // ── 5. O servidor e o Firebase ──
  if (s == null) {
    secoes.push({ id: "servidor", titulo: "Servidor e Firebase", nivel: "desconhecido", linhas: ["Sem resposta do servidor agora."] });
  } else if (s.ultimosEnvios.length === 0) {
    secoes.push({ id: "servidor", titulo: "Servidor e Firebase", nivel: "desconhecido", linhas: ["Nenhum envio recente pra você. Use 🔔 Testar agora para gerar um."] });
  } else {
    const c = { aceito: 0, pendente: 0, suprimido: 0, falha: 0, expirado: 0, clicado: 0 };
    for (const e of s.ultimosEnvios) {
      if (e.status === "accepted") c.aceito++;
      else if (e.status === "suppressed") c.suprimido++;
      else if (e.status === "permanent_failure") c.falha++;
      else if (e.status === "expired") c.expirado++;
      else c.pendente++;
      if (e.clicado) c.clicado++;
    }
    const linhas = [`Dos últimos ${s.ultimosEnvios.length} envios: ${c.aceito} aceito(s) pelo Firebase, ${c.suprimido} suprimido(s) por regra, ${c.pendente} em nova tentativa, ${c.falha} com falha, ${c.expirado} vencido(s); você tocou em ${c.clicado}.`];
    let nivel: NivelDaSecao = "ok";
    if (c.falha > 0) { nivel = "atencao"; linhas.push("Houve envios com falha: se foi token recusado, desative e ative de novo em 📱."); }
    if (c.aceito === 0 && c.suprimido > 0) { nivel = pior(nivel, "atencao"); linhas.push("Nada foi enviado ao Firebase: os avisos foram suprimidos por acesso, preferência ou horário silencioso."); }
    linhas.push("\"Aceito\" quer dizer que o Firebase recebeu a mensagem — não que ela apareceu na tela.");
    secoes.push({ id: "servidor", titulo: "Servidor e Firebase", nivel, linhas });
  }

  // ── 6. O que o aparelho observou ──
  {
    const u = l.ultimoRecebimento;
    if (!u) {
      secoes.push({ id: "observado", titulo: "O que este aparelho observou", nivel: "desconhecido", linhas: ["Este aparelho ainda não registrou nenhum push recebido pelo Service Worker. Use 🔔 Testar agora para verificar."] });
    } else if (u.erro) {
      secoes.push({ id: "observado", titulo: "O que este aparelho observou", nivel: "problema", linhas: [`O Service Worker recebeu o último push mas NÃO conseguiu exibi-lo (${u.erro}). A causa está no aparelho: permissão ou configuração do sistema.`] });
    } else {
      secoes.push({ id: "observado", titulo: "O que este aparelho observou", nivel: "ok", linhas: ["O Service Worker deste aparelho recebeu e exibiu o último push."] });
    }
  }

  return secoes;
}
