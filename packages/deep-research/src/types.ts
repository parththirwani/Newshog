export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface Learning {
  text: string;
  sourceUrls: string[];
  /** The exact supporting passage from the source the model based this claim on. */
  excerpt?: string;
}

export interface ResearchSource {
  id: number;
  url: string;
  claimText?: string;
  excerpt?: string;
  /** Audit-only: not surfaced in the client route. Status is written for
   *  debugging/tuning the grounding heuristic; the UI never renders a badge. */
  status: "verified" | "unverified" | "failed";
  reason?: "excerpt_not_found" | "excerpt_present_but_unsupportive";
}

export interface SubQuestionPlan {
  threads: string[];
  /** true = independent angles (fan-out); false = single dependent/sequential thread. */
  independent: boolean;
}

export type ClarificationQuestion = {
  id: string;
  question: string;
};

export type ClarificationAnswer = {
  id: string;
  question: string;
  answer: string;
};

export type DeepResearchMode = "answer" | "report";

export interface DeepResearchInput {
  query: string;
  depth: number;
  breadth: number;
  mode: DeepResearchMode;
  clarificationAnswers: ClarificationAnswer[];
  skipClarification?: boolean;
}

export interface AnalyticsHeaders {
  [header: string]: string;
}