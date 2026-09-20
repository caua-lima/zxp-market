import { describe, expect, it } from "vitest";
import {
  MAX_TOKENS_POR_LOTE,
  classificarErroFcm,
  dividirEmLotes,
  mapearRespostas,
  ttlSegundos,
} from "./push-envio";
import {
  ORCAMENTO_DATA_BYTES,
  ajustarAoOrcamento,
  bytesUtf8,
  serializarPayload,
  tamanhoDoData,
  truncarUnicode,
} from "./push-payload";
import type { SalePushPayload } from "./notifications";

describe("dividirEmLotes — 501 aparelhos não podem derrubar o envio", () => {
  const dispositivos = (n: number) => Array.from({ length: n }, (_, i) => `tok-${i}`);

  it("até 500 cabe num lote só", () => {
    expect(dividirEmLotes(dispositivos(500))).toHaveLength(1);
  });

  it("501 vira dois lotes: 500 + 1", () => {
    const lotes = dividirEmLotes(dispositivos(501));
    expect(lotes.map((l) => l.length)).toEqual([500, 1]);
  });

  it("1200 vira 500 + 500 + 200, sem perder nem repetir ninguém", () => {
    const todos = dispositivos(1200);
    const lotes = dividirEmLotes(todos);
    expect(lotes.map((l) => l.length)).toEqual([500, 500, 200]);
    expect(lotes.flat()).toEqual(todos);
  });

  it("nenhum lote passa do teto do FCM", () => {
    for (const l of dividirEmLotes(dispositivos(2345))) expect(l.length).toBeLessThanOrEqual(MAX_TOKENS_POR_LOTE);
  });

  it("vazio: nenhum lote", () => {
    expect(dividirEmLotes([])).toEqual([]);
  });
});

describe("ttlSegundos — o provedor descarta o que já não vale", () => {
  const AGORA = 1_800_000_000_000;

  it("é o que RESTA da validade, não a validade cheia", () => {
    expect(ttlSegundos(AGORA, AGORA + 3600_000)).toBe(3600);
    expect(ttlSegundos(AGORA + 5 * 3600_000, AGORA + 6 * 3600_000)).toBe(3600);
  });

  it("validade vencida: zero, e quem chama expira em vez de enviar", () => {
    expect(ttlSegundos(AGORA, AGORA - 1)).toBe(0);
  });

  it("arredonda pra baixo — nunca promete mais do que resta", () => {
    expect(ttlSegundos(AGORA, AGORA + 1999)).toBe(1);
  });
});

describe("classificarErroFcm", () => {
  it("token morto", () => {
    expect(classificarErroFcm("messaging/registration-token-not-registered")).toBe("token_invalido");
    expect(classificarErroFcm("messaging/invalid-registration-token")).toBe("token_invalido");
  });

  it("a mensagem não passa, repetir não adianta", () => {
    expect(classificarErroFcm("messaging/invalid-argument")).toBe("permanente");
    expect(classificarErroFcm("messaging/payload-size-limit-exceeded")).toBe("permanente");
  });

  it("indisponibilidade e quota são transitórias", () => {
    for (const c of ["messaging/server-unavailable", "messaging/internal-error", "messaging/quota-exceeded", "messaging/message-rate-exceeded"]) {
      expect(classificarErroFcm(c), c).toBe("transitorio");
    }
  });

  it("código ausente ou desconhecido: transitório — o teto de tentativas é que encerra", () => {
    expect(classificarErroFcm(undefined)).toBe("transitorio");
    expect(classificarErroFcm("messaging/algo-novo")).toBe("transitorio");
  });
});

describe("mapearRespostas — cada resposta volta pro SEU destino", () => {
  const destinos = ["a", "b", "c", "d"].map((id) => ({ id }));

  it("mistura de aceito, transitório e token morto, por posição", () => {
    const r = mapearRespostas(destinos, [
      { success: true, messageId: "m-a" },
      { success: false, error: { code: "messaging/internal-error" } },
      { success: false, error: { code: "messaging/registration-token-not-registered" } },
      { success: true, messageId: "m-d" },
    ]);
    expect(r.map((x) => [x.destino.id, x.classe])).toEqual([
      ["a", "aceito"], ["b", "transitorio"], ["c", "token_invalido"], ["d", "aceito"],
    ]);
    expect(r[0].messageId).toBe("m-a");
    expect(r[1].codigo).toBe("messaging/internal-error");
  });

  it("número de respostas diferente do de destinos: NADA é dado como aceito", () => {
    const r = mapearRespostas(destinos, [{ success: true }, { success: true }]);
    expect(r.every((x) => x.classe === "transitorio")).toBe(true);
    expect(r[0].codigo).toBe("resposta_incompleta");
  });
});

