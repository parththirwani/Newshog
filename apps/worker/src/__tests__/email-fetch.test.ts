import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockLogout = vi.fn().mockResolvedValue(undefined);
const mockGetMailboxLock = vi.fn();
const mockSearch = vi.fn();
const mockFetchOne = vi.fn();
const mockMessageFlagsAdd = vi.fn().mockResolvedValue(undefined);

const mockLock = { release: vi.fn() };
mockGetMailboxLock.mockResolvedValue(mockLock);

vi.mock("imapflow", () => ({
  ImapFlow: vi.fn(function MockImapFlow() {
    return {
      connect: mockConnect,
      logout: mockLogout,
      getMailboxLock: mockGetMailboxLock,
      search: mockSearch,
      fetchOne: mockFetchOne,
      messageFlagsAdd: mockMessageFlagsAdd,
      on: vi.fn(),
    };
  }),
}));

vi.mock("mailparser", () => ({
  simpleParser: vi.fn(),
}));

const { simpleParser } = await import("mailparser");
const { fetchDigestEmails, markEmailsSeen } = await import("../email-fetch");

function makeRawEmail(from: string, subject: string, textBody: string) {
  return Buffer.from(`From: ${from}\r\nSubject: ${subject}\r\n\r\n${textBody}`);
}

