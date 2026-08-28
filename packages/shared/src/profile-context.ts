import type { ExpertiseSummary, CompanyContext } from "../types";

function stringList(value: unknown): string {
  if (Array.isArray(value)) return (value as unknown[]).filter((v) => typeof v === "string").join(", ");
  if (typeof value === "string") return value;
  return "";
}

export interface ProfileLike {
  type: string;
  individual?: { expertiseSummary?: unknown } | null;
  enterprise?: { companyContext?: unknown; companyName?: string } | null;
}

export function buildProfileContext(profile: ProfileLike): string {
  if (profile.type === "individual" && profile.individual?.expertiseSummary) {
    const s = profile.individual.expertiseSummary as ExpertiseSummary;
    // Legacy pre-fix summaries were generated with a forced required-fields
    // schema over sparse/empty input and may be fabricated — never trust them
    // downstream until the profile is regenerated.
    if (s.sourceQuality === "unverified_legacy") {
      return "Expertise profile is unverified (generated before the sparse-input fix). Regenerate the profile before using it for matching.";
    }
    const anyData =
      (s.topics?.length ?? 0) > 0 ||
      !!s.tone ||
      (s.credentials?.length ?? 0) > 0 ||
      (s.recurringThemes?.length ?? 0) > 0;
    if (s.insufficientData || !anyData) {
      return "No verified expertise data available.";
    }
    return [
      `Topics: ${stringList(s.topics)}`,
      `Tone: ${s.tone ?? ""}`,
      `Credentials: ${stringList(s.credentials)}`,
      `Recurring themes: ${stringList(s.recurringThemes)}`,
    ].join("\n");
  }

  if (profile.type === "enterprise" && profile.enterprise?.companyContext) {
    const c = profile.enterprise.companyContext as CompanyContext;
    return [
      `Company: ${profile.enterprise.companyName}`,
      `What they do: ${c.whatTheyDo}`,
      `Who they serve: ${c.whoTheyServe}`,
      `Product categories: ${stringList(c.productCategories)}`,
      `Positioning/voice: ${c.positioningVoice}`,
      `Areas of authority: ${stringList(c.areasOfAuthority)}`,
    ].join("\n");
  }

  return "";
}