describe("truncarUnicode — corta em bytes sem quebrar o texto", () => {
  it("texto que cabe volta intacto", () => {
    expect(truncarUnicode("Nova venda", 100)).toBe("Nova venda");
  });

  it("nunca passa do limite, contando UTF-8", () => {
    const texto = "ção".repeat(200);
    const r = truncarUnicode(texto, 50);
    expect(bytesUtf8(r)).toBeLessThanOrEqual(50);
    expect(r.endsWith("…")).toBe(true);
  });

  it("não parte emoji: nenhum par substituto solto", () => {
    const texto = "🎉".repeat(100);
    for (const max of [10, 11, 12, 13, 14, 15, 33]) {
      const r = truncarUnicode(texto, max);
      expect(r, `max ${max}`).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
      expect(bytesUtf8(r)).toBeLessThanOrEqual(max);
    }
  });

  it("não separa emoji composto (família, bandeira) do seu final", () => {
    const familia = "👨‍👩‍👧";
    const r = truncarUnicode(familia.repeat(20), 40);
    // cada grafema tem 18 bytes; o corte só pode cair entre eles.
    const semReticencias = r.replace(/…$/, "");
    expect(semReticencias.length % familia.length).toBe(0);
  });

  it("acento combinado (e + ´) fica com a letra", () => {
    const r = truncarUnicode("é".repeat(50), 30);
    expect(r.replace(/…$/, "").length % 2).toBe(0);
  });

  it("limite pequeno demais: string vazia, não lixo", () => {
    expect(truncarUnicode("abcdef", 1)).toBe("");
  });

  it("aspas e quebras de linha custam o escape do JSON", () => {
    const r = truncarUnicode('"'.repeat(100), 20);
    expect(bytesUtf8(JSON.stringify(r)) - 2).toBeLessThanOrEqual(20);
  });
});

describe("ajustarAoOrcamento — o payload cabe nos 4096 bytes do FCM", () => {
  function base(over: Partial<SalePushPayload> = {}): Record<string, string> {
    return serializarPayload({
      eventId: "sale_paid:2000123456", type: "sale_paid", title: "Nova venda confirmada", body: "Menta Stronger · R$ 129,90",
      tag: "sale-2000123456", orderId: "2000123456", deepLink: "/?tab=pedidos&order=2000123456",
      productName: "Menta Stronger", timestamp: "2026-09-20T12:00:00.000Z", ...over,
    });
  }

  it("payload comum passa sem corte", () => {
    const r = ajustarAoOrcamento(base());
    expect(r.cortes).toEqual([]);
    expect(r.data).toEqual(base());
  });

  it("15 itens de nome ACENTUADO e longo (o caso que passava em ASCII e estourava em produção)", () => {
    const itens = Array.from({ length: 15 }, (_, i) => ({ title: `Cápsulas de Açaí com Guaraná e Ginseng Concentrado nº ${i} — edição especial ção`.repeat(2), quantity: i + 1 }));
    const data = base({ itensJson: JSON.stringify(itens) });
    expect(tamanhoDoData(data)).toBeGreaterThan(ORCAMENTO_DATA_BYTES); // o cenário precisa ser real
    const r = ajustarAoOrcamento(data);
    expect(tamanhoDoData(r.data)).toBeLessThanOrEqual(ORCAMENTO_DATA_BYTES);
    expect(r.cortes).toContain("itensJson");
  });

  it("o que fica de itensJson continua sendo JSON válido", () => {
    const itens = Array.from({ length: 15 }, (_, i) => ({ title: "Produto acentuado ção ".repeat(20) + i, quantity: 1 }));
    const r = ajustarAoOrcamento(base({ itensJson: JSON.stringify(itens) }));
    if (r.data.itensJson) expect(Array.isArray(JSON.parse(r.data.itensJson))).toBe(true);
  });

  it("corpo gigante é cortado por último e termina em reticências", () => {
    const r = ajustarAoOrcamento(base({ body: "Pedido com muitos produtos: ção ".repeat(400) }));
    expect(tamanhoDoData(r.data)).toBeLessThanOrEqual(ORCAMENTO_DATA_BYTES);
    expect(r.cortes).toContain("body");
    expect(r.data.body.endsWith("…")).toBe(true);
  });

  it("emoji no corpo: o corte não quebra nenhum", () => {
    const r = ajustarAoOrcamento(base({ body: "🎉 Meta batida! ".repeat(400) }));
    expect(r.data.body).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    expect(tamanhoDoData(r.data)).toBeLessThanOrEqual(ORCAMENTO_DATA_BYTES);
  });

  it("os campos que fazem o aparelho funcionar nunca são tocados", () => {
    const r = ajustarAoOrcamento(base({ body: "x".repeat(9000), itensJson: JSON.stringify(Array(15).fill({ title: "y".repeat(400), quantity: 1 })) }));
    const original = base();
    for (const campo of ["eventId", "type", "tag", "deepLink", "timestamp"]) expect(r.data[campo]).toBe(original[campo]);
  });

  it("título e produto gigantes também são contidos", () => {
    const r = ajustarAoOrcamento(base({ title: "T".repeat(5000), productName: "P".repeat(5000) }));
    expect(tamanhoDoData(r.data)).toBeLessThanOrEqual(ORCAMENTO_DATA_BYTES);
  });

  it("mesmo no pior caso o resultado cabe com folga sob os 4096 do FCM", () => {
    const r = ajustarAoOrcamento(base({ title: "T".repeat(9000), body: "B".repeat(9000), productName: "P".repeat(9000), itensJson: "[".repeat(9000) }));
    expect(tamanhoDoData(r.data)).toBeLessThan(4096);
  });
});
