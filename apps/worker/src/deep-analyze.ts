import { prisma, recordLlmCall, logStage } from "@newshog/db";
import { runResearch, createTokenBudget, createOpenRouterHandler, createEventEmitter } from "@newshog/deep-research";
import type { Learning, ResearchOutcome } from "@newshog/deep-research";
import type { CoverageSignal } from "@newshog/shared";

const MAX_SEED_PREVIEW = 400;
const MAX_DIGEST_LEARNINGS = 20;

export interface DeepAnalysisResult {
  runId: string;
  promptTokens: number;
  completionTokens: number;
  digest: string;
  /** Saturation signal for the analysis prompt + deterministic scoring. */
  coverageSignal?: CoverageSignal | null;
}

/**
 * Build the saturation signal from discovered sources + their dates. Excludes
 * the submitted article's own URL; counts distinct dated sources discovered by
 * research. Returns null (never throws) when outcomes are empty.
 */
export function buildCoverageSignal(
  visitedUrls: string[],
  sourceDates: Record<string, string>,
  articleUrl?: string,
  articlePublishedAt?: string | null,
): CoverageSignal | null {
  const external = visitedUrls
    .filter((url) => url !== articleUrl)
    .filter((url) => sourceDates[url]);
  if (external.length === 0) {
    return { externalSourceCount: 0, precedesSubmittedArticle: false };
  }
  const ms = external.map((url) => Date.parse(sourceDates[url]));
  const earliest = Math.min(...ms);
  const submitted = articlePublishedAt ? Date.parse(articlePublishedAt as string) : null;
  return {
    externalSourceCount: external.length,
    earliestSourceDate: new Date(earliest).toISOString(),
    latestSourceDate: new Date(Math.max(...ms)).toISOString(),
    precedesSubmittedArticle: submitted !== null && earliest < submitted,
  };
}

/**
 * Deterministic seed query built from the scrape — no extra LLM call, and no
 * manual input from the user. Frames the article's core topic as a research
 * subject so the whole enrichment is one click.
 */
function buildSeedQuery(title: string | null, text: string): string {
  const topic = title?.trim()
    ? title.trim()
    : text.slice(0, MAX_SEED_PREVIEW).replace(/\s+/g, " ").trim();
  return [
    `Research the topic of this article: ${topic}`,
    `Recent coverage, comparable recent stories, and who is writing about this space.`,
    `Also surface whether this story is one of several similar recent stories or genuinely novel.`,
  ].join("\n");
}

function compileDigest(learnings: Learning[], sources: Array<{ id: number; url: string; status: string }>): string {
  const findings = learnings
    .slice(0, MAX_DIGEST_LEARNINGS)
    .map((l, i) => {
      const cites = l.sourceUrls.map((url) => sources.find((s) => s.url === url)?.id ?? url).join(", ");
      return `${i + 1}. ${l.text}\n   Sources: ${cites}${l.excerpt ? `\n   Excerpt: ${l.excerpt.slice(0, 300)}` : ""}`;
    })
    .join("\n\n");
  const sourceList = sources.map((s) => `[${s.id}] ${s.url} (${s.status})`).join("\n");
  return `Findings (${learnings.length}):\n${findings}\n\nSources:\n${sourceList}`;
}

/**
 * Runs the deep-research pipeline on an article's topic and returns a condensed
 * digest for the analysis prompt. Persists a DeepResearchRun row and records the
 * research cost under the analysis so credit accounting sees the extra spend.
 */
export async function deepAnalyzeArticle(props: {
  title: string | null;
  articleText: string;
  analysisId: string;
  analysisUserId?: string | null;
  articleUrl?: string;
  articlePublishedAt?: string | null;
}): Promise<DeepAnalysisResult> {
  const { title, articleText, analysisId, analysisUserId, articleUrl, articlePublishedAt } = props;
  const seed = buildSeedQuery(title, articleText);
  logStage("deep_analyze_research_start", { analysisId });

  const run = await prisma.deepResearchRun.create({
    data: {
      runId: crypto.randomUUID(),
      status: "running",
      userId: analysisUserId ?? null,
      query: seed,
      depth: 2,
      breadth: 3,
      mode: "answer",
      skipClarification: true,
      clarificationAnswers: [],
      coveredQueries: [],
      learnings: [],
      sources: [],
      visitedUrls: [],
    },
  });

  const handler = createOpenRouterHandler();
  const budget = createTokenBudget();
  let outcome;
  try {
    outcome = await runResearch(
      { query: seed, depth: 2, breadth: 3, mode: "answer", skipClarification: true, clarificationAnswers: [] },
      { handler, budget, emit: createEventEmitter({ runId: run.runId, onEvent: () => {} }) },
    );
  } catch (err) {
    await prisma.deepResearchRun.update({
      where: { runId: run.runId },
      data: { status: "failed", error: err instanceof Error ? err.message : String(err) },
    }).catch(() => {});
    throw err;
  }

  const status = outcome.truncated
    ? ("truncated" as const)
    : (outcome.lowConfidence ? ("low_confidence" as const) : ("completed" as const));
  await prisma.deepResearchRun.update({
    where: { runId: run.runId },
    data: {
      status,
      learnings: outcome.learnings,
      sources: outcome.sources,
      visitedUrls: outcome.visitedUrls,
      coveredQueries: outcome.coveredQueries,
      promptTokens: outcome.promptTokens,
      completionTokens: outcome.completionTokens,
      ...(outcome.truncationReason ? { error: outcome.truncationReason } : {}),
    },
  }).catch((err) => console.error("[deep-analyze] persist research run failed:", err));

  const digest = compileDigest(outcome.learnings, outcome.sources);
  const coverageSignal = buildCoverageSignal(outcome.visitedUrls, outcome.sourceDates, articleUrl, articlePublishedAt);

  // Record the research spend against the analysis for cost/credit accounting.
  recordLlmCall(
    "analysis_deep_research",
    { prompt_tokens: outcome.promptTokens, completion_tokens: outcome.completionTokens },
    analysisId,
  );

  logStage("deep_analyze_research_done", { analysisId, learnings: outcome.learnings.length, truncated: outcome.truncated });
  return { runId: run.runId, digest, promptTokens: outcome.promptTokens, completionTokens: outcome.completionTokens, coverageSignal };
}