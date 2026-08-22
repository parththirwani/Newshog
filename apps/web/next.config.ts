import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@newshog/db", "@newshog/queue"],
  // ponytail: bullmq optionally imports @valkey/valkey-glide which isn't
  // installed — suppress the dev-server compilation warning.
  serverExternalPackages: ["@valkey/valkey-glide"],
};

export default nextConfig;
