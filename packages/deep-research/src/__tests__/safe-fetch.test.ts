import { describe, it, expect, vi } from "vitest";
import { safeFetchText, assertSafeUrl, ipIsBlocked, createValidatingLookup, SsrfError } from "@newshog/shared/safe-fetch";

// Fully hermetic via injected deps: fake DNS + fake fetch — no network.

const PUBLIC_A = { address: "93.184.216.34", family: 4 };
const okBody = (body = "<html>ok</html>", extra: Partial<Response> = {}) =>
  ({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: null,
    text: () => Promise.resolve(body),
    ...extra,
  }) as unknown as Response;

function deps(opts: { answers?: Record<string, object[] | Error>; fetchImpl?: (url: string) => Promise<Response> } = {}) {
  const resolveHost = vi.fn(async (host: string) => {
    const a = opts.answers?.[host];
    if (a instanceof Error) throw a;
    if (a) return a;
    return [PUBLIC_A];
  }) as unknown as (h: string) => Promise<{ address: string; family: number }[]>;
  const fetchImpl = vi.fn(opts.fetchImpl ?? ((u: string) => Promise.resolve(okBody())));
  return { resolveHost, fetch: fetchImpl };
}

describe("ipIsBlocked", () => {
  it("blocks private/loopback/reserved IPv4", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "10.255.255.255", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.5", "100.64.0.1", "224.0.0.1", "240.0.0.1"]) {
      expect(ipIsBlocked(ip), ip).toBe(true);
    }
  });
  it("blocks loopback/ULA/link-local IPv6 and IPv4-mapped", () => {
    for (const ip of ["::1", "::", "fc00::1234", "fe80::1234", "ff00::1234", "::ffff:127.0.0.1", "64:ff9b::127.0.0.1", "2001:0:4136:e378:8000:63bf:3fff:fdd2",
      // RFC 5952-compressed serializations (what getaddrinfo actually returns)
      "2001::4136:e378:8000:63bf:3fff:fdd2", "::127.0.0.1", "::10.0.0.1"]) {
      expect(ipIsBlocked(ip), ip).toBe(true);
    }
  });
  it("allows public addresses", () => {
    for (const ip of ["93.184.216.34", "104.21.1.1", "2606:4700:4700::1111"]) {
      expect(ipIsBlocked(ip), ip).toBe(false);
    }
    expect(ipIsBlocked("not-an-ip")).toBe(true);
  });
});

describe("assertSafeUrl", () => {
  it("rejects non-http(s) schemes, credentials, and literal private IPs", async () => {
    for (const u of ["file:///etc/passwd", "ftp://example.com", "gopher://x", "http://127.0.0.1/", "https://10.0.0.1/", "http://user:pw@93.184.216.34/", "http://[::1]/"]) {
      await expect(assertSafeUrl(u, () => Promise.resolve([PUBLIC_A]))).rejects.toBeInstanceOf(SsrfError);
    }
  });

  it("rejects when ANY returned DNS address is private", async () => {
    const mixed = [PUBLIC_A, { address: "169.254.169.254", family: 4 }];
    await expect(assertSafeUrl("http://evil.example/", () => Promise.resolve(mixed))).rejects.toBeInstanceOf(SsrfError);
  });

  it("rejects empty DNS and unavailable resolution", async () => {
    await expect(assertSafeUrl("http://nope.example/", () => Promise.resolve([] as never))).rejects.toBeInstanceOf(SsrfError);
    await expect(assertSafeUrl("http://nope.example/", () => Promise.reject(new Error("ENOTFOUND")))).rejects.toBeInstanceOf(SsrfError);
  });

  it("accepts a public URL", async () => {
    const url = await assertSafeUrl("https://example.com/article", () => Promise.resolve([PUBLIC_A]));
    expect(url.hostname).toBe("example.com");
  });
});

