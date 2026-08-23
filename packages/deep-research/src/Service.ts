import { mapWithConcurrency, runThreads } from "./Concurrency";
import type { Emitter } from "./Events";
import { preview } from "./Events";
import {
  extractJsonObject,
  parseClarificationQuestions,
  parseLearnings,
  parseResearchPlan,
  parseSubQuestionPlan,
} from "./Json";
import {
  answerPrompt,
  clarificationPrompt,
  learningsPrompt,
  planPrompt,
  repairPrompt,
  reportPrompt,
  subQuestionPrompt,
} from "./Prompts";
import type { LlmHandler } from "./Llm";
import { complete, createOpenRouterHandler, createTokenBudget, structuredCompletion } from "./Llm";
import { scrapeMarkdown } from "./Scrape";
import { getSearchProvider } from "./Search";
import { enforceReport } from "./Verify";
import type { RepairFn, Rewrite } from "./Verify";
import type { ClarificationAnswer, ClarificationQuestion, DeepResearchInput, Learning, ResearchSource, SearchResult } from "./types";

export const SEARCH_CONCURRENCY = 2;
export const MAX_SOURCES_PER_QUERY = 5;
export const MAX_CONTEXT_LENGTH = 80_000;
const MAX_CLARIFICATION_ANSWERS = 4;
const MAX_ANSWERS_TOTAL_CHARS = 6000;

function parseRepairs(text: string): Rewrite[] {
  const json = extractJsonObject(text);
  if (!Array.isArray(json.rewrites)) throw new Error("Repair response did not include a rewrites array.");
  return json.rewrites
    .filter((item) => typeof (item as { original?: string }).original === "string")
    .map((item) => {
      const { original, rewritten } = item as { original: string; rewritten?: unknown };
      return { original, rewritten: typeof rewritten === "string" && rewritten.trim() ? rewritten.trim() : null };
    })
    .slice(0, 20);
}

export class TruncatedResearchError extends Error {
  constructor() {
    super("Research run exceeded the per-run token ceiling.");
    this.name = "TruncatedResearchError";
  }
}

export function ensureActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Research cancelled");
}

export function mergeLearnings(learnings: Learning[]): Learning[] {
  const merged = new Map<string, Learning>();
  for (const learning of learnings) {
    if (!learning?.text || !Array.isArray(learning.sourceUrls)) continue;
    const text = learning.text.trim();
    const existing = merged.get(text);
    if (existing) {
      existing.sourceUrls = [...new Set([...existing.sourceUrls, ...learning.sourceUrls])];
      if (!existing.excerpt && learning.excerpt) existing.excerpt = learning.excerpt;
    } else {
      merged.set(text, { text, sourceUrls: [...new Set(learning.sourceUrls)], ...(learning.excerpt ? { excerpt: learning.excerpt } : {}) });
    }
  }
  return [...merged.values()];
}

export function citationSources(learnings: Learning[]): ResearchSource[] {
  return [...new Set(learnings.flatMap((learning) => learning.sourceUrls))].map((url, index) => ({
    id: index + 1,
    url,
    status: "unverified" as const,
  }));
}

export function buildResearchContext(query: string, answers: ClarificationAnswer[] = []): string {
  if (!answers.length) return query;
  const clarifications = answers
    .filter((answer) => answer.answer)
    .map((answer) => `- ${answer.question || answer.id}:\n  ${answer.answer}`)
    .join("\n");
  if (!clarifications) return query;
  return `Original research request:\n${query}\n\nUser clarifications:\n${clarifications}`;
}

interface ResearchState {
  learnings: Learning[];
  visitedUrls: string[];
  coveredQueries: string[];
}

interface Deps {
  handler: LlmHandler;
  budget: ReturnType<typeof createTokenBudget>;
  emit: Emitter;
  runId: string;
  analytics?: Record<string, string>;
  signal?: AbortSignal;
  search: (query: string, opts?: { engine?: string; signal?: AbortSignal }) => Promise<SearchResult[]>;
  scrape: (url: string) => Promise<string>;
  /** Injected enforcement repair (tests supply a fake; production uses the LLM). */
  repairSentences?: RepairFn;
}

