import { SCORE_THRESHOLD_LOW, SCORE_THRESHOLD_HIGH } from "@newshog/shared";

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

export function nextAction(score: number, matchCount: number): NextAction {
  let action: string;
  let timing: string;
  if (score >= SCORE_THRESHOLD_HIGH) {
    timing = "Now–48h";
    action = "Pitch in the next 48 hours while this story is cresting. The window is open right now.";
  } else if (score >= SCORE_THRESHOLD_LOW) {
    timing = "This week";
    action = "Watch this one. If the story gets a fresh development, that's your gap to pitch in.";
  } else {
    timing = "Skip";
    action = "Don't newsjack this — the story is too quiet. Spend the effort where timing is on your side.";
  }
  if (matchCount > 0) {
    action += ` And reply to the ${matchCount} open ${matchCount === 1 ? "opportunity" : "opportunities"} above before its deadline.`;
  }
  return { timing, action };
}