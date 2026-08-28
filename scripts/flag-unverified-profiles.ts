// One-shot migration for profiles created before the sparse-input fix
// (summarize.ts short-circuit + insufficient_data schema). Those summaries were
// generated with a forced required-fields schema over sparse/empty input and
// may be fabricated — buildProfileContext() now refuses to trust any summary
// flagged sourceQuality="unverified_legacy" in match/pitch prompts until the
// profile is regenerated.
//
//   bun scripts/flag-unverified-profiles.ts
//
// Idempotent: only touches profiles whose expertiseSummary lacks a sourceQuality
// marker. Existing rows are NOT deleted — the fabricated data stays visible in
// the UI, but stops flowing into downstream prompts.
//
import { prisma } from "@newshog/db";

interface StoredSummary {
  sourceQuality?: "verified" | "unverified_legacy";
}

async function main() {
  const profiles = await prisma.individualProfile.findMany({
    select: { profileId: true, xHandle: true, linkedinUrl: true, expertiseSummary: true },
  });

  const legacy = profiles.filter(
    (p) => p.expertiseSummary != null && !("sourceQuality" in (p.expertiseSummary as StoredSummary)),
  );

  let updated = 0;
  for (const profile of legacy) {
    const summary = profile.expertiseSummary as Record<string, unknown>;
    await prisma.individualProfile.update({
      where: { profileId: profile.profileId },
      data: { expertiseSummary: { ...summary, sourceQuality: "unverified_legacy" } as never },
    });
    updated++;
    console.log(
      `[flag-unverified] ${profile.profileId}${profile.xHandle ? ` @${profile.xHandle}` : ""}${
        profile.linkedinUrl ? ` ${profile.linkedinUrl}` : ""
      } -> unverified_legacy`,
    );
  }

  console.log(`\nFlagged ${updated} of ${profiles.length} individual profiles as unverified_legacy.`);
  console.log(
    updated > 0
      ? "These are now blocked from match/pitch prompts until the user regenerates their profile."
      : "No legacy unverified profiles found.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[flag-unverified] failed:", err);
    process.exit(1);
  });