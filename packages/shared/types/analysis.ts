import type { Angle } from "./angle";

export type StoryVelocity = "breaking" | "standard" | "evergreen";

export type EventTiming = "past" | "ongoing" | "upcoming";

export interface LlmAnalysis {
  score: number;
  why_now: string;
  velocity: StoryVelocity;
  velocity_reasoning: string;
  angles: Angle[];
  /**
   * How first-to-cover / differentiated this story is (0-100), grounded in the
   * deep-research coverage signal. Absent for quick-score (no research corpus).
   */
  noveltyScore?: number;
  /** Whether the underlying event already happened, is ongoing, or is upcoming. */
  eventTiming?: EventTiming;
}

/** Deterministic signal from the research run: how saturated the story is. */
export interface CoverageSignal {
  /** Distinct external sources covering this topic, excluding the article itself. */
  externalSourceCount: number;
  /** Earliest publish date across found sources, ISO, when any date was extractable. */
  earliestSourceDate?: string;
  /** Latest publish date across found sources, ISO, when any date was extractable. */
  latestSourceDate?: string;
  /** True when a found source predates the submitted article — it isn't the origin. */
  precedesSubmittedArticle: boolean;
}

export type AnalysisStatus =
  | "queued"
  | "scraping"
  | "scraped"
  | "researching"
  | "analyzing"
  | "analyzed"
  | "failed";

export interface Analysis {
  id: string;
  url?: string;
  status: AnalysisStatus;
  articleTitle?: string;
  score?: number;
  velocity?: StoryVelocity;
  angles?: Angle[];
  whyNow?: string;
  pitch?: string;
  error?: string;
  profileId?: string | null;
  researchRunId?: string | null;
  /** Article's own publish date, extracted at scrape time. */
  sourcePublishedAt?: string | null;
  /** Whether the underlying event is past / ongoing / upcoming. */
  eventTiming?: EventTiming | null;
  /** Deep-research-only: how saturated coverage is (null for quick-score). */
  coverageSignal?: CoverageSignal | null;
  /** Deep-research-only: first-to-cover differentiation (null for quick-score). */
  noveltyScore?: number | null;
  updatedAt?: string;
}
