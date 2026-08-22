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