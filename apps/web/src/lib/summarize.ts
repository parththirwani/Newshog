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
      required: ["topics", "tone", "credentials", "recurring_themes"],
      properties: {
        topics: { type: "array", items: { type: "string" }, description: "Topics this person covers or is known for" },
        tone: { type: "string", description: "Their professional writing/speaking tone" },
        credentials: { type: "array", items: { type: "string" }, description: "Stated credentials, titles, affiliations" },
        recurring_themes: { type: "array", items: { type: "string" }, description: "Themes that appear repeatedly in their content" },
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

export async function summarizeIndividualProfile(
  bio: string,
  xPosts?: string[],
): Promise<ExpertiseSummary> {
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
  return {
    topics: toStringArray(raw.topics),
    tone: typeof raw.tone === "string" ? raw.tone : "",
    credentials: toStringArray(raw.credentials),
    recurringThemes: toStringArray(raw.recurring_themes),
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
