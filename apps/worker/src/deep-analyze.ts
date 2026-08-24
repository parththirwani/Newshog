import { prisma, recordLlmCall, logStage } from "@newshog/db";
import {
  runResearch,
  createTokenBudget,
  createOpenRouterHandler,
  createEventEmitter,
  getSearchProvider,
  scrapeMarkdown,
  extractPublishDate,
} from "@newshog/deep-research";
import type { Learning, ResearchOutcome, SearchResult } from "@newshog/deep-research";
import { OPENROUTER_BASE_URL, LLM_MODEL, STALE_DAYS } from "@newshog/shared";
import type { CoverageSignal, RecentRelatedCoverage, ResurfacingConfirmation } from "@newshog/shared";
import OpenAI from "openai";

const MAX_SEED_PREVIEW = 400;
const MAX_DIGEST_LEARNINGS = 20;

// Rolling window (days, relative to today) a source must fall inside for it to
// count as "recent" evidence of a resurfacing. Old-article only.
export const RESURFACING_WINDOW_DAYS = 60;
const RESURFACING_MAX_CANDIDATES = 5;

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

/** The resurfacing query only runs for old articles (> STALE_DAYS). Pure gate. */
export function shouldRunResurfacing(articlePublishedAt?: string | null): boolean {
  if (!articlePublishedAt) return false;
  const ms = Date.parse(articlePublishedAt);
  if (Number.isNaN(ms)) return false;
  return Math.floor((Date.now() - ms) / 86_400_000) > STALE_DAYS;
}

/** Recency-biased query terms for finding NEW coverage of an old story, not the original event. */
export function buildResurfacingQuery(title: string | null, text: string): string {
  const topic = title?.trim()
    ? title.trim()
    : text.slice(0, MAX_SEED_PREVIEW).replace(/\s+/g, " ").trim();
  return `${topic} latest update ${new Date().getFullYear()}`;
}

/**
 * One additional recency-biased search, scraping candidates for real publish
 * dates within RESURFACING_WINDOW_DAYS of TODAY. Search + scrape are HTTP (no
 * token spend), so this is effectively one extra query that consumes nothing
 * against the LLM budget — no new concurrency lane, sequential and bounded.
 */
export async function findRecentRelatedCoverage(
  query: string,
  articleUrl?: string,
): Promise<RecentRelatedCoverage[]> {
  let results: SearchResult[];
  try {
    results = await getSearchProvider().search(query);
  } catch {
    return [];
  }
  const oldest = Date.now() - RESURFACING_WINDOW_DAYS * 86_400_000;
  const out: RecentRelatedCoverage[] = [];
  for (const r of results.slice(0, RESURFACING_MAX_CANDIDATES)) {
    if (r.url === articleUrl) continue;
    try {
      const md = await scrapeMarkdown(r.url);
      const d = extractPublishDate(md);
      if (!d) continue;
      const t = d.getTime();
      if (t < oldest || t > Date.now()) continue;
      out.push({
        url: r.url,
        date: d.toISOString(),
        snippet: (r.snippet || md.replace(/\s+/g, " ").trim()).slice(0, 300),
      });
    } catch {
      // skip unscrapable / undatable candidates
    }
  }
  return out;
}

/**
 * Pure fail-closed interpretation of the confirmation LLM's raw answer.
 * `confirmed` can only be true when evidence_url is a real URL present in
 * candidates. Any confirmed=true with a missing/fabricated evidence_url → false.
 */
export function parseResurfacingConfirmation(
  raw: unknown,
  candidates: RecentRelatedCoverage[],
): ResurfacingConfirmation {
  const obj = (raw ?? {}) as { resurfacing_confirmed?: unknown; evidence_url?: unknown };
  const allowed = new Set(candidates.map((c) => c.url));
  const evidenceUrl = typeof obj.evidence_url === "string" ? obj.evidence_url : null;
  if (obj.resurfacing_confirmed !== true || !evidenceUrl || !allowed.has(evidenceUrl)) {
    return { confirmed: false, evidenceUrl: null };
  }
  const ev = candidates.find((c) => c.url === evidenceUrl);
  return { confirmed: true, evidenceUrl, evidenceDate: ev?.date };
}

