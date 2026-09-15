import { describe, expect, it } from "vitest";
import {
  decidirRetry,
  esperaDoRecuo,
  ESPERA_MAXIMA_MS,
  lerRetryAfter,
  MAX_TENTATIVAS,
  statusEhRepetivel,
} from "./retry-http";

const AGORA = Date.parse("2026-09-15T12:00:00Z");
/** Ruido fixo, pra a espera nao depender de Math.random no teste. */
const semRuido = () => 0;

describe("o que se repete e o que nao", () => {
  it("erro de cliente NAO se repete — insistir nao muda a resposta", () => {
    /**
     * 400, 401, 403 e 404 nao mudam por insistencia. Repetir so gasta quota e
     * atrasa a rodada.
     */
    for (const s of [400, 401, 403, 404, 422]) {
      expect(decidirRetry({ status: s, tentativa: 1 }), String(s))
        .toEqual({ repetir: false, motivo: "erro_definitivo" });
    }
  });

  it("429 se repete — e um pedido explicito pra tentar depois", () => {
    const r = decidirRetry({ status: 429, tentativa: 1, aleatorio: semRuido });
    expect(r.repetir).toBe(true);
  });

  it("5xx se repete", () => {
    for (const s of [500, 502, 503, 504]) {
      expect(decidirRetry({ status: s, tentativa: 1, aleatorio: semRuido }).repetir, String(s)).toBe(true);
    }
  });

  it("rede caida ou timeout estourado se repete", () => {
    // `status: null` = a chamada nem chegou a responder.
    expect(decidirRetry({ status: null, tentativa: 1, aleatorio: semRuido }).repetir).toBe(true);
  });

  it("sucesso nao repete", () => {
    for (const s of [200, 201, 204]) {
      expect(decidirRetry({ status: s, tentativa: 1 }), String(s))
        .toEqual({ repetir: false, motivo: "sucesso" });
    }
  });

  it("acabadas as tentativas, para", () => {
    expect(decidirRetry({ status: 503, tentativa: MAX_TENTATIVAS }))
      .toEqual({ repetir: false, motivo: "sem_tentativas" });
  });

  it("statusEhRepetivel cobre a lista", () => {
    expect(statusEhRepetivel(429)).toBe(true);
    expect(statusEhRepetivel(408)).toBe(true);
    expect(statusEhRepetivel(404)).toBe(false);
  });
});

describe("Retry-After — o servidor manda", () => {
  it("em segundos", () => {
    expect(lerRetryAfter("30", AGORA)).toBe(30_000);
    expect(lerRetryAfter("0", AGORA)).toBe(0);
  });

  it("como data HTTP", () => {
    expect(lerRetryAfter("Tue, 15 Sep 2026 12:00:05 GMT", AGORA)).toBe(5000);
  });

  it("data no passado significa 'pode agora'", () => {
    expect(lerRetryAfter("Tue, 15 Sep 2026 11:59:00 GMT", AGORA)).toBe(0);
  });

  it("ausente ou ilegivel devolve null — quem chama usa a espera calculada", () => {
    expect(lerRetryAfter(null, AGORA)).toBeNull();
    expect(lerRetryAfter("", AGORA)).toBeNull();
    expect(lerRetryAfter("logo", AGORA)).toBeNull();
  });

  it("o cabecalho VENCE a espera calculada", () => {
    /**
     * Esperar menos do que o servidor pediu e insistir contra um limite que ele
     * acabou de comunicar — o caminho mais rapido pra um bloqueio mais longo.
     */
    const r = decidirRetry({ status: 429, tentativa: 1, retryAfter: "5", agora: AGORA, aleatorio: semRuido });
    expect(r).toMatchObject({ repetir: true, esperarMs: 5000 });
  });

  it("Retry-After absurdo e limitado — senao trava a funcao", () => {
    const r = decidirRetry({ status: 429, tentativa: 1, retryAfter: "3600", agora: AGORA });
    expect(r).toMatchObject({ repetir: true, esperarMs: ESPERA_MAXIMA_MS });
  });
});

describe("recuo exponencial com ruido", () => {
  it("dobra a cada tentativa", () => {
    expect(esperaDoRecuo(1, semRuido)).toBe(500);
    expect(esperaDoRecuo(2, semRuido)).toBe(1000);
    expect(esperaDoRecuo(3, semRuido)).toBe(2000);
  });

  it("nunca passa do teto", () => {
    expect(esperaDoRecuo(20, semRuido)).toBe(ESPERA_MAXIMA_MS);
    expect(esperaDoRecuo(20, () => 1)).toBe(ESPERA_MAXIMA_MS);
  });

  it("o ruido separa as chamadas paralelas", () => {
    /**
     * O sync dispara oito chamadas em paralelo. Sem ruido, as oito falhariam
     * juntas e voltariam juntas, batendo no mesmo limite de novo — um comboio
     * que se auto-perpetua.
     */
    expect(esperaDoRecuo(1, () => 0)).toBe(500);
    expect(esperaDoRecuo(1, () => 1)).toBe(625);
  });

  it("tentativa zero ou negativa nao vira espera negativa", () => {
    expect(esperaDoRecuo(0, semRuido)).toBeGreaterThanOrEqual(0);
    expect(esperaDoRecuo(-3, semRuido)).toBeGreaterThanOrEqual(0);
  });
});
