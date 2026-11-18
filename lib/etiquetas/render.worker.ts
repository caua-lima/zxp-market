/// <reference lib="webworker" />
/**
 * O motor ZPL roda aqui, fora da tela: carregar 7 MB de WASM e desenhar 19
 * etiquetas não pode travar o clique da pessoa. Uma etiqueta por vez (o
 * runtime Go do WASM é de uma linha só), na ordem em que chegam.
 */
import { init, zplToBase64Async } from "zpl-renderer-js/external";
import { ALTURA_MM, DPMM, LARGURA_MM, URL_DO_MOTOR, normalizarParaRender } from "./render";

type Pedido = { id: number; zpl: string };
type Resposta = { id: number; png: string } | { id: number; erro: string };

let motor: Promise<unknown> | null = null;
let fila: Promise<void> = Promise.resolve();

function carregarMotor(): Promise<unknown> {
  if (!motor) {
    motor = init({ wasmUrl: URL_DO_MOTOR }).catch((e: unknown) => {
      motor = null; // deixa tentar de novo na próxima etiqueta
      throw e;
    });
  }
  return motor;
}

self.onmessage = (ev: MessageEvent<Pedido>) => {
  const { id, zpl } = ev.data;
  fila = fila.then(async () => {
    let r: Resposta;
    try {
      await carregarMotor();
      const png = await zplToBase64Async(normalizarParaRender(zpl), LARGURA_MM, ALTURA_MM, DPMM);
      r = { id, png };
    } catch (e) {
      r = { id, erro: e instanceof Error ? e.message : String(e) };
    }
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(r);
  });
};
