import type { NextConfig } from "next";
import { fileURLToPath } from "url";

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' https://js.stripe.com https://*.stripe.com",
  "connect-src 'self' https://api.stripe.com https://js.stripe.com https://*.stripe.com",
  "frame-src https://js.stripe.com https://hooks.stripe.com https://checkout.stripe.com https://billing.stripe.com https://*.stripe.com",
  "form-action 'self' https://checkout.stripe.com https://billing.stripe.com https://*.stripe.com",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  transpilePackages: ["@newshog/db", "@newshog/queue"],
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  // ponytail: bullmq optionally imports @valkey/valkey-glide which isn't
  // installed — suppress the dev-server compilation warning.
  serverExternalPackages: ["@valkey/valkey-glide"],
  outputFileTracingIncludes: {
    "/*": ["../../prompts/**/*"],
  },
  webpack(config) {
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@valkey/valkey-glide": false,
    };
    return config;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
