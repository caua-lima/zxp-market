import type { MetadataRoute } from "next";

// Convenção de arquivo do Next.js: isto vira /manifest.webmanifest e é
// linkado no <head> automaticamente — é o que faz o navegador (Android/
// desktop) oferecer "Instalar app". No iOS quem faz esse papel são as
// meta tags apple-* configuradas em app/layout.tsx, o manifest sozinho
// não é suficiente lá.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ZXP Market — Dashboard VAZXPRESS",
    short_name: "ZXP Market",
    description: "ZXP Market — dashboard financeiro e operacional da VAZXPRESS no Mercado Livre. Um produto ZXP Solutions.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // Livre, e não "portrait-primary": travar em retrato tirava do celular a orientação em que as tabelas
    // largas (Pedidos, Estoque, DRE) são legíveis, e o teclado virtual em retrato já é o pior caso. O
    // layout é medido em paisagem (844x390) sem elemento fora da tela. Instalações antigas do PWA só
    // pegam o valor novo ao reinstalar.
    orientation: "any",
    background_color: "#10100E",
    theme_color: "#10100E",
    icons: [
      { src: "/manifest-icon-192", sizes: "192x192", type: "image/png" },
      { src: "/manifest-icon-512", sizes: "512x512", type: "image/png" },
    ],
  };
}
