// LinkedIn ingestion via Apify's atomus/linkedin-profile-scraper actor.
//
// Single POST to the sync run endpoint; no SDK, no cookies, $0.006 per
// successfully scraped profile (free tier covers ~20/month, not-found and
// error results are free). Every failure mode is logged explicitly and
// returned as a distinguishable discriminated union — a scrape failure is
// never collapsed to an empty string that the LLM would have to guess at.
//
// Env: APIFY_TOKEN (Apify API token: https://console.apify.com/settings/integrations)
//
// Successful scrapes are cached in Redis for 24h (keyed by the canonical URL),
// so profile edits that keep the same LinkedIn URL don't re-run the paid actor.

import { loadCachedJson, saveCachedJson } from "./redis-json-cache";

export interface LinkedInProfileData {
  fullName: string;
  headline: string;
  summary: string;
  positions: string[];
  skills: string[];
}

export type LinkedInResult =
  | { status: "ok"; data: LinkedInProfileData }
  | { status: "not_found"; reason: string }
  | { status: "error"; reason: string };

const ACTOR_URL = "https://api.apify.com/v2/acts/atomus~linkedin-profile-scraper/run-sync-get-dataset-items";
const CACHE_TTL_SECONDS = 24 * 60 * 60;
const CACHE_PREFIX = "linkedin-profile-cache:";

export function isValidLinkedInProfileData(value: unknown): value is LinkedInProfileData {
  const v = value as LinkedInProfileData;
  return (
    typeof v?.fullName === "string" &&
    typeof v?.headline === "string" &&
    typeof v?.summary === "string" &&
    Array.isArray(v?.positions) &&
    Array.isArray(v?.skills)
  );
}

export function normalizeLinkedInUrl(raw: string): string {
  const url = raw.trim();
  if (!/^https?:\/\//i.test(url)) return `https://${url}`;
  return url;
}

// The actor only resolves vanity /in/<handle> URLs. Encoded member-ID URLs
// (https://www.linkedin.com/in/ACoAA...) and URNs return an error record and
// are never charged — but rejecting them here saves a round trip.
export function isVanityLinkedInUrl(url: string): boolean {
  const m = /^https:\/\/(www\.)?linkedin\.com\/in\/([A-Za-z0-9_-]+)\/?(\?.*)?$/.exec(url.trim());
  if (!m) return false;
  const handle = m[2];
  // Encoded member IDs always start with these prefixes and cannot be resolved
  // to a vanity handle — the actor would reject them anyway (for free).
  return !/^ACoAA|^ACwAA/.test(handle);
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function linkedinProfileText(data: LinkedInProfileData): string {
  const parts: string[] = [];
  if (data.headline) parts.push(`Headline: ${data.headline}`);
  if (data.summary) parts.push(`About: ${data.summary}`);
  if (data.positions.length) parts.push(`Experience: ${data.positions.join("; ")}`);
  if (data.skills.length) parts.push(`Skills: ${data.skills.join(", ")}`);
  return parts.join("\n");
}

interface ApifyRecord {
  url?: string;
  status?: string;
  reason?: string;
  error_kind?: string;
  profile?: {
    full_name?: string | null;
    headline?: string | null;
    summary?: string | null;
    position_groups?: Array<{
      profile_positions?: Array<{ title?: string | null; company?: string | null }>;
    }>;
    skills?: Array<string | null> | null;
  };
}

export async function fetchLinkedInProfile(rawUrl: string): Promise<LinkedInResult> {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    console.error("[linkedin] APIFY_TOKEN not set — LinkedIn scrape skipped.");
    return { status: "error", reason: "no_token" };
  }

  const url = normalizeLinkedInUrl(rawUrl);
  if (!isVanityLinkedInUrl(url)) {
    console.error(`[linkedin] invalid vanity URL, skipping scrape: ${url}`);
    return { status: "error", reason: "invalid_url" };
  }

  const cached = await loadCachedJson(CACHE_PREFIX, url, isValidLinkedInProfileData);
  if (cached) {
    console.log(`[linkedin] ${url} served from daily cache.`);
    return { status: "ok", data: cached };
  }

  try {
    const res = await fetch(
      `${ACTOR_URL}?token=${encodeURIComponent(token)}&timeout=60`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileUrls: [url] }),
        signal: AbortSignal.timeout(75_000),
      },
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[linkedin] Apify request failed: ${res.status} ${detail.slice(0, 300)}`);
      return { status: "error", reason: res.status === 429 ? "rate_limited" : "apify_error" };
    }

    const items = (await res.json()) as ApifyRecord[];
    const item = items[0];
    if (!item) {
      console.error(`[linkedin] Apify returned no records for ${url}`);
      return { status: "error", reason: "empty_result" };
    }

    if (item.status === "not_found") {
      console.warn(`[linkedin] ${url} not found (private, deleted, or not indexed).`);
      return { status: "not_found", reason: "not_found" };
    }

    if (item.status === "error" || !item.profile) {
      const kind = item.error_kind ?? "actor_error";
      console.error(`[linkedin] ${url} scrape error: ${item.reason ?? kind} (${kind})`);
      return { status: "error", reason: kind };
    }

    const p = item.profile;
    const positions = (p.position_groups ?? [])
      .flatMap((g) => g.profile_positions ?? [])
      .map((pos) => [pos.title, pos.company].filter(Boolean).join(" at "))
      .filter(Boolean);
    const skills = (p.skills ?? []).filter((s): s is string => typeof s === "string");
    const data: LinkedInProfileData = {
      fullName: p.full_name ?? "",
      headline: p.headline ?? "",
      summary: stripHtml(p.summary ?? ""),
      positions,
      skills,
    };
    console.log(
      `[linkedin] scraped ${data.fullName} (${url}): ${positions.length} positions, ${skills.length} skills, ${data.summary.length} about-characters.`,
    );
    await saveCachedJson(CACHE_PREFIX, url, data, CACHE_TTL_SECONDS);
    return { status: "ok", data };
  } catch (err) {
    console.error(`[linkedin] fetch failed for ${url}:`, err);
    return { status: "error", reason: "network_error" };
  }
}