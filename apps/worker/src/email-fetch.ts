import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { SourcePlatform } from "@newshog/shared";

interface FetchedEmail {
  uid: number;
  subject: string;
  text: string;
  html: string;
  from: string;
  date: Date;
  platform: SourcePlatform;
}

const SENDER_PLATFORM_MAP: Record<string, SourcePlatform> = {
  "sourceofsources.com": "source_of_sources",
  "sourceofsources.co.uk": "source_of_sources",
  "mentionmatch.com": "help_a_b2b_writer",
  "sourcebottle.com": "sourcebottle",
  "sourcebottle.com.au": "sourcebottle",
};

function detectPlatform(from: string): SourcePlatform | null {
  const lower = from.toLowerCase();
  for (const [domain, platform] of Object.entries(SENDER_PLATFORM_MAP)) {
    if (lower.includes(domain)) return platform;
  }
  return null;
}

function createClient() {
  return new ImapFlow({
    host: process.env.IMAP_HOST ?? "imap.gmail.com",
    port: Number(process.env.IMAP_PORT ?? 993),
    secure: true,
    auth: {
      user: process.env.IMAP_USER ?? "",
      pass: process.env.IMAP_PASS ?? "",
    },
    logger: false,
  });
}

export async function fetchDigestEmails(): Promise<FetchedEmail[]> {
  const client = createClient();
  await client.connect();

  const emails: FetchedEmail[] = [];

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      // Sender filtering happens in detectPlatform below; server-side FROM
      // filters are provider-dependent, so just pull all unseen.
      const uids = await client.search(["UNSEEN"], { uid: true });

      for (const uid of uids) {
        const msg = await client.fetchOne(uid, { source: true, uid: true }, { uid: true });
        if (!msg.source) continue;

        const parsed = await simpleParser(msg.source);
        const from = parsed.from?.text ?? "";
        const platform = detectPlatform(from);
        if (!platform) continue;

        emails.push({
          uid,
          subject: parsed.subject ?? "",
          text: parsed.text ?? "",
          html: parsed.html ?? "",
          from,
          date: parsed.date ?? new Date(),
          platform,
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  return emails;
}

// Marked seen only after the caller has persisted the emails' requests, so a
// failed ingest keeps the mail for the next poll instead of losing it.
export async function markEmailsSeen(uids: number[]): Promise<void> {
  if (uids.length === 0) return;
  const client = createClient();
  await client.connect();

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      for (const uid of uids) {
        await client.messageFlagsAdd(uid, ["\\Seen"]);
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}