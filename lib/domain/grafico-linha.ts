/**
 * Geometria do gráfico de linhas do painel "Ao vivo" — pura, pra ser testada
 * sem desenhar nada.
 *
 * Duas coisas que o SVG não faz sozinho: escolher uma escala "redonda" (o eixo
 * vai a 800, não a 723) e suavizar a linha sem fazê-la mergulhar abaixo de
 * zero entre dois pontos (vendas negativas não existem — uma curva que passa
 * de 0 pra baixo mente).
 */

export type Ponto = { x: number; y: number };

/**
 * Escala com `max` redondo e marcas igualmente espaçadas.
 *
 * O passo é 1, 2 ou 5 vezes uma potência de dez — é o que o olho lê sem
 * esforço (0, 200, 400…) em vez de 0, 181, 362…
 */
export function escalaRedonda(maximo: number, marcas = 4): { max: number; passos: number[] } {
  const alvo = Number.isFinite(maximo) && maximo > 0 ? maximo : 1;
  const bruto = alvo / Math.max(marcas, 1);
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const f = bruto / potencia;
  const passo = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * potencia;
  const n = Math.max(Math.ceil(alvo / passo - 1e-9), 1);
  return { max: n * passo, passos: Array.from({ length: n + 1 }, (_, i) => i * passo) };
}

const r = (v: number) => Math.round(v * 100) / 100;

/**
 * Curva suave por INTERPOLAÇÃO MONÓTONA (Fritsch–Carlson): passa por todos os
 * pontos e nunca ultrapassa o menor nem o maior vizinho — sem "barriga" abaixo
 * do eixo nem acima do pico, que é o que uma curva de Catmull-Rom faz.
 * Pontos precisam vir em x crescente.
 */
export function caminhoSuave(pontos: readonly Ponto[]): string {
  const n = pontos.length;
  if (n === 0) return "";
  if (n === 1) return `M${r(pontos[0].x)} ${r(pontos[0].y)}`;

  const dx = Array.from({ length: n - 1 }, (_, i) => pontos[i + 1].x - pontos[i].x);
  const m = Array.from({ length: n - 1 }, (_, i) => (dx[i] === 0 ? 0 : (pontos[i + 1].y - pontos[i].y) / dx[i]));

  // Inclinação em cada ponto: média dos vizinhos, zero nos picos e vales.
  const t = new Array<number>(n);
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;

  // Limita pra não passar do que os segmentos permitem.
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const h = Math.hypot(a, b);
    if (h > 3) { t[i] = (3 * a * m[i]) / h; t[i + 1] = (3 * b * m[i]) / h; }
  }

  let d = `M${r(pontos[0].x)} ${r(pontos[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pontos[i];
    const p1 = pontos[i + 1];
    const h = dx[i] / 3;
    d += ` C${r(p0.x + h)} ${r(p0.y + t[i] * h)} ${r(p1.x - h)} ${r(p1.y - t[i + 1] * h)} ${r(p1.x)} ${r(p1.y)}`;
  }
  return d;
}
