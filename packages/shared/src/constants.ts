export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const LLM_MODEL = "anthropic/claude-3-haiku";
export const LLM_MAX_TOKENS = 1500;
export const LLM_MAX_INPUT_CHARS = 8000;

export const SCORE_THRESHOLD_LOW = 30;
export const SCORE_THRESHOLD_HIGH = 60;

export const MAX_ANGLES = 3;

// Decay-rate categories for story velocity. Order is fixed — standard is the
// safe fallback for old rows / corrupt LLM output.
export const STORY_VELOCITIES = ["breaking", "standard", "evergreen"] as const;
export const DEFAULT_VELOCITY = "standard";

// Cost per 1M tokens (USD), for the /stats dashboard. Hardcoded, not a
// live price lookup — bump the number when the model or plan changes.
export const LLM_PROMPT_PRICE_PER_M = 0.25;
export const LLM_COMPLETION_PRICE_PER_M = 1.25;
export const LLM_DAILY_ALERT_USD = 5;

export const ANALYSIS_DEDUPE_HOURS = 24;

// Coverage saturation: how many independent external sources it takes for a
// story to stop being a fresh/breaking pitch. Tunable without re-prompting.
export const SATURATION_THRESHOLD = 10;

/**
 * Saturation score penalty, keyed by external source count. All values are
 * deductions applied deterministically in postprocessing — the model never
 * sees or sets them. Keeps the "is this saturated" judgment auditable and
 * adjustable independent of prompt wording. Clamp inputs >= the last bucket.
 */
const SATURATION_PENALTIES: Array<number | undefined> = [
  0,    // 0-0  sources: no penalty (first-to-cover)
  0,    // 1
  0,    // 2
  0,    // 3
  2,    // 4
  3,    // 5
  5,    // 6
  7,    // 7
  8,    // 8
  9,    // 9
  10,   // 10+ — heavily covered: meaningful deduction
];
export function saturationPenalty(externalSourceCount: number): number {
  const i = Math.min(Math.max(0, Math.floor(externalSourceCount)), SATURATION_PENALTIES.length - 1);
  return SATURATION_PENALTIES[i] ?? 0;
}

// Age beyond which a story can never be "breaking" — deterministic floor,
// independent of the LLM/critique passes. See applyGrounding in the worker.
export const STALE_DAYS = 90;

/**
 * Age score penalty, keyed by how many days ago the article was published.
 * Same deterministic postprocess pattern as SATURATION_PENALTIES: applied in
 * code, never seen or set by the model, tunable without re-prompting.
 *
 * Buckets are explicitly tiered rather than a flat >90 cliff: a 91-day-old
 * story might legitimately have a fresh resurfacing hook (worth a modest
 * penalty), while an 11-year-old one (e.g. the Whetlab reference case) almost
 * never does and needs a real floor. Deliberate — if someone collapses these
 * buckets in a refactor, that "old vs ancient" distinction is the intent to
 * preserve, not just arithmetically, but because magnitudes differ by an order
 * of magnitude.
 */
const AGE_PENALTIES: Array<{ maxDays: number; penalty: number }> = [
  { maxDays: 7, penalty: 0 },    // current/breaking-eligible
  { maxDays: 30, penalty: 5 },   // standard cycle
  { maxDays: 90, penalty: 10 },  // late standard / approaching stale
  { maxDays: 365, penalty: 25 }, // old — needs a concrete resurfacing hook
  { maxDays: Infinity, penalty: 40 }, // ancient — real floor (Whetlab class)
];
export function agePenalty(daysOld: number): number {
  if (!Number.isFinite(daysOld) || daysOld <= 0) return 0;
  return AGE_PENALTIES.find((b) => daysOld <= b.maxDays)?.penalty ?? 0;
}
