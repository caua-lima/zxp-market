/**
 * O alarme do PC: bipes altos, alternando tons, até a extensão fechar este
 * documento ("Parar alarme" na janelinha, clique na notificação ou "Parar o
 * alarme" no app). Abriu = tocando; fechou = silêncio. O volume do Windows
 * manda: com o PC no mudo, não há o que fazer daqui.
 */
const contexto = new AudioContext();

function bipe(freq, inicio, duracao) {
  const osc = contexto.createOscillator();
  const ganho = contexto.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  ganho.gain.setValueAtTime(0.0001, inicio);
  ganho.gain.exponentialRampToValueAtTime(1, inicio + 0.01);
  ganho.gain.setValueAtTime(1, inicio + duracao - 0.02);
  ganho.gain.exponentialRampToValueAtTime(0.0001, inicio + duracao);
  osc.connect(ganho).connect(contexto.destination);
  osc.start(inicio);
  osc.stop(inicio + duracao);
}

function rodada() {
  const t = contexto.currentTime + 0.05;
  // "BI-BI-BI-BIIIP", estilo despertador.
  for (let i = 0; i < 3; i++) bipe(i % 2 ? 1320 : 990, t + i * 0.22, 0.16);
  bipe(1480, t + 0.7, 0.6);
}

(async () => {
  if (contexto.state === "suspended") await contexto.resume();
  rodada();
  setInterval(rodada, 1600);
})();
