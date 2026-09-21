"use client";

import { useState } from "react";

/**
 * O formulário tem alteração não salva?
 *
 * Guarda uma foto do valor na primeira pintura e compara com o valor de agora.
 * Passe UM objeto com só os campos que a pessoa edita (não o estado de
 * "salvando", "erro" ou de expandir seções: esses mudam sem que ela tenha
 * digitado nada e fariam o formulário parecer sujo).
 *
 * Serve de entrada pro `confirmarDescarte` do Modal: Escape, clique no fundo e o
 * botão Cancelar só perguntam quando há o que perder. Formulário intacto fecha
 * direto, sem pergunta desnecessária.
 */
export function useFormularioSujo(valor: unknown): boolean {
  const [aoAbrir] = useState(() => JSON.stringify(valor));
  return JSON.stringify(valor) !== aoAbrir;
}
