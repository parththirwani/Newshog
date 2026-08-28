import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { rateLimit, clientIp, ANALYZE_RATE_LIMIT, ANALYZE_WINDOW_MS } from "./rate-limit";

describe("rateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests up to the limit", () => {
    for (let i = 1; i <= 3; i++) {
      expect(rateLimit("k", 3, 1000).ok).toBe(true);
    }
  });

  it("blocks after the limit within the window", () => {
    rateLimit("k", 2, 1000);
    rateLimit("k", 2, 1000);
    const blocked = rateLimit("k", 2, 1000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("resets the window after it expires", () => {
    rateLimit("k", 1, 1000);
    expect(rateLimit("k", 1, 1000).ok).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(rateLimit("k", 1, 1000).ok).toBe(true);
  });

  it("tracks keys independently", () => {
    rateLimit("a", 1, 1000);
    expect(rateLimit("b", 1, 1000).ok).toBe(true);
  });

  it("exposes the default analyze limits", () => {
    expect(ANALYZE_RATE_LIMIT).toBe(10);
    expect(ANALYZE_WINDOW_MS).toBe(60 * 60 * 1000);
  });
});

describe("clientIp", () => {
  it("uses x-forwarded-for first value", () => {
    const req = new Request("http://x", {
      headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" },
    });
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