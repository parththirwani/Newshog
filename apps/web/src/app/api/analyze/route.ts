import { NextResponse } from "next/server";
import { prisma } from "@newshog/db";
import { getAnalyzeQueue, ANALYZE_QUEUE } from "@newshog/queue";
import {
  rateLimit,
  clientIp,
  ANALYZE_RATE_LIMIT,
  ANALYZE_WINDOW_MS,
  anonQuota,
} from "@/lib/rate-limit";
import { getSessionUser, getAnonId, anonIdCookie } from "@/lib/auth";
import { trackServer } from "@/lib/analytics";
import { normalizeUrl } from "@/lib/url";
import { ANALYSIS_DEDUPE_HOURS } from "@newshog/shared";

function isValidUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function withAnonCookie(res: NextResponse, cookie: ReturnType<typeof anonIdCookie> | null) {
  if (cookie) res.cookies.set(cookie);
  return res;
}

export async function POST(request: Request) {
  // ponytail: in-memory per-process token bucket (10/hr/key). Single-node
  // ceiling; swap to the redis in packages/queue (createConnection) in
  // Phase 8 when the web app runs more than one instance.
  const gate = rateLimit(`analyze:${clientIp(request)}`, ANALYZE_RATE_LIMIT, ANALYZE_WINDOW_MS);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many analyses. Try again later." },
      { status: 429, headers: { "Retry-After": String(gate.retryAfter) } },
    );
  }

  try {
    const body = await request.json();
    const { url, profileId } = body as { url?: string; profileId?: string };

    if (!url || typeof url !== "string" || !isValidUrl(url)) {
      return NextResponse.json({ error: "Invalid URL. Provide a valid http(s) URL." }, { status: 400 });
    }

    const normalizedUrl = normalizeUrl(url);

    // Free tier: anonymous visitors get 3 analyses tracked by a signed
    // httpOnly anon_id cookie; logged-in users are unlimited. Clearing the
    // cookie resets the count — an accepted free-growth-gate tradeoff, not a
    // hard paywall.
    const session = await getSessionUser();
    const anon = session ? null : await getAnonId();
    const anonId = anon?.id ?? null;
    const anonCookie = anon?.cookie ?? null;

    // Profiles are account-scoped — a caller may only analyze against their
    // own profile. Anonymous callers can't attach one at all.
    if (profileId) {
      if (!session) {
        return NextResponse.json({ error: "Sign in to use a profile." }, { status: 403 });
      }
      const owned = await prisma.profile.findUnique({
        where: { id: profileId },
        select: { userId: true },
      });
      if (!owned || owned.userId !== session.id) {
        return NextResponse.json({ error: "Forbidden." }, { status: 403 });
      }
    }

    // ponytail: count()-based quota, no anonymous_usage table — saving a
    // second write path. If anon analysis history (beyond a counter) is ever
    // needed, add the table then.
    const used = anonId ? await prisma.analysis.count({ where: { anonId } }) : null;
    const remaining = used == null ? undefined : Math.max(0, anonQuota(used).remaining - 1);

    // Dedupe: don't re-run the expensive pipeline for a URL already analyzed
    // in the window. Only the caller's own rows (or fully context-free rows,
    // which hold no private data) are dedupe targets — cross-account rows are
    // private. Escapes via DELETE then POST again if it goes stale.
    const recent = await prisma.analysis.findFirst({
      where: {
        url: normalizedUrl,
        profileId: profileId || null,
        status: "analyzed",
        // Only dedupe against complete results — a scoreless/partial "analyzed"
        // row (legacy dev data, or a run that wrote status before score) would
        // otherwise get returned and render as a permanent blank page. Re-run.
        score: { not: null },
        createdAt: { gt: new Date(Date.now() - ANALYSIS_DEDUPE_HOURS * 60 * 60 * 1000) },
        OR: session
          ? [{ userId: session.id }, { userId: null, anonId: null }]
          : [{ anonId }, { userId: null, anonId: null }],
      },
      select: { id: true },
    });
    if (recent) {
      trackServer("url_deduped", { profileId: profileId ?? null });
      return withAnonCookie(NextResponse.json({ id: recent.id, deduped: true, remaining }, { status: 201 }), anonCookie);
    }

    if (used != null && !anonQuota(used).ok) {
      trackServer("free_tier_exhausted", { anonId });
      return withAnonCookie(
        NextResponse.json(
          { error: "You've used your 3 free stories. Sign in to keep analyzing.", remaining: 0 },
          { status: 402 },
        ),
        anonCookie,
      );
    }

    const analysis = await prisma.analysis.create({
      data: {
        url: normalizedUrl,
        status: "queued",
        profileId: profileId || null,
        userId: session?.id ?? null,
        anonId,
      },
    });

    const queue = getAnalyzeQueue();
    await queue.add(ANALYZE_QUEUE, { analysisId: analysis.id }, { jobId: analysis.id });

    trackServer("url_pasted", { profileId: profileId ?? null });

    return withAnonCookie(NextResponse.json({ id: analysis.id, remaining }, { status: 201 }), anonCookie);
  } catch (err) {
    console.error("[api/analyze] POST error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}