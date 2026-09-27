import type { NextConfig } from "next";
import path from "node:path";
import { cabecalhosDeSeguranca } from "./lib/config/cabecalhos";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  turbopack: {
    root: path.resolve(__dirname),
  },
  // S27 — ver lib/config/cabecalhos.ts.
  async headers() {
    return [{ source: "/:path*", headers: cabecalhosDeSeguranca({ dev: process.env.NODE_ENV !== "production" }) }];
  },
};

export default nextConfig;
