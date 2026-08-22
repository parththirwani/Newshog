import OpenAI from "openai";
import { OPENROUTER_BASE_URL, LLM_MODEL, LLM_MAX_TOKENS, LLM_MAX_INPUT_CHARS } from "@newshog/shared";
import type { Angle } from "@newshog/shared";
import { recordLlmCall } from "@newshog/db";
import { loadPrompt } from "./prompts";

const client = new OpenAI({
  baseURL: OPENROUTER_BASE_URL,
  apiKey: process.env.OPENROUTER_API_KEY!,
});

const SYSTEM = loadPrompt("pitch.md");

export interface PitchInput {
  articleTitle?: string | null;
  articleText?: string | null;
  angles: Angle[];
  selectedAngle?: string;
  profileContext?: string;
  opportunity?: { requesterName?: string; outlet?: string; topicText: string };
  analysisId?: string;
}

export async function generatePitch(input: PitchInput): Promise<string> {
  const angle =
    input.angles.find((a) => a.title === input.selectedAngle) ??
    input.angles[0];

  const angleBlock = angle
    ? `Selected angle:\nTitle: ${angle.title}\nWhy now: ${angle.why_now}\nWhy journalists care: ${angle.why_journalists_care}\nExample headline: ${angle.headline}`
    : "No angles available — reflect what the article supports.";

  const titleLine = input.articleTitle ? `Article title: ${input.articleTitle}\n\n` : "";
  const textBlock = (input.articleText ?? "").slice(0, LLM_MAX_INPUT_CHARS);
  const profileBlock = input.profileContext
    ? `\n\nUser profile context:\n${input.profileContext}`
    : "";
  const requestBlock = input.opportunity
    ? `\n\nMatched journalist request: ${input.opportunity.requesterName ?? "unknown"} at ${input.opportunity.outlet ?? "unknown outlet"}. They asked: ${input.opportunity.topicText}`
    : "";

  const response = await client.chat.completions.create({
    model: LLM_MODEL,
    max_tokens: LLM_MAX_TOKENS,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `${titleLine}${angleBlock}\n\nArticle text:\n${textBlock}${profileBlock}${requestBlock}`,
      },
    ],
  });

  const pitch = response.choices[0]?.message.content?.trim();
  if (!pitch) throw new Error("No pitch generated");

  await recordLlmCall("pitch", response.usage, input.analysisId);
  return pitch;
}