function throwIfTruncated(budget: Deps["budget"]): void {
  if (budget.exceeded()) throw new TruncatedResearchError();
}

async function structured<T>(
  deps: Deps,
  opts: { prompt: string; parser: (text: string) => T; purpose: string },
): Promise<T> {
  const result = await structuredCompletion({
    prompt: opts.prompt,
    parser: opts.parser,
    purpose: opts.purpose,
    handler: deps.handler,
    budget: deps.budget,
    runId: deps.runId,
    signal: deps.signal,
    emit: deps.emit,
    analytics: deps.analytics,
  });
  throwIfTruncated(deps.budget);
  return result as T;
}

async function analyzeSearchQuery(args: {
  searchQuery: { query: string; researchGoal: string };
  deps: Deps;
  state: ResearchState;
  innerConcurrency: number;
}): Promise<{ learnings: Learning[]; followUpQuestions: string[]; urls: string[] }> {
  const { searchQuery, deps, state, innerConcurrency } = args;
  ensureActive(deps.signal);
  deps.emit.emit("search.queued", { query: searchQuery.query });
  deps.emit.emit("search.started", { query: searchQuery.query });

  let sources: SearchResult[];
  try {
    sources = await deps.search(searchQuery.query, { signal: deps.signal });
    deps.emit.emit("search.completed", { query: searchQuery.query, sourceCount: sources.length });
    deps.emit.emit("sources.discovered", { query: searchQuery.query, urls: sources.map((s) => s.url) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.emit.emit("search.failed", { query: searchQuery.query, message });
    deps.emit.emit("warning", { message: `Continuing after a failed search: ${searchQuery.query}` });
    return { learnings: [], followUpQuestions: [], urls: [] };
  }

  for (const url of sources.map((s) => s.url)) {
    state.visitedUrls.push(url);
    if (!state.coveredQueries.includes(searchQuery.query)) state.coveredQueries.push(searchQuery.query);
  }

  const selected = sources.slice(0, MAX_SOURCES_PER_QUERY);
  const scraped = await mapWithConcurrency(selected, innerConcurrency, async (source) => {
    try {
      return { ...source, markdown: await deps.scrape(source.url) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.emit.emit("warning", { message: `Could not scrape ${source.url}: ${message}` });
      return { ...source, markdown: source.snippet };
    }
  });

  const contents = scraped
    .filter((source) => source.markdown)
    .map((source) => `Source: ${source.url}\n${source.markdown}`)
    .join("\n\n")
    .slice(0, MAX_CONTEXT_LENGTH);
  if (!contents) {
    return { learnings: [], followUpQuestions: [], urls: sources.map((s) => s.url) };
  }

  deps.emit.emit("content.processing.started", { query: searchQuery.query, contentCount: scraped.length });
  try {
    const extracted = await structured(deps, {
      prompt: learningsPrompt(searchQuery.query, contents),
      parser: (text) => parseLearnings(text, scraped.map((source) => source.url)),
      purpose: "extract_learnings",
    });
    deps.emit.emit("content.processing.completed", { query: searchQuery.query });
    for (const learning of extracted.learnings) deps.emit.emit("learning.created", { query: searchQuery.query, learning });
    for (const question of extracted.followUpQuestions) deps.emit.emit("follow_up.created", { query: searchQuery.query, question });
    deps.emit.emit("cost.updated", {
      promptTokens: deps.budget.promptTokens,
      completionTokens: deps.budget.completionTokens,
      ceiling: deps.budget.ceiling,
      exceeded: deps.budget.exceeded(),
    });
    return { learnings: extracted.learnings, followUpQuestions: extracted.followUpQuestions, urls: sources.map((s) => s.url) };
  } catch (error) {
    if (error instanceof TruncatedResearchError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    deps.emit.emit("warning", { message: `Could not analyze sources for ${searchQuery.query}: ${message}` });
    return { learnings: [], followUpQuestions: [], urls: sources.map((s) => s.url) };
  }
}

async function research(args: {
  query: string;
  breadth: number;
  depth: number;
  deps: Deps;
  state: ResearchState;
  innerConcurrency: number;
}): Promise<void> {
  const { query, breadth, depth, deps, state, innerConcurrency } = args;
  ensureActive(deps.signal);

  deps.emit.emit("research.plan.started", { query: preview(query), breadth, depth });
  const queries = await structured(deps, {
    prompt: planPrompt(query, breadth, state.learnings, state.coveredQueries),
    parser: parseResearchPlan,
    purpose: "generate_search_plan",
  });
  for (const q of queries) if (!state.coveredQueries.includes(q.query)) state.coveredQueries.push(q.query);
  deps.emit.emit("research.plan.completed", { queries });

  const results = await mapWithConcurrency(queries, innerConcurrency, async (searchQuery) => {
    ensureActive(deps.signal);
    const result = await analyzeSearchQuery({ searchQuery, deps, state, innerConcurrency });
    deps.emit.emit("research.progress", {
      totalQueries: queries.length,
      currentDepth: depth,
      currentQuery: searchQuery.query,
      coveredQueries: state.coveredQueries.length,
    });
    return result;
  });
  ensureActive(deps.signal);
  throwIfTruncated(deps.budget);

  state.learnings = mergeLearnings([...state.learnings, ...results.flatMap((result) => result.learnings)]);
  state.visitedUrls = [...new Set([...state.visitedUrls, ...results.flatMap((result) => result.urls)])];

  if (depth <= 1) return;
  const nextQuestions = [...new Set(results.flatMap((result) => result.followUpQuestions))].slice(0, Math.ceil(breadth / 2));
  if (nextQuestions.length === 0) return;

  deps.emit.emit("research.recursing", {
    nextDepth: depth - 1,
    nextBreadth: Math.max(1, Math.ceil(breadth / 2)),
    questionCount: nextQuestions.length,
  });
  await research({
    query: `Previous research task: ${query}\n\nFollow-up research directions:\n${nextQuestions.map((question) => `- ${question}`).join("\n")}`,
    breadth: Math.max(1, Math.ceil(breadth / 2)),
    depth: depth - 1,
    deps,
    state,
    innerConcurrency,
  });
}

async function generateFinal(args: {
  query: string;
  mode: "answer" | "report";
  deps: Deps;
  state: ResearchState;
}): Promise<{ text: string; sources: ResearchSource[]; lowConfidence: boolean }> {
  const { query, mode, deps, state } = args;
  const sources = citationSources(state.learnings);
  const isReport = mode === "report";
  const operation = isReport ? "report.generation" : "answer.generation";
  deps.emit.emit(`${operation}.started`, { learningCount: state.learnings.length });
  ensureActive(deps.signal);
  throwIfTruncated(deps.budget);

  const prompt = isReport ? reportPrompt(query, state.learnings, sources) : answerPrompt(query, state.learnings, sources);
  const response = await complete({
    prompt,
    system: "You are a rigorous research writer. Do not invent facts or sources.",
    handler: deps.handler,
    budget: deps.budget,
    signal: deps.signal,
  });
  throwIfTruncated(deps.budget);
  deps.emit.emit(`${operation}.completed`, { length: response.text.length, model: response.model });

  const repair: RepairFn = deps.repairSentences ?? ((failing, learnings) => defaultRepair(deps, failing, learnings));
  const result = await enforceReport(response.text, state.learnings, sources, repair);
  throwIfTruncated(deps.budget);
  // An empty report is never a success — treat fully-stripped runs as low-confidence.
  if (!result.report.trim()) result.lowConfidence = true;

  // Sources stay typed for the persisted audit trail: mark grounded urls as
  // verified so the record reflects what actually survived, but the enum is
  // never surfaced through the client route.
  for (const source of sources) {
    if (result.groundedSources.includes(source.url)) source.status = "verified" as ResearchSource["status"];
  }
  deps.emit.emit("verification.completed", {
    factualCount: result.factualCount,
    repaired: result.repairedCount,
    removed: result.removedCount,
    lowConfidence: result.lowConfidence,
  });
  return { text: result.report, sources, lowConfidence: result.lowConfidence };
}

/** Default bounded-repair pass: one structured LLM call on the failing sentences.
 *  A malformed repair response degrades to the strip path (never crashes the run). */
async function defaultRepair(
  deps: Deps,
  failing: string[],
  learnings: Learning[],
): Promise<Rewrite[]> {
  if (!failing.length) return [];
  try {
    const result = await structured<{ rewrites: Rewrite[] }>(deps, {
      prompt: repairPrompt(failing, learnings),
      parser: (text) => ({ rewrites: parseRepairs(text) }),
      purpose: "repair_citations",
    });
    return result.rewrites;
  } catch (error) {
    deps.emit.emit("warning", { message: `Could not repair citations (stripping instead): ${error instanceof Error ? error.message : String(error)}` });
    return [];
  }
}

export interface ResearchOutcome {
  learnings: Learning[];
  visitedUrls: string[];
  coveredQueries: string[];
  sources: ResearchSource[];
  text?: string;
  answer?: string;
  report?: string;
  promptTokens: number;
  completionTokens: number;
  truncated: boolean;
  truncationReason?: string;
  /** Finished, but stripping gutted a large share of facts; treat with extra scrutiny. */
  lowConfidence?: boolean;
}

export async function runResearch(input: DeepResearchInput, deps: Partial<Deps> & { emit: Emitter }): Promise<ResearchOutcome> {
  if (!input.clarificationAnswers?.length && !input.skipClarification) {
    throw new Error("clarificationAnswers are required unless skipClarification is explicitly set.");
  }

  const budget = deps.budget ?? createTokenBudget();
  const handler = deps.handler ?? createOpenRouterHandler();
  const search = deps.search ?? ((query: string, opts?: { signal?: AbortSignal }) => getSearchProvider().search(query, opts));
  const scrape = deps.scrape ?? scrapeMarkdown;

  const fullDeps: Deps = {
    handler,
    budget,
    emit: deps.emit,
    runId: deps.runId ?? deps.emit.runId,
    ...(deps.analytics ? { analytics: deps.analytics } : {}),
    ...(deps.signal ? { signal: deps.signal } : {}),
    search,
    scrape,
  };

  const context = buildResearchContext(input.query, input.clarificationAnswers ?? []);
  const state: ResearchState = { learnings: [], visitedUrls: [], coveredQueries: [] };
  fullDeps.emit.emit("research.started", { query: input.query, breadth: input.breadth, depth: input.depth, mode: input.mode });

  let truncated = false;
  try {
    let plan: { threads: string[]; independent: boolean };
    try {
      plan = await structured(fullDeps, {
        prompt: subQuestionPrompt(context),
        parser: parseSubQuestionPlan,
        purpose: "identify_sub_questions",
      });
    } catch (error) {
      if (error instanceof TruncatedResearchError) throw error;
      // planning step is non-fatal — treat as one linear thread
      plan = { threads: [context], independent: false };
    }

    if (plan.independent && plan.threads.length > 1) {
      // Upfront query-space split: seed covered queries with every thread's scope
      // so same-tick plans don't collide — threads won't re-search siblings' ground.
      state.coveredQueries = [...plan.threads];
      fullDeps.emit.emit("thread.started", { threadCount: plan.threads.length, threads: plan.threads });
      const perThreadBreadth = Math.max(1, Math.ceil(input.breadth / plan.threads.length));
      await runThreads(
        plan.threads.map(
          (thread) => () =>
            research({
              query: thread,
              breadth: perThreadBreadth,
              depth: input.depth,
              deps: fullDeps,
              state,
              innerConcurrency: 1, // shared budget: threads must not multiply the pool
            }),
        ),
        SEARCH_CONCURRENCY,
      );
      fullDeps.emit.emit("thread.completed", { threadCount: plan.threads.length });
    } else {
      await research({
        query: context,
        breadth: input.breadth,
        depth: input.depth,
        deps: fullDeps,
        state,
        innerConcurrency: SEARCH_CONCURRENCY,
      });
    }

    ensureActive(fullDeps.signal);
    throwIfTruncated(fullDeps.budget);
    state.learnings = mergeLearnings(state.learnings);

    const final = await generateFinal({ query: context, mode: input.mode, deps: fullDeps, state });
    fullDeps.emit.emit("research.completed", {
      learningCount: state.learnings.length,
      visitedUrls: state.visitedUrls.length,
      promptTokens: budget.promptTokens,
      completionTokens: budget.completionTokens,
    });
    const outcome: ResearchOutcome = {
      learnings: state.learnings,
      visitedUrls: [...new Set(state.visitedUrls)],
      coveredQueries: [...state.coveredQueries],
      sources: final.sources,
      promptTokens: budget.promptTokens,
      completionTokens: budget.completionTokens,
      truncated: false,
      lowConfidence: final.lowConfidence,
    };
    if (input.mode === "report") outcome.report = final.text;
    else outcome.answer = final.text;
    return outcome;
  } catch (error) {
    if (error instanceof TruncatedResearchError) {
      truncated = true;
      fullDeps.emit.emit("research.truncated", {
        message: error.message,
        partialLearnings: state.learnings.length,
        partialUrls: state.visitedUrls.length,
      });
    } else {
      throw error;
    }
  }

  const outcome: ResearchOutcome = {
    learnings: mergeLearnings(state.learnings),
    visitedUrls: [...new Set(state.visitedUrls)],
    coveredQueries: [...state.coveredQueries],
    sources: [],
    promptTokens: budget.promptTokens,
    completionTokens: budget.completionTokens,
    truncated,
    truncationReason: "Per-run token ceiling exceeded; returned partial results.",
  };
  return outcome;
}

export async function generateClarificationQuestions(input: { query: string }, deps: { handler: LlmHandler; signal?: AbortSignal; emit: Emitter }): Promise<ClarificationQuestion[]> {
  const budget = createTokenBudget();
  const result = await structuredCompletion({
    prompt: clarificationPrompt(input.query),
    parser: parseClarificationQuestions,
    purpose: "generate_clarifications",
    handler: deps.handler,
    budget,
    runId: deps.emit.runId,
    signal: deps.signal,
    emit: deps.emit,
  });
  return result as ClarificationQuestion[];
}

export function validateClarificationAnswers(answers: unknown): ClarificationAnswer[] {
  if (answers === undefined || answers === null) return [];
  if (!Array.isArray(answers) || answers.length > MAX_CLARIFICATION_ANSWERS) {
    throw new Error("answers must be an array containing at most 4 items.");
  }
  let totalLength = 0;
  const validated = answers.map((item, index): ClarificationAnswer => {
    if (!item || typeof item !== "object") throw new Error(`answers[${index}] must be an object.`);
    const raw = item as { id?: string; question?: string; answer?: string };
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const question = typeof raw.question === "string" ? raw.question.trim() : "";
    const answer = typeof raw.answer === "string" ? raw.answer.trim() : "";
    if (!id || !answer || answer.length > 2000) {
      throw new Error(`answers[${index}] must include id and an answer up to 2000 characters.`);
    }
    totalLength += answer.length;
    return { id, question: question.slice(0, 500), answer };
  });
  if (totalLength > MAX_ANSWERS_TOTAL_CHARS) {
    throw new Error("combined answers must not exceed 6000 characters.");
  }
  return validated;
}