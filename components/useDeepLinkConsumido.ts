"use client";

import { useEffect, useRef } from "react";
import { decidirAberturaDoLink } from "@/lib/domain/deep-link-consumo";

/**
 * Abre o item de um deep link UMA vez por navegação. Ver
 * `lib/domain/deep-link-consumo` pro porquê e pra regra.
 *
 * `abrir` é chamado no efeito (é a reação a um evento — chegou o link e o item
 * apareceu), e o estado de "já consumi" vive numa ref: ele não desenha nada.
 */
export function useDeepLinkConsumido(
  id: string | undefined,
  chaveDeNavegacao: number,
  pronto: boolean,
  abrir: (id: string) => void,
) {
  const consumida = useRef<string | null>(null);
  useEffect(() => {
    const d = decidirAberturaDoLink({ consumida: consumida.current, id, chaveDeNavegacao, pronto });
    consumida.current = d.consumida;
    if (d.abrir && id) abrir(id);
  }, [id, chaveDeNavegacao, pronto, abrir]);
}
