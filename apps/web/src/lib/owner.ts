import { getSessionUser } from "./auth";

// Ownership: an analysis linked to a user (or profile) is private to that
// account. A fully context-free analysis (no user, no profile) is public.
export function isOwner(
  owned: { userId: string | null | undefined; profileId: string | null | undefined },
  ownerUserId: string | null,
  ownerProfileId: string | null,
): boolean {
  if (owned.userId) return ownerUserId === owned.userId;
  if (owned.profileId) return ownerProfileId === owned.profileId;
  return true;
}

export async function resolveOwnerIds(): Promise<{
  userId: string | null;
  profileId: string | null;
}> {
  const user = await getSessionUser();
  if (!user) return { userId: null, profileId: null };
  const { prisma } = await import("@newshog/db");
  const profile = await prisma.profile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  return { userId: user.id, profileId: profile?.id ?? null };
}