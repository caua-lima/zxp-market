"use client";

import { MARCA_DOURADO, MARCA_ONYX } from "@/lib/marca";

/**
 * Logomark oficial da ZXP Solutions.
 *
 * O desenho vem do arquivo de marca (public/marca/zxp-icone-dourado-onyx.svg):
 * uma POLILINHA com traço grosso e cantos retos (miter), não um polígono
 * preenchido. A versão anterior aqui era uma aproximação desenhada à mão, com
 * dez vértices tentando imitar o traço — o peso das hastes e o ângulo da
 * diagonal não batiam com a marca real.
 *
 * `viewBox` 0 0 200 200 e as coordenadas são as do arquivo original, sem
 * reescalar: qualquer conversão manual aqui reintroduziria o mesmo desvio.
 *
 * Sem gradiente e sem detalhe fino de propósito — a marca tem que ler igual
 * em 16px (favicon) e em 512px (ícone de app).
 */
/**
 * @param radius raio dos cantos NA ESCALA DO viewBox (0-200). O padrão 44 é o
 *   do guia de identidade. Antes o valor chegava na escala 0-100 e era
 *   dobrado aqui dentro, o que dava 48 no padrão — perto de 44, e diferente.
 *   Ninguém passava o parâmetro, então a conversão só existia pra manter um
 *   uso histórico que já não havia.
 */
export function ZxpMark({ size = 30, radius = 44 }: { size?: number; radius?: number }) {
  const rx = radius;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      style={{ flexShrink: 0, display: "block" }}
      aria-hidden="true"
      focusable="false"
    >
      <rect width="200" height="200" rx={rx} fill={MARCA_ONYX} />
      <polyline
        points="30,47 170,47 30,153 170,153"
        fill="none"
        stroke={MARCA_DOURADO}
        strokeWidth="34"
        strokeLinejoin="miter"
        strokeLinecap="butt"
      />
    </svg>
  );
}
