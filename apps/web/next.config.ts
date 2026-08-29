import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@newshog/db", "@newshog/queue"],
  // ponytail: bullmq optionally imports @valkey/valkey-glide which isn't
  // installed — suppress the dev-server compilation warning.
  serverExternalPackages: ["@valkey/valkey-glide", "undici"],
  async headers() {
    // Static layer of A.5. No Access-Control-Allow-* is emitted anywhere: API
    // routes are same-origin by default; any future public API surface must
    // open CORS deliberately, route by route.
    //
    // CSP: script-src keeps 'unsafe-inline' because App Router bakes inline
    // flight scripts into statically-prerendered pages (a per-request nonce
    // cannot reach build-time HTML without abandoning prerendering). The
    // other directives (no framing, no objects, self-only connect/base/form)
    // are what carry the real weight here.
    const isDev = process.env.NODE_ENV === "development";
    const csp = [
      "default-src 'self'",
      // 'unsafe-eval' is dev-only (React refresh) and never ships to prod.
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
