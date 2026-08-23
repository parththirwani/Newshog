import { describe, it, expect } from "vitest";
import { mapWithConcurrency, runThreads } from "../Concurrency";
import { createEventEmitter, preview } from "../Events";
import { parseLearnings, parseResearchPlan, parseClarificationQuestions, parseSubQuestionPlan } from "../Json";
import { buildResearchContext, citationSources, mergeLearnings, validateClarificationAnswers, SEARCH_CONCURRENCY } from "../Service";
import { reportPrompt, planPrompt, learningsPrompt } from "../Prompts";
import { extractMarkdown } from "../Scrape";
import { normalizeSearchResults, parseBingHtml, resolveBingUrl } from "../Search";
import { enforceReport, isGrounded, isAnalysisSentence, segmentReport } from "../Verify";
import type { RepairFn, Rewrite } from "../Verify";
import { createTokenBudget } from "../Llm";

import { webSearchEntries, scrybePayload } from "./fixtures";

describe("search + scrape normalization", () => {
  it("dedupes and validates Toolbox search results", () => {
    const results = normalizeSearchResults(webSearchEntries);
    expect(results.length).toBe(2);
    expect(results.every((r) => r.url.startsWith("http"))).toBe(true);
    expect(new Set(results.map((r) => r.url)).size).toBe(results.length);
  });

  it("extracts markdown from a Scrybe payload", () => {
    const md = extractMarkdown(scrybePayload);
    expect(md).toContain("Welcome to Python.org");
  });
});

describe("Bing failover search", () => {
  it("decodes Bing redirect URLs to real destinations", () => {
    expect(resolveBingUrl("https://www.bing.com/ck/a?u=a1aHR0cHM6Ly9kdWNrZGIub3JnLw")).toBe("https://duckdb.org/");
    expect(resolveBingUrl("https://duckdb.org/")).toBe("https://duckdb.org/");
  });

  it("parses b_algo results into deduped, validated search results", () => {
    const html = `<ol id="b_results"><li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=a1aHR0cHM6Ly9kdWNrZGIub3JnLw">DuckDB</a></h2><div class="b_caption"><p>An in-process SQL OLAP database.</p></div></li><li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=a1aHR0cHM6Ly9kdWNrZGIub3JnL2luc3RhbGwv">Install</a></h2><div class="b_caption"><p>Install guide.</p></div></li></ol>`;
    const results = parseBingHtml(html);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ title: "DuckDB", url: "https://duckdb.org/", snippet: "An in-process SQL OLAP database." });
    expect(results.every((r) => !r.url.includes("bing.com/ck/"))).toBe(true);
  });
});

describe("structured response parsing", () => {
  it("rescues JSON from code fences", () => {
    const plan = parseResearchPlan('```json\n{"queries":[{"query":"python docs","researchGoal":"official docs"}]}\n```');
    expect(plan).toEqual([{ query: "python docs", researchGoal: "official docs" }]);
  });

  it("keeps citations only from supplied sources and carries excerpts", () => {
    const parsed = parseLearnings(
      '{"learnings":[{"text":"Python has docs","sourceUrls":["https://trusted.example","https://bad.example"],"excerpt":"official docs exist"}],"followUpQuestions":["What versions?"]}',
      ["https://trusted.example"],
    );
    expect(parsed.learnings).toEqual([
      { text: "Python has docs", sourceUrls: ["https://trusted.example"], excerpt: "official docs exist" },
    ]);
    expect(parsed.followUpQuestions).toEqual(["What versions?"]);
  });

  it("parses clarification ids with dedup", () => {
    const qs = parseClarificationQuestions(
      '{"questions":[{"id":"deployment","question":"Where?"},{"id":"deployment","question":"Scale?"}]}',
    );
    expect(qs[0].id).toBe("deployment");
    expect(qs[1].id).toMatch(/^question_/);
  });

  it("parses independent vs linear sub-question plans", () => {
    expect(parseSubQuestionPlan('{"independent":true,"threads":["coverage","beat","competitors"]}')).toEqual({
      threads: ["coverage", "beat", "competitors"],
      independent: true,
    });
    expect(parseSubQuestionPlan('{"independent":false,"query":"one thing"}')).toEqual({
      threads: ["one thing"],
      independent: false,
    });
  });
});

