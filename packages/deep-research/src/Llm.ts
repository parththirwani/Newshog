import OpenAI from "openai";
import { OPENROUTER_BASE_URL, LLM_MODEL } from "@newshog/shared";
import type { Emitter } from "./Events";
import type { AnalyticsHeaders } from "./types";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmResponse {
  text: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number };
}

export interface LlmHandler {
  complete(params: {
    messages: LlmMessage[];
    temperature?: number;
    signal?: AbortSignal;
  }): Promise<LlmResponse>;
}

export const MAX_RUN_TOKENS: number = Number(process.env.MAX_RUN_TOKENS ?? 300_000);

export interface TokenBudget {
  promptTokens: number;
  completionTokens: number;
  ceiling: number;
  add(prompt: number, completion: number): void;
  exceeded(): boolean;
}

export function createTokenBudget(ceiling: number = MAX_RUN_TOKENS): TokenBudget {
  let promptTokens = 0;
  let completionTokens = 0;
  return {
    ceiling,
    get promptTokens() {
      return promptTokens;
    },
    get completionTokens() {
      return completionTokens;
    },
    add(prompt: number, completion: number) {
      promptTokens += prompt;
      completionTokens += completion;
    },
    exceeded() {
      return promptTokens + completionTokens >= ceiling;
    },
  };
}

export function createOpenRouterHandler(apiKey?: string): LlmHandler {
  const client = new OpenAI({
    apiKey: apiKey ?? process.env.OPENROUTER_API_KEY!,
    baseURL: OPENROUTER_BASE_URL,
  });
  return {
    async complete({ messages, temperature = 0.2, signal }) {
      const response = await client.chat.completions.create(
        { model: LLM_MODEL, temperature, messages },
        { signal } as never,
      );
      const choice = response.choices[0];
      const usage = response.usage;
      return {
        text: choice?.message?.content ?? "",
        model: response.model ?? LLM_MODEL,
        usage: {
          promptTokens: usage?.prompt_tokens ?? 0,
          completionTokens: usage?.completion_tokens ?? 0,
        },
      };
    },
  };
}

export interface StructuredCompletionDeps {
  prompt: string;
  parser: (text: string) => unknown;
  purpose: string;
  handler: LlmHandler;
  budget: TokenBudget;
  runId: string;
  signal?: AbortSignal;
  emit?: Emitter;
  analytics?: AnalyticsHeaders;
}

/**
 * Structured JSON-in/JSON-out completion with one correction retry. Temp 0.2 →
 * parse; on rejection send a temp-0 "return one valid JSON" correction. Every
 * call accumulates prompt+completion totals into the shared per-run budget so
 * the cost cap is enforced in code.
 */
export async function structuredCompletion(deps: StructuredCompletionDeps): Promise<unknown> {
  const { prompt, parser, handler, budget, signal } = deps;
  const messages: LlmMessage[] = [
    { role: "system", content: "You are a careful research assistant. Follow the requested output format exactly." },
    { role: "user", content: prompt },
  ];

  const first = await handler.complete({ messages, temperature: 0.2, signal });
  budget.add(first.usage.promptTokens, first.usage.completionTokens);
  try {
    return parser(first.text);
  } catch {
    const correction = await handler.complete({
      messages: [
        ...messages,
        { role: "assistant", content: first.text },
        { role: "user", content: "Your previous response was invalid. Return only one valid JSON object matching the requested schema." },
      ],
      temperature: 0,
      signal,
    });
    budget.add(correction.usage.promptTokens, correction.usage.completionTokens);
    return parser(correction.text);
  }
}

/** Non-structured completion for the final answer/report generation pass. */
export async function complete(deps: {
  prompt: string;
  system: string;
  temperature?: number;
  handler: LlmHandler;
  budget: TokenBudget;
  signal?: AbortSignal;
}): Promise<LlmResponse> {
  const response = await deps.handler.complete({
    messages: [
      { role: "system", content: deps.system },
      { role: "user", content: deps.prompt },
    ],
    temperature: deps.temperature ?? 0.2,
    signal: deps.signal,
  });
  deps.budget.add(response.usage.promptTokens, response.usage.completionTokens);
  return response;
}