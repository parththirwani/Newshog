import { describe, it, expect, vi, afterEach } from "vitest";
import { clientIp, hashScope, guard, __setLimiterFactoryForTests, ROUTE_LIMITS, type RouteKey } from "./rate-limit";

const ipReq = (ip = "1.2.3.4") =>
  new Request("http://x/api", { headers: { "x-forwarded-for": ip } });

// Fake limiter: tracks consumed counts per key, honoring the route's policy.
function fakeLimiter() {
  const counts = new Map<string, number>();
  return {
    counts,
    limit: vi.fn(async (key: string) => {
      const route = key.split(":")[0] as RouteKey;
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      const over = n > ROUTE_LIMITS[route].limit;
      return { success: !over, reset: Date.now() + 60_000 };
    }),
  };
}

afterEach(() => {
  __setLimiterFactoryForTests(() => null);
});

describe("clientIp", () => {
  it("uses x-forwarded-for first value", () => {
    const req = new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } });
    expect(clientIp(req)).toBe("1.2.3.4");
  });
  it("falls back through x-real-ip", () => {
    const req = new Request("http://x", { headers: { "x-real-ip": "5.6.7.8" } });
    expect(clientIp(req)).toBe("5.6.7.8");
  });
  it("falls back to unknown", () => {
    expect(clientIp(new Request("http://x"))).toBe("unknown");
  });
});

describe("hashScope", () => {
  it("is stable, case/space-insensitive, and never leaks the raw value", () => {
    const h = hashScope(" User@Example.com ");
    expect(h).toBe(hashScope("user@example.com"));
    expect(h.length).toBe(16);
    expect(h).not.toContain("user");
  });
});

describe("guard", () => {
  it("allows up to the route limit, then 429s with Retry-After", async () => {
    const fake = fakeLimiter();
    __setLimiterFactoryForTests(() => fake);
    const policy = ROUTE_LIMITS["analyze"];
    for (let i = 1; i <= policy.limit; i++) {
      const out = await guard(ipReq(), "analyze");
      expect(out.allowed).toBe(true);
    }
    const denied = await guard(ipReq(), "analyze");
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.response.status).toBe(429);
      expect(denied.response.headers.get("Retry-After")).toBeTruthy();
      expect(await denied.response.json()).toMatchObject({ error: "rate_limited", code: "rate_limited" });
    }
  });

  it("keys per-IP: a different IP has its own budget", async () => {
    const fake = fakeLimiter();
    __setLimiterFactoryForTests(() => fake);
    for (let i = 0; i < ROUTE_LIMITS["analyze"].limit; i++) await guard(ipReq("9.9.9.9"), "analyze");
    const fresh = await guard(ipReq("8.8.8.8"), "analyze");
    expect(fresh.allowed).toBe(true);
  });

  it("extraKeys add independently-limited dimensions (auth-request email cap)", async () => {
    const fake = fakeLimiter();
    __setLimiterFactoryForTests(() => fake);
    const email = hashScope("victim@example.com");
    // IP budget is 3 too, so vary the IP per request to isolate the email cap.
    let allowed = 0;
    for (let i = 0; i < 5; i++) {
      const out = await guard(ipReq(`2.2.2.${i}`), "auth-request", { extraKeys: { email } });
      if (out.allowed) allowed++;
    }
    expect(allowed).toBe(ROUTE_LIMITS["auth-request"].limit); // email cap binds first
  });

  it("fail-CLOSED: limiter error on a money route → 503 ratelimit_unavailable", async () => {
    __setLimiterFactoryForTests(() => ({ limit: () => Promise.reject(new Error("ECONNREFUSED")) }));
    const out = await guard(ipReq(), "analyze");
    expect(out.allowed).toBe(false);
    if (!out.allowed) {
      expect(out.response.status).toBe(503);
      expect(await out.response.json()).toMatchObject({ code: "ratelimit_unavailable" });
    }
  });

  it("fail-CLOSED: Upstash result.error on a money route → 503", async () => {
    __setLimiterFactoryForTests(() => ({ limit: () => Promise.resolve({ success: true, reset: 0, error: "timeout" }) }));
    const out = await guard(ipReq(), "auth-verify");
    expect(out.allowed).toBe(false);
    if (!out.allowed) expect(out.response.status).toBe(503);
  });

  it("fail-OPEN: limiter error on telemetry still allows", async () => {
    __setLimiterFactoryForTests(() => ({ limit: () => Promise.reject(new Error("down")) }));
    const out = await guard(ipReq(), "events");
    expect(out.allowed).toBe(true);
  });

  it("unconfigured limiter: tolerated in test env, fail-closed in production", async () => {
    __setLimiterFactoryForTests(() => null);
    expect((await guard(ipReq(), "analyze")).allowed).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    try {
      const out = await guard(ipReq(), "analyze");
      expect(out.allowed).toBe(false);
      if (!out.allowed) expect(out.response.status).toBe(503);
      expect((await guard(ipReq(), "events")).allowed).toBe(true); // telemetry tolerates
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("auth-verify-email is consumed without an IP key (ip:false)", async () => {
    const fake = fakeLimiter();
    __setLimiterFactoryForTests(() => fake);
    await guard(ipReq("1.1.1.1"), "auth-verify-email", { ip: false, extraKeys: { email: "abc" } });
    const keys = [...fake.counts.keys()];
    expect(keys).toEqual(["auth-verify-email:email:abc"]);
  });
});
