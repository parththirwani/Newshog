export type ProfileType = "individual" | "enterprise";

export interface ExpertiseSummary {
  topics: string[];
  tone: string | null;
  credentials: string[];
  recurringThemes: string[];
  /** True when the source text was too sparse to extract real expertise. */
  insufficientData?: boolean;
  /** Confidence that recurring themes are actually recurring across sources. */
  recurringThemesConfidence?: "single_source" | "multi_source" | null;
  /**
   * "verified" = produced by this pipeline (honest, may be insufficientData).
   * "unverified_legacy" = generated before the sparse-input fix, may be
   * fabricated. Downstream matching must not trust legacy summaries.
   */
  sourceQuality?: "verified" | "unverified_legacy";
}

export interface CompanyContext {
  whatTheyDo: string;
  whoTheyServe: string;
  productCategories: string[];
  positioningVoice: string;
  areasOfAuthority: string[];
}

export interface IndividualProfileData {
  linkedinUrl?: string;
  xHandle?: string;
  freeTextBio?: string;
  expertiseSummary?: ExpertiseSummary;
}

export interface EnterpriseProfileData {
  companyName: string;
  companyDescription?: string;
  websiteUrl?: string;
  docsUrl?: string;
  pdfText?: string;
  companyContext?: CompanyContext;
}
