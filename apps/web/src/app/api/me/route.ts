import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isProUser } from "@/lib/pro-gate";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ signedIn: false, pro: false });
  }
  return NextResponse.json({ signedIn: true, email: user.email, pro: isProUser(user), tier: user.tier });
}