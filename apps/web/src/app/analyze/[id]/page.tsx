import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@newshog/db";
import { getSessionUser } from "@/lib/auth";
import { ResultView } from "./ResultView";
import { isOwner, resolveOwnerIds } from "@/lib/owner";

async function getAnalysis(id: string) {
  const analysis = await prisma.analysis.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      articleTitle: true,
      score: true,
      profileId: true,
      userId: true,
    },
  });
  if (!analysis) notFound();
  return analysis;
}

async function getFullAnalysis(id: string) {
  const analysis = await prisma.analysis.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      articleTitle: true,
      score: true,
      angles: true,
      whyNow: true,
      pitch: true,
      error: true,
      profileId: true,
      userId: true,
      updatedAt: true,
    },
  });
  if (!analysis) notFound();
  return analysis;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const analysis = await getAnalysis(id);

  const title = analysis.articleTitle
    ? `${analysis.articleTitle} — Newshog`
    : "Newshog analysis";
  const score = analysis.score != null ? analysis.score : "";
  const description = analysis.score != null
    ? `How newsworthy is this story for PR? Newshog scores it ${score}/100 with angles worth pitching.`
    : "PR newjack analysis in progress — score, angles and a ready-to-send pitch.";

  return {
    title,
    description,
    openGraph: { title, description },
  };
}

export default async function AnalysisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getSessionUser();
  const { userId, profileId } = await resolveOwnerIds();

  const basic = await getAnalysis(id);
  const owner = isOwner(basic, userId, profileId);

  if (basic.status === "analyzed") {
    const full = await getFullAnalysis(id);
    return <ResultView id={id} owner={owner} user={user} initial={full} />;
  }

  return <ResultView id={id} owner={owner} user={user} />;
}
