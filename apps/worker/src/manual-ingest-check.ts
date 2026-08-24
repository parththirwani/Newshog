import { fetchDigestEmails } from "./email-fetch";

// Manual smoke-test for digest ingestion, independent of the 4h BullMQ
// scheduler. Reads only UNSEEN mail and does NOT mark anything seen
// (markEmailsSeen is only called by the worker after persistence), so it is
// safe to run against a live inbox.
//
//   bun run apps/worker/src/manual-ingest-check.ts
//
// Use this after rotating IMAP creds or when a platform changes its digest
// format, to confirm fetchDigestEmails parses real mail end to end.

const emails = await fetchDigestEmails();
console.log(`fetched ${emails.length} unseen digest email(s)`);

for (const email of emails) {
  console.log(`- [${email.platform}] "${email.subject}"`);
  console.log(`  from: ${email.from}`);
  console.log(`  ${email.text.length} chars text / ${email.html.length} chars html`);
}