describe("safeFetchText", () => {
  it("fetches after validation and returns the body", async () => {
    const d = deps();
    const r = await safeFetchText("https://example.com/x", d);
    expect(r.ok).toBe(true);
    expect(r.body).toBe("<html>ok</html>");
    expect(d.resolveHost).toHaveBeenCalledWith("example.com");
  });

  it("rejects a literal private IP without ever fetching", async () => {
    const d = deps();
    await expect(safeFetchText("http://169.254.169.254/latest/meta-data", d)).rejects.toBeInstanceOf(SsrfError);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("redirect chain public→private: rejected pre-connect (exactly one fetch)", async () => {
    const redirectToPrivate = () => Promise.resolve({
      ok: false,
      status: 302,
      statusText: "Found",
      headers: { get: (h: string) => (h === "location" ? "http://10.0.0.7/internal" : null) },
    } as unknown as Response);
    const d = deps({ fetchImpl: redirectToPrivate });
    await expect(safeFetchText("https://example.com/x", d)).rejects.toBeInstanceOf(SsrfError);
    expect(d.fetch).toHaveBeenCalledTimes(1);
  });

  it("redirect chain public→public→200: re-resolves and succeeds", async () => {
    const chain = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve({
        ok: false,
        status: 301,
        statusText: "Moved",
        headers: { get: (h: string) => (h === "location" ? "https://other.example/final" : null) },
      } as unknown as Response))
      .mockImplementationOnce(() => Promise.resolve(okBody("<html>final</html>")));
    const d = deps();
    d.fetch = chain;
    const r = await safeFetchText("https://example.com/x", d);
    expect(r.ok).toBe(true);
    expect(r.body).toBe("<html>final</html>");
    // resolveHost ran for both hops — the per-hop re-validation the plan's
    // redirect-chain test is about.
    expect(d.resolveHost).toHaveBeenCalledWith("example.com");
    expect(d.resolveHost).toHaveBeenCalledWith("other.example");
  });

  it("stops after the redirect hop limit", async () => {
    const hopAway = () => Promise.resolve({
      ok: false,
      status: 302,
      statusText: "Found",
      headers: { get: (h: string) => (h === "location" ? "https://example.com/next" : null) },
    } as unknown as Response);
    const d = deps({ fetchImpl: hopAway });
    await expect(safeFetchText("https://example.com/x", d)).rejects.toThrow(/redirect follows/);
    expect((d.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(7);
  });

  it("rejects oversized content-length before reading", async () => {
    const huge = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: (h: string) => (h === "content-length" ? String(SAFE_MAX + 1) : null) },
      text: () => Promise.resolve(""),
    } as unknown as Response;
    const d = deps({ fetchImpl: () => Promise.resolve(huge) });
    await expect(safeFetchText("https://example.com/big", { ...d, maxBytes: SAFE_MAX })).rejects.toThrow(/exceeds/);
  });

  const SAFE_MAX = 1024;
  it("rejects a streamed body over the cap", async () => {
    const chunks = [new Uint8Array(600), new Uint8Array(600)];
    let read = 0;
    const res = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: null,
      body: {
        getReader() {
          return {
            read: () => { const c = chunks[read++]; return Promise.resolve({ done: read > chunks.length ? true : !c, value: c }); },
            cancel: () => Promise.resolve(),
          };
        },
      },
    } as unknown as Response;
    const d = deps({ fetchImpl: () => Promise.resolve(res) });
    await expect(safeFetchText("https://example.com/big", { ...d, maxBytes: 1024 })).rejects.toThrow(/exceeds 1024 bytes/);
  });

  it("non-2xx terminal responses return ok:false without throwing", async () => {
    const d = deps({ fetchImpl: () => Promise.resolve({ ok: false, status: 503, statusText: "Busy", headers: null } as unknown as Response) });
    const r = await safeFetchText("https://example.com/x", d);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(503);
  });
});

describe("createValidatingLookup (rebinding defense at connect time)", () => {
  // Simulated rebinding: pre-check resolves public; by socket time the same
  // hostname resolves private — the connector must refuse the connection.
  it("errors the connection when re-resolution turns private", async () => {
    const fakeDns = vi.fn().mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const lookup = createValidatingLookup(fakeDns as never);
    const err = await new Promise<Error | null>((resolve) => {
      lookup("evil.example", { all: false }, (e) => resolve(e));
    });
    expect(err).toBeInstanceOf(SsrfError);
    expect((err as Error).message).toMatch(/blocked address/);
  });

  it("passes a public re-resolution through (single-answer mode)", async () => {
    const fakeDns = vi.fn().mockResolvedValue([PUBLIC_A]);
    const lookup = createValidatingLookup(fakeDns as never);
    const [addr, fam] = await new Promise<[string, number]>((resolve, reject) => {
      lookup("ok.example", { all: false }, (e: Error | null, address?: string | { address: string; family: number }[], family?: number) =>
        e ? reject(e) : resolve([address as string, family as number]),
      );
    });
    expect(addr).toBe(PUBLIC_A.address);
    expect(fam).toBe(4);
  });

  it("passes a public re-resolution through (all mode)", async () => {
    const fakeDns = vi.fn().mockResolvedValue([PUBLIC_A, { address: "2606:4700:4700::1111", family: 6 }]);
    const lookup = createValidatingLookup(fakeDns as never);
    await new Promise<void>((resolve, reject) => {
      lookup("ok.example", { all: true }, (e: Error | null) => (e ? reject(e) : resolve()));
    });
  });
});
