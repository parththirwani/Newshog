// Manual free-path: insert a journalist request that was found outside email
// (e.g. #journorequest / #PRrequest on X or Bluesky, a press page, a directory).
// Skips the LLM extraction step — same schema shape extractJournalistRequests()
// produces, straight to the DB. Like the email path, it expires after 7 days.
//
//   bun scripts/add-request.ts --platform qwoted --requester "Jane Doe" \
//     --outlet "TechCrunch" --topic "AI compliance experts for a feature" \
//     --deadline 2026-09-01 --reply jane@example.com
//
//   or a single JSON object via stdin:
//   echo '{"platform":"haro","requesterName":"Joe","outlet":"WSJ","topicText":"..."}' \
//     | bun scripts/add-request.ts --json
//
import { prisma } from "@newshog/db";
import type { SourcePlatform } from "@newshog/shared";

const PLATFORMS: SourcePlatform[] = [
  "source_of_sources",
  "help_a_b2b_writer",
  "sourcebottle",
  "haro",
  "qwoted",
  "mentionmatch",
  "pressplugs",
];

interface ManualRequest {
  platform: SourcePlatform;
  requesterName?: string;
  outlet?: string;
  topicText: string;
  deadline?: string;
  replyContact?: string;
}

function parseArgs(argv: string[]): ManualRequest {
  const r: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] ?? "";
      r[k] = v;
      i++;
    }
  }
  return {
    platform: (r.platform as SourcePlatform) || "qwoted",
    requesterName: r.requester || undefined,
    outlet: r.outlet || undefined,
    topicText: r.topic || "",
    deadline: r.deadline || undefined,
    replyContact: r.reply || undefined,
  };
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const jsonIdx = rawArgs.indexOf("--json");
  let req: ManualRequest;
  if (jsonIdx !== -1) {
    const raw = await new Promise<string>((resolve) => {
      let buf = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (c) => (buf += c));
      process.stdin.on("end", () => resolve(buf));
    });
    req = JSON.parse(raw) as ManualRequest;
  } else {
    req = parseArgs(rawArgs);
  }

  if (!PLATFORMS.includes(req.platform)) {
    throw new Error(`Invalid platform "${req.platform}". Choices: ${PLATFORMS.join(", ")}`);
  }
  if (!req.topicText.trim()) {
    throw new Error("topicText is required.");
  }

  const deadline = req.deadline && !Number.isNaN(Date.parse(req.deadline)) ? new Date(req.deadline) : null;

  const row = await prisma.journalistRequest.create({
    data: {
      sourcePlatform: req.platform,
      requesterName: req.requesterName ?? null,
      outlet: req.outlet ?? null,
      topicText: req.topicText.trim(),
      deadline,
      replyContact: req.replyContact ?? null,
      rawEmailRef: "manual",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  console.log(`Created journalist request ${row.id} [${row.sourcePlatform}]`);
  console.log(JSON.stringify(row, null, 2));
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});