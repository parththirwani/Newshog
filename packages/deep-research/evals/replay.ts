import fs from "node:fs";
import path from "node:path";
import { rankSearchResults } from "../src/Search";

type Candidate = { title: string; url: string; relevant: boolean; date: string | null; byline: string | null; passage: string | null };
type Case = { id: string; mode: string; held_out: boolean; question: string; required_subquestions: string[]; known_relevant_urls: string[]; candidates: Candidate[] };
type Benchmark = { revision: string; as_of: string; held_out: string[]; cases: Case[] };

const root = path.resolve(process.cwd());
const benchmark = JSON.parse(fs.readFileSync(path.join(root, "packages/deep-research/evals/benchmark.v1.json"), "utf8")) as Benchmark;
const run = process.argv.includes("--run") ? process.argv[process.argv.indexOf("--run") + 1] : "baseline";
if (run !== "baseline" && run !== "candidate") throw new Error("--run must be baseline or candidate");

function canonicalUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  for (const key of [...u.searchParams.keys()]) if (/^(utm_|ref|source|campaign)/i.test(key)) u.searchParams.delete(key);
  u.pathname = u.pathname.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
  return u.toString();
}

function select(c: Case): Candidate[] {
  if (run === "baseline") return [...c.candidates].slice(0, 5);
  const ranked = rankSearchResults(c.question, c.candidates.map(({ relevant: _relevant, date: _date, byline: _byline, passage, ...candidate }) => ({ ...candidate, snippet: passage ?? "" })));
  const byUrl = new Map(c.candidates.map((candidate) => [canonicalUrl(candidate.url), candidate]));
  return ranked
    .map((candidate) => byUrl.get(canonicalUrl(candidate.url)))
    .filter((candidate): candidate is Candidate => Boolean(candidate))
    .slice(0, 5);
}

const rows = benchmark.cases.map((c) => {
  const selected = select(c);
  const relevant = selected.filter((x) => x.relevant && x.passage);
  const precisionAt5 = relevant.length / 5;
  const answeredSubquestions = new Set<string>();
  for (const source of relevant) {
    const text = `${source.title} ${source.passage}`.toLowerCase();
    c.required_subquestions.forEach((subquestion, index) => {
      const tokens = subquestion.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
      if (tokens.filter((token) => text.includes(token)).length >= Math.max(1, Math.ceil(tokens.length / 3))) answeredSubquestions.add(`${index}`);
    });
  }
  const evidenceCoverage = c.required_subquestions.length ? answeredSubquestions.size / c.required_subquestions.length : 0;
  const explicitGap = relevant.length === 0;
  const badSuccess = explicitGap && relevant.length === 0 && c.mode !== "article" ? true : false;
  const bylinePrecision = /byline|journalist/.test(c.question.toLowerCase())
    ? (selected.filter((x) => x.relevant && x.byline && x.passage).length / Math.max(1, selected.filter((x) => x.byline).length))
    : null;
  return {
    caseId: c.id, mode: c.mode, heldOut: c.held_out, selected: selected.map((x) => ({ url: x.url, title: x.title, relevant: x.relevant, date: x.date, byline: x.byline, passage: Boolean(x.passage) })),
    precisionAt5, evidenceCoverage, evidenceBacked: relevant.length > 0 ? 1 : 0, explicitGap, bylinePrecision, badSuccess,
    cost: { promptTokens: 0, completionTokens: 0, providerCostUsd: 0 }, latencyMs: 0,
  };
});
const held = rows.filter((x) => x.heldOut);
const avg = (items: number[]) => items.length ? items.reduce((a, b) => a + b, 0) / items.length : 0;
  const citationSupport = rows.flatMap((row) => row.selected).filter((source) => source.relevant).length
    ? rows.flatMap((row) => row.selected).filter((source) => source.relevant && source.passage).length / rows.flatMap((row) => row.selected).filter((source) => source.relevant).length
    : 0;
  const aggregate = {
  run, benchmark: benchmark.revision, asOf: benchmark.as_of, caseCount: rows.length, heldOutCount: held.length,
  retrievalPrecisionAt5: avg(held.map((x) => x.precisionAt5)), evidenceBackedCoverage: avg(held.map((x) => x.evidenceCoverage)), explicitGapRate: avg(held.map((x) => x.explicitGap ? 1 : 0)),
  citationSupport, unsupportedNamedJournalists: 0, badSuccessRuns: rows.filter((x) => x.badSuccess).length,
  medianLatencyMs: 0, worstLatencyMs: 0, medianCostUsd: 0, worstCostUsd: 0,
};
const trace = { benchmarkRevision: benchmark.revision, run, generatedAt: new Date().toISOString(), aggregate, cases: rows };
const outDir = path.join(root, "plans/deep-research/traces");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `${run}-replay.json`), JSON.stringify(trace, null, 2));
console.log(JSON.stringify({ aggregate, cases: rows.map(({ caseId, mode, heldOut, precisionAt5, evidenceCoverage, explicitGap, badSuccess }) => ({ caseId, mode, heldOut, precisionAt5, evidenceCoverage, explicitGap, badSuccess })) }, null, 2));
