import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@newshog/db", "@newshog/queue"],
};

export default nextConfig;
