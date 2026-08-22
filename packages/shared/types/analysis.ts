import type { Angle } from "./angle";

export interface LlmAnalysis {
  score: number;
  why_now: string;
  angles: Angle[];
}

export type AnalysisStatus =
  | "queued"
  | "scraping"
  | "scraped"
  | "analyzing"
  | "analyzed"
  | "failed";

export interface Analysis {
  id: string;
  url?: string;
  status: AnalysisStatus;
  articleTitle?: string;
  score?: number;
  angles?: Angle[];
  whyNow?: string;
  pitch?: string;
  error?: string;
  profileId?: string | null;
  updatedAt?: string;
}
