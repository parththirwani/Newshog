import OpenAI from "openai";
import { OPENROUTER_BASE_URL, LLM_MODEL } from "@newshog/shared";
import type { Angle, JournalistRequest } from "@newshog/shared";

let client: OpenAI;
function getClient() {
  if (!client) client = new OpenAI({ baseURL: OPENROUTER_BASE_URL, apiKey: process.env.OPENROUTER_API_KEY! });
  return client;
}

export interface MatchResult {
  journalist_request_id: string;
  match_rationale: string;
}

const TOOL = {
  type: "function" as const,
  function: {
    name: "submit_matches",
    description: "Submit journalist requests that match the analysis angles",
    parameters: {
      type: "object",
      required: ["matches"],
      properties: {
        matches: {
          type: "array",
          description: "Journalist requests that are a genuine match for at least one angle",
          items: {
            type: "object",
            required: ["journalist_request_id", "match_rationale"],
            properties: {
              journalist_request_id: { type: "string", description: "ID of the matching request" },
              match_rationale: { type: "string", description: "1-2 sentences explaining which angle matches and why" },
            },
          },
        },
      },
    },
  },
};

export async function matchRequestsToAnalysis(
  angles: Angle[],
  profileContext: string | null,
  requests: JournalistRequest[],
): Promise<MatchResult[]> {
  if (requests.length === 0) return [];

  const angleText = angles
    .map((a, i) => `${i + 1}. ${a.title}: ${a.why_now} — ${a.why_journalists_care}`)
    .join("\n");

  const requestsText = requests
    .map((r) => `[${r.id}] ${r.requesterName ?? "Unknown"} (${r.outlet ?? "unknown outlet"}): ${r.topicText}`)
    .join("\n");

  const profileLine = profileContext
    ? `\n\nUser profile:\n${profileContext}`
    : "";

  const response = await getClient().chat.completions.create({
    model: LLM_MODEL,
    max_tokens: 1000,
    tools: [TOOL],
    tool_choice: { type: "function", function: { name: "submit_matches" } },
    messages: [
      {
        role: "system",
        content: `You match journalist open requests to PR analysis angles. A match means the journalist's ask overlaps with one of the angles — they are looking for sources or commentary on a topic the user could credibly speak to. When a user profile is provided, only match requests where the user's expertise genuinely overlaps the ask. Be selective — false matches waste the user's time.`,
      },
      {
        role: "user",
        content: `Angles:\n${angleText}${profileLine}\n\nOpen journalist requests:\n${requestsText}`,
      },
    ],
  });

  const toolCall = response.choices[0]?.message.tool_calls?.[0];
  if (!toolCall?.function.arguments) return [];

  try {
    const result = JSON.parse(toolCall.function.arguments) as { matches: MatchResult[] };
    return result.matches ?? [];
  } catch {
    return [];
  }
}
