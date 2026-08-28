// X (Twitter) API v2 ingestion. Requires a funded X API key: user lookup is
// ~$0.01/call on pay-per-use billing, cheap at Newshog's volume. When the key
// is unset we log loudly and report no_token instead of silently swallowing an
// unavailable request (the old silent `null` let the LLM invent a persona).
//
// Successes are cached in Redis for 24h (see x-profile-cache.ts) so
// re-regenerations within a day hit X's own 24h dedup at minimal/no cost.
//
// Env: X_API_KEY, REDIS_URL

import { loadCachedXProfile, saveCachedXProfile } from "./x-profile-cache";

const X_BASE = "https://api.twitter.com/2";

export type XProfileResult =
  | { ok: true; handle: string; bio: string; recentPosts: string[] }
  | {
      ok: false;
      reason: "no_token" | "bad_request" | "not_found" | "rate_limited" | "api_error" | "network_error";
      status?: number;
    };

// Accept @handle, handle, https://x.com/handle, https://twitter.com/handle,
// with optional query/fragment and trailing slash.
export function normalizeXHandle(raw: string): string {
  let h = raw.trim();
  h = h.replace(/^https?:\/\//i, "");
  h = h.replace(/^(www\.)?(x\.com|twitter\.com)\//i, "");
  h = h.replace(/^@/, "");
  h = h.split(/[?#]/)[0];
  h = h.replace(/\/+$/, "");
  return h;
}

export async function fetchXProfile(rawHandle: string): Promise<XProfileResult> {
  const token = process.env.X_API_KEY;
  if (!token) {
    console.error("[x-api] X_API_KEY not set — X fetch skipped (set a funded pay-per-use key).");
    return { ok: false, reason: "no_token" };
  }

  // Twitter usernames are 1-15 chars, letters/digits/underscore.
  const handle = normalizeXHandle(rawHandle);
  if (!handle || !/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
    console.error(`[x-api] invalid handle after normalization: ${JSON.stringify(rawHandle)} -> ${JSON.stringify(handle)}`);
    return { ok: false, reason: "bad_request" };
  }

  const cached = await loadCachedXProfile(handle);
  if (cached) {
    console.log(`[x-api] @${handle} served from daily cache.`);
    return { ok: true, handle: cached.handle, bio: cached.bio, recentPosts: cached.recentPosts };
  }

  try {
    const userRes = await fetch(`${X_BASE}/users/by/username/${handle}?user.fields=description`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (userRes.status === 404) {
      console.warn(`[x-api] @${handle} not found.`);
      return { ok: false, reason: "not_found" };
    }
    if (userRes.status === 429) {
      console.error(`[x-api] rate limited fetching @${handle}.`);
      return { ok: false, reason: "rate_limited", status: 429 };
    }
    if (!userRes.ok) {
      // X returns this when the app is not attached to a Project / not on a paid
      // tier. The common cause: the API key is valid but the app was never put
      // in a project, or access was never upgraded from the old free tier.
      if (userRes.status === 403) {
        console.error(
          `[x-api] @${handle} forbidden. If the reason is 'client-not-enrolled': attach this app to a Project and enable v2 user access (Basic/Pro tier) in the X developer portal. Status: ${userRes.status}`,
        );
      } else {
        console.error(`[x-api] user lookup failed for @${handle}: ${userRes.status}`);
      }
      return { ok: false, reason: "api_error", status: userRes.status };
    }

    const userData = (await userRes.json()) as { data?: { id: string; description?: string } };
    const userId = userData.data?.id;
    const bio = userData.data?.description ?? "";
    if (!userId) {
      console.error(`[x-api] @${handle} returned no user id.`);
      return { ok: false, reason: "api_error" };
    }

    const tweetsRes = await fetch(
      `${X_BASE}/users/${userId}/tweets?max_results=5&tweet.fields=text`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
    );
    if (!tweetsRes.ok) {
      // A valid user with no public timeline (or a throttled posts call) is a
      // real, usable signal — surface the bio rather than failing the whole
      // profile over the trailing posts endpoint. This degraded result is NOT
      // cached: a temporary outage shouldn't freeze an empty post list for 24h.
      if (tweetsRes.status === 429) {
        console.warn(`[x-api] rate limited fetching tweets for @${handle} — returning bio only.`);
      } else {
        console.warn(`[x-api] tweets fetch failed for @${handle}: ${tweetsRes.status} — returning bio only.`);
      }
      return { ok: true, handle, bio, recentPosts: [] };
    }

    const tweetsData = (await tweetsRes.json()) as { data?: Array<{ text: string }> };
    const recentPosts = (tweetsData.data ?? []).map((t) => t.text);
    console.log(`[x-api] @${handle}: ${recentPosts.length} recent posts, bio ${bio.length} chars.`);
    await saveCachedXProfile(handle, { handle, bio, recentPosts });
    return { ok: true, handle, bio, recentPosts };
  } catch (err) {
    console.error(`[x-api] fetch failed for @${handle}:`, err);
    return { ok: false, reason: "network_error" };
  }
}