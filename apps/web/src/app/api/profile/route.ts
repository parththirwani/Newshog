import { NextResponse } from "next/server";
import { prisma } from "@newshog/db";
import { getSessionUser } from "@/lib/auth";
import { summarizeIndividualProfile, summarizeCompanyProfile } from "@/lib/summarize";
import { fetchXProfile } from "@/lib/x-api";
import { fetchLinkedInProfile, linkedinProfileText } from "@/lib/linkedin";
import { crawlCompanySite } from "@/lib/crawl";
import type { ProfileType } from "@newshog/shared";
import { trackServer } from "@/lib/analytics";

async function requireUser() {
  const user = await getSessionUser();
  if (!user) return null;
  return user;
}

// LinkedIn is scraped for real via Apify (never a bare URL string). Failures
// become an explicit "LinkedIn unavailable (reason)" marker — the prompt and
// logs see a real signal instead of an empty string, and summarize()'s
// short-circuit treats all-unavailable as insufficient data.
async function scrapeLinkedinSection(linkedinUrl?: string): Promise<string> {
  if (!linkedinUrl) return "";
  const li = await fetchLinkedInProfile(linkedinUrl);
  if (li.status === "ok") {
    return linkedinProfileText(li.data);
  }
  return `LinkedIn unavailable (${li.reason})`;
}

function assembleBio(opts: {
  linkedinUrl?: string;
  linkedinSection?: string;
  xUnavailable?: string | null;
  freeTextBio?: string;
}): string {
  return [
    opts.linkedinUrl && `LinkedIn: ${opts.linkedinUrl}`,
    opts.linkedinSection,
    opts.xUnavailable && `X unavailable (${opts.xUnavailable})`,
    opts.freeTextBio,
  ].filter(Boolean).join("\n\n") || "No bio provided.";
}

