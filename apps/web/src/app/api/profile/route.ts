import { NextResponse } from "next/server";
import { prisma } from "@newshog/db";
import { getSessionEmail } from "@/lib/auth";
import { summarizeIndividualProfile, summarizeCompanyProfile } from "@/lib/summarize";
import { fetchXProfile } from "@/lib/x-api";
import { crawlCompanySite } from "@/lib/crawl";
import type { ProfileType } from "@newshog/shared";

export async function GET() {
  const email = await getSessionEmail();
  if (!email) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const profile = await prisma.profile.findUnique({
    where: { ownerEmail: email },
    include: { individual: true, enterprise: true },
  });

  return NextResponse.json(profile ?? null);
}

export async function POST(request: Request) {
  const email = await getSessionEmail();
  if (!email) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const body = await request.json();
  const type = body.type as ProfileType | undefined;
  if (type !== "individual" && type !== "enterprise") {
    return NextResponse.json({ error: "type must be 'individual' or 'enterprise'." }, { status: 400 });
  }

  const existing = await prisma.profile.findUnique({ where: { ownerEmail: email } });
  if (existing) {
    return NextResponse.json({ error: "Profile already exists. Use PUT to update." }, { status: 409 });
  }

  try {
    if (type === "individual") {
      const { linkedinUrl, xHandle, freeTextBio } = body;
      const bio = [linkedinUrl && `LinkedIn: ${linkedinUrl}`, freeTextBio].filter(Boolean).join("\n\n") || "No bio provided.";

      let xPosts: string[] | undefined;
      let xRawData: Record<string, unknown> | null = null;
      if (xHandle) {
        const xData = await fetchXProfile(xHandle);
        if (xData) {
          xPosts = xData.recentPosts;
          xRawData = xData as unknown as Record<string, unknown>;
        }
      }

      const expertiseSummary = await summarizeIndividualProfile(bio, xPosts);

      const profile = await prisma.profile.create({
        data: {
          type: "individual",
          ownerEmail: email,
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
        ownerEmail: email,
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

    return NextResponse.json(profile, { status: 201 });
  } catch (err) {
    console.error("[api/profile] POST error:", err);
    return NextResponse.json({ error: "Failed to create profile." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const email = await getSessionEmail();
  if (!email) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const existing = await prisma.profile.findUnique({
    where: { ownerEmail: email },
    include: { individual: true, enterprise: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "No profile found. Use POST to create." }, { status: 404 });
  }

  const body = await request.json();

  try {
    if (existing.type === "individual") {
      const { linkedinUrl, xHandle, freeTextBio } = body;
      const bio = [linkedinUrl && `LinkedIn: ${linkedinUrl}`, freeTextBio].filter(Boolean).join("\n\n") || "No bio provided.";

      let xPosts: string[] | undefined;
      let xRawData: Record<string, unknown> | null = (existing.individual?.xRawData as Record<string, unknown>) ?? null;
      if (xHandle && xHandle !== existing.individual?.xHandle) {
        const xData = await fetchXProfile(xHandle);
        if (xData) {
          xPosts = xData.recentPosts;
          xRawData = xData as unknown as Record<string, unknown>;
        }
      } else if (existing.individual?.xRawData) {
        const raw = existing.individual.xRawData as { recentPosts?: string[] };
        xPosts = raw.recentPosts;
      }

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
