import OpenAI from "openai";
import { OPENROUTER_BASE_URL, LLM_MODEL } from "@newshog/shared";
import type { ExpertiseSummary, CompanyContext } from "@newshog/shared";
import { recordLlmCall } from "@newshog/db";
import { loadPrompt } from "./prompts";

const client = new OpenAI({
  baseURL: OPENROUTER_BASE_URL,
  apiKey: process.env.OPENROUTER_API_KEY!,
});

const SYSTEM = loadPrompt("profile-summary.md");

const INDIVIDUAL_TOOL = {
  type: "function" as const,
  function: {
    name: "submit_expertise",
    description: "Submit the individual expertise profile",
    parameters: {
      type: "object",
      // Topics/credentials/themes are required so the schema shape is stable,
      // but they may be empty arrays. tone is nullable. insufficient_data is
      // the honest escape hatch: sparse input is never padded with invented
      // expertise to satisfy a non-null tone.
      required: ["topics", "tone", "credentials", "recurring_themes", "recurring_themes_confidence", "insufficient_data"],
      properties: {
        topics: { type: "array", items: { type: "string" }, description: "Topics this person covers or is known for — empty array when not evidenced" },
        tone: { type: ["string", "null"], description: "Their professional writing/speaking tone — null when the source text gives no signal" },
        credentials: { type: "array", items: { type: "string" }, description: "Stated credentials, titles, affiliations — empty array when not evidenced" },
        recurring_themes: { type: "array", items: { type: "string" }, description: "Themes that appear repeatedly in their content — empty array when only one source or none" },
        recurring_themes_confidence: { type: "string", enum: ["single_source", "multi_source", "null"], description: "single_source when only one source was provided; null when no themes were found" },
        insufficient_data: { type: "boolean", description: "true when the provided text is too sparse to extract real expertise — do not fabricate to fill other fields" },
      },
    },
  },
};

// LLM tool calls occasionally return array fields as a single string.
// Coerce defensively so callers can rely on string[].
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

const ENTERPRISE_TOOL = {
  type: "function" as const,
  function: {
    name: "submit_company_context",
    description: "Submit the enterprise company context",
    parameters: {
      type: "object",
      required: ["what_they_do", "who_they_serve", "product_categories", "positioning_voice", "areas_of_authority"],
      properties: {
        what_they_do: { type: "string", description: "What the company does" },
        who_they_serve: { type: "string", description: "Who their customers/audience are" },
        product_categories: { type: "array", items: { type: "string" }, description: "Product or service categories" },
        positioning_voice: { type: "string", description: "How they position themselves, their brand voice" },
        areas_of_authority: { type: "array", items: { type: "string" }, description: "Areas where they claim expertise or thought leadership" },
      },
    },
  },
};

// A bio that only interpolates URLs, "unavailable" markers (from failed
// LinkedIn/X fetch attempts), or the "No bio provided." fallback with no X
// posts carries zero real signal. Short-circuiting saves an LLM call and makes
// the insufficient-data case deterministic instead of relying on the model to
// behave. Sparse-but-real text (e.g. a written bio with no sources) still goes
// through the LLM with the null-tolerant schema.
function hasSubstantiveContent(bio: string, xPosts?: string[]): boolean {
  const stripped = bio
    .replace(/https?:\/\/\S+/g, "")
    .replace(/linkedin:?\s*(unavailable\s*\([^)]*\))?/gi, "")
    .replace(/x\s+unavailable\s*\([^)]*\)/gi, "")
    .replace(/no bio provided\./gi, "")
    .trim();
  return stripped.length > 0 || (xPosts?.length ?? 0) > 0;
}

function insufficientSummary(): ExpertiseSummary {
  return {
    topics: [],
    tone: null,
    credentials: [],
    recurringThemes: [],
    insufficientData: true,
    recurringThemesConfidence: null,
    sourceQuality: "verified",
  };
}

export async function summarizeIndividualProfile(
  bio: string,
  xPosts?: string[],
): Promise<ExpertiseSummary> {
  if (!hasSubstantiveContent(bio, xPosts)) {
    return insufficientSummary();
  }

  const xSection = xPosts?.length
    ? `\n\nRecent X/Twitter posts:\n${xPosts.join("\n")}`
    : "";

  const response = await client.chat.completions.create({
    model: LLM_MODEL,
    max_tokens: 800,
    tools: [INDIVIDUAL_TOOL],
    tool_choice: { type: "function", function: { name: "submit_expertise" } },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Analyze this individual's profile:\n\n${bio}${xSection}` },
    ],
  });

  await recordLlmCall("profile", response.usage);

  const toolCall = response.choices[0]?.message.tool_calls?.[0];
  if (!toolCall?.function.arguments) {
    throw new Error("No tool call in response");
  }

  const raw = JSON.parse(toolCall.function.arguments);
  const topics = toStringArray(raw.topics);
  const credentials = toStringArray(raw.credentials);
  const recurringThemes = toStringArray(raw.recurring_themes);
  const tone = typeof raw.tone === "string" && raw.tone.trim() ? raw.tone : null;
  const allEmpty = topics.length === 0 && !tone && credentials.length === 0 && recurringThemes.length === 0;
  return {
    topics,
    tone,
    credentials,
    recurringThemes,
    // Defensive: even if the model forgets insufficient_data, all-empty fields
    // must not be presented downstream as real expertise.
    insufficientData: raw.insufficient_data === true || allEmpty,
    recurringThemesConfidence:
      raw.recurring_themes_confidence === "single_source" || raw.recurring_themes_confidence === "multi_source"
        ? raw.recurring_themes_confidence
        : null,
    sourceQuality: "verified",
  };
}

export async function summarizeCompanyProfile(
  description: string,
  websiteText?: string,
): Promise<CompanyContext> {
  const websiteSection = websiteText
    ? `\n\nWebsite content:\n${websiteText.slice(0, 5000)}`
    : "";

  const response = await client.chat.completions.create({
    model: LLM_MODEL,
    max_tokens: 800,
    tools: [ENTERPRISE_TOOL],
    tool_choice: { type: "function", function: { name: "submit_company_context" } },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Analyze this company:\n\n${description}${websiteSection}` },
    ],
  });

  await recordLlmCall("profile", response.usage);

  const toolCall = response.choices[0]?.message.tool_calls?.[0];
  if (!toolCall?.function.arguments) {
    throw new Error("No tool call in response");
  }

  const raw = JSON.parse(toolCall.function.arguments);
  return {
    whatTheyDo: typeof raw.what_they_do === "string" ? raw.what_they_do : "",
    whoTheyServe: typeof raw.who_they_serve === "string" ? raw.who_they_serve : "",
    productCategories: toStringArray(raw.product_categories),
    positioningVoice: typeof raw.positioning_voice === "string" ? raw.positioning_voice : "",
    areasOfAuthority: toStringArray(raw.areas_of_authority),
  };
}
