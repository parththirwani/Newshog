import type { Learning, ResearchSource } from "./types";

/** Content tokens worth matching on (drops stopwords / short fragments). */
function significantTokens(text: string): Set<string> {
  const stop = new Set([
    "the", "and", "for", "are", "was", "but", "not", "you", "that", "with", "this", "have",
    "from", "they", "will", "their", "what", "about", "into", "than", "then", "them", "more",
    "also", "just", "has", "its", "been", "were", "may", "two", "one", "per", "our", "new",
    "how", "why", "who", "when", "where", "there", "would", "their", "which", "these",
  ]);
  return new Set(
    (text.toLowerCase().match(/[a-z]{4,}/g) ?? [])
      .filter((token) => !stop.has(token)),
  );
}

function excerptPool(learnings: Learning[]): Map<string, string[]> {
  const pool = new Map<string, string[]>();
  for (const learning of learnings) {
    for (const url of learning.sourceUrls) {
      if (!learning.excerpt) continue;
      if (!pool.has(url)) pool.set(url, []);
      pool.get(url)!.push(learning.excerpt);
    }
  }
  return pool;
}

/** Drop markdown link syntax and bare bracket markers so only claim words remain. */
function cleanClaim(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\d+\]/g, " ")
    .trim();
}

export function hostOf(url: string): string {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const INLINE_LINK_RE = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
const FOOTNOTE_RE = /\[(\d{1,3})\]/g;
const BRACKET_URL_RE = /\[(https?:\/\/[^\]\s,]+)[^\]]*\]/g;
const NAKED_URL_RE = /https?:\/\/\S+/g;

/**
 * Resolve every citation form a model might use to a source URL: real
 * `[text](url)` links, `[N]` footnote ids (via the source registry), bare
 * `[https://x]` bracket urls, and naked urls. A later normalize step converts
 * whichever style survives into a real clickable link for the persisted report.
 */
export function citationUrls(text: string, sources: ResearchSource[] = []): string[] {
  const byId = new Map(sources.map((s) => [s.id, s.url]));
  const urls = new Set<string>();
  let m: RegExpExecArray | null;
  for (m = INLINE_LINK_RE.exec(text); m; m = INLINE_LINK_RE.exec(text)) urls.add(m[2]);
  for (m = FOOTNOTE_RE.exec(text); m; m = FOOTNOTE_RE.exec(text)) {
    const url = byId.get(Number(m[1]));
    if (url) urls.add(url);
  }
  for (m = BRACKET_URL_RE.exec(text); m; m = BRACKET_URL_RE.exec(text)) urls.add(m[1]);
  for (m = NAKED_URL_RE.exec(text); m; m = NAKED_URL_RE.exec(text)) urls.add(m[0]);
  return [...urls];
}

/**
 * Re-express a surviving claim that was written with a bracket/footnote/url
 * citation as real `[label](url)` markdown so the persisted report always
 * contains a clickable link.
 */
