export type SourcePlatform = "source_of_sources" | "help_a_b2b_writer" | "sourcebottle";

export interface JournalistRequest {
  id: string;
  sourcePlatform: SourcePlatform;
  requesterName?: string;
  outlet?: string;
  topicText: string;
  deadline?: string;
  replyContact?: string;
  ingestedAt: string;
  expiresAt?: string;
}

export interface AnalysisJournalistMatch {
  analysisId: string;
  journalistRequestId: string;
  matchRationale: string;
  matchedAt: string;
  journalistRequest: JournalistRequest;
}
