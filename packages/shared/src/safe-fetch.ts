// SSRF-safe fetch (security.md Phase A.2). Every URL that originates from
// user input (analysis URLs, profile company sites, deep-research scrape
// targets) goes through here:
//
//  - http(s) only, no embedded credentials, no non-ASCII tricks (URL parse
//    normalizes).
//  - DNS pre-resolved and every returned address checked against
//    private/reserved ranges (RFC1918, loopback, link-local incl. the
//    169.254.169.254 cloud metadata endpoint, CGNAT, ULA, IPv4-mapped IPv6).
//  - redirects are followed MANUALLY, re-validating scheme + DNS at every
//    hop, so a public host cannot 302 into an internal one.
//
// Pinning (defense against DNS rebinding — hostname resolves public at
// check time, private at connect time):
//  - Node (web on Vercel): an undici Agent whose connector `lookup` re-runs
//    the same private-IP validation at actual connect time, so the socket is
//    only ever established to a validated address, per hop, with correct SNI.
//  - Bun (worker container): undici's Agent is not functional under Bun, so
//    we fall back to the per-hop pre-validation above. Residual TOCTOU
//    window: resolve→connect is milliseconds apart (TTL-0 rebinding is a
//    narrow race). Accepted tradeoff: the worker runs on its own compose
//    network; postgres/redis there must not be reachable by URL anyway, and
//    an external attacker cannot enqueue a job without passing the API
//    limiter + quota (A.1) first.
//  - Under vitest (`VITEST`/`NODE_ENV=test`) the global fetch is used with no
//    dispatcher so route/package tests can keep stubbing `globalThis.fetch`;
//    pre-validation still runs (real DNS for public hostnames, injected fake
//    where tests need hermeticity).

import dns from "node:dns";
import net from "node:net";

export const SAFE_FETCH_TIMEOUT_MS = 10_000;
export const SAFE_FETCH_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_REDIRECT_HOPS = 5;

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

type ResolvedAddress = { address: string; family: number | string };

// ---------------------------------------------------------------------------
// IP range checks

