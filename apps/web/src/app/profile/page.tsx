import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { AppShell } from "@/components/app/AppShell";
import { ProfileContent } from "@/components/profile/ProfileContent";

export default async function ProfilePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <AppShell user={user}>
      <ProfileContent user={user} />
    </AppShell>
  );
}
