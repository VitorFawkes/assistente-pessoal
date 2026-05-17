import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // Server actions defaults are fine; this is just a marker for future tweaks.
  },
  serverExternalPackages: ["pg"],
};

export default nextConfig;