function ipv4IsBlocked(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0) return true; // "this" network / 0.0.0.0
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (commonly used for VPC-internal addressing)
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function ipv6IsBlocked(ip: string): boolean {
  const lower = ip.toLowerCase();
  // IPv4-mapped (::ffff:a.b.c.d or ::ffff:xxxx:xxxx) — inspect the v4 part.
  const mapped = lower.match(/^::ffff:(.+)$/);
  if (mapped) {
    const tail = mapped[1];
    if (net.isIPv4(tail)) return ipv4IsBlocked(tail);
    const hi = Number.parseInt(tail.split(":")[0] ?? "0", 16);
    const loHex = tail.split(":")[1] ?? "0";
    const lo = Number.parseInt(loHex, 16);
    const a = (hi >>> 8) & 0xff;
    const b = hi & 0xff;
    const c = (lo >>> 8) & 0xff;
    const d = lo & 0xff;
    return ipv4IsBlocked(`${a}.${b}.${c}.${d}`);
  }
  if (lower === "::" || lower === "::1") return true; // unspecified + loopback
  if (lower.startsWith("64:ff9b:")) return true; // NAT64 well-known prefix embeds IPv4 (can translate to loopback)
  if (lower.startsWith("2002:")) return true; // 6to4 embeds IPv4 in the global id
  if (lower.startsWith("2001:0:") || lower === "2001:0" || lower.startsWith("2001::")) return true; // Teredo embeds IPv4 (inverted); :: is the compressed zero second group
  // Deprecated IPv4-compatible form (::1.2.3.4) carries a full v4 tail.
  const v4compat = lower.match(/^::(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4compat) return ipv4IsBlocked(v4compat[1]);
  const firstGroup = lower.replace(/^:+/, "").split(":")[0] ?? "";
  const fg = Number.parseInt(firstGroup, 16);
  if (!Number.isNaN(fg)) {
    if ((fg & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
    if ((fg & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((fg & 0xff00) === 0xff00) return true; // ff00::/12 multicast
  }
  return false;
}

export function ipIsBlocked(ip: string): boolean {
  if (net.isIPv4(ip)) return ipv4IsBlocked(ip);
  if (net.isIPv6(ip)) return ipv6IsBlocked(ip);
  return true; // unparseable is always blocked
}

// ---------------------------------------------------------------------------
// URL + DNS validation

async function defaultResolveHost(hostname: string): Promise<ResolvedAddress[]> {
  return dns.promises.lookup(hostname, { all: true, verbatim: true }) as Promise<ResolvedAddress[]>;
}

/** Throws SsrfError unless `raw` is a fetch-safe http(s) URL whose host is
 *  public (literal IPs checked directly, hostnames via DNS). */
export async function assertSafeUrl(raw: string, resolveHost: (h: string) => Promise<ResolvedAddress[]> = defaultResolveHost): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError(`Invalid URL: ${raw.slice(0, 100)}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError(`Blocked scheme ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new SsrfError("Credentials in URL are not allowed");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) throw new SsrfError("URL has no hostname");
  if (net.isIP(host)) {
    if (ipIsBlocked(host)) throw new SsrfError(`Blocked literal address ${host}`);
    return url;
  }
  let addrs: ResolvedAddress[];
  try {
    addrs = await resolveHost(host);
  } catch {
    throw new SsrfError(`DNS resolution failed for ${host}`);
  }
  if (!addrs?.length) throw new SsrfError(`No DNS records for ${host}`);
  for (const a of addrs) {
    if (ipIsBlocked(a.address)) {
      throw new SsrfError(`${host} resolves to blocked address ${a.address}`);
    }
  }
  return url;
}

// ---------------------------------------------------------------------------
// Capped body read

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const body = res.body as ReadableStream<Uint8Array> | null;
  if (!body || typeof body.getReader !== "function") {
    const text = await res.text();
    if (text.length > maxBytes) throw new SsrfError(`Response exceeds ${maxBytes} bytes`);
    return text;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new SsrfError(`Response exceeds ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}

// ---------------------------------------------------------------------------
// safeFetchText

export type SafeFetchDeps = {
  fetch?: (url: string, init?: Record<string, unknown>) => Promise<Response>;
  resolveHost?: (hostname: string) => Promise<ResolvedAddress[]>;
  timeoutMs?: number;
  maxBytes?: number;
};

export type SafeFetchResult = {
  status: number;
  ok: boolean;
  statusText: string;
  finalUrl: string;
  body: string;
};

const isBunRuntime = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
const isTestRuntime = () =>
  process.env.VITEST === "true" || process.env.NODE_ENV === "test" || process.env.SAFE_FETCH_USE_GLOBAL === "1";

// Node-only: connector-level re-validation at socket time (pinning). The
// lookup hook fires for every new connection, including every redirect hop.
export type ConnectorLookup = (
  hostname: string,
  options: unknown,
  callback: (err: Error | null, address?: string | ResolvedAddress[], family?: number) => void,
) => void;

/** undici `connect.lookup` hook: resolves fresh at connect time and refuses
 *  the socket if ANY returned address is private — this is what defeats DNS
 *  rebinding (public at pre-check time, private at connect time). */
export function createValidatingLookup(
  resolveHost: (h: string) => Promise<ResolvedAddress[]> = defaultResolveHost,
): ConnectorLookup {
  return (hostname, options, callback) => {
    resolveHost(hostname).then(
      (addrs) => {
        if (!addrs?.length) {
          callback(new SsrfError(`No DNS records for ${hostname} at connect time`));
          return;
        }
        for (const a of addrs) {
          if (ipIsBlocked(a.address)) {
            callback(new SsrfError(`${hostname} re-resolved to blocked address ${a.address}`));
            return;
          }
        }
        const opts = options as { all?: boolean } | undefined;
        if (opts?.all) callback(null, addrs);
        else {
          const first = addrs.find((a) => String(a.family) === "4") ?? addrs[0];
          callback(null, first.address, Number(first.family));
        }
      },
      (err) => callback(err as Error),
    );
  };
}

let pinnedImpl: Promise<{ fetch: SafeFetchDeps["fetch"] } | null> | undefined;
function getNodePinnedImpl() {
  pinnedImpl ??= (async () => {
    try {
      const { Agent, fetch: undiciFetch } = await import("undici");
      const dispatcher = new Agent({ connect: { lookup: createValidatingLookup() as never } });
      return {
        fetch: ((url: string, init?: Record<string, unknown>) =>
          undiciFetch(url as never, { ...init, dispatcher } as never).then(
            (r: unknown) => r as Response,
          )) as SafeFetchDeps["fetch"],
      };
    } catch {
      return null; // undici unavailable → global fetch + pre-validation only
    }
  })();
  return pinnedImpl;
}

/**
 * Fetch a user-supplied URL with full SSRF validation (scheme, private-IP
 * DNS checks, manual per-hop redirect re-validation, timeout, 5MB cap).
 * Non-2xx (non-redirect) responses resolve with ok:false; network/validation
 * failures throw (SsrfError for SSRF rejections).
 */
export async function safeFetchText(rawUrl: string, deps: SafeFetchDeps = {}): Promise<SafeFetchResult> {
  const timeoutMs = deps.timeoutMs ?? SAFE_FETCH_TIMEOUT_MS;
  const maxBytes = deps.maxBytes ?? SAFE_FETCH_MAX_BYTES;
  const resolveHost = deps.resolveHost ?? defaultResolveHost;

  let fetchImpl = deps.fetch;
  if (!fetchImpl) {
    if (isBunRuntime || isTestRuntime()) {
      fetchImpl = (url, init) => globalThis.fetch(url, init as RequestInit);
    } else {
      const pinned = await getNodePinnedImpl();
      fetchImpl =
        pinned?.fetch ?? ((url, init) => globalThis.fetch(url, init as RequestInit));
    }
  }

  let next = rawUrl;
  for (let follows = 0; ; follows++) {
    if (follows > MAX_REDIRECT_HOPS) throw new SsrfError(`Exceeded ${MAX_REDIRECT_HOPS} redirect follows`);
    const validated = await assertSafeUrl(next, resolveHost);
    const res = await fetchImpl(next, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        // Browser-like UA: paywalled/bot-challenge sites gate on self-
        // identifying bot strings ("NewshogBot"), so both scrapeArticle and
        // crawlCompanySite send a browser-eyewash pattern.
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
    });

    const isRedirect = res.status >= 300 && res.status < 400;
    const location = isRedirect ? res.headers?.get?.("location") ?? null : null;
    if (isRedirect && location) {
      next = new URL(location, validated).toString();
      continue;
    }
    if (!res.ok) {
      return { status: res.status, ok: false, statusText: res.statusText ?? "", finalUrl: validated.toString(), body: "" };
    }
    const declared = Number(res.headers?.get?.("content-length") ?? "NaN");
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new SsrfError(`Response exceeds ${maxBytes} bytes`);
    }
    return {
      status: res.status,
      ok: true,
      statusText: res.statusText ?? "",
      finalUrl: validated.toString(),
      body: await readCapped(res, maxBytes),
    };
  }
}
