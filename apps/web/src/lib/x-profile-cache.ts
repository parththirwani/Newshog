// 24h X-profile cache backed by Redis (SET with TTL), so re-fetching a handle
// within a day costs only the per-day dedup from the X side — usually nothing.
// Only successful {ok:true, bio, recentPosts} results are cached; failures are
// never stored and retry on the next call.
//
// Fail-open: if REDIS_URL is unset or Redis is unreachable, every read/write is
// a no-op and callers fall back to a live X API call. Transient Redis failures
// cool off for a minute, then re-enable automatically.
//
import { loadCachedJson, saveCachedJson } from "./redis-json-cache";

const TTL_SECONDS = 24 * 60 * 60;
const KEY_PREFIX = "x-profile-cache:";

export interface CachedXProfile {
  handle: string;
  bio: string;
  recentPosts: string[];
}

function isValidCachedXProfile(value: unknown): value is CachedXProfile {
  const v = value as CachedXProfile;
  return (
    typeof v?.handle === "string" &&
    typeof v?.bio === "string" &&
    Array.isArray(v?.recentPosts)
  );
}

export function loadCachedXProfile(handle: string): Promise<CachedXProfile | null> {
  return loadCachedJson(KEY_PREFIX, handle, isValidCachedXProfile);
}

export function saveCachedXProfile(handle: string, value: CachedXProfile): Promise<void> {
  return saveCachedJson(KEY_PREFIX, handle, value, TTL_SECONDS);
}