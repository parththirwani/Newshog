import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { prisma } from "@newshog/db";
import { band } from "@/lib/result-utils";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Newshog PR opportunity score";

export default async function OpengraphImage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const analysis = await prisma.analysis.findUnique({
    where: { id },
    select: { articleTitle: true, score: true },
  });
  if (!analysis) return notFound();

  const score = analysis.score ?? null;
  const title = analysis.articleTitle ?? "Story analysis";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          background: "#08090b",
          color: "#f5f5f4",
          fontFamily: "Geist, system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 20, letterSpacing: 4, textTransform: "uppercase", opacity: 0.6 }}>
          Newshog
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              display: "flex",
              fontSize: 72,
              letterSpacing: -4,
              lineHeight: 1.05,
              maxWidth: 900,
            }}
          >
            {title}
          </div>
          {score != null && (
            <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
              <span style={{ fontSize: 120, fontWeight: 700, letterSpacing: -6 }}>{score}</span>
              <span style={{ fontSize: 28, opacity: 0.6 }}>/100 · {band(score)}</span>
            </div>
          )}
        </div>
      </div>
    ),
    { ...size },
  );
}