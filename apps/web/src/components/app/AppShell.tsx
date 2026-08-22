import { AppHeader } from "./AppHeader";

export function AppShell({
  user,
  children,
}: {
  user: { email: string };
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-12">
        {children}
      </main>
    </div>
  );
}
