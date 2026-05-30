import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // Server actions defaults are fine; this is just a marker for future tweaks.
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