export function normalizeCitation(text: string, url: string): string {
  const label = hostOf(url);
  // 1) collapse "[..., https://x, ...]" bracket lists to a single real link
  let out = text.replace(BRACKET_URL_RE, `[${label}](${url})`);
  // 2) drop bare [N] footnotes now that a real href sits in the sentence
  out = out.replace(FOOTNOTE_RE, " ").replace(/\s+/g, " ").trim();
  // 3) shorten over-long link labels (a repair pass sometimes wraps a whole
  //    sentence as the link text) to a tidy host label
  out = out.replace(INLINE_LINK_RE, (full, t, u) => (t.length > 48 ? `[${hostOf(u)}](${u})` : full));
  // 4) an href pointing at the grounding url already exists — nothing to do
  const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\(${escaped}\\)`).test(out)) return out;
  // 5) no href survived — append one before the trailing period
  const dot = out.lastIndexOf(".");
  if (dot > 0 && out.length - dot <= 3) {
    return `${out.slice(0, dot)} [${label}](${url}).${out.slice(dot + 1)}`;
  }
  return `${out} ${`[${label}](${url})`}`;
}

/**
 * True when the claim is grounded against an excerpt belonging to at least one
 * of the supplied urls. Token-overlap heuristic (an LLM judge can slot in later
 * without changing this signature).
 */
export function isGrounded(claim: string, url: string, learnings: Learning[]): boolean {
  const excerpts = excerptPool(learnings).get(url);
  if (!excerpts?.length) return false;
  const claimTokens = significantTokens(cleanClaim(claim));
  if (claimTokens.size === 0) return false;
  return excerpts.some((excerpt) => {
    const excerptTokens = significantTokens(excerpt);
    const overlap = [...claimTokens].filter((token) => excerptTokens.has(token));
    return overlap.length >= Math.max(1, Math.ceil(claimTokens.size * 0.3));
  });
}

/**
 * ponytail: analysis-vs-claim classification is a marker-phrase heuristic. It
 * WILL misclassify a fact written without one of these framing phrases as a
 * claim (and vice versa). The failure mode to watch after shipping is reports
 * coming back oddly thin or stilted after the strip pass — that tells you the
 * marker list needs widening, not that the enforcement gate is wrong. An LLM
 * classifier can replace this later without touching consumers.
 */
const ANALYSIS_MARKERS = [
  "this suggests", "this could", "this implies", "this indicates", "this points",
  "this shows", "this signals", "this suggests that", "over all", "overall,",
  "in practice", "in our view", "it appears", "it seems", "arguably", "likely",
  "perhaps", "we interpret", "taken together", "this reads", "this is a sign",
  "this is notable", "this matters", "this is worth",
  "here is a summary", "here is the research", "here is a research", "in summary",
  "in conclusion", "to summarize", "based on the provided findings",
];

// Recap sections (Conclusion / Summary / Key findings) restate facts already
// cited earlier in the report, so the model often writes them without fresh
// inline citations. Stripping them guts an otherwise-solid report — treat them
// as recap (kept, not scored/stripped), except items that DO carry a citation.
const RECAP_HEADINGS = ["conclusion", "summary", "key findings", "recap", "overview"];

export function isAnalysisSentence(text: string): boolean {
  const lower = cleanClaim(text).toLowerCase();
  return ANALYSIS_MARKERS.some((marker) => lower.includes(marker));
}

export interface Sentence {
  kind: "claim" | "analysis";
  text: string;
  url?: string;
}

/**
 * Split a report into sentence units, skipping headings and the trailing
 * "## Sources" registry (which is reference links, not claims). A sentence is
 * a claim if it carries any citation (footnote number, url, or link) or if it
 * was written without an analysis framing marker; it is analysis only when a
 * framing phrase marks it as interpretation.
 */
export function segmentReport(report: string): Sentence[] {
  const out: Sentence[] = [];
  let inSources = false;
  let inRecap = false;
  for (const line of report.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^#{1,6}\s/.test(trimmed)) {
      if (/^sources?\s*$/i.test(trimmed.replace(/[#\s]/g, ""))) inSources = true;
      const heading = trimmed.replace(/^#{1,6}\s*/i, "").toLowerCase().trim();
      inRecap = RECAP_HEADINGS.some((h) => heading.includes(h));
      continue;
    }
    if (inSources) continue;
    for (const unit of splitUnits(trimmed)) {
      if (!unit) continue;
      const urls = citationUrls(unit);
      out.push({
        kind: isAnalysisSentence(unit) || (inRecap && urls.length === 0) ? "analysis" : "claim",
        text: unit,
        ...(urls.length ? { url: urls[0] } : {}),
      });
    }
  }
  return out;
}

function splitUnits(line: string): string[] {
  // A model frequently puts the footnote/link AFTER the period ("…by 2030. [2]"),
  // and real links "[text](url)" start with "[". So do NOT treat "[" as a fresh
  // sentence boundary — the citation belongs to the sentence before it.
  return line.split(/(?<=\.)\s+(?=[A-Z0-9"'“])/).map((s) => s.trim()).filter(Boolean);
}

function isGroundedClaim(sentence: Sentence, learnings: Learning[], sources: ResearchSource[]): string | undefined {
  if (sentence.kind === "analysis") return undefined;
  const urls = citationUrls(sentence.text, sources);
  if (!urls.length) return undefined;
  const grounded = urls.find((url) => isGrounded(sentence.text, url, learnings));
  return grounded;
}

export interface Rewrite {
  original: string;
  rewritten: string | null;
}

export type RepairFn = (failing: string[], learnings: Learning[], sources: ResearchSource[]) => Promise<Rewrite[]>;

export interface EnforcementResult {
  report: string;
  sentences: Sentence[];
  repairedCount: number;
  removedCount: number;
  factualCount: number;
  lowConfidence: boolean;
  groundedSources: string[];
}

export const LOW_CONFIDENCE_STRIP_RATIO = 0.3;

/**
 * Post-generation enforcement gate. Only sentences that are (a) plain analysis
 * or (b) factual claims grounded in a stored excerpt — for a source they cite
 * in ANY style ([text](url), [N], [url], naked url) — survive. Ungrounded or
 * citation-less claims first get ONE bounded repair pass (rewrite to be properly
 * grounded+linked, or drop), then anything still failing is stripped
 * programmatically. Surviving grounded claims are normalized to real
 * `[label](url)` markdown so the persisted report always renders clickable.
 * A report that loses >LOW_CONFIDENCE_STRIP_RATIO of its factual claims is
 * flagged lowConfidence rather than shipped as if it were solid.
 */
export async function enforceReport(
  report: string,
  learnings: Learning[],
  sources: ResearchSource[],
  repair?: RepairFn,
): Promise<EnforcementResult> {
  const first = segmentReport(report);
  const factualCount = first.filter((s) => s.kind === "claim").length;
  const firstViolations = first.filter((s) => !isGroundedClaim(s, learnings, sources)).map((s) => s.text);

  let current = report;
  let repairedCount = 0;
  let removedCount = 0;
  if (firstViolations.length && repair) {
    let rewrites: Rewrite[] = [];
    try {
      rewrites = await repair(firstViolations, learnings, sources);
    } catch {
      rewrites = []; // a broken repair must never crash the run — strip instead
    }
    repairedCount = rewrites.filter((r) => r.rewritten && r.rewritten !== r.original).length;
    removedCount += rewrites.filter((r) => r.rewritten === null).length;
    current = applyRewrites(current, rewrites);
  }

  // Second sweep: strip what still violates, normalize what survives.
  const groundedSources = new Set<string>();
  const second = segmentReport(current);
  for (const sentence of second) {
    if (sentence.kind === "analysis") continue;
    const groundedUrl = isGroundedClaim(sentence, learnings, sources);
    if (!groundedUrl) {
      const idx = current.indexOf(sentence.text);
      if (idx === -1) continue;
      let end = idx + sentence.text.length;
      while (end < current.length && /\s/.test(current[end])) end++;
      current = current.slice(0, idx) + current.slice(end);
      removedCount++;
      continue;
    }
    groundedSources.add(groundedUrl);
    const fixed = normalizeCitation(sentence.text, groundedUrl);
    if (fixed !== sentence.text) {
      const idx = current.indexOf(sentence.text);
      if (idx !== -1) current = current.slice(0, idx) + fixed + current.slice(idx + sentence.text.length);
    }
  }
  current = current.replace(/\n{3,}/g, "\n\n").trim();
  // normalizeCitation can stitch two sentences together if a footnote ran
  // sentences without a real link; the trim shouldn't destroy structure.
  const finalSegments = segmentReport(current);
  const lowConfidence = factualCount > 0 && removedCount / factualCount > LOW_CONFIDENCE_STRIP_RATIO;

  return { sentences: finalSegments, report: current, repairedCount, removedCount, factualCount, lowConfidence, groundedSources: [...groundedSources] };
}

function applyRewrites(report: string, rewrites: Rewrite[]): string {
  let out = report;
  for (const { original, rewritten } of rewrites) {
    const idx = out.indexOf(original);
    if (idx === -1) continue;
    out = out.slice(0, idx) + (rewritten ?? "") + out.slice(idx + original.length);
  }
  return out;
}