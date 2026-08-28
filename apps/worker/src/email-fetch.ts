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
  "mentionmatch.com": "mentionmatch",
  "sourcebottle.com": "sourcebottle",
  "sourcebottle.com.au": "sourcebottle",
  // TODO: placeholder domains — confirm against real digest senders once mail
  // arrives; a wrong guess silently misclassifies that platform's mail.
  "qwoted.com": "qwoted",
  "haro.featured.com": "haro",
  "featured.com": "haro",
  "pressplugs.com": "pressplugs",
};

// Match a sender's domain at a label boundary, not by raw substring. This
// keeps subdomain senders (mail.qwoted.com) working while rejecting lookalike
// registrations (getfeatured.com, not-qwoted.net) that `includes()` would
// silently swallow as the wrong platform.
function senderDomain(from: string): string | null {
  const match = from.toLowerCase().match(/@([a-z0-9.-]+)/);
  return match ? match[1] : null;
}

function detectPlatform(from: string): SourcePlatform | null {
  const domain = senderDomain(from);
  if (!domain) return null;
  for (const [candidate, platform] of Object.entries(SENDER_PLATFORM_MAP)) {
    if (domain === candidate || domain.endsWith(`.${candidate}`)) return platform;
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
    // ponytail: 10s connect timeout; skip the digest when the IMAP server is
    // unreachable instead of hanging for the default 300s socket timeout.
    connectionTimeout: 10_000,
    socketTimeout: 30_000,
    logger: false,
  });
}

export async function fetchDigestEmails(): Promise<FetchedEmail[]> {
  const client = createClient();
  // ponytail: swallow socket-level errors that fire after a failed connect —
  // the connect() catch already returns []; these would otherwise crash the
  // worker via an unhandled 'error' event on the socket.
  client.on("error", () => {});

  try {
    await client.connect();
  } catch {
    return [];
  }

  const emails: FetchedEmail[] = [];

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      // Sender filtering happens in detectPlatform below; server-side FROM
      // filters are provider-dependent, so just pull all unseen. Use the
      // object-form criteria: imapflow's array form ("UNSEEN") returns false
      // instead of UIDs, which would crash the loop below.
      const uids = await client.search({ seen: false }, { uid: true });
      if (!Array.isArray(uids)) {
        console.error("[email-fetch] search returned non-array, skipping digest:", uids);
        return [];
      }

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
  client.on("error", () => {});

  try {
    await client.connect();
  } catch {
    return;
  }

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