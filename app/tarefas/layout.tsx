import type { Metadata } from "next";

/**
 * O app de tarefas tem nome e manifesto próprios — é o que faz o celular
 * instalar "ZXP Tarefas" separado do painel (ver manifest.webmanifest/route.ts).
 */
export const metadata: Metadata = {
  title: "ZXP Tarefas",
  description: "As tarefas da equipe: o que fazer hoje e na semana.",
  manifest: "/tarefas/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ZXP Tarefas",
  },
};

export default function LayoutDasTarefas({ children }: { children: React.ReactNode }) {
  return children;
}
