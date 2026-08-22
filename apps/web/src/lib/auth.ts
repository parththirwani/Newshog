import { cookies } from "next/headers";

const SESSION_COOKIE = "session_email";

export async function getSessionEmail(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value ?? null;
}

export function sessionCookie(email: string) {
  return {
    name: SESSION_COOKIE,
    value: email,
    httpOnly: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    sameSite: "lax" as const,
  };
}
