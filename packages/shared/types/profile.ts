export type ProfileType = "individual" | "enterprise";

export interface ExpertiseSummary {
  topics: string[];
  tone: string;
  credentials: string[];
  recurringThemes: string[];
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
