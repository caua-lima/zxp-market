"use client";

/**
 * A tela pede "desenhe esta etiqueta" e recebe o PNG (base64). Um Worker só
 * pra página inteira; se ele morrer, o próximo pedido sobe outro.
 */

type Pendente = { resolve: (png: string) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let seq = 0;
const pendentes = new Map<number, Pendente>();

function falharTodos(motivo: string) {
  for (const p of pendentes.values()) p.reject(new Error(motivo));
  pendentes.clear();
}

function oWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL("./render.worker.ts", import.meta.url), { type: "module" });
  w.onmessage = (ev: MessageEvent<{ id: number; png?: string; erro?: string }>) => {
    const p = pendentes.get(ev.data.id);
    if (!p) return;
    pendentes.delete(ev.data.id);
    if (typeof ev.data.png === "string") p.resolve(ev.data.png);
    else p.reject(new Error(ev.data.erro || "falha no motor"));
  };
  w.onerror = (ev) => {
    ev.preventDefault();
    falharTodos(`o motor de etiquetas parou${ev.message ? `: ${ev.message}` : ""}`);
    w.terminate();
    if (worker === w) worker = null;
  };
  worker = w;
  return w;
}

/** PNG (base64, sem o prefixo data:) da etiqueta, 813×1220 px (4×6 pol. a 203 dpi). */
export function renderizarEtiqueta(zpl: string): Promise<string> {
  const id = ++seq;
  return new Promise<string>((resolve, reject) => {
    pendentes.set(id, { resolve, reject });
    try {
      oWorker().postMessage({ id, zpl });
    } catch (e) {
      pendentes.delete(id);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

export function base64ParaBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
