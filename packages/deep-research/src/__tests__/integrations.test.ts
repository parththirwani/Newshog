import { describe, it, expect } from "vitest";
import { runResearch } from "../Service";
import { createTokenBudget } from "../Llm";
import { createEventEmitter } from "../Events";
import type { Emitter } from "../Events";
import type { LlmHandler } from "../Llm";

function planText(content: string): string {
  if (content.includes("GENUINELY INDEPENDENT")) {
    return JSON.stringify({ independent: true, threads: ["coverage of X", "who covers this beat", "market context"] });
  }
  if (content.includes("generate up to") || content.includes("Generate up to")) {
    return JSON.stringify({ queries: [{ query: "coverage query", researchGoal: "g" }, { query: "beat query", researchGoal: "g2" }] });
  }
  if (content.includes("Failing sentences")) {
    return JSON.stringify({ rewrites: [] });
  }
  if (content.includes("Sources:")) {
    return JSON.stringify({
      learnings: [
        { text: "The report shows strong B2B coverage", sourceUrls: ["https://a.com"], excerpt: "strong B2B coverage stats" },
      ],
      followUpQuestions: [],
    });
  }
  // the final answer/report — grounded and inline-linked so enforcement passes
  return "The report found strong B2B coverage [coverage](https://a.com).";
}

describe("runResearch orchestration (no network, no LLM)", () => {
  it("rejects a kickoff with no clarification answers unless skipClarification is set", async () => {
    const handler: LlmHandler = {
      complete: async ({ messages }) => ({
        text: planText(messages[messages.length - 1].content),
        model: "t",
        usage: { promptTokens: 1, completionTokens: 1 },
      }),
    };
    const emit = createEventEmitter({});
    const budget = createTokenBudget(100);

    await expect(
      runResearch(
        { query: "q", depth: 1, breadth: 1, mode: "answer" },
        { handler, budget, emit, search: async () => [], scrape: async () => "x" },
      ),
    ).rejects.toThrow(/clarificationAnswers are required/);

    const ok = await runResearch(
      { query: "q", depth: 1, breadth: 1, mode: "answer", skipClarification: true },
      { handler, budget, emit, search: async () => [], scrape: async () => "x" },
    );
    expect(ok.truncated).toBe(false);
  });

  it("completes a fan-out run with parallel threads sharing a budget", async () => {
    const budget = createTokenBudget(10_000_000);
    const emit = createEventEmitter({ onEvent: () => {} });
    const events: string[] = [];
    const rec: Emitter = createEventEmitter({ runId: "r", onEvent: (e) => events.push(e.type) });

    const handler: LlmHandler = {
      complete: async ({ messages }) => ({
        text: planText(messages[messages.length - 1].content),
        model: "t",
        usage: { promptTokens: 10, completionTokens: 4 },
      }),
    };

    const outcome = await runResearch(
      {
        query: "B2B chargers",
        depth: 2,
        breadth: 4,
        mode: "report",
        clarificationAnswers: [{ id: "scope", question: "scope?", answer: "b2b" }],
        skipClarification: true,
      },
      {
        handler,
        budget,
        emit: rec,
        search: async (query) => [{ title: "a", url: "https://a.com", snippet: "snip" }],
        scrape: async (url) => "The report says there is strong B2B article coverage here.",
      },
    );

    expect(outcome.truncated).toBe(false);
    expect(outcome.learnings.length).toBeGreaterThan(0);
    expect(outcome.report).toBeDefined();
    // sub-question planning ran so threads were fanned out
    expect(events).toContain("thread.completed");
    // covered-query seed: thread scopes present in the accumulator (race fix)
    expect(outcome.coveredQueries.length).toBeGreaterThanOrEqual(3);
    // sources carry verification status (not silently trusted)
    expect(outcome.sources.length).toBeGreaterThan(0);
    expect(outcome.sources.every((s) => ["verified", "unverified", "failed"].includes(s.status))).toBe(true);
  });

  it("returns truncated status with partial learnings when the token ceiling is hit", async () => {
    const budget = createTokenBudget(30); // tiny ceiling
    const events: string[] = [];
    const rec: Emitter = createEventEmitter({ runId: "t", onEvent: (e) => events.push(e.type) });

    const handler: LlmHandler = {
      complete: async ({ messages }) => ({
        text: planText(messages[messages.length - 1].content),
        model: "t",
        usage: { promptTokens: 20, completionTokens: 10 },
      }),
    };

let outcome: Awaited<ReturnType<typeof runResearch>>;
    try {
      outcome = await runResearch(
        { query: "over budget", depth: 3, breadth: 3, mode: "answer", skipClarification: true },
        {
          handler,
          budget,
          emit: rec,
          search: async (q) => [
            { url: "https://a.com", title: "", snippet: "s" },
            { url: "https://b.com", title: "", snippet: "s" },
          ],
          scrape: async (url) => "body text",
        },
      );
    } catch (err) {
      throw new Error(`runResearch threw unexpectedly: ${err instanceof Error ? err.message : String(err)}`);
    }
    expect(outcome.truncated, `truncated=${outcome.truncated}`).toBe(true);
    expect(events).toContain("research.truncated");
  });
});