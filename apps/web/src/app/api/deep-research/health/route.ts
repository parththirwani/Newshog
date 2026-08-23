import { NextResponse } from "next/server";

export async function GET() {
  // Deep Research runs entirely in-process via BullMQ + OpenRouter; a reachable
  // provider is implied by a running worker. No separate sub-service to probe.
  return NextResponse.json({ status: "ok", search: "ddg", model: "openrouter" });
}