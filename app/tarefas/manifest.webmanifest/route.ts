/**
 * O manifesto do APP DE TAREFAS (/tarefas) — o que o funcionário instala no
 * celular. É um app separado do painel (nome, ícone e tela inicial próprios),
 * mas mora no mesmo site e no mesmo login: nada de outro repositório.
 *
 * `id` próprio pra o navegador não confundir com o painel (que é "/"); o
 * `scope` é o site todo pra o toque numa notificação de tarefa ("/?tab=
 * tarefas&task=…") abrir dentro do app — a raiz manda o Colaborador de volta
 * pra /tarefas levando a tarefa.
 */
export const dynamic = "force-static";

export function GET() {
  const manifesto = {
    id: "/tarefas",
    name: "ZXP Tarefas",
    short_name: "Tarefas",
    description: "As tarefas da equipe: o que fazer hoje e na semana, e avisos de tarefa nova.",
    start_url: "/tarefas",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#10100E",
    theme_color: "#10100E",
    icons: [
      { src: "/manifest-icon-192", sizes: "192x192", type: "image/png" },
      { src: "/manifest-icon-512", sizes: "512x512", type: "image/png" },
    ],
  };
  return new Response(JSON.stringify(manifesto), {
    headers: { "Content-Type": "application/manifest+json; charset=utf-8" },
  });
}
