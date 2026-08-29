import { describe, it, expect } from "vitest";
import {
  parseBody,
  AnalyzeBodySchema,
  DeepResearchBodySchema,
  AuthVerifyBodySchema,
  ProfileCreateBodySchema,
  ProfileUpdateBodySchema,
} from "./schemas";

const req = (body: unknown, headers?: Record<string, string>) =>
  new Request("http://x/api", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  });

describe("parseBody", () => {
  it("returns parsed data on a valid body", async () => {
    const out = await parseBody(req({ url: "https://example.com/a" }), AnalyzeBodySchema);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.url).toBe("https://example.com/a");
  });

  it("rejects malformed JSON with 400 invalid_request", async () => {
    const out = await parseBody(req("{oops"), AnalyzeBodySchema);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.response.status).toBe(400);
      expect(await out.response.json()).toMatchObject({ code: "invalid_request" });
    }
  });

  it("rejects oversized declared bodies with 413 before parsing", async () => {
    const out = await parseBody(req({ url: "https://e.com", filler: "x".repeat(70000) }, { "content-length": "70100" }), AnalyzeBodySchema);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.response.status).toBe(413);
  });

  it("caps chunked bodies with no content-length too", async () => {
    const big = "x".repeat(64 * 1024 + 10);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        const enc = new TextEncoder();
        for (let i = 0; i < big.length; i += 8192) c.enqueue(enc.encode(big.slice(i, i + 8192)));
        c.close();
      },
    });
    const request = new Request("http://x/api", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    const out = await parseBody(request, AnalyzeBodySchema);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.response.status).toBe(413);
  });

  it("strict schemas reject unknown keys (AnalyzeBody)", async () => {
    const out = await parseBody(req({ url: "https://e.com", evil: 1 }), AnalyzeBodySchema);
    expect(out.ok).toBe(false);
  });

  it("non-http(s) protocols are rejected as invalid URLs", async () => {
    // NB: private-IP literals (http://[::1]/) are valid URL *shapes* — they
    // get rejected later by safeFetchText (see safe-fetch.test.ts A.2 suite).
    for (const url of ["file:///etc/passwd", "ftp://x", "javascript:alert(1)"]) {
      const out = await parseBody(req({ url }), AnalyzeBodySchema);
      expect(out.ok, url).toBe(false);
      if (!out.ok) {
        expect(out.response.status).toBe(400);
        expect((await out.response.json()).error).toMatch(/Invalid URL/);
      }
    }
  });
});

describe("route schemas", () => {
  it("DeepResearchBodySchema applies defaults", () => {
    const r = DeepResearchBodySchema.safeParse({ query: "hello" });
    expect(r.success && r.data).toMatchObject({ query: "hello", depth: 2, breadth: 3, mode: "answer", skipClarification: false, clarificationAnswers: [] });
  });

  it("DeepResearchBodySchema enforces range messages", () => {
    const r = DeepResearchBodySchema.safeParse({ query: "x", depth: 9 });
    expect(!r.success && r.error.issues[0].message).toBe("depth must be an integer between 1 and 4.");
  });

  it("AuthVerifyBodySchema wants a 6-digit code and valid email", () => {
    expect(AuthVerifyBodySchema.safeParse({ email: "a@b.co", code: "12345" }).success).toBe(false);
    expect(AuthVerifyBodySchema.safeParse({ email: "nope", code: "123456" }).success).toBe(false);
    expect(AuthVerifyBodySchema.safeParse({ email: " A@B.co ", code: "123456" }).success).toBe(true);
  });

  it("ProfileCreateBodySchema keeps the legacy type + companyName messages", () => {
    const t = ProfileCreateBodySchema.safeParse({ type: "wizard" });
    expect(!t.success && t.error.issues[0].message).toMatch(/individual.*enterprise|Invalid option/);
    const c = ProfileCreateBodySchema.safeParse({ type: "enterprise" });
    // companyName optional at schema level; route handler keeps "companyName required."
    expect(c.success).toBe(true);
  });

  it("profile schemas accept the client's empty-string 'absent' fields", () => {
    // ProfileContent.tsx posts every field, "" for blanks — regression: these
    // must not 400 on the URL/handle shape checks.
    const individual = ProfileCreateBodySchema.safeParse({
      type: "individual", linkedinUrl: "", freeTextBio: "",
    });
    expect(individual.success).toBe(true);
    const enterprise = ProfileCreateBodySchema.safeParse({
      type: "enterprise", companyName: "Acme", companyDescription: "", websiteUrl: "", docsUrl: "", pdfText: "",
    });
    expect(enterprise.success).toBe(true);
    const update = ProfileUpdateBodySchema.safeParse({ linkedinUrl: "", xHandle: "", websiteUrl: "" });
    expect(update.success).toBe(true);
    // ...but non-empty garbage still fails
    expect(ProfileCreateBodySchema.safeParse({ type: "individual", linkedinUrl: "not a url" }).success).toBe(false);
    expect(ProfileCreateBodySchema.safeParse({ type: "individual", xHandle: "no peeps!" }).success).toBe(false);
  });
});
