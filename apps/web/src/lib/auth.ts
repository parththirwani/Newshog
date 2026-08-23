import { cookies } from "next/headers";
import crypto from "crypto";

const SESSION_COOKIE = "session_email";
const ANON_COOKIE = "anon_id";

// ponytail: HMAC-signed email-in-cookie, no session store. Bearer-valid until
// the 30-day maxAge or SESSION_SECRET rotation; no per-device logout or
// invalidation. Upgrade path: opaque tokens in a sessions table + revoke.
const secret = process.env.SESSION_SECRET ?? crypto.randomBytes(32);

export function sign(value: string): string {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

export function verifySigned(raw: string): string | null {
  const idx = raw.lastIndexOf(".");
  if (idx <= 0 || idx === raw.length - 1) return null;
  const value = raw.slice(0, idx);
  const sig = raw.slice(idx + 1);
  const expected = sign(value);
  if (sig.length !== expected.length) return null;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? value : null;
}

export function sessionCookie(email: string) {
  return {
    name: SESSION_COOKIE,
    value: `${email}.${sign(email)}`,
    httpOnly: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    sameSite: "lax" as const,
  };
}

export async function getSessionEmail(): Promise<string | null> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  return raw ? verifySigned(raw) : null;
}

// Resolve the session cookie to a real user row. Lazy import keeps prisma
// out of auth.ts's load path for routes that never touch the DB.
export async function getSessionUser(): Promise<{ id: string; email: string; tier: string } | null> {
  const email = await getSessionEmail();
  if (!email) return null;
  const { prisma } = await import("@newshog/db");
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, tier: true },
  });
  return user;
}

export function anonIdCookie(id: string) {
  return {
    name: ANON_COOKIE,
    value: `${id}.${sign(id)}`,
    httpOnly: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax" as const,
  };
}

// Read the signed anon cookie if present, else mint a fresh id. Returns the
// cookie to set when one was just created.
export async function getAnonId(): Promise<{ id: string; cookie: ReturnType<typeof anonIdCookie> | null }> {
  const jar = await cookies();
  const raw = jar.get(ANON_COOKIE)?.value;
  if (raw) {
    const id = verifySigned(raw);
    if (id) return { id, cookie: null };
  }
  const id = crypto.randomBytes(16).toString("hex");
  return { id, cookie: anonIdCookie(id) };
}
