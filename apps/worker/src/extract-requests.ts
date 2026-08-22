import OpenAI from "openai";
import { OPENROUTER_BASE_URL, LLM_MODEL } from "@newshog/shared";

let client: OpenAI;
function getClient() {
  if (!client) client = new OpenAI({ baseURL: OPENROUTER_BASE_URL, apiKey: process.env.OPENROUTER_API_KEY! });
  return client;
}

export interface ExtractedRequest {
  requester_name: string | null;
  outlet: string | null;
  topic_text: string;
  deadline: string | null;
  reply_contact: string | null;
}

const TOOL = {
  type: "function" as const,
  function: {
    name: "submit_requests",
    description: "Submit extracted journalist requests from the email digest",
    parameters: {
      type: "object",
      required: ["requests"],
      properties: {
        requests: {
          type: "array",
          description: "Journalist requests extracted from the email",
          items: {
            type: "object",
            required: ["topic_text"],
            properties: {
              requester_name: { type: ["string", "null"], description: "Name of the journalist or requester, if stated" },
              outlet: { type: ["string", "null"], description: "Publication or outlet, if stated" },
              topic_text: { type: "string", description: "The topic or ask — what the journalist is looking for" },
              deadline: { type: ["string", "null"], description: "Deadline if stated, ISO 8601 or natural language" },
              reply_contact: { type: ["string", "null"], description: "How to reply — email, form URL, or platform instructions" },
            },
          },
        },
      },
    },
  },
};

export async function extractJournalistRequests(
  emailBody: string,
): Promise<ExtractedRequest[]> {
  const truncated = emailBody.slice(0, 6000);

  const response = await getClient().chat.completions.create({
    model: LLM_MODEL,
    max_tokens: 1000,
    tools: [TOOL],
    tool_choice: { type: "function", function: { name: "submit_requests" } },
    messages: [
      {
        role: "system",
        content: "Extract all journalist requests or source queries from this email digest. Each distinct ask — a journalist looking for sources, experts, or commentary on a topic — is a separate request. If the email contains no journalist requests, return an empty array.",
      },
      {
        role: "user",
        content: truncated,
      },
    ],
  });

  const toolCall = response.choices[0]?.message.tool_calls?.[0];
  if (!toolCall?.function.arguments) return [];

  try {
    const result = JSON.parse(toolCall.function.arguments) as { requests: ExtractedRequest[] };
    return result.requests ?? [];
  } catch {
    return [];
  }
}
