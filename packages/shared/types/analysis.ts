import type { Angle } from "./angle";

export type StoryVelocity = "breaking" | "standard" | "evergreen";

export interface LlmAnalysis {
  score: number;
  why_now: string;
  velocity: StoryVelocity;
  velocity_reasoning: string;
  angles: Angle[];
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
  updatedAt?: string;
}
