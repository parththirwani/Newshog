import OpenAI from "openai";
import {
  OPENROUTER_BASE_URL,
  LLM_MODEL,
  LLM_MAX_TOKENS,
  LLM_MAX_INPUT_CHARS,
  MAX_ANGLES,
  STORY_VELOCITIES,
  DEFAULT_VELOCITY,
} from "@newshog/shared";
import type { Angle, LlmAnalysis, CoverageSignal } from "@newshog/shared";
import { recordLlmCall } from "@newshog/db";

const client = new OpenAI({
  baseURL: OPENROUTER_BASE_URL,
  apiKey: process.env.OPENROUTER_API_KEY!,
});

const SYSTEM = await Bun.file(new URL("../../../prompts/analysis.md", import.meta.url)).text();

const TOOL = {
  type: "function" as const,
  function: {
    name: "submit_analysis",
    description: "Submit the PR newjack analysis result",
    parameters: {
      type: "object",
      required: ["score", "why_now", "velocity", "velocity_reasoning", "angles"],
      properties: {
        score: {
          type: "number",
          description: `Opportunity score 0-100. 0-${30}: skip, ${30}-${60}: consider, ${60}+: strong opportunity`,
        },
        why_now: {
          type: "string",
          description: "1-2 sentence summary of why this story is relevant for PR right now",
        },
        velocity: {
          type: "string",
          enum: STORY_VELOCITIES,
          description:
            "Story decay rate, independent of score. breaking: fades in hours-to-days (viral launch, breaking news). standard: normal news cycle (days) — most product/funding announcements. evergreen: slow decay, weeks or longer (policy, research, structural industry shifts).",
        },
        velocity_reasoning: {
          type: "string",
          description: "One sentence, with concrete evidence from the article, justifying the velocity classification.",
        },
        angles: {
          type: "array",
          description: `Up to ${MAX_ANGLES} specific, timely angles. If fewer than ${MAX_ANGLES} viable angles exist, return fewer.`,
          items: {
            type: "object",
            required: ["title", "why_now", "why_journalists_care", "headline"],
            properties: {
              title: { type: "string", description: "Short angle title" },
              why_now: { type: "string", description: "Why this angle is timely right now" },
              why_journalists_care: { type: "string", description: "Why a journalist would pitch this" },
              headline: { type: "string", description: "Example headline if this angle were pitched" },
            },
          },
        },
        novelty_score: {
          type: "number",
          description: "How first-to-cover / differentiated this story is, 0-100. High = genuinely novel / not yet widely covered. Low = one of several similar recent stories. Grounded in the coverage signal when provided.",
        },
        event_timing: {
          type: "string",
          enum: ["past", "ongoing", "upcoming"],
          description: "Whether the underlying event driving the story already happened (past), is currently unfolding (ongoing), or has not happened yet (upcoming).",
        },
      },
    },
  },
};

/** Combined grounding block fed to the model on deep-research-backed calls only. */
function buildGroundingBlock(grounding: {
  sourcePublishedAt?: string | null;
  coverageSignal?: CoverageSignal | null;
}): string {
  const lines: string[] = [];
  const pubDate = grounding.sourcePublishedAt;
  if (pubDate) {
    const days = Math.max(0, Math.floor((Date.now() - Date.parse(pubDate)) / 86_400_000));
    lines.push(`Article publish date: ${pubDate.slice(0, 10)} (${days} day${days === 1 ? "" : "s"} ago).`);
  }
  const cov = grounding.coverageSignal;
  if (cov) {
    const span = cov.earliestSourceDate && cov.latestSourceDate
      ? `spanning ${cov.earliestSourceDate.slice(0, 10)} to ${cov.latestSourceDate.slice(0, 10)}`
      : "";
    const precedes = cov.precedesSubmittedArticle
      ? "Earlier coverage exists — this article is not the origin story."
      : "No earlier coverage found — this appears to be first-to-cover or genuinely novel.";
    lines.push(`Independent coverage found: ${cov.externalSourceCount} source${cov.externalSourceCount === 1 ? "" : "s"}${span ? `, ${span}` : ""}. ${precedes}`);
  }
  if (!lines.length) return "";
  return `\n\n${lines.join(" ")}\n\nScore should reflect PR opportunity, not just newsworthiness. A genuinely important story already saturated with coverage is a WEAKER pitch opportunity than a moderately interesting story nobody has covered yet — weight both independence/novelty and newsworthiness, and set novelty_score accordingly.`;
}

export async function analyzeArticle(
  text: string,
  title: string | null,
  profileContext?: string,
  analysisId?: string,
  researchContext?: string,
  grounding?: {
    sourcePublishedAt?: string | null;
    coverageSignal?: CoverageSignal | null;
  },
): Promise<LlmAnalysis> {
  const truncated = text.slice(0, LLM_MAX_INPUT_CHARS);
  const titleLine = title ? `Article title: ${title}\n\n` : "";
  const profileSection = profileContext
    ? `\n\nUser profile for tailoring angles:\n${profileContext}`
    : "";
  const researchSection = researchContext
    ? `\n\nAdditional research context gathered on this topic:\n${researchContext}\n\nUse this to calibrate score, angle novelty, and timing — note if this story is one of several similar recent stories (lower novelty/score) or genuinely first-to-cover (higher score justification).`
    : "";
  const coverageBlock = grounding ? buildGroundingBlock(grounding) : "";

  const response = await client.chat.completions.create({
    model: LLM_MODEL,
    max_tokens: LLM_MAX_TOKENS,
    tools: [TOOL],
    tool_choice: { type: "function", function: { name: "submit_analysis" } },
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `${titleLine}Analyze this article:\n\n${truncated}${profileSection}${researchSection}${coverageBlock}`,
      },
    ],
  });

  // Usage is recorded fire-and-forget; a DB hiccup must not fail the analysis.
  await recordLlmCall("analysis", response.usage, analysisId);

  const toolCall = response.choices[0]?.message.tool_calls?.[0];
  if (!toolCall?.function.arguments) {
    throw new Error("No tool call in response");
  }

  const result = JSON.parse(toolCall.function.arguments) as LlmAnalysis;
  result.score = Math.max(0, Math.min(100, Math.round(result.score)));
  if (result.noveltyScore != null) result.noveltyScore = Math.max(0, Math.min(100, Math.round(result.noveltyScore)));
  if (result.eventTiming != null && !["past", "ongoing", "upcoming"].includes(result.eventTiming)) result.eventTiming = undefined;
  result.velocity = STORY_VELOCITIES.includes(result.velocity) ? result.velocity : DEFAULT_VELOCITY;
  result.angles = toAngleArray(result.angles as unknown).slice(0, MAX_ANGLES);
  return result;
}

// The LLM occasionally wraps a single angle as an object instead of nesting
// it in an array, or returns garbage strings. Normalize so callers can rely
// on Angle[].
function toAngleArray(value: unknown): Angle[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is Angle => typeof v === "object" && v !== null && typeof (v as Angle).title === "string");
  }
  if (typeof value === "object" && value !== null && typeof (value as Angle).title === "string") {
    return [value as Angle];
  }
  return [];
}