describe("prompt shaping", () => {
  it("instructs the planner to avoid covered queries", () => {
    const p = planPrompt("research", 3, [], ["recent coverage of X"]);
    expect(p).toMatch(/do NOT repeat/i);
    expect(p).toContain("recent coverage of X");
  });

  it("demands grounding excerpts in the learnings prompt", () => {
    const p = learningsPrompt("query", "Source: https://x.com\nbody");
    expect(p).toMatch(/excerpt/);
    expect(p).toMatch(/verbatim/);
  });
});

describe("merge + citation", () => {
  it("merges duplicate learnings and unions sources + excerpts", () => {
    const merged = mergeLearnings([
      { text: "fact", sourceUrls: ["https://a.com"], excerpt: "A" },
      { text: "fact", sourceUrls: ["https://b.com"] },
    ]);
    expect(merged).toEqual([{ text: "fact", sourceUrls: ["https://a.com", "https://b.com"], excerpt: "A" }]);
    expect(citationSources(merged)).toEqual([
      { id: 1, url: "https://a.com", status: "unverified" },
      { id: 2, url: "https://b.com", status: "unverified" },
    ]);
  });

  it("builds research context from answers", () => {
    const ctx = buildResearchContext("Go", [{ id: "scale", question: "Scale?", answer: "50k DAU" }]);
    expect(ctx).toMatch(/Original research request:\nGo/);
    expect(ctx).toMatch(/Scale\?:\n +50k DAU/);
  });

  it("validates clarification answer bounds", () => {
    expect(validateClarificationAnswers([{ id: "a", answer: "x" }])).toHaveLength(1);
    expect(() => validateClarificationAnswers([{ id: "a", answer: "" }])).toThrow(/answer/);
    expect(() => validateClarificationAnswers([{ id: "a", answer: "x".repeat(2001) }])).toThrow(/2000/);
  });
});

describe("events + concurrency", () => {
  it("orders events and previews whitespace", () => {
    const events: unknown[] = [];
    const emitter = createEventEmitter({ runId: "r", onEvent: (e) => events.push(e) });
    emitter.emit("a");
    emitter.emit("b");
    expect((events[0] as { runId: string }).runId).toBe("r");
    expect((events[0] as { sequence: number }).sequence).toBe(1);
    expect((events[1] as { sequence: number }).sequence).toBe(2);
    expect(preview(" one\n two ")).toBe("one two");
  });

  it("caps concurrency and preserves order", async () => {
    let active = 0;
    let max = 0;
    const results = await mapWithConcurrency([1, 2, 3, 4], 2, async (v) => {
      active++;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 3));
      active--;
      return v * 2;
    });
    expect(max).toBe(2);
    expect(results).toEqual([2, 4, 6, 8]);
  });

  it("runThreads shares one budget, never multiplying it", async () => {
    let peak = 0;
    let active = 0;
    const threads = [1, 2, 3].map(
      () => () =>
        new Promise<number>((resolve) => {
          active++;
          peak = Math.max(peak, active);
          setTimeout(() => {
            active--;
            resolve(1);
          }, 10);
        }),
    );
    await runThreads(threads, SEARCH_CONCURRENCY);
    expect(peak).toBeLessThanOrEqual(SEARCH_CONCURRENCY);
  });

  it("cost budget trips when the cumulative ceiling is crossed", () => {
    const budget = createTokenBudget(100);
    budget.add(60, 60); // 120 >= 100
    expect(budget.exceeded()).toBe(true);
  });
});

