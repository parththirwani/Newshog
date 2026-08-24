import { logStage } from "@newshog/db";
import { SATURATION_THRESHOLD, STALE_DAYS, agePenalty, saturationPenalty } from "@newshog/shared";
import type { CoverageSignal, EventTiming, LlmAnalysis, StoryVelocity } from "@newshog/shared";

export interface GroundingInput {
  coverageSignal?: CoverageSignal | null;
  sourcePublishedAt?: string | null;
  eventTiming?: EventTiming | null;
}

/**
 * Deterministic post-processing applied to the model's analysis on
 * deep-research-backed calls. Both adjustments are hard overrides in code, not
 * prompt suggestions — same principle as the velocity guardrail: a story that
 * is demonstrably saturated or downstream cannot be scored/timed as a fresh
 * origin on the model's word alone.
 */
export function applyGrounding(base: LlmAnalysis, grounding: GroundingInput): {
  score: number;
  velocity: StoryVelocity;
  noveltyScore?: number;
  eventTiming?: EventTiming;
} {
  const cov = grounding.coverageSignal;
  // Evidence-gated resurfacing override: only honored when the confirmation is
  // true AND evidence_url points at a real recentRelatedCoverage URL (fail
  // closed — a fabricated/missing evidence url is treated as no resurfacing).
  const res = cov?.resurfacing;
  const resurfaced = !!(
    res?.confirmed &&
    res.evidenceUrl &&
    cov?.recentRelatedCoverage?.some((c) => c.url === res.evidenceUrl)
  );
  let score = base.score;
  let velocity = base.velocity;

  // Age decay is deterministic and independent of the LLM's own staleness
  // judgment (and of the critique pass). It applies to every call, not just
  // deep-research ones. Keyed off the raw sourcePublishedAt — deliberate: on a
  // missing date we return 0, we do NOT fall back to MOCK_PUBLISH, which sits
  // ~235 days in the past and would penalize every date-less analysis.
  const days = daysOldRaw(grounding.sourcePublishedAt);
  if (days > 0) {
    if (resurfaced) {
      // Resurfacing: effective age is bounded by the confirmed new development,
      // not the original publish date — recent confirmed coverage pulls the
      // effective date forward (reverse of precedesSubmittedArticle pushing it
      // back). Hard cap: a resurfaced old story is never breaking, only standard
      // at best — it's newsworthy again but lacks true breaking decay.
      const eff = daysOldRaw(res!.evidenceDate ?? grounding.sourcePublishedAt);
      score = Math.max(0, Math.min(100, score - agePenalty(eff)));
      if (velocity === "breaking") velocity = "standard";
    } else {
      score = Math.max(0, Math.min(100, score - agePenalty(days)));
      // Stale story can never read as "breaking" — mirrors the saturation clamp.
      if (days > STALE_DAYS) velocity = "evergreen";
    }
    if (days > STALE_DAYS || resurfaced) {
      logStage("resurfacing_path", {
        path: resurfaced ? "resurfacing-adjusted" : "full-penalty",
        ...(resurfaced ? { evidenceUrl: res!.evidenceUrl } : {}),
      });
    }
  }

  if (cov) {
    // Saturation deduction is deterministic and tunable in constants.ts — the
    // model never sees or sets it, so rerunning against a fixed corpus is stable.
    // Builds on `score` (which may already carry the age penalty) so both guards
    // compose instead of the saturation one overwriting the age one.
    let adjusted = Math.max(0, Math.min(100, score - saturationPenalty(cov.externalSourceCount)));
    if (cov.precedesSubmittedArticle) {
      // downstream commentary, not the origin — discount originality a little.
      adjusted = Math.max(0, adjusted - 4);
    }
    score = adjusted;

    if (cov.externalSourceCount >= SATURATION_THRESHOLD) {
      // heavily covered — cannot be "breaking" regardless of the article's age.
      velocity = daysOld(sourcePublishedAt(grounding)) <= 3 ? "standard" : "evergreen";
    }
    if (cov.precedesSubmittedArticle) {
      // the pitch window should track the earliest known coverage, not the
      // article's own publish date.
      velocity = daysSince(cov.earliestSourceDate ?? sourcePublishedAt(grounding)) <= 3 ? "standard" : "evergreen";
    }
  }

  return {
    score,
    velocity,
    noveltyScore: base.novelty_score,
    eventTiming: base.event_timing,
  };
}

const MOCK_PUBLISH = "2026-01-01";

function sourcePublishedAt(grounding: GroundingInput): string {
  return grounding.sourcePublishedAt ?? MOCK_PUBLISH;
}

function daysOld(pub: string): number {
  return Math.max(0, Math.floor((Date.now() - Date.parse(pub)) / 86_400_000));
}

// Version that treats a missing/invalid date as "unknown" (0 days) rather than
// defaulting to a past sentinel — the age penalty must never fire on absence.
function daysOldRaw(pub: string | undefined | null): number {
  if (!pub) return 0;
  const ms = Date.parse(pub);
  if (Number.isNaN(ms)) return 0;
  return Math.max(0, Math.floor((Date.now() - ms) / 86_400_000));
}

function daysSince(iso: string | undefined): number {
  if (!iso) return 0;
  return daysOld(iso);
}