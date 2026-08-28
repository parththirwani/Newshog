// Generic Redis JSON cache with TTL, shared by the X and LinkedIn profile
// caches. Fail-open: if REDIS_URL is unset or Redis is unreachable, every
// read/write is a no-op and callers fall back to the live API — the cache must
// never fail a profile request.
//
// Transient Redis failures (restart, OOM burst) disable the cache for a
// cooling-off window, then it re-enables automatically instead of staying off
// for the process lifetime.
//
import IORedis from "ioredis";

const RETRY_AFTER_MS = 60_000;

let client: IORedis | null = null;
let disabledUntil = 0;

// Lazy, fail-fast client: no connection until the first op; failures go into a
// cooling-off window before we retry. enableOfflineQueue stays ON (default) so
// the first command queues while the connection establishes.
function getClient(): IORedis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (disabledUntil) {
    if (Date.now() < disabledUntil) return null;
    // Cooling-off over — drop the dead client and retry fresh.
    disabledUntil = 0;
    client?.disconnect?.();
    client = null;
  }
  if (!client) {
    client = new IORedis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      retryStrategy: () => null, // fail fast; do not hang the request
    });
    // Swallow so an unhandled 'error' event can't crash the process; the active
    // operation's try/catch decides whether to cool off.
    client.on("error", (err) => {
      console.error(`[redis-cache] redis error: ${(err as Error)?.message ?? err}`);
    });
  }
  return client;
}

function coolOff(label: string, key: string, err: unknown): void {
  disabledUntil = Date.now() + RETRY_AFTER_MS;
  console.error(`[redis-cache] ${label} failed for ${key}:`, err);
}

/** Read a JSON value at `prefix + key`. Returns null on miss or any error. */
export async function loadCachedJson<T>(
  prefix: string,
  key: string,
  validate: (value: unknown) => value is T,
): Promise<T | null> {
  const r = getClient();
  if (!r) return null;
  try {
    const raw = await r.get(`${prefix}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return validate(parsed) ? parsed : null;
  } catch (err) {
    coolOff("read", key, err);
    return null;
  }
}

/** Write a JSON value at `prefix + key` with a TTL. Errors are non-fatal. */
export async function saveCachedJson(prefix: string, key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const r = getClient();
  if (!r) return;
  try {
    await r.set(`${prefix}${key}`, JSON.stringify(value), "EX", ttlSeconds);
  } catch (err) {
    coolOff("write", key, err);
  }
}