describe("citation enforcement", () => {
  const sources = [
    { id: 1, url: "https://a.com", status: "unverified" as const },
    { id: 2, url: "https://b.com", status: "unverified" as const },
  ];
  const learnings = [
    { text: "Alpha adoption", sourceUrls: ["https://a.com"], excerpt: "Alpha adoption reached 60 percent this year." },
    { text: "Beta momentum", sourceUrls: ["https://b.com"], excerpt: "Beta research program has lost momentum." },
  ];

  it("keeps only linked+grounded, and clear analysis", async () => {
    const report = [
      "The report reached 60 percent adoption [adoption](https://a.com).",
      "The firm hired a new chief executive [hire](https://b.com).",
      "An unlinked market share fact.",
      "Overall, this points to a growing sector.",
    ].join("\n");

    const enforced = await enforceReport(report, learnings, sources);

    expect(enforced.report).toContain("60 percent adoption");
    expect(enforced.report).toContain("Overall, this points");
    expect(enforced.report).not.toContain("chief executive");
    expect(enforced.report).not.toContain("unlinked market share fact");
    expect(enforced.report).not.toMatch(/\[hire\]\(https:\/\/b\.com\)/);
    // every surviving claim is inline-linked (nothing badge-worthy runs)
    for (const s of enforced.sentences) {
      if (s.kind === "claim") expect(s.url).toBeDefined();
    }
  });

  it("bounded retry re-grounds a failing claim and drops one it cannot", async () => {
    const fix: RepairFn = async (sentences) => sentences.map((text): Rewrite => {
      if (text.includes("chief executive")) return { original: text, rewritten: "Beta research program lost momentum [beta](https://b.com)." };
      return { original: text, rewritten: null };
    });
    const report = [
      "The firm hired a new chief executive [hire](https://b.com).",
      "An unlinked one fact.",
    ].join("\n");

    const enforced = await enforceReport(report, learnings, sources, fix);

    expect(enforced.repairedCount).toBe(1);
    expect(enforced.removedCount).toBe(1);
    expect(enforced.report).toContain("Beta research program lost momentum");
    expect(enforced.report).toContain("(https://b.com)");
    expect(enforced.report).not.toContain("unlinked one fact");
  });

  it("flags low confidence when stripping guts more than a third of factual claims", async () => {
    const report = [
      "The report reached 60 percent adoption [adoption](https://a.com).",
      "The first phony figure.",
      "The second phony figure.",
      "The third phony figure.",
      "The fourth phony figure.",
    ].join("\n");

    const enforced = await enforceReport(report, learnings, sources);

    expect(enforced.removedCount).toBe(4);
    expect(enforced.factualCount).toBe(5);
    expect(enforced.lowConfidence).toBe(true);
    expect(enforced.report).toContain("60 percent adoption");
    expect(enforced.report).not.toContain("phony figure");
  });

  it("classifies framing as analysis, not as an unlinked claim", () => {
    expect(isAnalysisSentence("Overall, this is a strong sector story.")).toBe(true);
    expect(isAnalysisSentence("This could signal support for adoption.")).toBe(true);
    expect(isAnalysisSentence("The firm reported 10k users.")).toBe(false);
    expect(segmentReport("## Sources\n[a](https://x.com)")).toHaveLength(0);
  });

  it("keeps footnote-style citations and normalizes them into real clickable links", async () => {
    const report = "Alpha adoption reached 60 percent this year [1].";
    const enforced = await enforceReport(report, learnings, sources);
    expect(enforced.report).toContain("(https://a.com)");
    expect(enforced.report).not.toMatch(/\[\d+\]/);
    expect(enforced.factualCount).toBe(1);
    expect(enforced.removedCount).toBe(0);
  });

  it("keeps bare bracket-url citations and normalizes them into real links", async () => {
    const report = "Alpha adoption reached 60 percent this year [https://a.com].";
    const enforced = await enforceReport(report, learnings, sources);
    expect(enforced.report).toContain("(https://a.com)");
    expect(enforced.report).toMatch(/\[[^\]]+\]\(https:\/\/a\.com\)/);
  });

  it("falls back to the strip path when the repair pass throws", async () => {
    const boom: RepairFn = async () => { throw new Error("LLM down"); };
    const report = "An unlinked claim that cannot be saved.";
    const enforced = await enforceReport(report, learnings, sources, boom);
    expect(enforced.report).not.toContain("cannot be saved");
    expect(enforced.removedCount).toBe(1);
  });

  it("does not fragment a sentence when the model puts the footnote after the period", async () => {
    // model pattern: "…60 percent this year. [1] The sector is growing." — the
    // [1] belongs to the prior sentence and must not split into two claims.
    const report = "Alpha adoption reached 60 percent this year. [1] The sector overall is growing.";
    const segments = segmentReport(report);
    expect(segments.length).toBe(1);
    expect(segments[0].kind).toBe("claim");
    const enforced = await enforceReport(report, learnings, sources);
    expect(enforced.report).toContain("60 percent");
    expect(enforced.report).toContain("(https://a.com)");
    expect(enforced.removedCount).toBe(0);
  });

  it("keeps uncited recap sections instead of stripping them", async () => {
    const report = [
      "Alpha adoption reached 60 percent this year [1].",
      "",
      "## Conclusion",
      "- Alpha adoption crossed 60 percent this year.",
      "- The sector is growing.",
    ].join("\n");
    const enforced = await enforceReport(report, learnings, sources);
    expect(enforced.report).toContain("Conclusion");
    expect(enforced.report).toContain("crossed 60 percent");
    expect(enforced.report).toContain("sector is growing");
    expect(enforced.lowConfidence).toBe(false);
    expect(enforced.removedCount).toBe(0);
  });
});