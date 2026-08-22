import OpenAI from "openai";
import { OPENROUTER_BASE_URL, LLM_MODEL, LLM_MAX_TOKENS, LLM_MAX_INPUT_CHARS, MAX_ANGLES } from "@newshog/shared";
import type { Angle, LlmAnalysis } from "@newshog/shared";
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
      required: ["score", "why_now", "angles"],
      properties: {
        score: {
          type: "number",
          description: `Opportunity score 0-100. 0-${30}: skip, ${30}-${60}: consider, ${60}+: strong opportunity`,
        },
        why_now: {
          type: "string",
          description: "1-2 sentence summary of why this story is relevant for PR right now",
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
      },
    },
  },
};

export async function analyzeArticle(
  text: string,
  title: string | null,
  profileContext?: string,
  analysisId?: string,
): Promise<LlmAnalysis> {
  const truncated = text.slice(0, LLM_MAX_INPUT_CHARS);
  const titleLine = title ? `Article title: ${title}\n\n` : "";
  const profileSection = profileContext
    ? `\n\nUser profile for tailoring angles:\n${profileContext}`
    : "";

  const response = await client.chat.completions.create({
    model: LLM_MODEL,
    max_tokens: LLM_MAX_TOKENS,
    tools: [TOOL],
    tool_choice: { type: "function", function: { name: "submit_analysis" } },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `${titleLine}Analyze this article:\n\n${truncated}${profileSection}` },
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
