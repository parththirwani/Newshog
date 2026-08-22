import { getSessionEmail } from "./auth";

// A context-free analysis (no profile) is public by design. A
// profile-linked analysis is editable only by the profile's owner.
export function isProfileOwner(
  profileId: string | null | undefined,
  ownerProfileId: string | null,
): boolean {
  return !profileId || ownerProfileId === profileId;
}

export async function resolveOwnerProfileId(): Promise<string | null> {
  const email = await getSessionEmail();
  if (!email) return null;
  const { prisma } = await import("@newshog/db");
  const profile = await prisma.profile.findUnique({
    where: { ownerEmail: email },
    select: { id: true },
  });
  return profile?.id ?? null;
}