export async function GET() {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const profile = await prisma.profile.findUnique({
    where: { userId: user.id },
    include: { individual: true, enterprise: true },
  });

  return NextResponse.json(profile ?? null);
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const body = await request.json();
  const type = body.type as ProfileType | undefined;
  if (type !== "individual" && type !== "enterprise") {
    return NextResponse.json({ error: "type must be 'individual' or 'enterprise'." }, { status: 400 });
  }

  const existing = await prisma.profile.findUnique({ where: { userId: user.id } });
  if (existing) {
    return NextResponse.json({ error: "Profile already exists. Use PUT to update." }, { status: 409 });
  }

  try {
    if (type === "individual") {
      const { linkedinUrl, xHandle, freeTextBio } = body;

      const linkedinSection = await scrapeLinkedinSection(linkedinUrl);

      let xPosts: string[] | undefined;
      let xRawData: Record<string, unknown> | null = null;
      let xUnavailable: string | null = null;
      if (xHandle) {
        const xData = await fetchXProfile(xHandle);
        if (xData.ok) {
          xPosts = xData.recentPosts;
          xRawData = xData as unknown as Record<string, unknown>;
        } else {
          xUnavailable = xData.reason;
        }
      }

      const bio = assembleBio({ linkedinUrl, linkedinSection, xUnavailable, freeTextBio });

      const expertiseSummary = await summarizeIndividualProfile(bio, xPosts);

      const profile = await prisma.profile.create({
        data: {
          type: "individual",
          userId: user.id,
          individual: {
            create: {
              linkedinUrl: linkedinUrl || null,
              xHandle: xHandle || null,
              freeTextBio: freeTextBio || null,
              xRawData: xRawData as never,
              expertiseSummary: expertiseSummary as never,
            },
          },
        },
        include: { individual: true },
      });

      trackServer("profile_created", { type: "individual" });
      return NextResponse.json(profile, { status: 201 });
    }

    // Enterprise
    const { companyName, companyDescription, websiteUrl, docsUrl, pdfText } = body;
    if (!companyName || typeof companyName !== "string") {
      return NextResponse.json({ error: "companyName required." }, { status: 400 });
    }

    const urlsToCrawl = [websiteUrl, docsUrl].filter(Boolean) as string[];
    let websiteRawText: string | undefined;
    if (urlsToCrawl.length) {
      websiteRawText = await crawlCompanySite(urlsToCrawl);
    }

    const descriptionText = [companyDescription, pdfText && `\n\nPDF content:\n${pdfText}`].filter(Boolean).join("\n") || companyName;
    const companyContext = await summarizeCompanyProfile(descriptionText, websiteRawText);

    const profile = await prisma.profile.create({
      data: {
        type: "enterprise",
        userId: user.id,
        enterprise: {
          create: {
            companyName,
            companyDescription: companyDescription || null,
            websiteUrl: websiteUrl || null,
            docsUrl: docsUrl || null,
            pdfText: pdfText || null,
            websiteRawText: websiteRawText ?? null,
            companyContext: companyContext as never,
            lastCrawledAt: urlsToCrawl.length ? new Date() : null,
          },
        },
      },
      include: { enterprise: true },
    });

      trackServer("profile_created", { type: "enterprise" });
      return NextResponse.json(profile, { status: 201 });
  } catch (err) {
    console.error("[api/profile] POST error:", err);
    return NextResponse.json({ error: "Failed to create profile." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const existing = await prisma.profile.findUnique({
    where: { userId: user.id },
    include: { individual: true, enterprise: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "No profile found. Use POST to create." }, { status: 404 });
  }

  const body = await request.json();

  try {
    if (existing.type === "individual") {
      const { linkedinUrl, xHandle, freeTextBio } = body;

      const linkedinSection = await scrapeLinkedinSection(linkedinUrl);

      let xPosts: string[] | undefined;
      let xRawData: Record<string, unknown> | null = (existing.individual?.xRawData as Record<string, unknown>) ?? null;
      let xUnavailable: string | null = null;
      if (xHandle && xHandle !== existing.individual?.xHandle) {
        const xData = await fetchXProfile(xHandle);
        if (xData.ok) {
          xPosts = xData.recentPosts;
          xRawData = xData as unknown as Record<string, unknown>;
        } else {
          xUnavailable = xData.reason;
          xRawData = null;
        }
      } else if (existing.individual?.xRawData) {
        const raw = existing.individual.xRawData as { recentPosts?: string[] };
        xPosts = raw.recentPosts;
      }

      const bio = assembleBio({ linkedinUrl, linkedinSection, xUnavailable, freeTextBio });

      const expertiseSummary = await summarizeIndividualProfile(bio, xPosts);

      const profile = await prisma.individualProfile.update({
        where: { profileId: existing.id },
        data: {
          linkedinUrl: linkedinUrl ?? existing.individual?.linkedinUrl ?? null,
          xHandle: xHandle ?? existing.individual?.xHandle ?? null,
          freeTextBio: freeTextBio ?? existing.individual?.freeTextBio ?? null,
          xRawData: xRawData as never,
          expertiseSummary: expertiseSummary as never,
        },
      });

      return NextResponse.json({ ...existing, individual: profile });
    }

    // Enterprise
    const { companyName, companyDescription, websiteUrl, docsUrl, pdfText } = body;

    const urlsToCrawl = [websiteUrl, docsUrl].filter(Boolean) as string[];
    let websiteRawText: string | undefined = existing.enterprise?.websiteRawText ?? undefined;
    if (urlsToCrawl.length) {
      websiteRawText = await crawlCompanySite(urlsToCrawl);
    }

    const descriptionText = [companyDescription, pdfText && `\n\nPDF content:\n${pdfText}`].filter(Boolean).join("\n") || companyName || existing.enterprise?.companyName;
    const companyContext = await summarizeCompanyProfile(descriptionText, websiteRawText);

    const profile = await prisma.enterpriseProfile.update({
      where: { profileId: existing.id },
      data: {
        companyName: companyName ?? existing.enterprise?.companyName,
        companyDescription: companyDescription ?? existing.enterprise?.companyDescription ?? null,
        websiteUrl: websiteUrl ?? existing.enterprise?.websiteUrl ?? null,
        docsUrl: docsUrl ?? existing.enterprise?.docsUrl ?? null,
        pdfText: pdfText ?? existing.enterprise?.pdfText ?? null,
        websiteRawText: websiteRawText ?? null,
        companyContext: companyContext as never,
        lastCrawledAt: urlsToCrawl.length ? new Date() : existing.enterprise?.lastCrawledAt,
      },
    });

    return NextResponse.json({ ...existing, enterprise: profile });
  } catch (err) {
    console.error("[api/profile] PUT error:", err);
    return NextResponse.json({ error: "Failed to update profile." }, { status: 500 });
  }
}