describe("fetchDigestEmails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch.mockResolvedValue([]);
    process.env.IMAP_HOST = "imap.test.com";
    process.env.IMAP_PORT = "993";
    process.env.IMAP_USER = "test@test.com";
    process.env.IMAP_PASS = "password";
  });

  afterEach(() => {
    delete process.env.IMAP_HOST;
    delete process.env.IMAP_PORT;
    delete process.env.IMAP_USER;
    delete process.env.IMAP_PASS;
  });

  it("connects to IMAP server and logs out when done", async () => {
    await fetchDigestEmails();
    expect(mockConnect).toHaveBeenCalled();
    expect(mockLogout).toHaveBeenCalled();
  });

  it("returns empty array when no unseen emails match", async () => {
    mockSearch.mockResolvedValue([]);
    const results = await fetchDigestEmails();
    expect(results).toEqual([]);
  });

  it("fetches and parses emails from Source of Sources", async () => {
    const rawEmail = makeRawEmail("digest@sourceofsources.com", "Weekly queries", "AI experts needed");
    mockSearch.mockResolvedValue([101]);
    mockFetchOne.mockResolvedValue({ source: rawEmail, uid: 101 });
    (simpleParser as ReturnType<typeof vi.fn>).mockResolvedValue({
      subject: "Weekly queries",
      text: "AI experts needed",
      html: "",
      from: { text: "digest@sourceofsources.com" },
      date: new Date("2026-08-20"),
    });

    const results = await fetchDigestEmails();

    expect(results).toHaveLength(1);
    expect(results[0].platform).toBe("source_of_sources");
    expect(results[0].subject).toBe("Weekly queries");
    expect(results[0].from).toBe("digest@sourceofsources.com");
    expect(results[0].uid).toBe(101);
  });

  it("detects Help a B2B Writer platform", async () => {
    const rawEmail = makeRawEmail("team@mentionmatch.com", "B2B digest", "query");
    mockSearch.mockResolvedValue([201]);
    mockFetchOne.mockResolvedValue({ source: rawEmail, uid: 201 });
    (simpleParser as ReturnType<typeof vi.fn>).mockResolvedValue({
      subject: "B2B digest",
      text: "query",
      html: "",
      from: { text: "team@mentionmatch.com" },
      date: new Date(),
    });

    const results = await fetchDigestEmails();
    expect(results).toHaveLength(1);
    expect(results[0].platform).toBe("help_a_b2b_writer");
  });

  it("detects SourceBottle platform", async () => {
    const rawEmail = makeRawEmail("digest@sourcebottle.com.au", "SB weekly", "query");
    mockSearch.mockResolvedValue([301]);
    mockFetchOne.mockResolvedValue({ source: rawEmail, uid: 301 });
    (simpleParser as ReturnType<typeof vi.fn>).mockResolvedValue({
      subject: "SB weekly",
      text: "query",
      html: "",
      from: { text: "digest@sourcebottle.com.au" },
      date: new Date(),
    });

    const results = await fetchDigestEmails();
    expect(results).toHaveLength(1);
    expect(results[0].platform).toBe("sourcebottle");
  });

  it("skips emails from unknown senders", async () => {
    const rawEmail = makeRawEmail("spam@unknown.com", "Spam", "text");
    mockSearch.mockResolvedValue([401]);
    mockFetchOne.mockResolvedValue({ source: rawEmail, uid: 401 });
    (simpleParser as ReturnType<typeof vi.fn>).mockResolvedValue({
      subject: "Spam",
      text: "text",
      html: "",
      from: { text: "spam@unknown.com" },
      date: new Date(),
    });

    const results = await fetchDigestEmails();
    expect(results).toEqual([]);
  });

  it("searches only unseen messages", async () => {
    mockSearch.mockResolvedValue([]);
    await fetchDigestEmails();
    expect(mockSearch).toHaveBeenCalledWith(["UNSEEN"], { uid: true });
  });

  it("skips emails with no source buffer", async () => {
    mockSearch.mockResolvedValue([601]);
    mockFetchOne.mockResolvedValue({ source: null, uid: 601 });

    const results = await fetchDigestEmails();
    expect(results).toEqual([]);
  });

  it("releases IMAP lock even on error", async () => {
    mockSearch.mockRejectedValue(new Error("IMAP error"));

    await expect(fetchDigestEmails()).rejects.toThrow("IMAP error");
    expect(mockLock.release).toHaveBeenCalled();
    expect(mockLogout).toHaveBeenCalled();
  });

  it("handles multiple emails from different senders", async () => {
    const email1 = makeRawEmail("digest@sourceofsources.com", "SOS digest", "query 1");
    const email2 = makeRawEmail("digest@sourcebottle.com", "SB digest", "query 2");
    mockSearch.mockResolvedValue([701, 702]);
    mockFetchOne
      .mockResolvedValueOnce({ source: email1, uid: 701 })
      .mockResolvedValueOnce({ source: email2, uid: 702 });

    (simpleParser as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        subject: "SOS digest",
        text: "query 1",
        html: "",
        from: { text: "digest@sourceofsources.com" },
        date: new Date(),
      })
      .mockResolvedValueOnce({
        subject: "SB digest",
        text: "query 2",
        html: "",
        from: { text: "digest@sourcebottle.com" },
        date: new Date(),
      });

    const results = await fetchDigestEmails();
    expect(results).toHaveLength(2);
    expect(results[0].platform).toBe("source_of_sources");
    expect(results[1].platform).toBe("sourcebottle");
  });

  it("uses default IMAP config when env vars not set", async () => {
    delete process.env.IMAP_HOST;
    delete process.env.IMAP_PORT;
    delete process.env.IMAP_USER;
    delete process.env.IMAP_PASS;

    await fetchDigestEmails();
    expect(mockConnect).toHaveBeenCalled();
  });
});

describe("markEmailsSeen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns early when no uids given", async () => {
    await markEmailsSeen([]);
    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockMessageFlagsAdd).not.toHaveBeenCalled();
  });

  it("flags each provided uid as seen", async () => {
    await markEmailsSeen([1, 2, 3]);

    expect(mockConnect).toHaveBeenCalled();
    expect(mockMessageFlagsAdd).toHaveBeenCalledTimes(3);
    for (const uid of [1, 2, 3]) {
      expect(mockMessageFlagsAdd).toHaveBeenCalledWith(uid, ["\\Seen"]);
    }
    expect(mockLogout).toHaveBeenCalled();
  });

  it("releases lock and logs out even when flagging throws", async () => {
    mockMessageFlagsAdd.mockRejectedValueOnce(new Error("flag failed"));

    await expect(markEmailsSeen([9])).rejects.toThrow("flag failed");
    expect(mockLock.release).toHaveBeenCalled();
    expect(mockLogout).toHaveBeenCalled();
  });
});
