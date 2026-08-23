import type { Learning, ResearchSource } from "./types";

export function planPrompt(
  query: string,
  breadth: number,
  learnings: Learning[] = [],
  coveredQueries: string[] = [],
): string {
  const prior = learnings.map((learning) => learning.text).filter(Boolean).join("\n");
  const covered = coveredQueries.filter(Boolean).join("\n- ");
  const coveredSection = covered
    ? `\n\nAlready searched (do NOT repeat these — focus on genuinely new ground):\n- ${covered}`
    : "";
  return `Generate up to ${breadth} distinct web search queries. Return only JSON: {"queries":[{"query":"...","researchGoal":"..."}]}.\n\nTask:\n${query}\n\nPrior findings:\n${prior || "(none yet)"}${coveredSection}\n\nDo not repeat searches substantially similar to the covered queries above.`;
}

export function subQuestionPrompt(query: string): string {
  return `Determine whether this research request decomposes into 2-3 GENUINELY INDEPENDENT research angles (each answerable without needing the others' findings first). If yes, return {"independent":true,"threads":["angle 1","angle 2","angle 3"]}. If the subtasks are dependent or sequential (each builds on the previous), return {"independent":false,"query":"<the request unchanged>"}.\n\nRequest:\n${query}\n\nReturn only JSON.`;
}

export function clarificationPrompt(query: string): string {
  return `Generate 2 to 4 concise clarification questions that would materially improve research for the request below. Ask only questions a user can answer. Return only JSON: {"questions":[{"id":"short_snake_case_id","question":"..."}]}.\n\nRequest:\n${query}`;
}

export function learningsPrompt(query: string, contents: string, scope = ""): string {
  const scopeLine = scope ? `\nResearch scope: ${scope}` : "";
  return `Extract concise, information-dense findings from the web sources for this research query. Include exact entities, dates, and numbers where present. Every finding must include one or more exact supporting source URLs copied from the Sources section. Do not include a finding if it is unsupported. For every finding, quote the exact supporting excerpt from the source (copy a short verbatim passage) into the "excerpt" field so the claim can be verified against source text. Return only JSON: {"learnings":[{"text":"...","sourceUrls":["https://example.com"],"excerpt":"verbatim supporting passage"}],"followUpQuestions":["..."]}.\n\nQuery:\n${query}${scopeLine}\n\nSources:\n${contents}`;
}

function formatFindings(learnings: Learning[], sources: ResearchSource[]): string {
  const sourceIds = new Map(sources.map((source) => [source.url, source.id]));
  return learnings
    .map((learning) => {
      const citations = learning.sourceUrls
        .map((url) => `[${sourceIds.get(url) ?? url}] ${url}`)
        .join(" ");
      return `- ${learning.text}\n  Excerpt: ${learning.excerpt ?? "(none)"}\n  Supporting sources: ${citations}`;
    })
    .join("\n");
}

const COMMITMENT = `Every sentence that states a specific external fact — a number, a statistic, a quote, a named event, a date, or any claim about what happened or what a source says — MUST contain an inline markdown hyperlink to the exact source it came from, immediately after the claim, in this form: [claim text](source_url). A bare bracket number like [1] that does not resolve to an href is NOT acceptable. Do not cite a source that does not actually support the claim: the claim's wording must be grounded in that source's supporting excerpt.

Sentences that are your own analysis, inference, or framing are NOT external facts and do NOT need a link. But you MUST write them so they read clearly as interpretation — lead them with a framing phrase such as "This suggests", "This could indicate", "Overall", "In our view", or "This points to" — never present your judgment as a stated fact.`;

function formatSourceRegistry(sources: ResearchSource[]): string {
  return sources.map((source) => `- [${source.id}] ${source.url}`).join("\n");
}

export function answerPrompt(query: string, learnings: Learning[], sources: ResearchSource[]): string {
  return `Answer the user's research request using the supported findings below. Be concise and accurate.\n\nCitation rule:\n${COMMITMENT}\n\nRequest:\n${query}\n\nFindings (with supporting excerpts and source URLs):\n${formatFindings(learnings, sources)}\n\nSource registry:\n${formatSourceRegistry(sources)}`;
}

export function reportPrompt(query: string, learnings: Learning[], sources: ResearchSource[]): string {
  return `Write a detailed Markdown research report using the relevant findings below. Do not invent facts.\n\nCitation rule:\n${COMMITMENT}\n\nEnd with a ## Sources section listing each URL you cited, one per line in "- [N] https://..." form for reference.\n\nRequest:\n${query}\n\nFindings (with supporting excerpts and source URLs):\n${formatFindings(learnings, sources)}\n\nSource registry:\n${formatSourceRegistry(sources)}`;
}

/**
 * Repair prompt for the post-generation enforcement pass. `failing` sentences
 * came back unlinked or not grounded; the model must either re-ground each as a
 * properly linked sentence or drop it. Returned as strict JSON so the parser
 * decides (vs. hoped-for formatting).
 */
export function repairPrompt(failing: string[], learnings: Learning[]): string {
  const evidence = learnings
    .map((l) => `- ${l.text}\n  excerpt: ${l.excerpt ?? "(none)"} sources: ${l.sourceUrls.join(", ")}`)
    .filter(Boolean)
    .join("\n");
  const failingList = failing.map((s) => `- ${s}`).join("\n");
  return `A research report contained citations that could not be grounded in the evidence. For each failing sentence below, fix it by ONE of:
(a) rewriting the claim so it is exactly supported by a source's excerpt below, keeping an inline markdown link [claim](source_url) to the real source that grounds it; or
(b) returning "rewritten": null to drop the claim entirely if it cannot be supported.

Do NOT invent sources. Only use URLs present in the evidence below.

Evidence available:
${evidence}

Failing sentences:
${failingList}

Return only JSON: {"rewrites":[{"original":"<verbatim failing sentence>","rewritten":"<corrected sentence with inline link, or null to drop>"}]}`;
}