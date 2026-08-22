import { prisma } from "@newshog/db";

const CLIENT_EVENTS = new Set([
  "url_pasted",
  "analysis_completed",
  "angle_copied",
  "pitch_copied",
  "result_shared",
  "medialyst_clicked",
]);

export const MAX_EVENT_NAME_LEN = 64;
export const MAX_PROPS_LEN = 8;

export function isValidEventName(name: unknown): name is string {
  return typeof name === "string" && CLIENT_EVENTS.has(name);
}

export function pruneProps(props: unknown): Record<string, unknown> | undefined {
  if (typeof props !== "object" || props === null || Array.isArray(props)) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  let kept = 0;
  for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
    if (kept >= MAX_PROPS_LEN) break;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null) {
      out[k] = v;
      kept++;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

export async function trackServer(name: string, props?: Record<string, unknown>): Promise<void> {
  try {
    await prisma.event.create({ data: { name, props: props as never } });
  } catch (err) {
    console.error("[analytics] trackServer failed:", err);
  }
}