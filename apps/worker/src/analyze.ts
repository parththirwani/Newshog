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
const CRITIQUE_SYSTEM = await Bun.file(new URL("../../../prompts/analysis-critique.md", import.meta.url)).text();

const TOOL = {
  type: "function" as const,
  function: {
    name: "submit_analysis",
    description: "Submit the PR newjack analysis result",
    parameters: {
      type: "object",
      required: ["score", "why_now", "velocity", "velocity_reasoning", "angles", "novelty_score", "event_timing"],
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
          description: "How first-to-cover / differentiated is this story, 0-100. High = genuinely novel / not yet widely covered. Low = one of several similar recent stories. Grounded in the coverage signal when provided.",
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

// Reviewer tool for the second, self-critique pass. Narrower than TOOL: it
// approves the first pass or returns only the fields that must change.
const CRITIQUE_TOOL = {
  type: "function" as const,
  function: {
    name: "submit_critique",
    description: "Submit the review verdict on the first-pass analysis",
    parameters: {
      type: "object",
      required: ["approved", "corrected_fields", "critique_notes"],
      properties: {
        approved: {
          type: "boolean",
          description: "True when the first-pass analysis is acceptable unchanged; false when any field needs correcting.",
        },
        corrected_fields: {
          type: ["object", "null"],
          description:
            "Null when approved is true. Otherwise an object holding ONLY the fields that must change (any subset of score, why_now, velocity, velocity_reasoning, novelty_score, event_timing, angles). Omit every unchanged field.",
          properties: {
            score: { type: "number", description: "Corrected opportunity score 0-100" },
            why_now: { type: "string", description: "Corrected why-this-matters summary" },
            velocity: { type: "string", enum: STORY_VELOCITIES },
            velocity_reasoning: { type: "string" },
            novelty_score: { type: "number", description: "Corrected 0-100" },
            event_timing: { type: "string", enum: ["past", "ongoing", "upcoming"] },
            angles: {
              type: "array",
              items: {
                type: "object",
                required: ["title", "why_now", "why_journalists_care", "headline"],
                properties: {
                  title: { type: "string" },
                  why_now: { type: "string" },
                  why_journalists_care: { type: "string" },
                  headline: { type: "string" },
                  fit_rationale: { type: "string", description: "Why this user can credibly take the angle (profile context only)" },
                  is_stretch: { type: "boolean", description: "True when the angle is a weak / stretched fit" },
                },
              },
            },
          },
        },
        critique_notes: {
          type: "array",
          items: { type: "string" },
          description: "One short line per correction (or why the pass was approved).",
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
  if (cov?.resurfacing?.confirmed && cov.resurfacing.evidenceUrl) {
    lines.push(
      `Confirmed resurfacing: a recent development (${cov.resurfacing.evidenceUrl}) makes this old story newly relevant. Frame "why this matters" as RESURFACING, not fresh-breaking or "timely".`,
    );
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

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `Today's date: ${new Date().toISOString().slice(0, 10)}.\n\n${titleLine}Analyze this article:\n\n${truncated}${profileSection}${researchSection}${coverageBlock}`,
    },
  ];

  // A malformed first pass should not fail the analysis outright — malformed
  // tool output is usually transient. Give the model one clean retry (mirrors
  // deep-research's structuredCompletion correction). Only a second failure
  // gives up, and with a user-facing message, not developer jargon.
  let result = await submitFirstPass(messages, analysisId);
  if (!result) {
    result = await submitFirstPass(messages, analysisId);
  }
  if (!result) {
    throw new Error(
      "We couldn't analyze this story after retrying. Please try again in a moment.",
    );
  }

  // Second, enforcing pass: a separate reviewer LLM checks the first pass against
  // the known failure modes and either approves it or returns only the fields that
  // changed. A prompt-line asking the model to self-critique in one shot does not
  // guarantee it happens; a real second call does. Critique failure is non-fatal —
  // fall back to the first pass unchanged, mirroring how pitch failure doesn't fail
  // the run.
  try {
    return await critiqueAnalysis(result, {
      title,
      text: truncated,
      publishedAt: grounding?.sourcePublishedAt ?? null,
      profileContext,
      researchContext,
    }, analysisId);
  } catch (err) {
    console.error(`[critique] analysis_critique failed for ${analysisId ?? "?"}:`, err);
    return result;
  }
}

interface CritiqueContext {
  title: string | null;
  text: string;
  publishedAt?: string | null;
  profileContext?: string;
  researchContext?: string;
}

/**
 * Run the first-pass analysis LLM call and parse its tool output.
 * Returns null on a structurally unusable response (so callers can retry)
 * rather than throwing, and never persists garbage. Usage is recorded (the
 * recordLlmCall failure is fire-and-forget — a DB hiccup must not fail analysis).
 */
async function submitFirstPass(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  analysisId?: string,
): Promise<LlmAnalysis | null> {
  const response = await client.chat.completions.create({
    model: LLM_MODEL,
    max_tokens: LLM_MAX_TOKENS,
    tools: [TOOL],
    tool_choice: { type: "function", function: { name: "submit_analysis" } },
    messages,
  });
  await recordLlmCall("analysis", response.usage, analysisId);

  const toolCall = response.choices[0]?.message.tool_calls?.[0];
  if (!toolCall?.function.arguments) return null;

  let parsed: LlmAnalysis;
  try {
    parsed = JSON.parse(toolCall.function.arguments) as LlmAnalysis;
    // The prompt previously told the model to emit "why_this_matters" while the
    // schema/code read "why_now". Tolerate the legacy alias so we don't reject
    // an otherwise-valid response while the prompt change propagates.
    const raw = parsed as Partial<LlmAnalysis> & { why_this_matters?: unknown };
    if (raw.why_this_matters != null && raw.why_now == null) {
      raw.why_now = String(raw.why_this_matters);
    }
    assertWellFormed(parsed);
  } catch {
    return null;
  }
  return normalize(parsed);
}

async function critiqueAnalysis(
  first: LlmAnalysis,
  ctx: CritiqueContext,
  analysisId?: string,
): Promise<LlmAnalysis> {
  const today = new Date().toISOString().slice(0, 10);
  const pubBlock = ctx.publishedAt
    ? `Article publish date: ${ctx.publishedAt.slice(0, 10)} (${daysAgo(ctx.publishedAt)} days ago).`
    : "Article publish date: unknown (treat staleness unknown, rely on the article's own framing).";
  const titleLine = ctx.title ? `Article title: ${ctx.title}\n` : "";
  const profileBlock = ctx.profileContext ? `\nProfile context used:\n${ctx.profileContext}` : "";
  const researchBlock = ctx.researchContext ? `\nResearch context:\n${ctx.researchContext}` : "";
  const firstPass = JSON.stringify(first, null, 2);

  const response = await client.chat.completions.create({
    model: LLM_MODEL,
    max_tokens: LLM_MAX_TOKENS,
    tools: [CRITIQUE_TOOL],
    tool_choice: { type: "function", function: { name: "submit_critique" } },
    messages: [
      { role: "system", content: CRITIQUE_SYSTEM },
      {
        role: "user",
        content: `${titleLine}Today's date: ${today}.\n${pubBlock}${profileBlock}${researchBlock}\n\nFirst-pass analysis:\n${firstPass}\n\nArticle text:\n${ctx.text}`,
      },
    ],
  });

  // Separate, attributable cost row for the critique pass.
  await recordLlmCall("analysis_critique", response.usage, analysisId);

  const toolCall = response.choices[0]?.message.tool_calls?.[0];
  if (!toolCall?.function.arguments) throw new Error("No critique tool call in response");

  const critique = JSON.parse(toolCall.function.arguments) as {
    approved?: boolean;
    corrected_fields?: Partial<LlmAnalysis> | null;
    critique_notes?: string[];
  };

  if (critique.approved !== false || !critique.corrected_fields) return first;

  // A malformed corrected field must never overwrite a valid first-pass value.
  // normalize() clamps a non-finite score to 0, so a garbage critique score
  // would zero a good first pass and persist the exact scoreless/zeroed row we
  // guard against upstream. Keep the first-pass value for that field.
  const corrected = { ...critique.corrected_fields };
  if (corrected.score != null && !Number.isFinite(Number(corrected.score))) {
    delete corrected.score;
  }
  if (corrected.why_now != null && typeof corrected.why_now !== "string") {
    delete corrected.why_now;
  }

  return normalize({ ...first, ...corrected });
}

function normalize(result: LlmAnalysis): LlmAnalysis {
  // Last-line defense for the critique-merge path only — the first pass is
  // validated by assertWellFormed before it gets here. A non-finite score here
  // (e.g. a malformed corrected_fields) clamps to 0 rather than NaNs into a
  // NULL DB column while status stays "analyzed".
  const parsed = Number(result.score);
  result.score = Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : 0;
  if (result.novelty_score != null) result.novelty_score = Math.max(0, Math.min(100, Math.round(result.novelty_score)));
  if (result.event_timing != null && !["past", "ongoing", "upcoming"].includes(result.event_timing)) result.event_timing = undefined;
  result.velocity = STORY_VELOCITIES.includes(result.velocity) ? result.velocity : DEFAULT_VELOCITY;
  result.angles = toAngleArray(result.angles as unknown).slice(0, MAX_ANGLES);
  return result;
}

function daysAgo(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return 0;
  return Math.max(0, Math.floor((Date.now() - ms) / 86_400_000));
}

/**
 * Reject a first-pass response that is structurally unusable (missing a finite
 * score, missing why_now, or missing the angles array). A genuine low score is
 * fine — this only rejects responses the model failed to produce per schema.
 * Throwing causes the job to fail visibly (and be retryable) instead of
 * persisting an "analyzed" row with no real content.
 */
function assertWellFormed(raw: Partial<LlmAnalysis>): void {
  const score = Number((raw as { score?: unknown }).score);
  const hasWhyNow = typeof raw.why_now === "string" && raw.why_now.trim().length > 0;
  // `angles` may be an array OR a single angle object — toAngleArray coerces the
  // object case into a one-element array. Only reject when it's neither (e.g. a
  // string/number), which normalize can never turn into Angle[].
  const anglesOk =
    Array.isArray(raw.angles) ||
    (typeof raw.angles === "object" && raw.angles !== null && typeof (raw.angles as Angle).title === "string");
  if (!Number.isFinite(score) || typeof raw.score !== "number" || !hasWhyNow || !anglesOk) {
    throw new Error(
      "Malformed analysis response (missing/invalid required field). Retry the analysis.",
    );
  }
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
