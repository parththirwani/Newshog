import { SATURATION_THRESHOLD, saturationPenalty } from "@newshog/shared";
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
  let score = base.score;
  let velocity = base.velocity;

  if (cov) {
    // Saturation deduction is deterministic and tunable in constants.ts — the
    // model never sees or sets it, so rerunning against a fixed corpus is stable.
    let adjusted = Math.max(0, Math.min(100, base.score - saturationPenalty(cov.externalSourceCount)));
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
    noveltyScore: base.noveltyScore,
    eventTiming: base.eventTiming,
  };
}

const MOCK_PUBLISH = "2026-01-01";

function sourcePublishedAt(grounding: GroundingInput): string {
  return grounding.sourcePublishedAt ?? MOCK_PUBLISH;
}

function daysOld(pub: string): number {
  return Math.max(0, Math.floor((Date.now() - Date.parse(pub)) / 86_400_000));
}

function daysSince(iso: string | undefined): number {
  if (!iso) return 0;
  return daysOld(iso);
}