/**
 * Live smoke test: run N deep-research prompts through the real pipeline
 * (OpenRouter + DDG→Bing failover search + jsdom/Readability scrape), captured
 * per prompt. Run from apps/worker so workspace deps resolve:
 *
 *   bun --env-file=../../.env src/deep-research-smoke.ts [--depth 1] [--breadth 2] [--prompts 3]
 *
 * Writes src/deep-research-smoke.json and prints a per-prompt summary.
 */
import fs from "node:fs";
import { runResearch, createOpenRouterHandler, createTokenBudget, createEventEmitter } from "@newshog/deep-research";

const args = process.argv.slice(2);
const flag = (name: string, dflt: number) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? dflt : Number(args[i + 1]);
};
const DEPTH = flag("depth", 1);
const BREADTH = flag("breadth", 2);
const LIMIT = flag("prompts", 3);

const PROMPTS: Array<{ query: string; mode: "answer" | "report" }> = [
  { query: "What are the key recent trends in B2B SaaS pricing models for 2025?\nFocus on transparent/usage-based pricing.", mode: "answer" },
  { query: "Recent coverage of the EU AI Act enforcement, and what it means for US startups exporting to Europe.", mode: "answer" },
  { query: "Which journalists cover climate tech funding rounds? Identify outlets and named writers reporting on Series A climate deals in the last 6 months.", mode: "report" },
  { query: "Market context: how are vertical AI agents for legal workflows being funded and adopted?", mode: "answer" },
  { query: "Who is currently covering identity and access management (IAM) startups, and what is the competitive angle?", mode: "report" },
  { query: "What data exists on retention rates for fintech neobanks versus legacy banks in Europe 2024-2025?", mode: "answer" },
  { query: "Compare DuckDB vs Apache Arrow vs Parquet for analytics — who is reporting on each and why does it matter now?", mode: "report" },
  { query: "Recent research on developer productivity tools and AI pair-programming — coverage trends and named vendors.", mode: "answer" },
  { query: "What is the current state of decentralized/sovereign AI infrastructure in India, and which players are investing?", mode: "report" },
  { query: "Which data cells or themes are driving the current cybersecurity funding wave? Focus on SASE / zero trust.", mode: "answer" },
];

const RESULTS: Array<Record<string, unknown>> = [];

for (let i = 0; i < Math.min(LIMIT, PROMPTS.length); i++) {
  const budget = createTokenBudget(Number(process.env.MAX_RUN_TOKENS ?? 300_000));
  const started = Date.now();
  let entry: Record<string, unknown>;
  try {
    const outcome = await runResearch(
      { ...PROMPTS[i], depth: DEPTH, breadth: BREADTH, skipClarification: true },
      { handler: createOpenRouterHandler(), budget, emit: createEventEmitter({ onEvent: () => {} }) },
    );
    const text = (outcome.answer ?? outcome.report ?? "") as string;
    entry = {
      ok: Boolean(text),
      truncated: outcome.truncated,
      truncationReason: outcome.truncationReason ?? null,
      learnings: outcome.learnings.length,
      sources: outcome.sources.length,
      failed: outcome.sources.filter((s) => s.status === "failed").length,
      promptTokens: outcome.promptTokens,
      completionTokens: outcome.completionTokens,
      takenMs: Date.now() - started,
      textLength: text.length,
      answerSnippet: text.slice(0, 160),
    };
  } catch (err) {
    entry = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      takenMs: Date.now() - started,
    };
  }
  RESULTS.push(entry);
  console.log(
    `prompt ${i + 1}/${Math.min(LIMIT, PROMPTS.length)} ok=${entry.ok} learnings=${entry.learnings ?? "-"} ` +
      `sources=${entry.sources ?? "-"} failed=${entry.failed ?? "-"} ${entry.promptTokens ?? 0}+${entry.completionTokens ?? 0}tk ${entry.takenMs}ms`,
  );
}

fs.writeFileSync(new URL("./deep-research-smoke.json", import.meta.url), JSON.stringify(RESULTS, null, 2));
const passed = RESULTS.filter((r) => r.ok).length;
const grounded = RESULTS.filter((r) => (r.sources as number) > 0).length;
console.log(`\n== PASSED ${passed}/${RESULTS.length} | grounded (sources>0) ${grounded}/${RESULTS.length} ==`);
for (const r of RESULTS) {
  console.log(`${r.ok ? "PASS" : "FAIL"} | ${r.textLength ?? 0} chars | ${r.failed ?? "-"} failed cites | ${r.promptTokens ?? 0}+${r.completionTokens ?? 0} tk`);
}