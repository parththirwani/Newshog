// One-off backfill: generate pitches for old analyses that never got one.
// Run once, then delete this script:
//   bun scripts/backfill-pitches.ts

import { prisma } from "@newshog/db";
import type { Angle } from "@newshog/shared";

const client = new (await import("openai")).default({
  baseURL: (await import("@newshog/shared")).OPENROUTER_BASE_URL,
  apiKey: process.env.OPENROUTER_API_KEY!,
});

const { LLM_MODEL, LLM_MAX_TOKENS, LLM_MAX_INPUT_CHARS } = await import("@newshog/shared");

const SYSTEM = await Bun.file(new URL("../prompts/pitch.md", import.meta.url)).text();

async function generatePitch(articleTitle: string, articleText: string, angles: Angle[]): Promise<string> {
  const angle = angles[0];
  const angleBlock = angle
    ? `Selected angle:\nTitle: ${angle.title}\nWhy now: ${angle.why_now}\nWhy journalists care: ${angle.why_journalists_care}\nExample headline: ${angle.headline}`
    : "No angles available — reflect what the article supports.";

  const titleLine = articleTitle ? `Article title: ${articleTitle}\n\n` : "";
  const textBlock = (articleText ?? "").slice(0, LLM_MAX_INPUT_CHARS);

  const response = await client.chat.completions.create({
    model: LLM_MODEL,
    max_tokens: LLM_MAX_TOKENS,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `${titleLine}${angleBlock}\n\nArticle text:\n${textBlock}`,
      },
    ],
  });

  const pitch = response.choices[0]?.message.content?.trim();
  if (!pitch) throw new Error("No pitch generated");
  return pitch;
}

async function main() {
  const missing = await prisma.analysis.findMany({
    where: { status: "analyzed", pitch: null },
    select: { id: true, articleTitle: true, rawArticleText: true, angles: true },
    orderBy: { createdAt: "desc" },
  });

  console.log(`Found ${missing.length} analyses with no pitch`);

  let done = 0;
  let failed = 0;

  for (const a of missing) {
    if (!a.rawArticleText || !a.angles) {
      console.log(`  skipping ${a.id} (no article text or angles)`);
      failed++;
      continue;
    }

    try {
      const angles = a.angles as unknown as Angle[];
      const pitch = await generatePitch(a.articleTitle ?? "", a.rawArticleText, angles);
      await prisma.analysis.update({
        where: { id: a.id },
        data: { pitch },
      });
      done++;
      console.log(`  [${done}/${missing.length}] pitch generated for ${a.id}`);
    } catch (err) {
      failed++;
      console.error(`  FAILED ${a.id}:`, err);
    }
  }

  console.log(`Done: ${done} pitches generated, ${failed} failed`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
