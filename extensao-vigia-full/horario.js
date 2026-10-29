/**
 * O próximo horário "redondo" da vigia: com 2 min, 12:00, 12:02, 12:04…; com
 * 1 min, todo minuto cheio. Não depende da hora em que a extensão ligou
 * (ligou 12:01:08 → próxima 12:02:00). A margem de 2 s evita conferir duas
 * vezes quando o Chrome acorda um tiquinho antes do horário.
 *
 * Os passos contam do zero do relógio (UTC). O fuso do Brasil é de horas
 * inteiras, então "minuto par" em UTC é minuto par aqui também.
 */
export function proximoHorario(minutos, agora = Date.now()) {
  const passo = minutos * 60_000;
  return Math.floor((agora + 2_000) / passo) * passo + passo;
}
