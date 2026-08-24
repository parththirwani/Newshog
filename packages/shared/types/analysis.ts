import type { Angle } from "./angle";

export type StoryVelocity = "breaking" | "standard" | "evergreen";

export type EventTiming = "past" | "ongoing" | "upcoming";

export interface LlmAnalysis {
  score: number;
  why_now: string;
  velocity: StoryVelocity;
  velocity_reasoning: string;
  angles: Angle[];
  novelty_score?: number;
  /** Whether the underlying event already happened, is ongoing, or is upcoming. */
  event_timing?: EventTiming;
}

/** A recent source (within the resurfacing window, relative to today) touching an old story. */
export interface RecentRelatedCoverage {
  url: string;
  /** Publish date of this source, ISO. */
  date: string;
  snippet: string;
}

/**
 * LLM-confirmed evidence that an old story has a genuinely new development.
 * `confirmed` is only ever true when `evidenceUrl` points at a real URL from
 * the recentRelatedCoverage list — the confirmation step fails closed otherwise.
 */
export interface ResurfacingConfirmation {
  confirmed: boolean;
  /** Must be one of recentRelatedCoverage[].url — never fabricated. Null when !confirmed. */
  evidenceUrl: string | null;
  /** Publish date of the evidence source, ISO — the effective-age anchor for postprocess. Absent when !confirmed. */
  evidenceDate?: string;
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
  /**
   * Recent coverage of an old (staleness-eligible) story, deep-research only.
   * Distinct from externalSourceCount/earliest/latest — never repurposes them.
   * Absent for every other path.
   */
  recentRelatedCoverage?: RecentRelatedCoverage[];
  /** LLM confirmation of a genuine resurfacing. Deep-research + old-article only. */
  resurfacing?: ResurfacingConfirmation;
}

export type AnalysisStatus =
  | "queued"
  | "scraping"
  | "scraped"
  | "researching"
  | "analyzing"
  | "analyzed"
  | "failed";

export type ContentKind = "pitch" | "blog" | "post";
export type PostPlatform = "linkedin" | "twitter";

/** Editable blog/post drafts. Metadata (fit_assessment, time_framing) is
 *  deliberately not stored — it's a one-shot banner on generation. Ceiling:
 *  persist it when the UI renders badges from it after a reload. */
export interface ContentDrafts {
  blog?: string;
  post?: string;
}

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
  drafts?: ContentDrafts;
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
