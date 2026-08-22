// Load test + dedupe check for /api/analyze. Run with a live web app + db:
//   bun scripts/load-test.ts [baseUrl]
// Asserts: no 500s, seeded URLs come back deduped, and reports latency.
import { prisma } from "@newshog/db";
import { normalizeUrl } from "../apps/web/src/lib/url";
import { ANALYSIS_DEDUPE_HOURS } from "@newshog/shared";

const baseUrl = process.argv[2] ?? "http://localhost:3000";
const CONCURRENCY = 25;
const UNIQUE_URLS = 20;

function clientIp(i: number): string {
  return `203.0.113.${(i % 254) + 1}`;
}

async function post(url: string, ip: string): Promise<{ status: number; ms: number; body: unknown }> {
  const started = Date.now();
  const res = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ url }),
  });
  return { status: res.status, ms: Date.now() - started, body: await res.json().catch(() => null) };
}

async function main() {
  // Seed "already analyzed" URLs so dedupe has something to catch. Use
  // tracking-param variants — the whole point is normalization.
  const seedDeduped = Array.from({ length: 3 }, (_, i) => ({
    url: `https://example.com/story/${i}?utm_source=twitter&ref=share`,
    needle: `https://example.com/story/${i}`,
  }));
  for (const s of seedDeduped) {
    await prisma.analysis.create({
      data: {
        url: normalizeUrl(s.url),
        status: "analyzed",
        score: 70,
        createdAt: new Date(Date.now() - 60_000),
      },
    });
  }

  const uniqueUrls = Array.from(
    { length: UNIQUE_URLS },
    (_, i) => `https://example.com/breaking/${i}?utm_source=test`,
  );
  const tasks: Array<{ url: string; expectDeduped: boolean }> = [
    ...uniqueUrls.map((u) => ({ url: u, expectDeduped: false })),
    ...seedDeduped.map((s) => ({ url: s.url, expectDeduped: true })),
  ];

  // Spread unique x-forwarded-for values so the per-IP bucket doesn't 429.
  const latencies: number[] = [];
  let statusCounts: Record<number, number> = {};
  let failures: string[] = [];
  for (let offset = 0; offset < tasks.length; offset += CONCURRENCY) {
    const batch = tasks.slice(offset, offset + CONCURRENCY);
    const results = await Promise.all(
      batch.map((t, j) => post(t.url, clientIp(offset + j)).then((r) => ({ t, ...r }))),
    );
    for (const r of results) {
      statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
      if (r.status === 200) latencies.push(r.ms);
      if (r.status >= 500) failures.push(`${r.t.url} -> ${r.status}`);
      if (r.t.expectDeduped && (r.status !== 201 || r.body.deduped !== true)) {
        failures.push(`seed url not deduped: ${r.t.url} -> ${r.status} ${JSON.stringify(r.body)}`);
      }
    }
  }

  latencies.sort((a, b) => a - b);
  const p50 = latencies.length ? latencies[Math.floor(latencies.length * 0.5)] : 0;
  const p95 = latencies.length ? latencies[Math.floor(latencies.length * 0.95)] : 0;

  console.log(JSON.stringify({ tasks: tasks.length, statusCounts, p50, p95 }, null, 2));

  if (failures.length > 0) {
    console.error("FAILURES:\n" + failures.join("\n"));
    process.exit(1);
  }
  console.log("OK");
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});