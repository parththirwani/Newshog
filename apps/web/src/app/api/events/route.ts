import { NextResponse } from "next/server";
import { prisma } from "@newshog/db";
import { isValidEventName, pruneProps, MAX_EVENT_NAME_LEN } from "@/lib/analytics";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const ip = clientIp(request);
  const gate = rateLimit(`events:${ip}`, 60, 60_000);
  if (!gate.ok) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const name = body?.name;
  if (!isValidEventName(name)) {
    return NextResponse.json({ error: "Unknown event." }, { status: 400 });
  }
  const props = pruneProps(body?.props);

  try {
    await prisma.event.create({
      data: {
        name: (name as string).slice(0, MAX_EVENT_NAME_LEN),
        props: props as never,
      },
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error("[api/events] error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}