const RESURFACING_TOOL = {
  type: "function" as const,
  function: {
    name: "submit_resurfacing",
    description: "Confirm whether an old story has a genuine recent development",
    parameters: {
      type: "object",
      required: ["resurfacing_confirmed", "resurfacing_reason", "evidence_url"],
      properties: {
        resurfacing_confirmed: { type: "boolean", description: "True only if a recent source reports a real, new development about this story." },
        resurfacing_reason: { type: "string", description: "Required if confirmed. Name what specifically changed/developed." },
        evidence_url: { type: ["string", "null"], description: "Required if confirmed. MUST be one of the candidate URLs provided — never invent one." },
      },
    },
  },
};

let resurfacingClient: OpenAI;
// Confirmation step mirrors the per-candidate LLM judgment pattern used for
// journalist-request matching: the model judges each candidate rather than a
// filter query deciding. Kept here so it can share this module's analysisId.
export async function confirmResurfacing(
  candidates: RecentRelatedCoverage[],
  title: string | null,
  analysisId?: string,
): Promise<ResurfacingConfirmation | null> {
  if (!candidates.length) return null;
  if (!resurfacingClient) {
    resurfacingClient = new OpenAI({ baseURL: OPENROUTER_BASE_URL, apiKey: process.env.OPENROUTER_API_KEY! });
  }
  const list = candidates
    .map((c, i) => `[${i + 1}] ${c.url} (${c.date.slice(0, 10)}): ${c.snippet}`)
    .join("\n");
  const response = await resurfacingClient.chat.completions.create({
    model: LLM_MODEL,
    max_tokens: 300,
    tools: [RESURFACING_TOOL],
    tool_choice: { type: "function", function: { name: "submit_resurfacing" } },
    messages: [
      {
        role: "system",
        content:
          "You judge whether an OLD news story has a genuinely NEW development reported recently. A source merely mentioning or re-hashing the original event is NOT evidence of resurfacing — it must report something actually new (a follow-up, decision, legal development, anniversary with news hook, relaunch, etc.). evidence_url must be one of the provided candidate URLs exactly.",
      },
      {
        role: "user",
        content: `Original article: ${title ?? "(unknown)"}\n\nRecent coverage candidates:\n${list}\n\nConfirm resurfacing only if one candidate reports a real new development.`,
      },
    ],
  });

  await recordLlmCall("resurfacing_confirmation", response.usage, analysisId);

  const toolCall = response.choices?.[0]?.message.tool_calls?.[0];
  let raw: unknown = null;
  try {
    raw = toolCall ? JSON.parse(toolCall.function.arguments) : null;
  } catch {
    raw = null;
  }
  const rawObj = (raw ?? {}) as { resurfacing_confirmed?: boolean; evidence_url?: unknown };
  if (rawObj.resurfacing_confirmed === true) {
    const valid =
      typeof rawObj.evidence_url === "string" && candidates.some((c) => c.url === rawObj.evidence_url);
    if (!valid) {
      console.error(`[resurfacing] confirmed=true with invalid/missing evidence_url, failing closed for ${analysisId ?? "?"}`);
    }
  }
  return parseResurfacingConfirmation(raw, candidates);
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

  // Resurfacing detection: old-article only, deep-research path only. Adds the
  // recency query + evidence-gated confirmation into the coverage signal so the
  // deterministic postprocess can relax the staleness penalty when a real new
  // development exists. Any failure is non-fatal — degrade to the plain signal.
  if (coverageSignal && shouldRunResurfacing(articlePublishedAt)) {
    try {
      const recencyQuery = buildResurfacingQuery(title, articleText);
      const recent = await findRecentRelatedCoverage(recencyQuery, articleUrl);
      if (recent.length) {
        coverageSignal.recentRelatedCoverage = recent;
        const resurfacing = await confirmResurfacing(recent, title, analysisId);
        if (resurfacing) coverageSignal.resurfacing = resurfacing;
      }
    } catch (err) {
      console.error(`[deep-analyze] resurfacing detection failed for ${analysisId}:`, err);
    }
  }

  // Record the research spend against the analysis for cost/credit accounting.
  recordLlmCall(
    "analysis_deep_research",
    { prompt_tokens: outcome.promptTokens, completion_tokens: outcome.completionTokens },
    analysisId,
  );

  logStage("deep_analyze_research_done", { analysisId, learnings: outcome.learnings.length, truncated: outcome.truncated });
  return { runId: run.runId, digest, promptTokens: outcome.promptTokens, completionTokens: outcome.completionTokens, coverageSignal };
}