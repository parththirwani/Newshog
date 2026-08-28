import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  normalizeLinkedInUrl,
  isVanityLinkedInUrl,
  linkedinProfileText,
  fetchLinkedInProfile,
} from "./linkedin";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { loadCachedJson, saveCachedJson } = vi.hoisted(() => ({
  loadCachedJson: vi.fn(),
  saveCachedJson: vi.fn(),
}));
vi.mock("./redis-json-cache", () => ({ loadCachedJson, saveCachedJson }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  loadCachedJson.mockReset().mockResolvedValue(null);
  saveCachedJson.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("URL helpers", () => {
  it("accepts vanity /in/<handle> forms", () => {
    expect(isVanityLinkedInUrl("https://www.linkedin.com/in/parth-thirwani-887b26217")).toBe(true);
    expect(isVanityLinkedInUrl("https://linkedin.com/in/satyanadella/")).toBe(true);
    expect(isVanityLinkedInUrl("https://linkedin.com/in/satyanadella/?utm_source=share")).toBe(true);
  });

  it("rejects encoded member-ID URLs and non-linkedin URLs", () => {
    expect(isVanityLinkedInUrl("https://www.linkedin.com/in/ACoAAAR-kOEBwpv4Kg1xD8fRWSax1kPNYjX2W88")).toBe(false);
    expect(isVanityLinkedInUrl("https://example.com/in/something")).toBe(false);
  });

  it("adds the scheme when missing", () => {
    expect(normalizeLinkedInUrl("linkedin.com/in/abc")).toBe("https://linkedin.com/in/abc");
  });

  it("sorts profile sections into prompt text", () => {
    expect(
      linkedinProfileText({
        fullName: "Parth Thirwani",
        headline: "Building Codemate",
        summary: "AI coding assistant.",
        positions: ["Founder at Codemate", "Engineer at Postman"],
        skills: ["TypeScript", "LLMs"],
      }),
    ).toContain("Headline: Building Codemate");
    expect(linkedinProfileText({ fullName: "x", headline: "", summary: "", positions: [], skills: [] })).toBe("");
  });
});

describe("fetchLinkedInProfile", () => {
  it("reports no_token without calling Apify", async () => {
    delete process.env.APIFY_TOKEN;
    const res = await fetchLinkedInProfile("https://linkedin.com/in/abc");
    expect(res).toEqual({ status: "error", reason: "no_token" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a non-vanity URL before calling Apify", async () => {
    process.env.APIFY_TOKEN = "tok";
    const res = await fetchLinkedInProfile("https://www.linkedin.com/in/ACoAAAR-kOEBwpv4Kg1xD8fRWSax1kPNYjX2W88");
    expect(res).toEqual({ status: "error", reason: "invalid_url" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps Apify not_found", async () => {
    process.env.APIFY_TOKEN = "tok";
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{ status: "not_found" }],
    });
    const res = await fetchLinkedInProfile("https://linkedin.com/in/private");
    expect(res).toEqual({ status: "not_found", reason: "not_found" });
  });

  it("maps free-tier overflow to a distinguishable error", async () => {
    process.env.APIFY_TOKEN = "tok";
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{ status: "error", error_kind: "free_tier_limit" }],
    });
    const res = await fetchLinkedInProfile("https://linkedin.com/in/abc");
    expect(res).toEqual({ status: "error", reason: "free_tier_limit" });
  });

  it("maps actor failure and non-2xx to errors", async () => {
    process.env.APIFY_TOKEN = "tok";
    fetchMock.mockResolvedValue({ ok: false, status: 429, text: async () => "rate limited" });
    const rateLimited = await fetchLinkedInProfile("https://linkedin.com/in/abc");
    expect(rateLimited).toEqual({ status: "error", reason: "rate_limited" });

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{ status: "error", reason: "upstream failed", error_kind: "actor_error" }],
    });
    const actorError = await fetchLinkedInProfile("https://linkedin.com/in/abc");
    expect(actorError).toEqual({ status: "error", reason: "actor_error" });
  });

  it("parses a successful profile into prompt-relevant fields", async () => {
    process.env.APIFY_TOKEN = "tok";
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        {
          status: "success",
          profile: {
            full_name: "Parth Thirwani",
            headline: "Building Codemate · Ex-Postman",
            summary: "Software developer working on an AI coding assistant.<p>More HTML.</p>",
            position_groups: [
              { profile_positions: [{ title: "Founder", company: "Codemate" }] },
              { profile_positions: [{ title: "Engineer", company: "Postman" }] },
            ],
            skills: ["TypeScript", "LLMs"],
          },
        },
      ],
    });
    const res = await fetchLinkedInProfile("https://linkedin.com/in/parth-thirwani-887b26217");
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.data.fullName).toBe("Parth Thirwani");
    expect(res.data.headline).toBe("Building Codemate · Ex-Postman");
    expect(res.data.summary).not.toContain("<p>");
    expect(res.data.positions).toEqual(["Founder at Codemate", "Engineer at Postman"]);
    expect(res.data.skills).toEqual(["TypeScript", "LLMs"]);

    // Full success is cached for the 24h window (so edits with an unchanged URL
    // don't re-run the paid Apify actor).
    expect(saveCachedJson).toHaveBeenCalledWith(
      "linkedin-profile-cache:",
      "https://linkedin.com/in/parth-thirwani-887b26217",
      expect.objectContaining({ fullName: "Parth Thirwani" }),
      86400,
    );
  });

  it("serves a cached result within 24h without calling Apify", async () => {
    process.env.APIFY_TOKEN = "tok";
    loadCachedJson.mockResolvedValue({
      fullName: "Parth Thirwani",
      headline: "cached headline",
      summary: "",
      positions: [],
      skills: [],
    });

    const res = await fetchLinkedInProfile("https://linkedin.com/in/parth-thirwani-887b26217");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.data.headline).toBe("cached headline");
  });

  it("does not cache not_found or error results", async () => {
    process.env.APIFY_TOKEN = "tok";

    fetchMock.mockResolvedValue({ ok: true, json: async () => [{ status: "not_found" }] });
    await fetchLinkedInProfile("https://linkedin.com/in/private");
    expect(saveCachedJson).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue({ ok: false, status: 429, text: async () => "rate limited" });
    await fetchLinkedInProfile("https://linkedin.com/in/abc");
    expect(saveCachedJson).not.toHaveBeenCalled();
  });
});