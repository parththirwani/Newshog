// Dev trigger for the existing digest-ingestion flow, without waiting for the
// 4h BullMQ scheduler. Mirrors the worker's email-ingest job exactly:
// fetchDigestEmails → extractJournalistRequests → 24h dedupe → create
// (7-day expiry) → markEmailsSeen only after persistence.
//
//   bun scripts/ingest-now.ts
//
// Safe to run against a live inbox: seen flags are only touched after a
// successful persist, so a failure retries on the next run.
import { prisma } from "@newshog/db";
import { fetchDigestEmails, markEmailsSeen } from "../apps/worker/src/email-fetch";
import { extractJournalistRequests } from "../apps/worker/src/extract-requests";

async function main() {
  const emails = await fetchDigestEmails();
  console.log(`fetched ${emails.length} digest email(s)`);

  const processedUids: number[] = [];

  for (const email of emails) {
    try {
      const requests = await extractJournalistRequests(email.text || email.subject);
      console.log(`extracted ${requests.length} request(s) from: ${email.subject}`);

      for (const r of requests) {
        const recentDuplicate = await prisma.journalistRequest.findFirst({
          where: {
            sourcePlatform: email.platform,
            topicText: r.topic_text,
            ingestedAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
        });
        if (recentDuplicate) {
          console.log(`  skipping duplicate: ${r.topic_text}`);
          continue;
        }

        const deadline = r.deadline && !Number.isNaN(Date.parse(r.deadline)) ? new Date(r.deadline) : null;

        await prisma.journalistRequest.create({
          data: {
            sourcePlatform: email.platform,
            requesterName: r.requester_name,
            outlet: r.outlet,
            topicText: r.topic_text,
            deadline,
            replyContact: r.reply_contact,
            rawEmailRef: email.subject,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        });
      }

      processedUids.push(email.uid);
    } catch (err) {
      console.error(`failed to ingest email "${email.subject}":`, err);
    }
  }

  if (processedUids.length > 0) {
    await markEmailsSeen(processedUids);
  }

  console.log(`done — persisted ${processedUids.length}/${emails.length} email(s)`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});