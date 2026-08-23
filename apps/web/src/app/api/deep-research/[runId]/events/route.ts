import { prisma } from "@newshog/db";
import { getSessionUser } from "@/lib/auth";
import { createConnection } from "@newshog/queue";

export const dynamic = "force-dynamic";

// Same ownership rule as the run endpoints: owned runs stream only to the
// owner; userId-less runs are public context. 404 so foreign runIds don't leak.
async function isRunUser(runId: string) {
  const run = await prisma.deepResearchRun.findUnique({ where: { runId } });
  if (!run) return false;
  if (!run.userId) return true;
  const user = await getSessionUser();
  return user?.id === run.userId;
}

export async function GET(_: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!(await isRunUser(runId))) {
    return new Response("Not found.", { status: 404 });
  }
  const channel = `deep-research:${runId}`;
  const encoder = new TextEncoder();

  const redis = createConnection();
  let keepAlive: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(inner) {
      const send = (chunk: string) => {
        if (!closed) inner.enqueue(encoder.encode(chunk));
      };

      // Worker publishes raw JSON event objects; wrap into an SSE envelope.
      await redis.subscribe(channel);
      redis.on("message", (messageChannel, message) => {
        if (closed || messageChannel !== channel) return;
        let parsed: { type?: string } = {};
        try {
          parsed = JSON.parse(message) as { type?: string };
        } catch {
          parsed = {};
        }
        const type = parsed.type ?? "message";
        send(`event: ${type}\ndata: ${message}\n\n`);
      });

      // Keep the response open. `cancel()` tears down cleanly on client abort.
      keepAlive = setInterval(() => {
        if (closed) {
          clearInterval(keepAlive);
          return;
        }
        send(": keep-alive\n\n");
      }, 15_000);
    },
    async cancel() {
      closed = true;
      if (keepAlive) clearInterval(keepAlive);
      try {
        await redis.unsubscribe(channel);
      } catch {}
      redis.disconnect();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}