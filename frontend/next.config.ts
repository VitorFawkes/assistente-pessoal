import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // O proxy guarda o corpo de cada pedido para a rota; acima disso ele chega cortado. 16 MB = a foto de até
    // 10 MB do "Subir arquivo com perguntas" (Pedidos ao Marketing) em base64.
    proxyClientMaxBodySize: "16mb",
  },
  serverExternalPackages: ["pg"],
  async headers() {
    return [
      {
        // Universal Links: Apple exige Content-Type: application/json e SEM extensão no path
        source: "/.well-known/apple-app-site-association",
        headers: [{ key: "Content-Type", value: "application/json" }],
      },
    ];
  },
};

export default nextConfig;
