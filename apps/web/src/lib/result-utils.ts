import { SCORE_THRESHOLD_LOW, SCORE_THRESHOLD_HIGH, DEFAULT_VELOCITY } from "@newshog/shared";
import type { StoryVelocity } from "@newshog/shared";

export function band(score: number): string {
  if (score < SCORE_THRESHOLD_LOW) return "Skip";
  if (score < SCORE_THRESHOLD_HIGH) return "Consider";
  return "Strong";
}

export function relativeTime(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// Rule-based, not LLM: a deterministic read on the window is cheaper and
// renders instantly, which the sequential-call alternative isn't.
export interface NextAction {
  timing: string;
  action: string;
}

// Two inputs, not one: the score says whether to pitch, velocity says how
// fast the window closes. Keyed [band][velocity] stay in code so retuning word
// does not touch the LLM prompt. Unknown velocity (old rows, corrupt data)
// falls back to standard below.
// ponytail: unknown/old velocity silently treated as standard — no UI signal
// that a row is unclassified. Add a "velocity pending" badge when backfill matters.
const TIMING: Record<string, Record<string, NextAction>> = {
  Strong: {
    breaking: {
      timing: "Now–24h",
      action: "This is peaking — pitch today or lose the window.",
    },
    standard: {
      timing: "Now–48h",
      action: "Pitch in the next 48 hours while this story is cresting. The window is open right now.",
    },
    evergreen: {
      timing: "This week",
      action: "Strong story with a longer shelf life — no need to rush, but don't sit on it.",
    },
  },
  Consider: {
    breaking: { timing: "This week", action: "Watch this one. If the story gets a fresh development, that's your gap to pitch in." },
    standard: { timing: "This week", action: "Watch this one. If the story gets a fresh development, that's your gap to pitch in." },
    evergreen: { timing: "This week", action: "Watch this one. If the story gets a fresh development, that's your gap to pitch in." },
  },
  Skip: {
    breaking: { timing: "Skip", action: "Don't newsjack this — the story is too quiet. Spend the effort where timing is on your side." },
    standard: { timing: "Skip", action: "Don't newsjack this — the story is too quiet. Spend the effort where timing is on your side." },
    evergreen: { timing: "Skip", action: "Don't newsjack this — the story is too quiet. Spend the effort where timing is on your side." },
  },
};

export function nextAction(score: number, matchCount: number, velocity?: StoryVelocity): NextAction {
  const b = band(score);
  const v = velocity ?? DEFAULT_VELOCITY;
  let { timing, action } = TIMING[b][v] ?? TIMING[b][DEFAULT_VELOCITY];
  if (matchCount > 0) {
    action += ` And reply to the ${matchCount} open ${matchCount === 1 ? "opportunity" : "opportunities"} above before its deadline.`;
  }
  return { timing, action };
}